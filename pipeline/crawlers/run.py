# Crawler CLI (REAL EVENT INDEX V1 — PHASE 1 + PHASE 2).
#
#   python -m pipeline.crawlers.run --source douban --city 上海 --max-pages 10
#
# Output, in PHASE 2 order:
#
#   pipeline/data/gorgon.db                PRIMARY store (SQLite).
#   pipeline/data/crawl/douban_events.json       RawEvents (debug export).
#   pipeline/data/crawl/douban_crawl_report.json crawl statistics.
#
# The run talks to the REAL source. There is no --fixture mode: a fixture is
# for a unit test, and a production run that read one would be manufacturing
# results. `--offline` exists only to make "network is off" an explicit,
# recorded failure instead of a timeout surprise.
#
# PHASE 2 changes:
#   * SQLite is now the PRIMARY destination. Every event the crawler
#     produced is upserted via EventRepository; the JSON files are kept
#     as debug exports (see --no-json to disable them).
#   * `--no-store` keeps the PHASE 1 behaviour (JSON only), useful when
#     debugging the crawler's parsers without touching the DB.
#   * `--db <path>` lets the caller point at a different SQLite file
#     (the default is pipeline/data/gorgon.db).

import argparse
import json
import os
import sys

from pipeline.crawlers.base import STOP_BLOCKED, STOP_SOURCE_UNAVAILABLE
from pipeline.crawlers.douban import build_crawler
from pipeline.store.repository import EventRepository

DEFAULT_OUT_DIR = os.path.join("pipeline", "data", "crawl")
DEFAULT_DB_PATH = os.path.join("pipeline", "data", "gorgon.db")


