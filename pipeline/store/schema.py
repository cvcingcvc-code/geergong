# SQLite DDL for the local event store (PHASE 2).
#
# One table. Every column from the PHASE 2 spec is here, with the field-name
# translation that the rest of the project uses (snake_case rows, not
# camelCase). The DDL is intentionally a plain CREATE TABLE statement: the
# store is one table, the migrations file owns idempotency, and a single
# CREATE TABLE IF NOT EXISTS is what every fresh / restart test relies on.

# Schema version. Bumped by migrations.py when an ALTER is added.
#
# v2 (PHASE 3): adds geocode_source / geocoded_at next to the (pre-existing)
# latitude / longitude columns — every stored coordinate must record WHERE
# it came from and WHEN it was resolved.
SCHEMA_VERSION = 2

# Source URL is the durable identity of a real-world event: the page is the
# fact, the in-memory row is the cache. Every other field can change.
#
# We still keep a separate canonical_key column for the day a second source
# agrees on the same activity: in V1 it is just the normalised source URL,
# so existing dedupe logic (lookups, hash joins) does not need a special case.
DDL = """
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    canonical_key   TEXT NOT NULL,

    title           TEXT,

    start_time      TEXT,
    end_time        TEXT,

    city            TEXT,
    district        TEXT,

    venue_name      TEXT,
    address         TEXT,

    latitude        REAL,
    longitude       REAL,

    category        TEXT,

    price_type      TEXT,
    price           TEXT,

    organizer       TEXT,

    source_name     TEXT,
    source_url      TEXT NOT NULL,
    source_event_id TEXT,

    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,

    status          TEXT NOT NULL DEFAULT 'active',

    raw_json        TEXT,

    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
"""

# Unique index on source_url: every real event page is its own identity.
# An attempt to insert a second row with the same URL fails at the index
# level and is converted to an UPDATE by the repository.
DDL_INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_events_source_url "
    "ON events(source_url)",

    # Speeds up the most common search filters.
    "CREATE INDEX IF NOT EXISTS ix_events_city_district "
    "ON events(city, district)",
    "CREATE INDEX IF NOT EXISTS ix_events_start_time "
    "ON events(start_time)",
    "CREATE INDEX IF NOT EXISTS ix_events_category "
    "ON events(category)",
    "CREATE INDEX IF NOT EXISTS ix_events_canonical_key "
    "ON events(canonical_key)",

    # Cheap text search across the keyword-target fields. SQLite's FTS5 would
    # be heavier and require an extra virtual table; LIKE is enough for V1
    # and uses these indexes to avoid a full scan in the common cases.
    "CREATE INDEX IF NOT EXISTS ix_events_title "
    "ON events(title)",
    "CREATE INDEX IF NOT EXISTS ix_events_organizer "
    "ON events(organizer)",
]

# schema_version is a one-row metadata table. The migrations module writes it
# in the same transaction that mutates the schema, so a crash mid-upgrade
# still leaves the database in a self-consistent state.
DDL_META = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def ddl_statements():
    """The ordered DDL bundle a fresh database applies at open time.

    The meta table is created first because schema_version is written into
    it as part of the same transaction. Indexes come after the main table
    so the planner has column statistics to work with.
    """
    return [DDL_META, DDL] + DDL_INDEXES


# v2 columns. NOT part of the v1 DDL: apply_v1 always builds the v1 table and
# apply_v2 then ALTERs — one code path for fresh and existing databases alike,
# and an idempotency check in apply_v2 keeps re-runs safe.
V2_COLUMNS = (
    ("geocode_source", "TEXT"),
    ("geocoded_at", "TEXT"),
)

# Column list, in the order they appear in the schema, used by the
# repository to build INSERT statements without hand-listing them.
EVENT_COLUMNS = (
    "canonical_key",
    "title",
    "start_time",
    "end_time",
    "city",
    "district",
    "venue_name",
    "address",
    "latitude",
    "longitude",
    "geocode_source",
    "geocoded_at",
    "category",
    "price_type",
    "price",
    "organizer",
    "source_name",
    "source_url",
    "source_event_id",
    "first_seen_at",
    "last_seen_at",
    "fetched_at",
    "status",
    "raw_json",
    "created_at",
    "updated_at",
)