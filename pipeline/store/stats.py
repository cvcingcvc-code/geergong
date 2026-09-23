# Stats CLI for the local event store (PHASE 2).
#
#   python -m pipeline.store.stats [--db <path>] [--json] [--districts]
#
# Prints data-quality counters in the shape the PHASE 2 spec asked for:
#
#   totalEvents: 186
#   withDate: 174 / 186 (93.5%)
#   ...
#
# With --districts it also lists the per-district counts the database
# actually has — no fixture padding, no minimum-N filler.

import argparse
import json
import os
import sys

from pipeline.store.repository import EventRepository

DEFAULT_DB = os.path.join("pipeline", "data", "gorgon.db")


def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        prog="pipeline.store.stats",
        description="Print data-quality statistics for the local event DB.")
    parser.add_argument("--db", default=None,
                        help="path to gorgon.db (default: pipeline/data/gorgon.db)")
    parser.add_argument("--json", action="store_true",
                        help="machine-readable JSON output instead of text")
    parser.add_argument("--districts", action="store_true",
                        help="also list per-district counts")
    return parser.parse_args(argv)


def _format(stats, districts=None):
    """Plain-text report. Mirrors the spec's example shape verbatim."""
    lines = []
    lines.append("totalEvents: %d" % stats["totalEvents"]["count"])
    lines.append("uniqueSourceUrls: %d" % stats["uniqueSourceUrls"]["count"])
    for key in ("withDate", "withDistrict", "withVenue", "withAddress",
                "withPrice", "withOrganizer"):
        item = stats[key]
        lines.append("%s: %d / %d (%.1f%%)"
                     % (key, item["count"],
                        stats["totalEvents"]["count"], item["percentage"]))
    if districts:
        lines.append("")
        lines.append("districts:")
        for district, count in districts:
            label = district if district is not None else "(unrecognised)"
            lines.append("  %s: %d" % (label, count))
    return "\n".join(lines)


def main(argv=None):
    args = parse_args(argv)
    db_path = args.db or os.path.join(_repo_root(), DEFAULT_DB)
    with EventRepository(db_path) as repo:
        stats = repo.stats()
        districts = repo.distinct_districts() if args.districts else None
    if args.json:
        payload = {"db": db_path, "stats": stats}
        if districts is not None:
            payload["districts"] = [
                {"district": (d if d is not None else None), "count": c}
                for d, c in districts]
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0
    print("db: %s" % db_path)
    print(_format(stats, districts))
    return 0


if __name__ == "__main__":
    sys.exit(main())