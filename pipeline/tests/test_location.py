# Location-layer tests (PHASE 3).
#
# Covers: Haversine distance math, geocoder response parsers (offline, against
# recorded payload shapes), geocoder selection from the environment, and the
# PlaceResolver honesty rules (not_configured / not_found / error / cache).
#
# NO test in this file touches the network: parsers are pure functions and
# the HTTP boundary is injected via open_fn / stub geocoders.

import os
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.location.distance import (  # noqa: E402
    distance_km, offset_lat_km, within_radius,
)
from pipeline.location.geocoder import (  # noqa: E402
    AmapGeocoder, BaiduGeocoder, GeocodeCache, Geocoder, NominatimGeocoder,
    PlaceResolver, amap_payload_is_key_error, get_geocoder,
    parse_amap_geocode, parse_baidu_geocode, parse_nominatim,
)
from pipeline.location.models import PlaceResolution  # noqa: E402

# Recorded-shape payloads (real API response structures, fixed values).
AMAP_OK = {
    "status": "1", "info": "OK", "infocode": "10000",
    "geocodes": [{
        "formatted_address": "上海市杨浦区五角场",
        "country": "中国", "province": "上海市", "city": "上海市",
        "district": "杨浦区", "level": "热点商圈",
        "location": "121.515631,31.304138",
    }],
}
AMAP_EMPTY = {"status": "1", "info": "OK", "infocode": "10000", "geocodes": []}
AMAP_BAD_KEY = {"status": "0", "info": "INVALID_USER_KEY", "infocode": "10001"}

BAIDU_OK = {
    "status": 0,
    "result": {"location": {"lng": 121.515631, "lat": 31.304138},
               "level": "地标"},
}
BAIDU_BAD_KEY = {"status": 200, "message": "APP不存在，AK有误请检查再重试"}

NOMINATIM_OK = [{
    "place_id": 1, "lat": "31.304138", "lon": "121.515631",
    "display_name": "五角场, 杨浦区, 上海市, 中国",
}]


class _FakeHeaders:
    @staticmethod
    def get_content_charset(*_args):
        return "utf-8"


class _FakeResponse:
    headers = _FakeHeaders()

    def __init__(self, payload):
        import json
        self._body = json.dumps(payload).encode("utf-8")

    def read(self, _n=-1):
        return self._body


def _fake_open(payload):
    def open_fn(request):
        return _FakeResponse(payload)
    return open_fn


class TestDistance(unittest.TestCase):
    def test_zero_distance(self):
        self.assertAlmostEqual(distance_km(31.30, 121.51, 31.30, 121.51), 0.0)

    def test_one_degree_latitude_is_about_111_km(self):
        d = distance_km(31.0, 121.0, 32.0, 121.0)
        self.assertTrue(110.0 < d < 112.5, d)

    def test_symmetry(self):
        a = distance_km(31.3041, 121.5156, 31.2335, 121.4693)
        b = distance_km(31.2335, 121.4693, 31.3041, 121.5156)
        self.assertAlmostEqual(a, b, places=10)

    def test_wujiaochang_to_people_square_is_about_9_km(self):
        d = distance_km(31.3041, 121.5156, 31.2335, 121.4693)
        self.assertTrue(8.0 < d < 10.0, d)

    def test_out_of_range_input_raises(self):
        with self.assertRaises(ValueError):
            distance_km(95.0, 121.0, 31.0, 121.0)
        with self.assertRaises(ValueError):
            distance_km(31.0, "abc", 31.0, 121.0)

    def test_within_radius_includes_the_boundary(self):
        # Contract: an event AT radius_km is inside ("3km 附近" includes 3.0).
        self.assertTrue(within_radius(3.0, 3.0))
        self.assertTrue(within_radius(2.99, 3.0))
        self.assertFalse(within_radius(3.01, 3.0))
        self.assertFalse(within_radius(None, 3.0))
        self.assertFalse(within_radius(1.0, None))

    def test_offset_helper_builds_known_distances(self):
        lat, lng = offset_lat_km(31.3041, 121.5156, km_north=2.9, km_east=0.0)
        self.assertAlmostEqual(distance_km(31.3041, 121.5156, lat, lng), 2.9,
                               places=3)


