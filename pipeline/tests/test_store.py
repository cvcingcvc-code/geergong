# Event store tests (REAL EVENT INDEX V1 — PHASE 2).
#
# Offline. Every test uses an in-memory or tmpdir SQLite path so the
# production gorgon.db is never touched by the unit suite. The only
# fixture used is the RawEvent the test itself constructs.

import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.crawlers.models import RawEvent  # noqa: E402
from pipeline.store.migrations import run_migrations  # noqa: E402
from pipeline.store.normalize import (  # noqa: E402
    derive_canonical_key, derive_category, derive_price_type,
    event_to_row, merge_for_update,
)
from pipeline.store.repository import EventRepository  # noqa: E402
from pipeline.store.schema import EVENT_COLUMNS, SCHEMA_VERSION  # noqa: E402


# --- helpers ---------------------------------------------------------------

def event(*, source_url, title="t", district=None, city="上海",
          start_time=None, address=None, price=None, organizer=None,
          category=None, **overrides):
    """Build a RawEvent for the test. ``source_url`` is the only required
    field — the dedupe story is what these tests are about."""
    raw = {
        "detail": {"category": category} if category else None,
    }
    return RawEvent(
        title=title,
        startTime=start_time,
        city=city,
        district=district,
        address=address,
        price=price,
        organizer=organizer,
        sourceName="豆瓣同城",
        sourceUrl=source_url,
        sourceEventId=(source_url.rsplit("/", 2)[-2]
                       if source_url else None),
        rawData=raw,
        **overrides,
    )


# --- schema ----------------------------------------------------------------

class SchemaTest(unittest.TestCase):
    def test_create_on_open(self):
        """open() against an empty DB produces every required column."""
        with EventRepository(":memory:") as repo:
            cur = repo.conn.execute("PRAGMA table_info(events)")
            cols = {row[1] for row in cur.fetchall()}
        # Every column from the PHASE 2 spec is present.
        required = {
            "id", "canonical_key",
            "title", "start_time", "end_time",
            "city", "district", "venue_name", "address",
            "latitude", "longitude",
            "category", "price_type", "price", "organizer",
            "source_name", "source_url", "source_event_id",
            "first_seen_at", "last_seen_at", "fetched_at",
            "status", "raw_json", "created_at", "updated_at",
        }
        self.assertTrue(required.issubset(cols),
                        "missing columns: %s" % (required - cols))

    def test_source_url_is_unique(self):
        with EventRepository(":memory:") as repo:
            indices = repo.conn.execute("PRAGMA index_list(events)").fetchall()
            names = {row[1] for row in indices}
            self.assertIn("ux_events_source_url", names)
            # And the index is actually unique.
            info = repo.conn.execute(
                "PRAGMA index_info(ux_events_source_url)").fetchall()
            self.assertEqual(1, len(info))

    def test_schema_version_is_recorded(self):
        """The migration runner records the current version."""
        with EventRepository(":memory:") as repo:
            row = repo.conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()
            self.assertEqual(str(SCHEMA_VERSION), row[0])

    def test_migrations_idempotent(self):
        """Opening an already-migrated DB is a no-op."""
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "gorgon.db")
            # First open: creates schema.
            EventRepository(db_path).open().close()
            # Second open against the same file: must not raise, must not
            # lose data, must still report SCHEMA_VERSION.
            with EventRepository(db_path) as repo:
                row = repo.conn.execute(
                    "SELECT value FROM schema_meta "
                    "WHERE key='schema_version'").fetchone()[0]
                self.assertEqual(str(SCHEMA_VERSION), str(row))

    def test_columns_match_constants(self):
        """EVENT_COLUMNS does not list 'id' (autoincrement) but every
        other row column is in there."""
        schema_cols = set()
        with EventRepository(":memory:") as repo:
            for row in repo.conn.execute("PRAGMA table_info(events)").fetchall():
                schema_cols.add(row[1])
        expected = schema_cols - {"id"}
        self.assertEqual(set(EVENT_COLUMNS), expected)


# --- insert ---------------------------------------------------------------