def _repo_root():
    """…/pipeline/crawlers/run.py -> repo root (three levels up)."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        prog="pipeline.crawlers.run",
        description="Crawl a real public event source and upsert into the "
                    "local event store.")
    parser.add_argument("--source", default="douban",
                        help="crawler to run (default: douban)")
    parser.add_argument("--city", default="上海", help="city name (default: 上海)")
    parser.add_argument("--max-pages", type=int, default=10,
                        help="maximum number of listing pages (default: 10)")
    parser.add_argument("--out-dir", default=None,
                        help="output directory for JSON exports "
                             "(default: pipeline/data/crawl)")
    parser.add_argument("--db", default=None,
                        help="SQLite path (default: pipeline/data/gorgon.db)")
    parser.add_argument("--limit-details", type=int, default=None,
                        help="stop after N activity pages (default: all)")
    parser.add_argument("--politeness-delay", type=float, default=None,
                        help="seconds between requests to the same host "
                             "(default: fetcher's 0.4s; raise for sources "
                             "that rate-limit long detail runs)")
    parser.add_argument("--no-details", action="store_true",
                        help="listing rows only: no activity pages fetched")
    parser.add_argument("--no-store", action="store_true",
                        help="PHASE 1 mode: skip SQLite, JSON only")
    parser.add_argument("--no-json", action="store_true",
                        help="skip JSON debug exports; SQLite only")
    parser.add_argument("--offline", action="store_true",
                        help="disable outbound requests (fails loudly)")
    parser.add_argument("--quiet", action="store_true", help="no stdout summary")
    return parser.parse_args(argv)


def _write(path, payload):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _persist(repo, events):
    """Upsert events into SQLite; return counters.

    Exceptions propagate so the caller can decide whether a DB failure
    should fail the whole run or just be reported. A partial write is
    rolled back inside ``upsert_many``; we never leave the database
    half-stored.
    """
    return repo.upsert_many(events)


def main(argv=None):
    args = parse_args(argv)
    out_dir = args.out_dir or os.path.join(_repo_root(), DEFAULT_OUT_DIR)
    db_path = args.db or os.path.join(_repo_root(), DEFAULT_DB_PATH)

    from pipeline.search.settings import SearchSettings
    settings = SearchSettings(online=not args.offline)

    try:
        crawler = build_crawler(args.source, city=args.city,
                                max_pages=args.max_pages, settings=settings,
                                fetch_details=not args.no_details,
                                limit_details=args.limit_details,
                                politeness_delay=args.politeness_delay)
    except KeyError:
        print("unknown source: %s (known: douban)" % args.source, file=sys.stderr)
        return 2

    events, report = crawler.crawl()

    # PHASE 2 primary destination: SQLite. We still write the JSON exports
    # because they are the canonical record of what THIS run observed,
    # independent of what the database already contained. The DB has
    # historical state across runs; the JSON does not.
    counters = {"inserted": 0, "updated": 0, "unchanged": 0}
    lifecycle = None
    freshness = None
    db_path_used = None
    if not args.no_store:
        from pipeline.crawlers.base import (
            STOP_BLOCKED, STOP_SOURCE_UNAVAILABLE, canonical_url)
        from datetime import date as _date
        with EventRepository(db_path) as repo:
            counters = _persist(repo, events)
            # PHASE 5: lifecycle without deletion. Anything this crawl saw
            # is evidence the row is still listed; everything else of this
            # source goes missing_from_source, everything already gone by
            # date goes past. Matching uses crawler.sourceName — that is
            # the value stored in events.source_name (crawler.name is the
            # code-level key, e.g. "douban", NOT the stored label).
            #
            # missing-marking is SKIPPED when discovery itself was cut
            # short (blocked / source unavailable): an interrupted crawl
            # is NOT evidence that unseen rows vanished from the source.
            # Otherwise a temporary anti-bot wall would "disappear" the
            # whole database.
            discovery_completed = report.stopReason not in (
                STOP_BLOCKED, STOP_SOURCE_UNAVAILABLE)
            lifecycle = repo.apply_lifecycle(
                today=_date.today().isoformat(),
                seen_source_urls=[canonical_url(e.sourceUrl) for e in events],
                source_name=crawler.sourceName if discovery_completed else None)
            freshness = repo.freshness_stats()
        db_path_used = db_path

    if not args.no_json:
        events_path = os.path.join(out_dir, "%s_events.json" % crawler.name)
        report_path = os.path.join(out_dir, "%s_crawl_report.json"
                                   % crawler.name)
        _write(events_path, {"source": crawler.name, "city": args.city,
                             "count": len(events),
                             "events": [e.to_dict() for e in events]})
        _write(report_path, report.to_dict())
    else:
        events_path = None
        report_path = None

    if not args.quiet:
        print("source=%s city=%s maxPages=%s" % (crawler.name, args.city, args.max_pages))
        print("pagesFetched=%d activitiesDiscovered=%d uniqueActivityUrls=%d"
              % (report.pagesFetched, report.activitiesDiscovered,
                 report.uniqueActivityUrls))
        print("detailsFetched=%d success=%d failed=%d"
              % (report.detailsFetched, report.success, report.failed))
        print("missingDate=%d missingVenue=%d missingAddress=%d"
              % (report.missingDate, report.missingVenue, report.missingAddress))
        print("stopReason=%s" % report.stopReason)
        if not args.no_store:
            print("store=sqlite db=%s inserted=%d updated=%d unchanged=%d"
                  % (db_path_used, counters["inserted"], counters["updated"],
                     counters.get("unchanged", 0)))
            if lifecycle:
                print("lifecycle pastMarked=%d missingMarked=%d"
                      % (lifecycle["pastMarked"], lifecycle["missingMarked"]))
            if freshness:
                print("freshness totalActive=%d past=%d missingFromSource=%d "
                      "next7Days=%d next30Days=%d coordinateCoverage=%s%%"
                      % (freshness["totalActive"], freshness["past"],
                         freshness["missingFromSource"], freshness["next7Days"],
                         freshness["next30Days"],
                         freshness["coordinateCoverage"]))
        if not args.no_json:
            print("wrote %s" % events_path)
            print("wrote %s" % report_path)

    if not events:
        return 1
    if report.stopReason in (STOP_BLOCKED, STOP_SOURCE_UNAVAILABLE):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())