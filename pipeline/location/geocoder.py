# Geocoding layer (PHASE 3).
#
# place text -> real coordinates, via a real map/Geocoding API. The rules the
# PHASE 3 spec is strict about, enforced here and nowhere else:
#
#   * NO configured geocoder  -> PlaceResolution(status="not_configured").
#     The caller gets an honest empty result. NO coordinate is ever guessed,
#     no district centroid is fabricated, nothing is "close enough".
#   * A geocoder that answers "I don't know" -> status="not_found".
#   * A geocoder that fails (bad key / network / malformed payload)
#     -> status="error", with the reason in `detail`.
#   * Every resolution carries the provider name and its coordinate system
#     (GCJ-02 for Amap, BD-09 for Baidu, WGS-84 for Nominatim). Mixing datums
#     silently would bend every radius by 100-500m — we record it instead.
#
# The network call is isolated in `_get_json`; the response parsers are pure
# functions (parse_amap_geocode / parse_baidu_geocode / parse_nominatim) so
# they can be tested offline against recorded payloads.

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from pipeline.location.models import PlaceResolution

# --- provider endpoint constants ---------------------------------------------

AMAP_GEO_ENDPOINT = "https://restapi.amap.com/v3/geocode/geo"
BAIDU_GEO_ENDPOINT = "https://api.map.baidu.com/geocoding/v3/"
NOMINATIM_GEO_ENDPOINT = "https://nominatim.openstreetmap.org/search"

DEFAULT_TIMEOUT_SECONDS = 10.0

# Free-tier courtesy: Amap allows ~3 QPS for personal keys. One call every
# 0.35s keeps a 100-row backfill well inside the quota.
DEFAULT_RATE_LIMIT_SECONDS = 0.35

# Every coordinate we accept must land inside China's bounding box. The
# geocoders are queried with Chinese addresses; a "resolved" point outside
# this box means the API answered something we mis-parsed.
CHINA_BBOX = (73.0, 3.0, 136.0, 54.0)   # (min_lng, min_lat, max_lng, max_lat)


def _valid_china_coordinates(latitude, longitude):
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return False
    if latitude != latitude or longitude != longitude:   # NaN
        return False
    min_lng, min_lat, max_lng, max_lat = CHINA_BBOX
    return (min_lat <= latitude <= max_lat
            and min_lng <= longitude <= max_lng)


# --- response parsers (pure, offline-testable) -------------------------------
#
# Each returns (latitude, longitude, display_name) or None. None means "the
# payload is well-formed but holds no match" — NOT "the payload is broken".

def parse_amap_geocode(payload):
    """Amap /v3/geocode/geo success shape:
    {"status":"1","geocodes":[{"location":"121.515631,31.304138",
                               "formatted_address":"..."}]}
    `location` is "lng,lat" — the API's own order, easy to swap by accident.
    """
    if not isinstance(payload, dict) or payload.get("status") != "1":
        return None
    geocodes = payload.get("geocodes")
    if not isinstance(geocodes, list) or not geocodes:
        return None
    first = geocodes[0]
    if not isinstance(first, dict):
        return None
    location = first.get("location")
    if not isinstance(location, str) or "," not in location:
        return None
    lng_text, _, lat_text = location.partition(",")
    try:
        longitude = float(lng_text.strip())
        latitude = float(lat_text.strip())
    except ValueError:
        return None
    if not _valid_china_coordinates(latitude, longitude):
        return None
    return latitude, longitude, first.get("formatted_address")


def amap_payload_is_key_error(payload):
    """Amap answers key problems with status "0" + an infocode in the 100xx
    range. That is a CONFIGURATION failure and must surface as `error`,
    not quietly as "place not found"."""
    if not isinstance(payload, dict) or payload.get("status") != "0":
        return False
    infocode = str(payload.get("infocode") or "")
    return infocode.startswith("100")


def parse_baidu_geocode(payload):
    """Baidu /geocoding/v3/ success shape:
    {"status":0,"result":{"location":{"lng":121.51,"lat":31.30},"level":"地标"}}
    """
    if not isinstance(payload, dict) or payload.get("status") != 0:
        return None
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    location = result.get("location")
    if not isinstance(location, dict):
        return None
    latitude = location.get("lat")
    longitude = location.get("lng")
    if not _valid_china_coordinates(latitude, longitude):
        return None
    return latitude, longitude, result.get("level")


def parse_nominatim(payload):
    """Nominatim /search (jsonv2) success shape: a list of hits.
    [{"lat":"31.3041","lon":"121.5156","display_name":"..."}]
    """
    if not isinstance(payload, list) or not payload:
        return None
    first = payload[0]
    if not isinstance(first, dict):
        return None
    try:
        latitude = float(first.get("lat"))
        longitude = float(first.get("lon"))
    except (TypeError, ValueError):
        return None
    if not _valid_china_coordinates(latitude, longitude):
        return None
    return latitude, longitude, first.get("display_name")


