# Backfill tests (PHASE 4).
#
# Deterministic, OFFLINE (a stub geocoder — the real network probes live in
# the acceptance run, never in unit tests). Covers the PHASE 4 mandates:
#   * duplicate addresses geocode ONCE and write back to every row
#   * a second backfill run re-hits neither the API nor the quota (cache)
#   * geocode_source records provider AND coordinate system (amap_gcj02)
#   * a failed geocode leaves the row's coordinates NULL — never guessed

import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.crawlers.models import RawEvent  # noqa: E402
from pipeline.location.backfill import backfill_coordinates  # noqa: E402
from pipeline.location.geocoder import GeocodeCache, PlaceResolver  # noqa: E402
from pipeline.location.models import PlaceResolution  # noqa: E402
from pipeline.store.repository import EventRepository  # noqa: E402

TODAY = "2026-09-23T00:00:00"


class StubGeocoder(object):
    """Offline stand-in with the same interface + counters."""

    name = "stub"
    coord_system = "gcj02"

    def __init__(self, missing=()):
        self.calls = []
        self.missing = set(missing)

    def geocode(self, place, city=None):
        self.calls.append((place, city))
        if place in self.missing:
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name, detail="没有该地点")
        return PlaceResolution(place=place, status="resolved",
                               latitude=31.2304, longitude=121.4737,
                               provider=self.name,
                               displayName="上海市%s" % place,
                               coordSystem=self.coord_system)


def _add_event(repo, title, address, district="黄浦"):
    event = RawEvent(
        title=title, startTime="2026-09-26T14:00:00", city="上海",
        address=address, district=district, price="免费",
        sourceName="测试数据源",
        sourceUrl="https://example.com/events/%s" % title)
    kind, row_id = repo.upsert_event(event)
    assert kind == "inserted", kind
    return row_id


class TestDuplicateAddressSingleRequest(unittest.TestCase):
    def test_same_address_geocodes_once_writes_all_rows(self):
        stub = StubGeocoder()
        with EventRepository(":memory:") as repo:
            _add_event(repo, "活动甲", "南京西路 100 号")
            _add_event(repo, "活动乙", "南京西路100号")   # 空格差异，同一地址
            _add_event(repo, "活动丙", "南京西路 100 号")
            _add_event(repo, "活动丁", "淮海中路 200 号")
            resolver = PlaceResolver(stub)
            report = backfill_coordinates(repo, resolver, now=TODAY)
            self.assertEqual(report["uniqueAddresses"], 2)
            self.assertEqual(report["apiRequests"], 2)
            self.assertEqual(report["geocoded"], 4)
            self.assertEqual(len(stub.calls), 2)
            rows = repo.rows_missing_coordinates()
            self.assertEqual(len(rows), 0)


class TestBackfillIdempotency(unittest.TestCase):
    def test_second_run_uses_cache_not_api(self):
        stub = StubGeocoder()
        tmp = tempfile.mkdtemp(prefix="gorgon-bf-")
        cache = GeocodeCache(os.path.join(tmp, "geocode_cache.json"))
        with EventRepository(":memory:") as repo:
            _add_event(repo, "活动一", "西藏中路 1 号")
            _add_event(repo, "活动二", "南京东路 2 号")
            resolver = PlaceResolver(stub, cache=cache)
            first = backfill_coordinates(repo, resolver, now=TODAY)
            self.assertEqual(first["apiRequests"], 2)
            self.assertEqual(first["cacheHits"], 0)

            # 模拟增量：新爬到两条同地址、还没有坐标的活动
            _add_event(repo, "活动三", "西藏中路 1 号")
            _add_event(repo, "活动四", "南京东路 2 号")
            stub.calls = []
            second = backfill_coordinates(repo, resolver, now=TODAY)
            self.assertEqual(second["apiRequests"], 0)
            self.assertEqual(second["cacheHits"], 2)
            self.assertEqual(len(stub.calls), 0,
                            "第二次 backfill 不得重新请求 API")
            self.assertEqual(second["geocoded"], 2)

    def test_rerun_on_fully_geocoded_store_is_a_no_op(self):
        stub = StubGeocoder()
        with EventRepository(":memory:") as repo:
            _add_event(repo, "活动一", "西藏中路 1 号")
            resolver = PlaceResolver(stub)
            backfill_coordinates(repo, resolver, now=TODAY)
            stub.calls = []
            second = backfill_coordinates(repo, resolver, now=TODAY)
            self.assertEqual(second["candidates"], 0)
            self.assertEqual(second["apiRequests"], 0)


class TestCoordinateSystemPersistence(unittest.TestCase):
    def test_geocode_source_records_provider_and_datum(self):
        stub = StubGeocoder()
        with EventRepository(":memory:") as repo:
            row_id = _add_event(repo, "活动一", "西藏中路 1 号")
            backfill_coordinates(repo, PlaceResolver(stub), now=TODAY)
            row = repo.get_by_id(row_id)
            self.assertEqual(row["geocode_source"], "stub_gcj02")
            self.assertIsNotNone(row["geocoded_at"])

    def test_failed_geocode_leaves_coordinates_null(self):
        stub = StubGeocoder(missing=("西藏中路 1 号",))
        with EventRepository(":memory:") as repo:
            row_id = _add_event(repo, "活动一", "西藏中路 1 号")
            report = backfill_coordinates(repo, PlaceResolver(stub),
                                          now=TODAY)
            row = repo.get_by_id(row_id)
            self.assertIsNone(row["latitude"])
            self.assertIsNone(row["longitude"])
            self.assertEqual(report["notFound"], 1)
            self.assertEqual(report["geocoded"], 0)


if __name__ == "__main__":
    unittest.main()
