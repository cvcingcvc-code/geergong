# Nearby-search tests (PHASE 3).
#
# Covers: SearchRequest place fields, place parsing ("X附近" is a place, NOT
# a district), coordinate persistence + re-crawl survival, radius filtering
# (incl. the 2.9km-in / 3.1km-out regression the spec mandates), nearby
# ordering, unknown-place behaviour, and geocoder-unavailable honesty.
#
# All coordinates in the test store are SYNTHETIC TEST FIXTURES built with
# offset_lat_km() from one center — clearly labelled, never presented as
# real activity data, and only used to prove the math and the plumbing.

import os
import sys
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.crawlers.models import RawEvent  # noqa: E402
from pipeline.location.distance import distance_km, offset_lat_km  # noqa: E402
from pipeline.location.models import PlaceResolution  # noqa: E402
from pipeline.location.geocoder import PlaceResolver  # noqa: E402
from pipeline.search.models import SearchRequest  # noqa: E402
from pipeline.search.planner import parse_request  # noqa: E402
from pipeline.search.service import search_events  # noqa: E402
from pipeline.store.repository import EventRepository  # noqa: E402

TODAY = date(2026, 9, 15)

# Test anchor: Wujiaochang's real position — used ONLY as the center the
# synthetic fixture offsets are measured from.
CENTER = (31.304138, 121.515631)


def _km_offset(base, km_north, km_east):
    return offset_lat_km(base[0], base[1], km_north, km_east)


class NearbyFixture:
    """An in-memory event store seeded with synthetic-coordinate events."""

    def __init__(self):
        self.repo = EventRepository(":memory:")
        self.repo.open()

    def close(self):
        self.repo.close()

    def add_event(self, *, title, km_north, km_east, start="2026-09-26T14:00:00",
                  address="某测试路 1 号", keyword_hint=""):
        lat, lng = _km_offset(CENTER, km_north, km_east)
        event = RawEvent(
            title=title,
            startTime=start,
            city="上海",
            address=address,
            price="免费",
            sourceName="测试数据源",
            sourceUrl="https://example.com/events/%s" % title,
        )
        kind, row_id = self.repo.upsert_event(event)
        assert kind == "inserted", kind
        self.repo.update_coordinates(
            row_id, lat, lng,
            geocode_source="test-fixture",
            now="2026-09-15T00:00:00")
        return row_id


def _seed_standard(store):
    """A at 2.9km (inside), B at 3.1km (outside) — the spec's regression —
    plus nearer events for the ordering test."""
    store.add_event(title="A两九", km_north=2.9, km_east=0.0)
    store.add_event(title="B三一", km_north=3.1, km_east=0.0)
    store.add_event(title="C零五", km_north=0.5, km_east=0.0)
    store.add_event(title="D一八", km_north=1.8, km_east=0.0)
    return store


class TestCoordinatePersistence(unittest.TestCase):
    def test_coordinates_round_trip_with_provenance(self):
        store = NearbyFixture()
        try:
            row_id = store.add_event(title="坐标往返", km_north=1.0, km_east=0.5)
            row = store.repo.get_by_id(row_id)
            self.assertIsNotNone(row["latitude"])
            self.assertIsNotNone(row["longitude"])
            self.assertEqual(row["geocode_source"], "test-fixture")
            self.assertEqual(row["geocoded_at"], "2026-09-15T00:00:00")
        finally:
            store.close()

    def test_recrawl_does_not_wipe_geocoded_coordinates(self):
        store = NearbyFixture()
        try:
            row_id = store.add_event(title="重爬保护", km_north=1.0, km_east=0.0)
            before = store.repo.get_by_id(row_id)
            # The crawler re-upserts the same source URL: event_to_row carries
            # latitude=None ("not observed"), which must NOT overwrite the
            # geocoded coordinate.
            event = RawEvent(
                title="重爬保护（更新）",
                startTime="2026-09-26T14:00:00",
                city="上海",
                address="某测试路 1 号",
                sourceName="测试数据源",
                sourceUrl="https://example.com/events/重爬保护",
            )
            kind, same_id = store.repo.upsert_event(event)
            self.assertEqual(kind, "updated")
            self.assertEqual(same_id, row_id)
            after = store.repo.get_by_id(row_id)
            self.assertAlmostEqual(after["latitude"], before["latitude"])
            self.assertAlmostEqual(after["longitude"], before["longitude"])
            self.assertEqual(after["geocode_source"], "test-fixture")
        finally:
            store.close()

    def test_update_coordinates_refuses_null_and_sourceless(self):
        store = NearbyFixture()
        try:
            row_id = store.add_event(title="守卫", km_north=1.0, km_east=0.0)
            with self.assertRaises(ValueError):
                store.repo.update_coordinates(row_id, None, None,
                                              geocode_source="x")
            with self.assertRaises(ValueError):
                store.repo.update_coordinates(row_id, 31.0, 121.0,
                                              geocode_source=None)
        finally:
            store.close()

    def test_rows_missing_coordinates(self):
        store = NearbyFixture()
        try:
            event = RawEvent(
                title="还没有坐标", startTime="2026-09-26T10:00:00",
                city="上海", address="某真实地址",
                sourceName="测试数据源",
                sourceUrl="https://example.com/events/missing")
            _, row_id = store.repo.upsert_event(event)
            missing = store.repo.rows_missing_coordinates()
            self.assertTrue(any(r["id"] == row_id for r in missing))
        finally:
            store.close()