class InsertTest(unittest.TestCase):
    def test_insert_new_row(self):
        with EventRepository(":memory:") as repo:
            action, row_id = repo.upsert_event(
                event(source_url="https://www.douban.com/event/1/",
                      title="AI 艺术展", district="徐汇",
                      start_time="2026-10-01T19:00:00",
                      price="免费", organizer="美术馆",
                      category="展览"),
                now="2026-09-22T12:00:00")
            self.assertEqual("inserted", action)
            self.assertEqual(1, row_id)
            self.assertEqual(1, repo.count())
            row = repo.get_by_source_url("https://www.douban.com/event/1/")
            self.assertEqual("AI 艺术展", row["title"])
            self.assertEqual("徐汇", row["district"])
            self.assertEqual("2026-10-01T19:00:00", row["start_time"])
            self.assertEqual("免费", row["price"])
            self.assertEqual("美术馆", row["organizer"])
            self.assertEqual("展览", row["category"])
            self.assertEqual("free", row["price_type"])

    def test_insert_requires_source_url(self):
        with EventRepository(":memory:") as repo:
            with self.assertRaises(ValueError):
                repo.upsert_event(event(source_url=None))

    def test_upsert_many_returns_counters(self):
        with EventRepository(":memory:") as repo:
            evs = [
                event(source_url="https://x.com/event/%d/" % i)
                for i in range(1, 6)
            ]
            counters = repo.upsert_many(evs, now="2026-09-22T12:00:00")
            self.assertEqual({"inserted": 5, "updated": 0}, counters)
            self.assertEqual(5, repo.count())


# --- duplicate / upsert ---------------------------------------------------

class DuplicateSourceUrlUpsertTest(unittest.TestCase):
    def test_same_source_url_updates(self):
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(source_url="https://x.com/event/1/",
                                    title="Original"),
                              now="2026-09-22T12:00:00")
            action, row_id = repo.upsert_event(
                event(source_url="https://x.com/event/1/",
                      title="Modified"),
                now="2026-09-22T13:00:00")
            self.assertEqual("updated", action)
            self.assertEqual(1, row_id)
            self.assertEqual(1, repo.count(),
                             "second upsert must NOT add a new row")
            row = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("Modified", row["title"])

    def test_url_form_variants_collapse_to_one_row(self):
        """canonical_url drops query / trailing slash / www. — these must
        map to a single row, not three."""
        with EventRepository(":memory:") as repo:
            urls = [
                "https://www.douban.com/event/123/",
                "https://www.douban.com/event/123/?icn=track",
                "https://douban.com/event/123",
            ]
            for url in urls:
                repo.upsert_event(event(source_url=url, title="X"),
                                  now="2026-09-22T12:00:00")
            self.assertEqual(1, repo.count())

    def test_unique_constraint_at_db_level(self):
        """Even bypassing the repository, the unique index refuses a
        second row with the same canonical source_url."""
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(source_url="https://x.com/event/1/"),
                              now="2026-09-22T12:00:00")
            # Use the canonical form (no trailing slash) — that's what
            # the repository stored.
            with self.assertRaises(sqlite3.IntegrityError):
                repo.conn.execute(
                    "INSERT INTO events (source_url, first_seen_at, "
                    "last_seen_at, fetched_at, created_at, updated_at, "
                    "canonical_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("https://x.com/event/1", "t", "t", "t", "t", "t", "k"))


# --- incremental update ---------------------------------------------------

class IncrementalUpdateTest(unittest.TestCase):
    def test_second_batch_is_all_updates(self):
        """Spec: first crawl inserted=N, second crawl inserted=0 updated=N."""
        with EventRepository(":memory:") as repo:
            evs = [event(source_url="https://x.com/event/%d/" % i)
                   for i in range(1, 11)]
            first = repo.upsert_many(evs, now="2026-09-22T10:00:00")
            self.assertEqual(10, first["inserted"])
            self.assertEqual(0, first["updated"])

            # Identical batch, same source URLs, only the timestamp moved.
            second = repo.upsert_many(evs, now="2026-09-22T13:00:00")
            self.assertEqual(0, second["inserted"])
            self.assertEqual(10, second["updated"])
            self.assertEqual(10, repo.count(),
                             "second crawl must NOT add new rows")

    def test_content_change_lands(self):
        """A real content change between runs is reflected in the row."""
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(source_url="https://x.com/event/1/",
                                    title="Old"),
                              now="2026-09-22T10:00:00")
            repo.upsert_event(event(source_url="https://x.com/event/1/",
                                    title="New",
                                    district="静安"),
                              now="2026-09-22T13:00:00")
            row = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("New", row["title"])
            self.assertEqual("静安", row["district"])

    def test_missing_field_does_not_wipe_existing(self):
        """A re-crawl that extracted fewer fields must NOT clobber fields
        the previous run had observed."""
        with EventRepository(":memory:") as repo:
            repo.upsert_event(
                event(source_url="https://x.com/event/1/",
                      title="Original", district="徐汇", address="某路 1 号",
                      price="免费", organizer="美术馆"),
                now="2026-09-22T10:00:00")
            # Second pass: only title observed (e.g. detail page partial).
            repo.upsert_event(event(source_url="https://x.com/event/1/",
                                    title="Renamed"),
                              now="2026-09-22T13:00:00")
            row = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("Renamed", row["title"])
            self.assertEqual("徐汇", row["district"])
            self.assertEqual("某路 1 号", row["address"])
            self.assertEqual("免费", row["price"])
            self.assertEqual("美术馆", row["organizer"])