# --- HTTP plumbing -------------------------------------------------------------

def _get_json(url, params, *, proxy=None, timeout=DEFAULT_TIMEOUT_SECONDS,
              headers=None, open_fn=None):
    """GET `url` with `params`, return the parsed JSON body.

    The proxy is applied EXPLICITLY (urllib does not honour the environment
    once we build the opener ourselves). `open_fn` is injectable so tests can
    stub the network without patching urllib internals.
    """
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        "%s?%s" % (url, query), headers=headers or {"User-Agent": "GorgonNearby/1.0"})
    if open_fn is not None:
        response = open_fn(request)
    else:
        handlers = []
        if proxy:
            handlers.append(urllib.request.ProxyHandler(
                {"http": proxy, "https": proxy}))
        opener = urllib.request.build_opener(*handlers)
        response = opener.open(request, timeout=timeout)
    charset = response.headers.get_content_charset() or "utf-8"
    return json.loads(response.read().decode(charset, "replace"))


class GeocodeNetworkError(Exception):
    """Raised when the geocoder could not be reached at all."""


# --- geocoders ------------------------------------------------------------------

class Geocoder(object):
    """Interface: geocode(place_text, city=None) -> PlaceResolution."""

    name = None
    coord_system = None

    def geocode(self, place, city=None):
        raise NotImplementedError


class AmapGeocoder(Geocoder):
    """高德地图 Web 服务 API（正规中国地图数据源，GCJ-02 坐标系）."""

    name = "amap"
    coord_system = "gcj02"

    def __init__(self, key, *, endpoint=AMAP_GEO_ENDPOINT, proxy=None,
                 timeout=DEFAULT_TIMEOUT_SECONDS, rate_limit=DEFAULT_RATE_LIMIT_SECONDS,
                 open_fn=None):
        if not key:
            raise ValueError("AmapGeocoder needs an API key (AMAP_KEY)")
        self.key = key
        self.endpoint = endpoint
        self.proxy = proxy
        self.timeout = timeout
        self.rate_limit = rate_limit
        self._last_request_at = 0.0
        self._open_fn = open_fn

    def _throttle(self):
        if not self.rate_limit:
            return
        elapsed = time.time() - self._last_request_at
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self._last_request_at = time.time()

    def geocode(self, place, city=None):
        if not place or not str(place).strip():
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name,
                                   detail="地点为空，无法解析")
        self._throttle()
        params = {"key": self.key, "address": str(place).strip(),
                  "city": (city or "上海")}
        try:
            payload = _get_json(self.endpoint, params, proxy=self.proxy,
                                timeout=self.timeout, open_fn=self._open_fn)
        except Exception as exc:   # network layer — honest `error`
            return PlaceResolution(place=place, status="error",
                                   provider=self.name,
                                   detail="Geocoding 请求失败：%s" % exc)
        if amap_payload_is_key_error(payload):
            return PlaceResolution(place=place, status="error",
                                   provider=self.name,
                                   detail="高德 API key 无效：%s"
                                          % payload.get("info"))
        parsed = parse_amap_geocode(payload)
        if parsed is None:
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name,
                                   detail="高德没有返回该地点的坐标")
        latitude, longitude, display = parsed
        return PlaceResolution(place=place, status="resolved",
                               latitude=latitude, longitude=longitude,
                               provider=self.name, displayName=display,
                               coordSystem=self.coord_system)


