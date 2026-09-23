# EventRepository (PHASE 2).
#
# SQLite-backed repository over the ``events`` table.
#
# The contract the crawler relies on:
#
#   upsert_event(raw_event)        insert if new, update (with bumped
#                                  last_seen_at / fetched_at) otherwise;
#                                  always returns ("inserted" | "updated",
#                                  row_id). Same source URL never duplicates.
#
#   upsert_many(raw_events)        batch wrapper, returns counters
#                                  {"inserted": N, "updated": M}.
#
#   search(...)                    SELECT against title / venue_name /
#                                  address / organizer, filtered by city /
#                                  district / date / category.
#
#   stats()                        data-quality counters over the live DB.
#
# Transaction model: every public method runs in its own transaction. A
# ``with EventRepository(path) as repo:`` block reuses one connection for
# the duration of the block. Batch operations commit once at the end.
#
# Thread model: SQLite + this codebase = single writer. Two crawlers in
# parallel would race; the PHASE 2 spec calls out "incremental update"
# from one scheduled job, not concurrent writers. If that changes, the
# repository is the place to add a lock.

import os
import sqlite3
import time

from pipeline.crawlers.base import canonical_url
from pipeline.crawlers.models import RawEvent
from pipeline.store import normalize as _normalize
from pipeline.store.migrations import run_migrations
from pipeline.store.schema import EVENT_COLUMNS


# Closed vocabulary for the date range predicate.
_DATE_GTE = "start_time >= ?"
_DATE_LTE = "start_time <= ?"


