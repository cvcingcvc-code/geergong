# Search -> pipeline adapter (PHASE 4).
#
# The whole point of this module: a search hit must enter the EXISTING
# pipeline (normalize -> clean -> dedupe -> trust -> route). No second
# normalize, no second dedupe, no forked schema.
#
# So this adapter ONLY renames fields into the canonical raw shape from
# pipeline/schema.py and tucks the retrieval provenance into `_extra`.
# It performs zero cleaning, zero validation and zero scoring.

from pipeline.search.models import RawSearchResult

# search-layer field -> canonical raw field
_FIELD_MAP = {
    "title": "title",
    "snippet": "description",
    "rawDate": "startDate",
    "rawTime": "startTime",
    "rawVenue": "venue",
    "address": "address",
    "rawLocation": "location",
    "rawPrice": "price",
    "organizer": "organizer",
    "url": "sourceUrl",
    "registrationUrl": "registrationUrl",
    "publishedAt": "publishedAt",
    "source": "sourceName",
}

# Non-canonical keys the pipeline must still see at top level:
#   location  -> normalize/location.split_location reads it directly
#   tags      -> normalize flattens strings / lists
_LOCATION_KEY = "location"


def to_raw_activity(result, collected_at=None):
    """RawSearchResult -> canonical *raw* activity dict for the pipeline."""
    if isinstance(result, dict):
        result = RawSearchResult.from_dict(result)

    act = {"id": result.resultId, "status": "raw"}
    for src_key, dst_key in _FIELD_MAP.items():
        act[dst_key] = getattr(result, src_key, None)

    tags = result.tags or []
    act["tags"] = list(tags) if isinstance(tags, list) else [str(tags)]
    if collected_at:
        act["collectedAt"] = collected_at

    # Retrieval provenance travels with the record, never influencing rules.
    act["_extra"] = {
        "search": {
            "resultId": result.resultId,
            "providerQuery": result.providerQuery,
            "provider": result.provider,
            "source": result.source,
            "sourceType": result.sourceType,
            "sourceTrust": result.sourceTrust,
        }
    }
    return act


def to_raw_activities(results, collected_at=None):
    return [to_raw_activity(r, collected_at=collected_at) for r in results]


def provenance_of(activity):
    """Retrieval provenance entry for one pipeline record (or None)."""
    info = ((activity.get("_extra") or {}).get("search")) or {}
    if not info:
        return None
    return {
        "resultId": info.get("resultId"),
        "source": info.get("source") or activity.get("sourceName"),
        "sourceType": info.get("sourceType"),
        "sourceTrust": info.get("sourceTrust"),
        "providerQuery": info.get("providerQuery"),
        "url": activity.get("sourceUrl"),
    }
