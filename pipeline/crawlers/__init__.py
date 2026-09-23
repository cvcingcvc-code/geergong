# Gorgon crawler layer (REAL EVENT INDEX V1 — PHASE 1).
#
# A crawler is NOT a SearchProvider, and the two are deliberately kept apart:
#
#   SearchProvider   answers ONE user question, right now, at search time.
#                    It reads a handful of listing pages and returns
#                    RawSearchResult rows for the retrieval layer.
#
#   Crawler          discovers and collects a source's catalogue IN BULK,
#                    offline from any user query: listing page -> activity URL
#                    -> dedupe -> detail page -> RawEvent -> JSON.
#
# Mixing them would let batch-crawl concerns (pagination, dedupe across pages,
# per-URL success accounting, stop conditions) leak into the interactive
# search path, where they have no business. So the crawler layer is separate
# and shares only the already-existing PageFetcher.
#
# Nothing here touches the database, the search service or the UI. PHASE 1
# proves exactly one thing: real web page -> real structured activity.