class BaiduGeocoder(Geocoder):
    """百度地图地理编码 API（BD-09 坐标系）."""

    name = "baidu"
    coord_system = "bd09"

    def __init__(self, ak, *, endpoint=BAIDU_GEO_ENDPOINT, proxy=None,
                 timeout=DEFAULT_TIMEOUT_SECONDS, rate_limit=DEFAULT_RATE_LIMIT_SECONDS,
                 open_fn=None):
        if not ak:
            raise ValueError("BaiduGeocoder needs an AK (BAIDU_MAP_AK)")
        self.ak = ak
        self.endpoint = endpoint
        self.proxy = proxy
        self.timeout = timeout
        self.rate_limit = rate_limit
        self._last_request_at = 0.0
        self._open_fn = open_fn

    def _throttle(self):
        if not self.rate_limit:
            return
        elapsed = time.time() - self._last_request_at
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self._last_request_at = time.time()

    def geocode(self, place, city=None):
        if not place or not str(place).strip():
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name,
                                   detail="地点为空，无法解析")
        self._throttle()
        params = {"address": str(place).strip(), "output": "json",
                  "ak": self.ak}
        if city:
            params["city"] = city
        try:
            payload = _get_json(self.endpoint, params, proxy=self.proxy,
                                timeout=self.timeout, open_fn=self._open_fn)
        except Exception as exc:
            return PlaceResolution(place=place, status="error",
                                   provider=self.name,
                                   detail="Geocoding 请求失败：%s" % exc)
        # Baidu signals key problems with a non-zero status + 2xx HTTP, so the
        # parser would call it "no match" — catch it BEFORE parsing.
        if isinstance(payload, dict) and payload.get("status") not in (0, None):
            return PlaceResolution(place=place, status="error",
                                   provider=self.name,
                                   detail="百度 API 返回错误：%s"
                                          % payload.get("message"))
        parsed = parse_baidu_geocode(payload)
        if parsed is None:
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name,
                                   detail="百度没有返回该地点的坐标")
        latitude, longitude, display = parsed
        return PlaceResolution(place=place, status="resolved",
                               latitude=latitude, longitude=longitude,
                               provider=self.name, displayName=display,
                               coordSystem=self.coord_system)


class NominatimGeocoder(Geocoder):
    """OpenStreetMap Nominatim（WGS-84 坐标系；本机网络不可达时为 error）."""

    name = "nominatim"
    coord_system = "wgs84"

    def __init__(self, *, endpoint=NOMINATIM_GEO_ENDPOINT, proxy=None,
                 timeout=DEFAULT_TIMEOUT_SECONDS,
                 user_agent="GorgonNearby/1.0 (event-nearby-search)",
                 open_fn=None):
        self.endpoint = endpoint
        self.proxy = proxy
        self.timeout = timeout
        self.user_agent = user_agent
        self._open_fn = open_fn

    def geocode(self, place, city=None):
        if not place or not str(place).strip():
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name,
                                   detail="地点为空，无法解析")
        query = str(place).strip()
        if city and city not in query:
            query = "%s %s" % (query, city)
        params = {"q": query, "format": "jsonv2", "limit": 1,
                  "accept-language": "zh", "countrycodes": "cn"}
        try:
            payload = _get_json(self.endpoint, params, proxy=self.proxy,
                                timeout=self.timeout,
                                headers={"User-Agent": self.user_agent},
                                open_fn=self._open_fn)
        except Exception as exc:
            return PlaceResolution(place=place, status="error",
                                   provider=self.name,
                                   detail="Geocoding 请求失败：%s" % exc)
        parsed = parse_nominatim(payload)
        if parsed is None:
            return PlaceResolution(place=place, status="not_found",
                                   provider=self.name,
                                   detail="Nominatim 没有返回该地点的坐标")
        latitude, longitude, display = parsed
        return PlaceResolution(place=place, status="resolved",
                               latitude=latitude, longitude=longitude,
                               provider=self.name, displayName=display,
                               coordSystem=self.coord_system)


# --- geocoder selection (environment-driven, like SearchSettings) ---------------

AMAP_KEY_ENV_KEYS = ("AMAP_KEY", "GORGON_AMAP_KEY", "GAODE_KEY")
BAIDU_AK_ENV_KEYS = ("BAIDU_MAP_AK", "GORGON_BAIDU_AK", "BAIDU_AK")


def _env_value(env, names):
    for name in names:
        value = env.get(name)
        if value not in (None, ""):
            return value
    return None


def get_geocoder(env=None, proxy=None):
    """-> a configured Geocoder, or None when none is configured.

    None is NOT an error and NOT a fallback: the caller must answer
    `not_configured` and refuse to produce coordinates. Priority: an explicit
    GORGON_GEOCODER choice (which must then be fully configured — a half
    configuration is raised loudly), then an Amap key, then a Baidu AK.
    """
    env = os.environ if env is None else env
    if proxy is None:
        # Lazy import: pipeline.search.__init__ pulls the whole service chain,
        # which imports THIS module — a top-level import would be circular.
        from pipeline.search.settings import detect_http_proxy
        proxy = detect_http_proxy(env)
    choice = _env_value(env, ("GORGON_GEOCODER",))
    if choice is not None:
        choice = str(choice).strip().casefold()
        if choice in ("off", "none", "disabled"):
            return None
        if choice == "amap":
            key = _env_value(env, AMAP_KEY_ENV_KEYS)
            if not key:
                raise ValueError(
                    "GORGON_GEOCODER=amap 但未配置 AMAP_KEY；"
                    "拒绝以无 key 状态猜测坐标")
            return AmapGeocoder(key, proxy=proxy)
        if choice == "baidu":
            ak = _env_value(env, BAIDU_AK_ENV_KEYS)
            if not ak:
                raise ValueError(
                    "GORGON_GEOCODER=baidu 但未配置 BAIDU_MAP_AK；"
                    "拒绝以无 key 状态猜测坐标")
            return BaiduGeocoder(ak, proxy=proxy)
        if choice == "nominatim":
            return NominatimGeocoder(proxy=proxy)
        raise ValueError("未知 GORGON_GEOCODER=%r（可选 amap|baidu|nominatim|off）"
                         % choice)

    amap_key = _env_value(env, AMAP_KEY_ENV_KEYS)
    if amap_key:
        return AmapGeocoder(amap_key, proxy=proxy)
    baidu_ak = _env_value(env, BAIDU_AK_ENV_KEYS)
    if baidu_ak:
        return BaiduGeocoder(baidu_ak, proxy=proxy)
    return None