# --- timestamps -----------------------------------------------------------

class TimestampTest(unittest.TestCase):
    def test_first_seen_at_persists_across_updates(self):
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(source_url="https://x.com/event/1/"),
                              now="2026-09-22T10:00:00")
            row1 = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("2026-09-22T10:00:00", row1["first_seen_at"])

            repo.upsert_event(event(source_url="https://x.com/event/1/",
                                    title="Renamed"),
                              now="2026-09-22T20:00:00")
            row2 = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("2026-09-22T10:00:00", row2["first_seen_at"],
                             "first_seen_at must not move on update")

    def test_last_seen_at_refreshes_on_update(self):
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(source_url="https://x.com/event/1/"),
                              now="2026-09-22T10:00:00")
            repo.upsert_event(event(source_url="https://x.com/event/1/",
                                    title="Renamed"),
                              now="2026-09-22T20:00:00")
            row = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("2026-09-22T20:00:00", row["last_seen_at"])
            self.assertEqual("2026-09-22T20:00:00", row["fetched_at"])

    def test_last_seen_at_refreshes_even_when_unchanged(self):
        """The spec says last_seen_at/fetched_at update on every re-crawl,
        even if no field changed."""
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(source_url="https://x.com/event/1/"),
                              now="2026-09-22T10:00:00")
            # Identical event.
            repo.upsert_event(event(source_url="https://x.com/event/1/"),
                              now="2026-09-22T20:00:00")
            row = repo.get_by_source_url("https://x.com/event/1/")
            self.assertEqual("2026-09-22T20:00:00", row["last_seen_at"])
            self.assertEqual("2026-09-22T10:00:00", row["first_seen_at"])


# --- search ---------------------------------------------------------------

