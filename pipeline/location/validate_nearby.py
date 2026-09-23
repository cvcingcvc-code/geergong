# Nearby-search acceptance run (PHASE 3).
#
# The spec's acceptance list: 五角场 / 静安寺 / 人民广场 / 上海交通大学 /
# 新天地, each at radius 3km. This script IS the re-runnable acceptance: run
# it again after configuring a geocoder key and it produces the full report
# with real coordinates and real events.
#
# Honesty: with no geocoder configured every place reports
# placeResolutionStatus=not_configured and zero events — that is the CORRECT
# output until a key exists, and this script never substitutes fake
# coordinates to look complete.
#
# Usage:
#   python -m pipeline.location.validate_nearby [--db PATH] [--radius 3]
#   python -m pipeline.location.validate_nearby --json OUT.json

import argparse
import json
import os
import sys
from datetime import date

from pipeline.location.geocoder import PlaceResolver, get_geocoder
from pipeline.search.service import default_event_db, nearby_search_payload
from pipeline.store.repository import EventRepository

ACCEPTANCE_PLACES = ("五角场", "静安寺", "人民广场", "上海交通大学", "新天地")


def run_acceptance(db_path=None, radius_km=3.0, places=None, today=None,
                   geocoder=None):
    """-> list of per-place result dicts (the report body)."""
    places = places or ACCEPTANCE_PLACES
    db_path = db_path or default_event_db()
    today = today or date.today()
    geocoder = geocoder if geocoder is not None else get_geocoder()
    resolver = PlaceResolver(geocoder)
    rows_out = []
    with EventRepository(db_path) as repo:
        for place in places:
            payload = nearby_search_payload(
                {"place": place, "radiusKm": radius_km},
                repository=repo, resolver=resolver, today=today)
            events = [
                {
                    "title": r.get("activity", {}).get("title"),
                    "venue": r.get("activity", {}).get("venue"),
                    "address": r.get("activity", {}).get("address"),
                    "distanceKm": r.get("distanceKm"),
                    "sourceUrl": (r.get("activity", {}) or {}).get("sourceUrl"),
                }
                for r in payload.get("results") or []
            ]
            rows_out.append({
                "place": place,
                "placeResolutionStatus": (payload.get("placeResolution")
                                          or {}).get("status"),
                "resolvedPlace": (payload.get("placeResolution")
                                  or {}).get("resolvedPlace"),
                "latitude": (payload.get("placeResolution")
                             or {}).get("latitude"),
                "longitude": (payload.get("placeResolution")
                              or {}).get("longitude"),
                "radiusKm": payload.get("radiusKm"),
                "eventCount": len(events),
                "events": events,
            })
    return rows_out


def _print_report(rows):
    for row in rows:
        print("== %s ==" % row["place"])
        print("  placeResolutionStatus: %s" % row["placeResolutionStatus"])
        if row["latitude"] is not None:
            print("  resolvedPlace: %s" % row["resolvedPlace"])
            print("  latitude: %s" % row["latitude"])
            print("  longitude: %s" % row["longitude"])
        print("  radiusKm: %s" % row["radiusKm"])
        print("  events: %d" % row["eventCount"])
        for event in row["events"][:10]:
            print("    - [%.2fkm] %s | %s | %s"
                  % (event["distanceKm"], event["title"],
                     event["venue"] or event["address"], event["sourceUrl"]))
    coord_line = "no geocoder configured"
    geocoder = get_geocoder()
    if geocoder is not None:
        with EventRepository(_db_or_default()) as repo:
            stats = repo.coordinate_stats()
        coord_line = json.dumps(stats, ensure_ascii=False)
    print("\nEVENT COORDINATE COVERAGE: %s" % coord_line)


def _db_or_default():
    return default_event_db()


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Run the PHASE 3 nearby-search acceptance places.")
    parser.add_argument("--db", default=None)
    parser.add_argument("--radius", type=float, default=3.0)
    parser.add_argument("--json", dest="json_out", default=None,
                        help="also write the report as JSON to this path")
    args = parser.parse_args(argv)

    rows = run_acceptance(db_path=args.db, radius_km=args.radius)
    _print_report(rows)
    if args.json_out:
        directory = os.path.dirname(os.path.abspath(args.json_out))
        os.makedirs(directory, exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as handle:
            json.dump(rows, handle, ensure_ascii=False, indent=1)
        print("\nJSON report written to %s" % args.json_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
