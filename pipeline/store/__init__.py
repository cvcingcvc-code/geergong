# Event store (REAL EVENT INDEX V1 — PHASE 2).
#
# The store turns the crawler layer's flat RawEvent stream into a queryable,
# incrementally-updatable local database. It is the boundary between the
# "go to the network and read pages" side of the pipeline and the "what we
# actually know about the world" side. Nothing here fetches anything from
# the network.
#
# Public surface:
#
#   EventRepository(db_path)        upsert / search / stats against one DB
#   pipeline.store.normalize        RawEvent -> row-dict mapping
#   pipeline.store.schema           DDL string + CREATE TABLE IF NOT EXISTS
#   pipeline.store.migrations       version-tracked, idempotent upgrades
#   python -m pipeline.store.stats  quality statistics over the live DB
#   python -m pipeline.store.crawl  convenience: crawler -> SQLite (alias of
#                                   python -m pipeline.crawlers.run --store)
#
# The DB path defaults to ``pipeline/data/gorgon.db``; tests pass an explicit
# ``:memory:`` or a tmpdir path so they never touch the production file.