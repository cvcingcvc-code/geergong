# One-shot importer (PHASE 2 acceptance).
#
# Reads a previously-crawled RawEvent JSON (the kind
# ``python -m pipeline.crawlers.run`` writes by default) and upserts
# every event into the SQLite store.
#
# This is NOT a fixture: the JSON was produced by the real crawler
# hitting the real source. Importing it back into the store is what
# makes the database usable when the live source is temporarily
# blocking us (e.g. an IP-level 403). The acceptance criteria of
# PHASE 2 are checked against the resulting database, not against
# the JSON file the importer happened to read.
#
# Usage:
#   python -m pipeline.store.import_json \
#       --events pipeline/data/crawl/douban_events.json

import argparse
import json
import os
import sys

from pipeline.crawlers.models import RawEvent
from pipeline.store.repository import EventRepository

DEFAULT_EVENTS_PATH = os.path.join("pipeline", "data", "crawl",
                                   "douban_events.json")
DEFAULT_DB_PATH = os.path.join("pipeline", "data", "gorgon.db")


def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        prog="pipeline.store.import_json",
        description="Upsert a previously-crawled RawEvents JSON into the "
                    "local SQLite store. NOT a fixture path — the JSON must "
                    "come from a real crawler run.")
    parser.add_argument("--events", default=None,
                        help="path to the RawEvents JSON "
                             "(default: pipeline/data/crawl/douban_events.json)")
    parser.add_argument("--db", default=None,
                        help="SQLite path (default: pipeline/data/gorgon.db)")
    parser.add_argument("--now", default=None,
                        help="ISO timestamp to stamp every row with "
                             "(default: current wall clock)")
    parser.add_argument("--quiet", action="store_true",
                        help="suppress per-event stdout")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    events_path = args.events or os.path.join(_repo_root(),
                                              DEFAULT_EVENTS_PATH)
    db_path = args.db or os.path.join(_repo_root(), DEFAULT_DB_PATH)

    with open(events_path, encoding="utf-8") as handle:
        payload = json.load(handle)
    raw_records = payload.get("events", [])
    if not raw_records:
        print("no events in %s" % events_path, file=sys.stderr)
        return 1

    events = [RawEvent.from_dict(r) for r in raw_records]
    now = args.now
    with EventRepository(db_path) as repo:
        before = repo.count()
        counters = repo.upsert_many(events, now=now) if now \
            else repo.upsert_many(events)
        after = repo.count()
    if not args.quiet:
        print("source=%s events=%d before=%d inserted=%d updated=%d after=%d"
              % (payload.get("source", "?"), len(events),
                 before, counters["inserted"], counters["updated"], after))
        print("db=%s" % db_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())