class TestRadiusFilterAndOrdering(unittest.TestCase):
    def test_regression_2_9km_in_3_1km_out(self):
        """THE spec regression: radius 3km keeps A (2.9km) and drops B (3.1km)."""
        store = NearbyFixture()
        try:
            _seed_standard(store)
            hits = store.repo.search_nearby(
                latitude=CENTER[0], longitude=CENTER[1], radius_km=3.0)
            titles = {h["title"] for h in hits}
            self.assertIn("A两九", titles)       # 2.9 km — MUST appear
            self.assertNotIn("B三一", titles)    # 3.1 km — MUST NOT appear
        finally:
            store.close()

    def test_boundary_exact_radius_is_inside(self):
        store = NearbyFixture()
        try:
            store.add_event(title="正好三公里", km_north=3.0, km_east=0.0)
            hits = store.repo.search_nearby(
                latitude=CENTER[0], longitude=CENTER[1], radius_km=3.0)
            self.assertEqual([h["title"] for h in hits], ["正好三公里"])
            self.assertAlmostEqual(hits[0]["distance_km"], 3.0, places=2)
        finally:
            store.close()

    def test_ordering_is_distance_ascending(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            hits = store.repo.search_nearby(
                latitude=CENTER[0], longitude=CENTER[1], radius_km=3.0)
            titles = [h["title"] for h in hits]
            self.assertEqual(titles, ["C零五", "D一八", "A两九"])
            self.assertTrue(all(hits[i]["distance_km"] <= hits[i + 1]["distance_km"]
                                for i in range(len(hits) - 1)))
        finally:
            store.close()

    def test_keyword_filter(self):
        store = NearbyFixture()
        try:
            store.add_event(title="网球局", km_north=0.8, km_east=0.0)
            store.add_event(title="读书会", km_north=1.2, km_east=0.0)
            hits = store.repo.search_nearby(
                latitude=CENTER[0], longitude=CENTER[1], radius_km=3.0,
                keyword="网球")
            self.assertEqual([h["title"] for h in hits], ["网球局"])
        finally:
            store.close()

    def test_date_filter(self):
        store = NearbyFixture()
        try:
            store.add_event(title="九二六", km_north=0.8, km_east=0.0,
                            start="2026-09-26T14:00:00")
            store.add_event(title="十一〇一", km_north=1.2, km_east=0.0,
                            start="2026-10-01T09:00:00")
            hits = store.repo.search_nearby(
                latitude=CENTER[0], longitude=CENTER[1], radius_km=3.0,
                date_start="2026-09-25", date_end="2026-09-27")
            self.assertEqual([h["title"] for h in hits], ["九二六"])
        finally:
            store.close()

    def test_ungeocoded_rows_are_invisible_to_nearby(self):
        store = NearbyFixture()
        try:
            event = RawEvent(
                title="没有坐标的活动", startTime="2026-09-26T14:00:00",
                city="上海", address="杨浦区某路",
                sourceName="测试数据源",
                sourceUrl="https://example.com/events/nocoord")
            store.repo.upsert_event(event)
            hits = store.repo.search_nearby(
                latitude=CENTER[0], longitude=CENTER[1], radius_km=3.0)
            self.assertEqual(hits, [])
        finally:
            store.close()

    def test_invalid_radius_raises(self):
        store = NearbyFixture()
        try:
            with self.assertRaises(ValueError):
                store.repo.search_nearby(latitude=31.3, longitude=121.5,
                                         radius_km=0)
        finally:
            store.close()


class TestCoordinateStats(unittest.TestCase):
    def test_stats_shape(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            stats = store.repo.coordinate_stats()
            self.assertEqual(stats["totalEvents"], 4)
            self.assertEqual(stats["withCoordinates"], 4)
            self.assertEqual(stats["bySource"][0]["source"], "test-fixture")
        finally:
            store.close()


class TestPlaceParsing(unittest.TestCase):
    def test_wujiaochang_is_a_place_not_a_district(self):
        req = parse_request("五角场附近这个周末有什么活动")
        self.assertEqual(req.place, "五角场")
        self.assertIsNone(req.locationPreference)   # 五角场 != 杨浦
        self.assertIsNone(req.district)
        self.assertEqual(req.radiusKm, None)        # no radius mentioned
        self.assertEqual(req.dateRange, {"type": "relative", "value": "this_weekend"})

    def test_jingansi_does_not_leak_jingan_district(self):
        req = parse_request("静安寺附近有什么活动")
        self.assertEqual(req.place, "静安寺")
        self.assertIsNone(req.locationPreference)   # the leak this phase kills

    def test_explicit_radius_km_parsed(self):
        req = parse_request("人民广场附近3公里内有什么活动")
        self.assertEqual(req.place, "人民广场")
        self.assertEqual(req.radiusKm, 3.0)

    def test_radius_in_km_letters(self):
        req = parse_request("新天地附近5km的活动")
        self.assertEqual(req.place, "新天地")
        self.assertEqual(req.radiusKm, 5.0)

    def test_university_place_survives(self):
        req = parse_request("上海交通大学附近有什么讲座")
        self.assertEqual(req.place, "上海交通大学")
        self.assertIsNone(req.locationPreference)

    def test_sentence_prefix_is_trimmed(self):
        req = parse_request("我周末想去五角场附近")
        self.assertEqual(req.place, "五角场")

    def test_district_place_keeps_legacy_behaviour(self):
        # "徐汇附近" was, and stays, a SOFT district preference — the tested
        # contract of earlier phases. It is not a place search.
        req = parse_request("这个周末上海有什么AI活动？最好免费，徐汇附近，下午开始。")
        self.assertIsNone(req.place)
        self.assertEqual(req.locationPreference, "徐汇")

    def test_search_request_round_trip(self):
        req = SearchRequest(
            query="附近", place="五角场", latitude=31.30, longitude=121.51,
            radiusKm=3.0)
        data = req.to_dict()
        self.assertEqual(data["place"], "五角场")
        self.assertEqual(data["radiusKm"], 3.0)
        back = SearchRequest.from_dict(data)
        self.assertEqual(back.place, "五角场")
        self.assertAlmostEqual(back.latitude, 31.30)
        self.assertAlmostEqual(back.radiusKm, 3.0)
        snake = SearchRequest.from_dict(
            {"place": "静安寺", "latitude": 31.2, "longitude": 121.4,
             "radius_km": 2.5})
        self.assertEqual(snake.place, "静安寺")
        self.assertAlmostEqual(snake.radiusKm, 2.5)


class _StubResolver:
    def __init__(self, resolution):
        self.resolution = resolution

    def resolve(self, place, city=None):
        return self.resolution


class TestServiceNearby(unittest.TestCase):
    """The service-level honesty rules, offline via injected repo/resolver."""

    def test_geocoder_unavailable_is_not_configured_no_fabrication(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            # No geocoder configured (default env in tests): the service must
            # refuse to guess coordinates and return an honest empty result.
            result = search_events(
                {"query": "这个周末有什么活动", "place": "五角场", "radiusKm": 3},
                today=TODAY, repository=store.repo)
            self.assertEqual(result["placeResolution"]["status"],
                             "not_configured")
            self.assertEqual(result["results"], [])
            # The failure must be visible, not silent.
            codes = {n.get("code") for n in result["notices"]}
            self.assertIn("geocoder_not_configured", codes)
        finally:
            store.close()

    def test_not_configured_never_degrades_to_district_search(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            result = search_events(
                {"query": "五角场附近的活动"}, today=TODAY,
                repository=store.repo)
            self.assertEqual(result["results"], [])
            self.assertNotIn("杨浦", result["request"].get("district") or "")
            self.assertIsNone(result["request"].get("locationPreference"))
        finally:
            store.close()

    def test_unknown_place_is_not_found(self):
        store = NearbyFixture()
        try:
            resolver = _StubResolver(PlaceResolution(
                place="不存在的地方", status="not_found",
                detail="没有该地点"))
            result = search_events(
                {"query": "x", "place": "不存在的地方", "radiusKm": 3},
                today=TODAY, repository=store.repo, resolver=resolver)
            self.assertEqual(result["status"], "empty")
            self.assertEqual(result["placeResolution"]["status"], "not_found")
            self.assertEqual(result["results"], [])
        finally:
            store.close()

    def test_explicit_coordinates_resolve_without_geocoder(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            result = search_events(
                {"query": "附近活动", "latitude": CENTER[0],
                 "longitude": CENTER[1], "radiusKm": 3},
                today=TODAY, repository=store.repo)
            self.assertEqual(result["placeResolution"]["status"], "resolved")
            self.assertEqual(result["placeResolution"]["provider"], "caller")
            titles = [r["activity"]["title"] for r in result["results"]]
            self.assertEqual(titles, ["C零五", "D一八", "A两九"])
            self.assertNotIn("B三一", titles)
        finally:
            store.close()

    def test_nearby_results_carry_distance_and_ordering(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            result = search_events(
                {"query": "附近活动", "place": "五角场", "radiusKm": 3},
                today=TODAY, repository=store.repo,
                resolver=_StubResolver(PlaceResolution(
                    place="五角场", status="resolved", latitude=CENTER[0],
                    longitude=CENTER[1], provider="stub",
                    displayName="五角场", coordSystem="gcj02")))
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["placeResolution"]["resolvedPlace"],
                             "五角场")
            self.assertEqual(result["placeResolution"]["latitude"], CENTER[0])
            self.assertEqual(result["placeResolution"]["longitude"], CENTER[1])
            distances = [r["distanceKm"] for r in result["results"]]
            self.assertEqual(distances, sorted(distances))
            self.assertTrue(all(d <= 3.0 for d in distances))
            first = result["results"][0]
            self.assertEqual(first["activity"]["title"], "C零五")
            self.assertEqual(first["provenance"][0]["dataOrigin"], "real")
            self.assertIsNotNone(first["activity"]["sourceUrl"])
            self.assertIsNotNone(first["activity"]["address"])
        finally:
            store.close()

    def test_zero_results_within_radius_is_honest_no_auto_expand(self):
        store = NearbyFixture()
        try:
            store.add_event(title="很远", km_north=20.0, km_east=0.0)
            result = search_events(
                {"query": "x", "place": "五角场", "radiusKm": 3},
                today=TODAY, repository=store.repo,
                resolver=_StubResolver(PlaceResolution(
                    place="五角场", status="resolved", latitude=CENTER[0],
                    longitude=CENTER[1], provider="stub", coordSystem="gcj02")))
            self.assertEqual(result["status"], "empty")
            self.assertEqual(result["results"], [])
            codes = {n.get("code") for n in result["notices"]}
            self.assertIn("no_results_within_radius", codes)
            message = next(n["message"] for n in result["notices"]
                           if n.get("code") == "no_results_within_radius")
            self.assertIn("不会自动扩大", message)
        finally:
            store.close()

    def test_caller_radius_is_never_widened(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            result = search_events(
                {"query": "x", "place": "五角场", "radiusKm": 1.0},
                today=TODAY, repository=store.repo,
                resolver=_StubResolver(PlaceResolution(
                    place="五角场", status="resolved", latitude=CENTER[0],
                    longitude=CENTER[1], provider="stub", coordSystem="gcj02")))
            self.assertEqual(result["radiusKm"], 1.0)
            titles = [r["activity"]["title"] for r in result["results"]]
            self.assertEqual(titles, ["C零五"])   # only the 0.5km event
        finally:
            store.close()

    def test_natural_language_place_query_routes_to_nearby(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            # No resolver stub: the request must still reach the nearby path
            # (and honestly report not_configured) rather than the web chain.
            result = search_events(
                "五角场附近这个周末有什么活动", today=TODAY,
                repository=store.repo)
            self.assertEqual(result["placeResolution"]["place"], "五角场")
            self.assertEqual(result["results"], [])
        finally:
            store.close()

    def test_dict_with_only_query_still_extracts_place(self):
        # Regression: the API posts {"query": "静安寺附近…"} — the reparse of
        # a bare dict must not wipe the place the parser just extracted.
        store = NearbyFixture()
        try:
            _seed_standard(store)
            result = search_events(
                {"query": "静安寺附近这个周末有什么活动"},
                today=TODAY, repository=store.repo)
            self.assertEqual(result["placeResolution"]["place"], "静安寺")
            self.assertEqual(result["results"], [])
        finally:
            store.close()

    def test_summary_reports_local_pool_counts(self):
        store = NearbyFixture()
        try:
            _seed_standard(store)
            result = search_events(
                {"query": "x", "place": "五角场", "radiusKm": 3},
                today=TODAY, repository=store.repo,
                resolver=_StubResolver(PlaceResolution(
                    place="五角场", status="resolved", latitude=CENTER[0],
                    longitude=CENTER[1], provider="stub", coordSystem="gcj02")))
            nearby = result["summary"]["nearby"]
            self.assertEqual(nearby["localCandidates"], 3)
            self.assertEqual(nearby["primaryPool"], "local_index")
            self.assertEqual(nearby["radiusKm"], 3.0)
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