class TestAmapParser(unittest.TestCase):
    def test_success_payload(self):
        parsed = parse_amap_geocode(AMAP_OK)
        self.assertIsNotNone(parsed)
        latitude, longitude, display = parsed
        self.assertAlmostEqual(latitude, 31.304138)
        self.assertAlmostEqual(longitude, 121.515631)
        self.assertEqual(display, "上海市杨浦区五角场")

    def test_empty_geocodes_is_no_match(self):
        self.assertIsNone(parse_amap_geocode(AMAP_EMPTY))

    def test_malformed_payload_is_no_match_not_crash(self):
        for payload in (None, {}, {"status": "1"}, {"status": "1", "geocodes": [1]},
                        {"status": "1", "geocodes": [{"location": "nonsense"}]},
                        {"status": "1", "geocodes": [{"location": "999,999"}]}):
            self.assertIsNone(parse_amap_geocode(payload))

    def test_key_error_detection(self):
        self.assertTrue(amap_payload_is_key_error(AMAP_BAD_KEY))
        self.assertFalse(amap_payload_is_key_error(AMAP_OK))
        self.assertFalse(amap_payload_is_key_error(AMAP_EMPTY))


class TestBaiduParser(unittest.TestCase):
    def test_success_payload(self):
        parsed = parse_baidu_geocode(BAIDU_OK)
        self.assertIsNotNone(parsed)
        latitude, longitude, _ = parsed
        self.assertAlmostEqual(latitude, 31.304138)
        self.assertAlmostEqual(longitude, 121.515631)

    def test_bad_key_is_no_match(self):
        self.assertIsNone(parse_baidu_geocode(BAIDU_BAD_KEY))
        self.assertIsNone(parse_baidu_geocode(None))
        self.assertIsNone(parse_baidu_geocode({"status": 0, "result": {}}))


class TestNominatimParser(unittest.TestCase):
    def test_success_payload(self):
        parsed = parse_nominatim(NOMINATIM_OK)
        self.assertIsNotNone(parsed)
        latitude, longitude, display = parsed
        self.assertAlmostEqual(latitude, 31.304138)
        self.assertAlmostEqual(longitude, 121.515631)
        self.assertIn("五角场", display)

    def test_empty_and_malformed(self):
        self.assertIsNone(parse_nominatim([]))
        self.assertIsNone(parse_nominatim([{"lat": "x", "lon": "y"}]))
        self.assertIsNone(parse_nominatim(None))


class _StubGeocoder(Geocoder):
    """Programmable offline geocoder for resolver tests."""

    name = "stub"   # real geocoders all carry a name; the cache keys on it

    def __init__(self, resolution=None, calls=None):
        self.resolution = resolution
        self.calls = calls if calls is not None else []

    def geocode(self, place, city=None):
        self.calls.append((place, city))
        if isinstance(self.resolution, Exception):
            raise self.resolution
        return self.resolution


class TestPlaceResolver(unittest.TestCase):
    def test_no_geocoder_is_not_configured_never_a_guess(self):
        resolver = PlaceResolver(None)
        resolution = resolver.resolve("五角场", city="上海")
        self.assertEqual(resolution.status, "not_configured")
        self.assertIsNone(resolution.latitude)
        self.assertIsNone(resolution.longitude)

    def test_empty_place_is_not_found(self):
        resolver = PlaceResolver(_StubGeocoder())
        self.assertEqual(resolver.resolve("", city="上海").status, "not_found")
        self.assertEqual(resolver.resolve(None, city="上海").status, "not_found")

    def test_resolved_passes_fields_through(self):
        stub = _StubGeocoder(PlaceResolution(
            place="五角场", status="resolved", latitude=31.304138,
            longitude=121.515631, provider="stub",
            displayName="上海市杨浦区五角场", coordSystem="gcj02"))
        resolution = PlaceResolver(stub).resolve("五角场", city="上海")
        self.assertTrue(resolution.ok)
        self.assertAlmostEqual(resolution.latitude, 31.304138)
        self.assertEqual(resolution.coordSystem, "gcj02")
        self.assertEqual(stub.calls, [("五角场", "上海")])

    def test_geocoder_exception_is_error_not_crash(self):
        stub = _StubGeocoder(RuntimeError("network down"))
        resolution = PlaceResolver(stub).resolve("五角场", city="上海")
        self.assertEqual(resolution.status, "error")
        self.assertIn("network down", resolution.detail)

    def test_cache_prevents_second_call(self):
        stub = _StubGeocoder(PlaceResolution(
            place="五角场", status="resolved", latitude=31.3,
            longitude=121.5, provider="stub"))
        with tempfile.TemporaryDirectory() as tmp:
            cache = GeocodeCache(os.path.join(tmp, "cache.json"))
            resolver = PlaceResolver(stub, cache=cache)
            first = resolver.resolve("五角场", city="上海")
            second = resolver.resolve("五角场", city="上海")
        self.assertTrue(first.ok and second.ok)
        self.assertEqual(len(stub.calls), 1)