class SearchTest(unittest.TestCase):
    def _seed(self, repo):
        evs = [
            event(source_url="https://x.com/event/1/",
                  title="AI 艺术展", district="徐汇",
                  address="徐家汇路 1 号", start_time="2026-10-01T19:00:00",
                  price="免费", organizer="美术馆",
                  category="展览"),
            event(source_url="https://x.com/event/2/",
                  title="上海音乐节", district="静安",
                  address="南京西路 88 号", start_time="2026-11-01T19:00:00",
                  price="199元", organizer="上海音乐节组委会",
                  category="音乐"),
            event(source_url="https://x.com/event/3/",
                  title="设计展览", district="浦东",
                  address="世纪大道 100 号", start_time="2026-09-15T10:00:00",
                  price="30元", organizer="设计周",
                  category="展览"),
            event(source_url="https://x.com/event/4/",
                  title="咖啡讲座", district="徐汇",
                  address="某条路", start_time="2026-09-25T14:00:00",
                  price="免费", organizer="星巴克",
                  category="讲座"),
        ]
        repo.upsert_many(evs, now="2026-09-22T12:00:00")

    def test_district_filter(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(district="徐汇")
            titles = [r["title"] for r in rows]
            self.assertEqual(2, len(rows))
            self.assertIn("AI 艺术展", titles)
            self.assertIn("咖啡讲座", titles)

    def test_keyword_matches_title(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(keyword="音乐")
            self.assertEqual(1, len(rows))
            self.assertEqual("上海音乐节", rows[0]["title"])

    def test_keyword_matches_address(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(keyword="世纪大道")
            self.assertEqual(1, len(rows))
            self.assertEqual("设计展览", rows[0]["title"])

    def test_keyword_matches_organizer(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(keyword="星巴克")
            self.assertEqual(1, len(rows))
            self.assertEqual("咖啡讲座", rows[0]["title"])

    def test_keyword_matches_venue_name(self):
        """venue_name is normally null for Douban, but if a source sets
        it the search must still hit."""
        with EventRepository(":memory:") as repo:
            repo.upsert_event(event(
                source_url="https://x.com/event/5/",
                title="Anything", venueName="上海大剧院",
                district="黄浦"),
                now="2026-09-22T12:00:00")
            rows = repo.search(keyword="大剧院")
            self.assertEqual(1, len(rows))
            self.assertEqual("上海大剧院", rows[0]["venue_name"])

    def test_keyword_escapes_like_wildcards(self):
        """A keyword with % or _ must NOT match arbitrary rows.

        Without an ESCAPE clause SQLite's LIKE treats %/_ as wildcards,
        so a user searching for "50%" would silently get every row.
        With the ESCAPE clause, those characters are literal — only rows
        that actually contain a percent sign match.
        """
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            # No row has % or _, so a search for those characters is empty.
            self.assertEqual(0, len(repo.search(keyword="%")))
            self.assertEqual(0, len(repo.search(keyword="_")))

            # A row whose title literally contains a percent sign:
            repo.upsert_event(event(
                source_url="https://x.com/event/99/",
                title="全场 50% off",
                district="徐汇"),
                now="2026-09-22T12:00:00")
            # "50%" finds it (escaped % is a literal %).
            self.assertEqual(1, len(repo.search(keyword="50%")))
            # "%" finds it too (it does contain a %).
            self.assertEqual(1, len(repo.search(keyword="%")))
            # "_" still empty — none of the 5 rows contain an underscore.
            self.assertEqual(0, len(repo.search(keyword="_")))

    def test_date_range(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(dateStart="2026-10-01")
            titles = [r["title"] for r in rows]
            self.assertIn("AI 艺术展", titles)
            self.assertIn("上海音乐节", titles)
            self.assertNotIn("设计展览", titles)
            self.assertNotIn("咖啡讲座", titles)

            rows = repo.search(dateEnd="2026-09-30")
            titles = [r["title"] for r in rows]
            self.assertNotIn("AI 艺术展", titles)
            self.assertIn("设计展览", titles)
            self.assertIn("咖啡讲座", titles)

    def test_combined_filters(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(district="徐汇", keyword="AI")
            self.assertEqual(1, len(rows))
            self.assertEqual("AI 艺术展", rows[0]["title"])
            rows = repo.search(district="徐汇", dateStart="2026-11-01")
            self.assertEqual(0, len(rows))

    def test_city_filter(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            self.assertEqual(4, len(repo.search(city="上海")))
            self.assertEqual(0, len(repo.search(city="北京")))

    def test_category_filter(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(category="展览")
            titles = [r["title"] for r in rows]
            self.assertIn("AI 艺术展", titles)
            self.assertIn("设计展览", titles)

    def test_search_returns_dicts(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(keyword="AI")
            self.assertEqual(1, len(rows))
            self.assertIsInstance(rows[0], dict)
            # Expected keys present.
            for key in ("title", "source_url", "city", "district",
                        "start_time", "raw_json"):
                self.assertIn(key, rows[0])

    def test_limit_is_respected(self):
        with EventRepository(":memory:") as repo:
            self._seed(repo)
            rows = repo.search(limit=2)
            self.assertEqual(2, len(rows))


# --- restart persistence --------------------------------------------------

class RestartPersistenceTest(unittest.TestCase):
    def test_data_survives_close_reopen(self):
        """Close the connection, reopen against the same file: rows + raw_json
        are still there, untouched."""
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "gorgon.db")
            with EventRepository(db_path) as repo:
                repo.upsert_event(event(
                    source_url="https://x.com/event/1/",
                    title="Survives restart", district="徐汇",
                    start_time="2026-10-01T19:00:00",
                    price="免费", organizer="美术馆"),
                    now="2026-09-22T12:00:00")
                self.assertEqual(1, repo.count())
            # Close + reopen.
            with EventRepository(db_path) as repo:
                self.assertEqual(1, repo.count())
                row = repo.get_by_source_url("https://x.com/event/1/")
                self.assertEqual("Survives restart", row["title"])
                self.assertEqual("徐汇", row["district"])
                self.assertEqual("2026-10-01T19:00:00", row["start_time"])
                self.assertEqual("免费", row["price"])
                self.assertEqual("美术馆", row["organizer"])
                self.assertEqual("2026-09-22T12:00:00", row["first_seen_at"])

    def test_reopen_then_upsert_updates_existing_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "gorgon.db")
            with EventRepository(db_path) as repo:
                repo.upsert_event(event(
                    source_url="https://x.com/event/1/", title="A"),
                    now="2026-09-22T10:00:00")
            with EventRepository(db_path) as repo:
                action, _ = repo.upsert_event(
                    event(source_url="https://x.com/event/1/", title="B"),
                    now="2026-09-22T13:00:00")
                self.assertEqual("updated", action)
                self.assertEqual(1, repo.count())
                row = repo.get_by_source_url("https://x.com/event/1/")
                self.assertEqual("B", row["title"])
                self.assertEqual("2026-09-22T10:00:00", row["first_seen_at"])
                self.assertEqual("2026-09-22T13:00:00", row["last_seen_at"])

    def test_unique_constraint_survives_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "gorgon.db")
            with EventRepository(db_path) as repo:
                repo.upsert_event(event(source_url="https://x.com/event/1/"),
                                  now="2026-09-22T12:00:00")
            with EventRepository(db_path) as repo:
                with self.assertRaises(sqlite3.IntegrityError):
                    repo.conn.execute(
                        "INSERT INTO events (source_url, first_seen_at, "
                        "last_seen_at, fetched_at, created_at, updated_at, "
                        "canonical_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        ("https://x.com/event/1", "t", "t", "t", "t", "t", "k"))


# --- stats ----------------------------------------------------------------

class StatsTest(unittest.TestCase):
    def test_stats_counts_match(self):
        with EventRepository(":memory:") as repo:
            repo.upsert_many([
                event(source_url="https://x.com/event/1/", title="A",
                      district="徐汇", start_time="2026-10-01T19:00:00",
                      price="免费", address="addr"),
                event(source_url="https://x.com/event/2/", title="B",
                      start_time="2026-10-02T19:00:00"),
                event(source_url="https://x.com/event/3/", title="C",
                      organizer="org"),
            ], now="2026-09-22T12:00:00")
            s = repo.stats()
            self.assertEqual(3, s["totalEvents"]["count"])
            self.assertEqual(3, s["uniqueSourceUrls"]["count"])
            self.assertEqual(2, s["withDate"]["count"])      # 1 has no start_time
            self.assertEqual(1, s["withDistrict"]["count"])  # 1 has district
            self.assertEqual(0, s["withVenue"]["count"])
            self.assertEqual(1, s["withAddress"]["count"])
            self.assertEqual(1, s["withPrice"]["count"])
            self.assertEqual(1, s["withOrganizer"]["count"])

    def test_stats_percentages(self):
        with EventRepository(":memory:") as repo:
            repo.upsert_many([
                event(source_url="https://x.com/event/%d/" % i)
                for i in range(1, 11)
            ], now="2026-09-22T12:00:00")
            s = repo.stats()
            self.assertEqual(10, s["totalEvents"]["count"])
            self.assertEqual(0, s["withDate"]["count"])
            self.assertEqual(0.0, s["withDate"]["percentage"])
            # 0/10 is 0.0% — no division surprise.

    def test_distinct_districts(self):
        with EventRepository(":memory:") as repo:
            repo.upsert_many([
                event(source_url="https://x.com/event/1/", district="徐汇"),
                event(source_url="https://x.com/event/2/", district="徐汇"),
                event(source_url="https://x.com/event/3/", district="静安"),
                event(source_url="https://x.com/event/4/", district=None),
            ], now="2026-09-22T12:00:00")
            d = repo.distinct_districts()
            d_dict = dict(d)
            self.assertEqual(2, d_dict["徐汇"])
            self.assertEqual(1, d_dict["静安"])
            self.assertEqual(1, d_dict[None])


# --- normalize helpers ----------------------------------------------------

class NormalizeHelperTest(unittest.TestCase):
    def test_price_type(self):
        self.assertEqual("free", derive_price_type("免费"))
        self.assertEqual("free", derive_price_type("FREE"))
        self.assertEqual("paid", derive_price_type("199元"))
        self.assertEqual("paid", derive_price_type("80.0元起"))
        self.assertIsNone(derive_price_type(None))
        self.assertIsNone(derive_price_type(""))
        self.assertIsNone(derive_price_type("   "))

    def test_category_from_detail_only(self):
        self.assertEqual("展览", derive_category({"detail": {"category": "展览"}}))
        self.assertIsNone(derive_category({"detail": {"category": None}}))
        self.assertIsNone(derive_category({"detail": {}}))
        self.assertIsNone(derive_category({}))
        self.assertIsNone(derive_category(None))

    def test_canonical_key_stable_across_url_variants(self):
        a = derive_canonical_key("https://www.douban.com/event/1/")
        b = derive_canonical_key("https://www.douban.com/event/1/?icn=track")
        c = derive_canonical_key("https://douban.com/event/1")
        self.assertEqual(a, b)
        self.assertEqual(a, c)

    def test_canonical_key_handles_missing(self):
        self.assertIsNone(derive_canonical_key(None))
        self.assertIsNone(derive_canonical_key(""))


class MergeForUpdateTest(unittest.TestCase):
    def test_change_detection(self):
        old = {"title": "A", "price": "免费", "address": "addr"}
        new = {"title": "B", "price": "免费", "address": "addr"}
        changed = merge_for_update(old, new)
        self.assertEqual({"title": "B"}, changed)

    def test_blank_does_not_overwrite(self):
        old = {"title": "A", "price": "免费", "address": "addr"}
        new = {"title": None, "price": "免费", "address": None}
        changed = merge_for_update(old, new)
        # title and address must NOT be in the change set (blank doesn't
        # overwrite), price stays out because it matched.
        self.assertNotIn("title", changed)
        self.assertNotIn("address", changed)
        self.assertNotIn("price", changed)

    def test_timestamps_always_set(self):
        old = {"title": "A"}
        new = {"title": "A", "last_seen_at": "t1", "fetched_at": "t1",
               "raw_json": "{}"}
        changed = merge_for_update(old, new)
        self.assertEqual("t1", changed["last_seen_at"])
        self.assertEqual("t1", changed["fetched_at"])
        self.assertEqual("{}", changed["raw_json"])

    def test_existing_none_can_be_filled(self):
        """If the previous crawl had no address and the next one does,
        the merge records the change."""
        old = {"title": "A", "address": None}
        new = {"title": "A", "address": "addr"}
        changed = merge_for_update(old, new)
        self.assertEqual({"address": "addr"}, changed)

    def test_empty_existing_row_returns_full_new(self):
        new = {"title": "A", "last_seen_at": "t", "fetched_at": "t",
               "raw_json": "{}"}
        self.assertEqual(new, merge_for_update(None, new))


# --- event_to_row ---------------------------------------------------------

class EventToRowTest(unittest.TestCase):
    def test_row_columns_present(self):
        raw = event(source_url="https://x.com/event/1/", title="T",
                    district="徐汇", price="免费", category="展览")
        row = event_to_row(raw, now="2026-09-22T12:00:00")
        self.assertEqual("T", row["title"])
        self.assertEqual("徐汇", row["district"])
        self.assertEqual("https://x.com/event/1", row["source_url"])
        self.assertEqual("免费", row["price"])
        self.assertEqual("free", row["price_type"])
        self.assertEqual("展览", row["category"])
        self.assertEqual("2026-09-22T12:00:00", row["first_seen_at"])
        self.assertEqual("2026-09-22T12:00:00", row["last_seen_at"])
        # raw_json is a non-empty JSON string.
        import json as _json
        parsed = _json.loads(row["raw_json"])
        self.assertEqual("T", parsed["title"])


if __name__ == "__main__":
    unittest.main()