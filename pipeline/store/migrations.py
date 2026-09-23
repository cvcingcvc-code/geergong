# Schema migrations for the local event store (PHASE 2).
#
# The store owns its own schema version. Migrations are run on every open()
# so the same code path that handles a brand-new DB also upgrades an
# older one — no separate "migrate before use" step, no surprise when the
# API server is started against a months-old gorgon.db.
#
# Design rules:
#
#   * Each migration is (version, apply(conn)).
#   * apply() is idempotent: if the migration is not needed (target version
#     already reached), it does nothing.
#   * The whole upgrade runs in a single transaction, so a crash mid-upgrade
#     leaves the schema either fully old or fully new, never half-built.
#   * The schema_version row is the source of truth. Other metadata goes
#     into schema_meta alongside it but the integer version is what counts.

import sqlite3

from pipeline.store.schema import SCHEMA_VERSION, ddl_statements


def _read_version(conn):
    """Current schema version, or 0 when the meta table is absent."""
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    if not row:
        return 0
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return 0


def _write_version(conn, version):
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(int(version)),),
    )


# --- individual migrations --------------------------------------------------
#
# In V1 there is only one: the "fresh install" migration, which is the same
# DDL the schema module ships. New versions become new functions, each keyed
# by their target version number. Adding a column? Write apply_v2(conn).
#
# Migrations are NOT expected to drop or rename existing columns in V1 —
# the store is local, nothing reads it from outside, but losing an old
# field silently would still surprise the crawler report. New columns are
# fine; removals are a deliberate, separate operation.


def apply_v1(conn):
    """Initial schema. Brings a brand-new database to SCHEMA_VERSION=1."""
    for stmt in ddl_statements():
        conn.executescript(stmt)
    _write_version(conn, 1)


def apply_v2(conn):
    """PHASE 3: provenance columns for stored coordinates.

    latitude/longitude existed since v1 but nothing ever wrote them; v2 adds
    the two columns that make a coordinate auditable: which geocoder produced
    it and when. Idempotent via PRAGMA table_info, so running it against an
    already-migrated database is a no-op.
    """
    from pipeline.store.schema import V2_COLUMNS
    existing = {row[1] for row in conn.execute("PRAGMA table_info(events)")}
    for column_name, column_type in V2_COLUMNS:
        if column_name not in existing:
            conn.execute("ALTER TABLE events ADD COLUMN %s %s"
                         % (column_name, column_type))
    _write_version(conn, 2)


_MIGRATIONS = {
    1: apply_v1,
    2: apply_v2,
}


def run_migrations(conn):
    """Bring ``conn`` to the latest SCHEMA_VERSION. Idempotent.

    The schema_meta table is created up front so the version read below
    is well-defined even on a brand-new database. Without this the first
    ``_read_version`` call would raise "no such table" and the migration
    would never run.
    """
    # Ensure the meta table exists before we try to read the version out
    # of it. ddl_statements() returns the meta DDL first; we run only the
    # meta statement here so the rest of the migration is unchanged.
    from pipeline.store.schema import DDL_META
    conn.executescript(DDL_META)
    current = _read_version(conn)
    if current >= SCHEMA_VERSION:
        return current
    target = SCHEMA_VERSION
    try:
        for version in range(current + 1, target + 1):
            apply = _MIGRATIONS.get(version)
            if apply is None:
                raise RuntimeError(
                    "no migration registered for schema_version=%d" % version)
            apply(conn)
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        raise
    return SCHEMA_VERSION