# --- resolution cache ------------------------------------------------------------

class GeocodeCache(object):
    """Disk cache so re-runs do not re-hit the API (and re-spend quota).

    Stored under the data directory as one JSON file: provider + normalized
    query -> resolution. Resolved entries live 30 days, misses 7 (a miss can
    become a hit when the provider's data improves).
    """

    RESOLVED_TTL_SECONDS = 30 * 24 * 3600.0
    MISS_TTL_SECONDS = 7 * 24 * 3600.0

    def __init__(self, cache_path):
        self.cache_path = cache_path
        self._data = None

    def _load(self):
        if self._data is None:
            try:
                with open(self.cache_path, "r", encoding="utf-8") as handle:
                    raw = json.load(handle)
                self._data = raw if isinstance(raw, dict) else {}
            except (OSError, ValueError):
                self._data = {}
        return self._data

    @staticmethod
    def key_for(provider, place, city):
        normalized = "|".join(str(x or "").strip().casefold()
                              for x in (provider, place, city))
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]

    def get(self, provider, place, city):
        entry = self._load().get(self.key_for(provider, place, city))
        if not isinstance(entry, dict):
            return None
        age = time.time() - float(entry.get("cachedAt") or 0)
        ttl = (self.RESOLVED_TTL_SECONDS if entry.get("status") == "resolved"
               else self.MISS_TTL_SECONDS)
        if age > ttl:
            return None
        return entry

    def put(self, resolution, city, provider=None):
        data = self._load()
        data[self.key_for(provider or resolution.provider,
                          resolution.place, city)] = {
            "status": resolution.status,
            "latitude": resolution.latitude,
            "longitude": resolution.longitude,
            "displayName": resolution.displayName,
            "coordSystem": resolution.coordSystem,
            "provider": resolution.provider,
            "cachedAt": time.time(),
        }
        directory = os.path.dirname(os.path.abspath(self.cache_path))
        if directory:
            os.makedirs(directory, exist_ok=True)
        tmp_path = self.cache_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=1,
                      sort_keys=True)
        os.replace(tmp_path, self.cache_path)


# --- resolver ---------------------------------------------------------------------

class PlaceResolver(object):
    """place text -> PlaceResolution, with cache + not_configured honesty."""

    def __init__(self, geocoder, cache=None):
        self.geocoder = geocoder
        self.cache = cache

    def resolve(self, place, city=None):
        if not place or not str(place).strip():
            return PlaceResolution(place=place, status="not_found",
                                   detail="地点为空，无法解析")
        if self.geocoder is None:
            return PlaceResolution(
                place=place, status="not_configured",
                detail="未配置 Geocoding 数据源：设置 AMAP_KEY 或 "
                       "BAIDU_MAP_AK 后启用真实坐标解析")
        if self.cache is not None:
            cached = self.cache.get(self.geocoder.name, place, city)
            if cached is not None:
                return PlaceResolution(
                    place=place, status=cached.get("status"),
                    latitude=cached.get("latitude"),
                    longitude=cached.get("longitude"),
                    provider=cached.get("provider"),
                    displayName=cached.get("displayName"),
                    coordSystem=cached.get("coordSystem"),
                    detail="（缓存）")
        try:
            resolution = self.geocoder.geocode(place, city=city)
        except Exception as exc:   # noqa: BLE001 - resolver boundary
            # A geocoder that blows up must surface as `error`, never crash
            # the search and never look like "place not found".
            return PlaceResolution(place=place, status="error",
                                   detail="Geocoding 失败：%s" % exc)
        if self.cache is not None:
            try:
                # Keyed by geocoder.name — the SAME key `get` uses. (A
                # resolution's own provider could differ from the geocoder
                # serving it, e.g. through a caching wrapper.)
                self.cache.put(resolution, city,
                               provider=self.geocoder.name)
            except OSError:
                pass   # cache is an optimization, never a correctness gate
        return resolution
