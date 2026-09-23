# Event coordinate backfill (PHASE 3).
#
# Walks the SQLite event store and geocodes every row that has an address but
# no coordinates:
#
#     address != NULL  AND  latitude IS NULL  AND  longitude IS NULL
#
# Writes back: latitude, longitude, geocode_source, geocoded_at.
# A row the geocoder cannot resolve keeps NULL coordinates — spec rule, no
# exceptions: a district name is never written in place of a real coordinate,
# and a failed lookup is never retried by "just guessing nearby".
#
# Usage:
#   python -m pipeline.location.backfill --db pipeline/data/gorgon.db
#   python -m pipeline.location.backfill --db ... --limit 20 --dry-run
#
# Exit codes: 0 = ran (some rows may still be ungeocoded misses),
# 2 = no geocoder configured (nothing was attempted — by design).

import argparse
import os
import sys
import time
from datetime import date

from pipeline.location.geocoder import GeocodeCache, PlaceResolver, get_geocoder
from pipeline.store.repository import EventRepository


def normalize_address(address):
    """Whitespace-level normalization only — never invent door numbers.

    ALL whitespace is removed (not just collapsed): real crawls mix
    "南京西路 100 号" and "南京西路100号" for the same door. Chinese
    addresses carry no meaningful interior spaces.
    """
    return "".join(str(address or "").split())


class _CountingGeocoder(object):
    """Delegating wrapper that counts real API requests (PHASE 4 honesty:
    the report must show apiRequests, not just successes)."""

    def __init__(self, inner):
        self._inner = inner
        self.count = 0
        self.name = inner.name
        self.coord_system = inner.coord_system

    def geocode(self, place, city=None):
        self.count += 1
        return self._inner.geocode(place, city=city)


def backfill_coordinates(repo, resolver, *, city="上海", limit=None,
                         sleep_seconds=0.0, now=None):
    """Geocode rows missing coordinates. -> report dict.

    PHASE 4: rows are grouped by normalized address first — N events sharing
    one address cost ONE geocode request, not N. The report distinguishes
    apiRequests from cacheHits so a re-run is provably cheap.

    Deterministic order (id ASC) so re-runs are reproducible and a crash
    mid-batch leaves a clean "everything before X is done" state.
    """
    rows = repo.rows_missing_coordinates(limit=limit)
    report = {
        "candidates": len(rows),
        "uniqueAddresses": 0,
        "apiRequests": 0,
        "cacheHits": 0,
        "geocoded": 0,
        "notFound": 0,
        "errors": 0,
        "skippedNoAddress": 0,
        "details": [],
    }

    # Group by normalized address (spec: never send duplicate requests).
    groups = {}   # normalized -> {"rows": [...], "address": first raw}
    for row in rows:
        address = (row.get("address") or "").strip()
        if not address:
            report["skippedNoAddress"] += 1
            continue
        key = normalize_address(address)
        if key not in groups:
            groups[key] = {"address": address, "rows": []}
        groups[key]["rows"].append(row)
    report["uniqueAddresses"] = len(groups)

    counter = _CountingGeocoder(resolver.geocoder)
    resolver.geocoder = counter

    for key in sorted(groups):
        group = groups[key]
        address = group["address"]
        resolution = resolver.resolve(address, city=city)
        if resolution.detail == "（缓存）":
            report["cacheHits"] += 1
        report["apiRequests"] = counter.count
        if resolution.ok:
            for row in group["rows"]:
                source = resolution.provider
                if resolution.coordSystem:
                    source = "%s_%s" % (resolution.provider,
                                        resolution.coordSystem)
                repo.update_coordinates(
                    row["id"], resolution.latitude, resolution.longitude,
                    geocode_source=source, now=now)
                report["geocoded"] += 1
            report["details"].append({
                "status": "resolved",
                "address": address,
                "resolvedPlace": resolution.displayName,
                "eventsUpdated": len(group["rows"]),
            })
        elif resolution.status == "not_found":
            report["notFound"] += 1
            report["details"].append({
                "status": "not_found", "address": address,
                "detail": resolution.detail,
            })
        else:
            report["errors"] += 1
            report["details"].append({
                "status": resolution.status, "address": address,
                "detail": resolution.detail,
            })
        if sleep_seconds:
            time.sleep(sleep_seconds)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Geocode event-store rows that have an address but no "
                    "coordinates (writes latitude/longitude/geocode_source/"
                    "geocoded_at).")
    parser.add_argument("--db", default=None,
                        help="SQLite path (default: pipeline/data/gorgon.db)")
    parser.add_argument("--city", default="上海")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true",
                        help="Only report how many rows WOULD be geocoded")
    parser.add_argument("--sleep", type=float, default=None,
                        help="Seconds to wait between API calls "
                             "(default: geocoder's own rate limit)")
    args = parser.parse_args(argv)

    geocoder = get_geocoder()
    if geocoder is None:
        print("GEOCODER NOT CONFIGURED (placeResolutionStatus=not_configured)",
              file=sys.stderr)
        print("未配置 Geocoding 数据源。按 PHASE 3 规则：不猜坐标、不伪造距离。",
              file=sys.stderr)
        print("启用方式：免费注册高德开放平台 Web 服务 key 后设置 AMAP_KEY，"
              "或配置 BAIDU_MAP_AK。", file=sys.stderr)
        return 2

    db_path = args.db or _default_db_path()
    cache = GeocodeCache(_cache_path_for(db_path))
    resolver = PlaceResolver(geocoder, cache=cache)
    now = "%sT00:00:00" % date.today().isoformat()

    with EventRepository(db_path) as repo:
        if args.dry_run:
            rows = repo.rows_missing_coordinates()
            print("dry-run: %d rows would be geocoded (db=%s, geocoder=%s)"
                  % (len(rows), db_path, geocoder.name))
            return 0
        sleep = args.sleep if args.sleep is not None else 0.0
        report = backfill_coordinates(
            repo, resolver, city=args.city, limit=args.limit,
            sleep_seconds=sleep, now=now)
        stats = repo.coordinate_stats()

    import json as _json
    print(_json.dumps({"report": report, "coordinateStats": stats},
                      ensure_ascii=False, indent=1))
    return 0


def _default_db_path():
    import os
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    return os.path.join(repo_root, "pipeline", "data", "gorgon.db")


def _cache_path_for(db_path):
    """Cache lives next to the store it serves (PHASE 4: a second backfill
    run must not re-hit the API for already-resolved addresses)."""
    return os.path.join(os.path.dirname(os.path.abspath(db_path)),
                        "geocode_cache.json")


if __name__ == "__main__":
    sys.exit(main())