class TestGetGeocoder(unittest.TestCase):
    def test_no_keys_is_none(self):
        env = {"AMAP_KEY": "", "GORGON_AMAP_KEY": "", "GAODE_KEY": "",
               "BAIDU_MAP_AK": "", "GORGON_BAIDU_AK": "", "BAIDU_AK": "",
               "GORGON_GEOCODER": ""}
        self.assertIsNone(get_geocoder(env=env, proxy=None))

    def test_amap_key_selected(self):
        geocoder = get_geocoder(env={"AMAP_KEY": "k1"}, proxy=None)
        self.assertIsInstance(geocoder, AmapGeocoder)

    def test_baidu_key_selected(self):
        geocoder = get_geocoder(env={"BAIDU_MAP_AK": "ak1"}, proxy=None)
        self.assertIsInstance(geocoder, BaiduGeocoder)

    def test_explicit_off_wins_over_keys(self):
        geocoder = get_geocoder(
            env={"GORGON_GEOCODER": "off", "AMAP_KEY": "k1"}, proxy=None)
        self.assertIsNone(geocoder)

    def test_explicit_provider_without_key_raises_loudly(self):
        with self.assertRaises(ValueError):
            get_geocoder(env={"GORGON_GEOCODER": "amap"}, proxy=None)

    def test_unknown_choice_raises(self):
        with self.assertRaises(ValueError):
            get_geocoder(env={"GORGON_GEOCODER": "magic"}, proxy=None)


class TestGeocoderHttpStub(unittest.TestCase):
    """The full geocode() path with the network injected."""

    def test_amap_success(self):
        geocoder = AmapGeocoder("test-key", open_fn=_fake_open(AMAP_OK),
                                rate_limit=0)
        resolution = geocoder.geocode("五角场", city="上海")
        self.assertTrue(resolution.ok)
        self.assertEqual(resolution.provider, "amap")
        self.assertEqual(resolution.coordSystem, "gcj02")

    def test_amap_bad_key_is_error_not_not_found(self):
        geocoder = AmapGeocoder("bad-key", open_fn=_fake_open(AMAP_BAD_KEY),
                                rate_limit=0)
        resolution = geocoder.geocode("五角场", city="上海")
        self.assertEqual(resolution.status, "error")
        self.assertIn("key", resolution.detail)

    def test_amap_empty_is_not_found(self):
        geocoder = AmapGeocoder("test-key", open_fn=_fake_open(AMAP_EMPTY),
                                rate_limit=0)
        self.assertEqual(geocoder.geocode("不存在的地方").status, "not_found")

    def test_baidu_success_and_key_error(self):
        geocoder = BaiduGeocoder("ak", open_fn=_fake_open(BAIDU_OK),
                                 rate_limit=0)
        self.assertTrue(geocoder.geocode("五角场").ok)
        geocoder = BaiduGeocoder("ak", open_fn=_fake_open(BAIDU_BAD_KEY),
                                 rate_limit=0)
        self.assertEqual(geocoder.geocode("五角场").status, "error")

    def test_nominatim_success(self):
        geocoder = NominatimGeocoder(open_fn=_fake_open(NOMINATIM_OK))
        self.assertTrue(geocoder.geocode("五角场").ok)

    def test_network_failure_is_error(self):
        def boom(request):
            raise OSError("connection refused")
        geocoder = AmapGeocoder("k", open_fn=boom, rate_limit=0)
        resolution = geocoder.geocode("五角场")
        self.assertEqual(resolution.status, "error")


if __name__ == "__main__":
    unittest.main()