def _now():
    """ISO timestamp the repository stamps on every row.

    Centralised so the same value can be shared across a batch without
    two rows disagreeing about what "now" was a millisecond apart.
    """
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class EventRepository(object):
    """Thin SQLite repository over the events table."""

    def __init__(self, db_path):
        self.db_path = db_path
        self._conn = None

    # --- lifecycle -------------------------------------------------------

    def open(self):
        """Open the connection and bring the schema up to date.

        Safe to call against a brand-new path or an existing file: the
        migration runner is idempotent and writes the schema_version row
        in the same transaction as the DDL it produced.
        """
        if self._conn is not None:
            return self._conn
        if self.db_path != ":memory:":
            directory = os.path.dirname(os.path.abspath(self.db_path))
            if directory:
                os.makedirs(directory, exist_ok=True)
        # detect_types lets us hand Python datetime values to SQLite if we
        # ever need to; isolation_level=None (autocommit) is OFF here so
        # the repository controls transaction boundaries.
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        # Pragmas that matter for this store:
        #   * foreign_keys is OFF — there are no FK relationships in V1.
        #   * journal_mode=WAL makes reads possible during a crawl write,
        #     which keeps the API server responsive while the crawler is
        #     mid-run.
        #   * synchronous=NORMAL is the WAL sweet spot: durable on commit,
        #     not on every page write.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA foreign_keys = OFF")
        run_migrations(conn)
        conn.commit()
        self._conn = conn
        return conn

    def close(self):
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, exc_type, exc, tb):
        # If the block raised, roll back the open transaction so the next
        # user of the connection does not inherit a half-applied batch.
        if self._conn is not None and exc_type is not None:
            try:
                self._conn.rollback()
            except sqlite3.Error:
                pass
        self.close()
        return False

    # --- raw connection access (for tests / advanced use) ----------------

    @property
    def conn(self):
        if self._conn is None:
            raise RuntimeError(
                "EventRepository used before open(); use a `with` block "
                "or call .open() explicitly.")
        return self._conn

    # --- single-row upsert ----------------------------------------------

    def upsert_event(self, event, *, now=None):
        """Insert-or-update a single RawEvent.

        Returns ("inserted", row_id) when this is the first time the
        event's source URL is seen, or ("updated", row_id) when an
        existing row was refreshed.

        ``now`` is an optional override (ISO timestamp) so callers that
        orchestrate batches can stamp every row with the same instant.
        """
        if not isinstance(event, RawEvent):
            raise TypeError("upsert_event expected a RawEvent, got %r"
                            % type(event).__name__)
        if event.sourceUrl is None:
            raise ValueError("event has no sourceUrl; cannot upsert")

        ts = now or _now()
        row = _normalize.event_to_row(event, now=ts)
        existing = self._find_by_source_url(event.sourceUrl)
        if existing is None:
            new_id = self._insert_row(row)
            return "inserted", new_id
        self._update_row(existing["id"], existing, row)
        return "updated", existing["id"]

    def upsert_many(self, events, *, now=None):
        """Batch wrapper. Commits once at the end.

        Returns {"inserted": N, "updated": M}. ``now`` is shared across
        every row in the batch so first_seen_at / last_seen_at land on
        the same instant when the caller wants them to.
        """
        ts = now or _now()
        inserted = 0
        updated = 0
        try:
            for event in events:
                if not isinstance(event, RawEvent):
                    raise TypeError(
                        "upsert_many expected RawEvent items, got %r"
                        % type(event).__name__)
                if event.sourceUrl is None:
                    # A row the crawler cannot identify is not safe to
                    # upsert: it would either collide on its blank key
                    # or vanish into the database with no source URL.
                    # Better to skip it loudly than to silently store it.
                    raise ValueError(
                        "event has no sourceUrl; cannot upsert "
                        "(title=%r)" % (event.title,))
                row = _normalize.event_to_row(event, now=ts)
                existing = self._find_by_source_url(event.sourceUrl)
                if existing is None:
                    self._insert_row(row, commit=False)
                    inserted += 1
                else:
                    self._update_row(existing["id"], existing, row,
                                     commit=False)
                    updated += 1
            self.conn.commit()
        except sqlite3.Error:
            self.conn.rollback()
            raise
        return {"inserted": inserted, "updated": updated}

    # --- lookups --------------------------------------------------------

    def _find_by_source_url(self, source_url):
        """Look up by the canonical form of the URL.

        Douban (and every other major platform) appends tracking suffixes
        (``?icn=list-shopitem``) to the SAME activity. The crawler's own
        ``canonical_url`` already strips those plus ``www.`` and trailing
        slashes, so the lookup key has to go through the same function
        the INSERT uses. Otherwise the second upsert of a re-fetched
        activity would create a duplicate row.
        """
        canonical = canonical_url(source_url)
        if not canonical:
            return None
        cur = self.conn.execute(
            "SELECT * FROM events WHERE source_url = ?", (canonical,))
        row = cur.fetchone()
        return dict(row) if row else None

    def get_by_source_url(self, source_url):
        """Public lookup. Returns a plain dict or None.

        Accepts any URL form the crawler might hand back — the canonical
        URL is what the row is keyed on internally.
        """
        return self._find_by_source_url(source_url)

    def get_by_id(self, event_id):
        cur = self.conn.execute("SELECT * FROM events WHERE id = ?",
                                (event_id,))
        row = cur.fetchone()
        return dict(row) if row else None

    # --- insert / update plumbing --------------------------------------

    def _insert_row(self, row, *, commit=True):
        """One-shot INSERT. ``row`` must have every column key."""
        placeholders = ", ".join(["?"] * len(EVENT_COLUMNS))
        columns = ", ".join(EVENT_COLUMNS)
        values = [row.get(col) for col in EVENT_COLUMNS]
        cur = self.conn.execute(
            "INSERT INTO events (%s) VALUES (%s)" % (columns, placeholders),
            values)
        if commit:
            self.conn.commit()
        return cur.lastrowid

    def _update_row(self, row_id, existing_row, new_row, *, commit=True):
        """SET-only update: only the columns that actually changed."""
        changed = _normalize.merge_for_update(existing_row, new_row)
        if not changed:
            # Nothing in the activity record changed, but the contract
            # still requires us to bump last_seen_at / fetched_at. merge
            # already adds them unconditionally, so an empty dict here
            # means the caller is asking us to skip the UPDATE entirely.
            # We only get here when the crawler crashed mid-run and is
            # re-issuing the same row; touching the DB in that case is
            # cheap and lets the API report a fresh "as of" time.
            pass
        if not changed:
            return
        sets = ", ".join("%s = ?" % key for key in changed.keys())
        values = list(changed.values()) + [row_id]
        self.conn.execute(
            "UPDATE events SET %s WHERE id = ?" % sets, values)
        if commit:
            self.conn.commit()

    # --- search ---------------------------------------------------------

    def search(self, *, city=None, district=None, keyword=None,
               dateStart=None, dateEnd=None, category=None, limit=100):
        """Read-side query.

        ``keyword`` matches title / venue_name / address / organizer via
        case-insensitive LIKE. Date range is applied to start_time with a
        lexical comparison (ISO timestamps sort lexicographically; this is
        also what lets the index on start_time do its job).
        """
        clauses = []
        params = []
        if city:
            clauses.append("city = ?")
            params.append(city)
        if district:
            clauses.append("district = ?")
            params.append(district)
        if category:
            clauses.append("category = ?")
            params.append(category)
        if dateStart:
            clauses.append(_DATE_GTE)
            params.append(dateStart)
        if dateEnd:
            clauses.append(_DATE_LTE)
            params.append(dateEnd)
        if keyword:
            like = "%%%s%%" % _escape_like(keyword)
            clauses.append("(" + " OR ".join([
                "title LIKE ? ESCAPE '\\'",
                "venue_name LIKE ? ESCAPE '\\'",
                "address LIKE ? ESCAPE '\\'",
                "organizer LIKE ? ESCAPE '\\'",
            ]) + ")")
            params.extend([like, like, like, like])

        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = ("SELECT * FROM events%s ORDER BY "
               "COALESCE(start_time, '') ASC, id ASC LIMIT ?"
               % where)
        params.append(int(limit))
        cur = self.conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

    # --- nearby search (PHASE 3) ------------------------------------------

    # Safety valve: the distance filter runs in Python over this candidate
    # window. At Shanghai-city scale (tens of thousands of rows max) this is
    # milliseconds; a bounding-box pre-filter in SQL would be the next step,
    # and it is deliberately NOT here until the data demands it.
    NEARBY_SCAN_LIMIT = 5000

    def search_nearby(self, *, latitude, longitude, radius_km,
                      date_start=None, date_end=None, keyword=None,
                      limit=50):
        """Real radius search over geocoded rows.

        distance_km (Haversine) <= radius_km is the ONLY admission rule —
        no district, no city, no "close enough". Rows without coordinates
        are invisible here BY DESIGN: an event whose position we do not
        know is not "somewhere nearby", it is unknown.

        Returns rows (newest-column dicts) each carrying `distance_km`,
        ordered by distance asc, then start_time, then id — deterministic.
        """
        from pipeline.location.distance import distance_km, within_radius

        radius_km = float(radius_km)
        if not radius_km > 0:
            raise ValueError("radius_km must be > 0, got %r" % radius_km)

        clauses = ["latitude IS NOT NULL", "longitude IS NOT NULL"]
        params = []
        if date_start:
            clauses.append(_DATE_GTE)
            params.append(date_start)
        if date_end:
            clauses.append(_DATE_LTE)
            params.append(date_end)
        if keyword:
            like = "%%%s%%" % _escape_like(keyword)
            clauses.append("(" + " OR ".join([
                "title LIKE ? ESCAPE '\\'",
                "address LIKE ? ESCAPE '\\'",
                "venue_name LIKE ? ESCAPE '\\'",
                "organizer LIKE ? ESCAPE '\\'",
            ]) + ")")
            params.extend([like, like, like, like])

        sql = ("SELECT * FROM events WHERE %s ORDER BY id ASC LIMIT ?"
               % " AND ".join(clauses))
        params.append(self.NEARBY_SCAN_LIMIT)
        cur = self.conn.execute(sql, params)

        hits = []
        for row in cur.fetchall():
            row = dict(row)
            try:
                distance = distance_km(latitude, longitude,
                                       row["latitude"], row["longitude"])
            except ValueError:
                # A corrupt coordinate must not eject the whole query —
                # but it must not masquerade as "nearby" either.
                continue
            if not within_radius(distance, radius_km):
                continue
            row["distance_km"] = distance
            hits.append(row)

        hits.sort(key=lambda r: (r["distance_km"],
                                 r.get("start_time") or "",
                                 r.get("id") or 0))
        return hits[:int(limit)]

    def rows_missing_coordinates(self, limit=None):
        """Rows the backfill owns: a real address, but no coordinates yet."""
        clauses = ["address IS NOT NULL", "TRIM(address) != ''",
                   "latitude IS NULL", "longitude IS NULL"]
        sql = ("SELECT * FROM events WHERE %s ORDER BY id ASC"
               % " AND ".join(clauses))
        params = []
        if limit is not None:
            sql += " LIMIT ?"
            params.append(int(limit))
        cur = self.conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

    def update_coordinates(self, event_id, latitude, longitude, *,
                           geocode_source=None, now=None):
        """Write a geocoded coordinate + its provenance onto one row.

        `geocode_source` is mandatory-ish: a coordinate without a source
        cannot be audited, which is the exact failure mode PHASE 3 exists
        to remove. Returns True when a row was actually updated.
        """
        if latitude is None or longitude is None:
            raise ValueError(
                "update_coordinates refuses NULL coordinates: a failed "
                "geocode leaves the row as-is (null), it never fakes a point")
        if not geocode_source:
            raise ValueError(
                "update_coordinates requires geocode_source: every stored "
                "coordinate must record where it came from")
        ts = now or _now()
        cur = self.conn.execute(
            "UPDATE events SET latitude = ?, longitude = ?, "
            "geocode_source = ?, geocoded_at = ?, updated_at = ? "
            "WHERE id = ?",
            (float(latitude), float(longitude), geocode_source, ts, ts,
             int(event_id)))
        self.conn.commit()
        return cur.rowcount > 0

    def coordinate_stats(self):
        """Coordinate coverage + provenance breakdown, for honest reporting."""
        total = self.count()
        row = self.conn.execute(
            "SELECT "
            "  SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL "
            "            THEN 1 ELSE 0 END) AS with_coords, "
            "  SUM(CASE WHEN address IS NOT NULL AND TRIM(address) != '' "
            "           AND (latitude IS NULL OR longitude IS NULL) "
            "            THEN 1 ELSE 0 END) AS geocodable_missing "
            "FROM events").fetchone()
        by_source = [
            {"source": r[0] or "unknown", "count": int(r[1])}
            for r in self.conn.execute(
                "SELECT geocode_source, COUNT(*) FROM events "
                "WHERE latitude IS NOT NULL GROUP BY geocode_source "
                "ORDER BY 2 DESC")
        ]
        with_coords = int(row["with_coords"] or 0)
        return {
            "totalEvents": total,
            "withCoordinates": with_coords,
            "coordinatePercentage": round(100.0 * with_coords / total, 1)
                                    if total else 0.0,
            "geocodableMissing": int(row["geocodable_missing"] or 0),
            "bySource": by_source,
        }

    # --- aggregates -----------------------------------------------------

    def count(self):
        cur = self.conn.execute("SELECT COUNT(*) FROM events")
        return int(cur.fetchone()[0])

    def distinct_districts(self, *, city=None):
        """districts the DB actually contains, with their counts.

        Ordered by count desc. Includes a None bucket (unrecognised
        district) so the caller can show "unknown: N" rather than hide it.
        """
        if city:
            cur = self.conn.execute(
                "SELECT district, COUNT(*) AS n FROM events "
                "WHERE city = ? GROUP BY district ORDER BY n DESC, "
                "district IS NULL", (city,))
        else:
            cur = self.conn.execute(
                "SELECT district, COUNT(*) AS n FROM events "
                "GROUP BY district ORDER BY n DESC, district IS NULL")
        return [(row[0], int(row[1])) for row in cur.fetchall()]

    def distinct_sources(self):
        cur = self.conn.execute(
            "SELECT source_name, COUNT(*) AS n FROM events "
            "GROUP BY source_name ORDER BY n DESC")
        return [(row[0], int(row[1])) for row in cur.fetchall()]

    def stats(self):
        """Data-quality counters in the shape the spec asks for.

        Every counter is reported as (count, percentage). 0 % rows are
        still returned (so a freshly-empty DB prints every counter as
        0/0) — callers should not assume any field is absent.
        """
        total = self.count()
        unique_sources = self.conn.execute(
            "SELECT COUNT(DISTINCT source_url) FROM events"
        ).fetchone()[0]

        # A single SELECT with COUNT() filters is cheaper than N round
        # trips, and lets the planner pick the right index per predicate.
        row = self.conn.execute(
            "SELECT "
            "  SUM(CASE WHEN start_time IS NOT NULL "
            "            AND TRIM(start_time) != '' THEN 1 ELSE 0 END) AS with_date, "
            "  SUM(CASE WHEN district IS NOT NULL "
            "            AND TRIM(district) != '' THEN 1 ELSE 0 END) AS with_district, "
            "  SUM(CASE WHEN venue_name IS NOT NULL "
            "            AND TRIM(venue_name) != '' THEN 1 ELSE 0 END) AS with_venue, "
            "  SUM(CASE WHEN address IS NOT NULL "
            "            AND TRIM(address) != '' THEN 1 ELSE 0 END) AS with_address, "
            "  SUM(CASE WHEN price IS NOT NULL "
            "            AND TRIM(price) != '' THEN 1 ELSE 0 END) AS with_price, "
            "  SUM(CASE WHEN organizer IS NOT NULL "
            "            AND TRIM(organizer) != '' THEN 1 ELSE 0 END) AS with_organizer "
            "FROM events"
        ).fetchone()

        def pct(n):
            if not total:
                return 0.0
            return round(100.0 * n / total, 1)

        return {
            "totalEvents":       {"count": total,
                                  "percentage": 100.0 if total else 0.0},
            "uniqueSourceUrls":  {"count": int(unique_sources),
                                  "percentage": (100.0 if total else 0.0)},
            "withDate":          {"count": int(row["with_date"] or 0),
                                  "percentage": pct(row["with_date"])},
            "withDistrict":      {"count": int(row["with_district"] or 0),
                                  "percentage": pct(row["with_district"])},
            "withVenue":         {"count": int(row["with_venue"] or 0),
                                  "percentage": pct(row["with_venue"])},
            "withAddress":       {"count": int(row["with_address"] or 0),
                                  "percentage": pct(row["with_address"])},
            "withPrice":         {"count": int(row["with_price"] or 0),
                                  "percentage": pct(row["with_price"])},
            "withOrganizer":     {"count": int(row["with_organizer"] or 0),
                                  "percentage": pct(row["with_organizer"])},
        }


def _escape_like(value):
    """Escape LIKE wildcards in user-supplied keywords.

    Without this, a search for "50%" would silently match every row.
    """
    if value is None:
        return ""
    return (str(value)
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_"))