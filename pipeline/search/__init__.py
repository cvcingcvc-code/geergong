# Gorgon Information Retrieval (PHASE 4 of the Gorgon roadmap).
#
#   SearchRequest -> SearchPlan -> RawSearchResult -> SearchCandidate
#                 -> RankedEvent
#
# Search hits enter the EXISTING data pipeline; nothing here re-implements
# normalize / dedupe / trust / human review.
#
# See docs/INFORMATION_RETRIEVAL_CONTRACT.md

from pipeline.search.models import (  # noqa: F401
    BUCKETS,
    PRICE_PREFERENCES,
    TIME_PREFERENCES,
    RankedEvent,
    RawSearchResult,
    SearchCandidate,
    SearchPlan,
    SearchQuery,
    SearchRequest,
    bucket_for,
)
from pipeline.search.planner import (  # noqa: F401
    LLMQueryPlanner,
    parse_request,
    plan_search,
    resolve_date_range,
)
from pipeline.search.provider import (  # noqa: F401
    FixtureSearchProvider,
    ManualSearchProvider,
    SearchProvider,
    default_provider,
)
from pipeline.search.service import search_events, search_events_from_text  # noqa: F401

__all__ = [
    "SearchRequest", "SearchPlan", "SearchQuery", "RawSearchResult",
    "SearchCandidate", "RankedEvent", "BUCKETS",
    "PRICE_PREFERENCES", "TIME_PREFERENCES", "bucket_for",
    "parse_request", "plan_search", "resolve_date_range", "LLMQueryPlanner",
    "SearchProvider", "FixtureSearchProvider", "ManualSearchProvider",
    "default_provider",
    "search_events", "search_events_from_text",
]
