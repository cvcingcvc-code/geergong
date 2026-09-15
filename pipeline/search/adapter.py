# Search -> pipeline adapter (PHASE 4, extended in PHASE 5).
#
# The whole point of this module: a search hit must enter the EXISTING
# pipeline (normalize -> clean -> dedupe -> trust -> route). No second
# normalize, no second dedupe, no forked schema.
#
# So this adapter ONLY renames fields into the canonical raw shape from
# pipeline/schema.py and tucks the retrieval provenance into `_extra`.
# It performs zero cleaning, zero validation and zero scoring.
#
# PHASE 5 addition: the fields the EventExtractor pulled out of the real page
# (image, agenda, per-field provenance, fetch outcome) travel through as
# canonical raw fields + `_extra.extract`, so the Detail screen can show
# "where did this come from" without a second lookup.

from pipeline.search.models import RawSearchResult

# search-layer field -> canonical raw field
_FIELD_MAP = {
    "title": "title",
    "snippet": "description",
    "rawDate": "startDate",
    "rawTime": "startTime",
    "rawEndTime": "endTime",
    "rawVenue": "venue",
    "address": "address",
    "rawLocation": "location",
    "rawPrice": "price",
    "organizer": "organizer",
    "url": "sourceUrl",
    "registrationUrl": "registrationUrl",
    "publishedAt": "publishedAt",
    "source": "sourceName",
    "imageUrl": "imageUrl",
    "imageSource": "imageSource",
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

    # The extractor may have found a district/city the listing did not state.
    if getattr(result, "district", None):
        act["district"] = result.district
    if getattr(result, "city", None):
        act["city"] = result.city

    tags = result.tags or []
    act["tags"] = list(tags) if isinstance(tags, list) else [str(tags)]
    if collected_at:
        act["collectedAt"] = collected_at

    # Agenda only travels when the source actually published a timetable.
    extract_info = getattr(result, "extractInfo", None) or {}
    agenda = extract_info.get("agenda") or []
    if agenda:
        act["agenda"] = [dict(a) for a in agenda]

    # Retrieval provenance travels with the record, never influencing rules.
    act["_extra"] = {
        "search": {
            "resultId": result.resultId,
            "providerQuery": result.providerQuery,
            "provider": result.provider,
            "source": result.source,
            "sourceType": result.sourceType,
            "sourceTrust": result.sourceTrust,
            "dataOrigin": getattr(result, "dataOrigin", None) or "demo",
            "retrievedAt": getattr(result, "retrievedAt", None),
            "rank": getattr(result, "rank", None),
        },
        "extract": {
            "confidence": extract_info.get("confidence"),
            "fieldSources": dict(extract_info.get("fieldSources") or {}),
            "fetch": dict(extract_info.get("fetch") or {}),
            "skipped": extract_info.get("skipped"),
            "imageSource": getattr(result, "imageSource", None),
        },
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
        "provider": info.get("provider"),
        "dataOrigin": info.get("dataOrigin"),
        "retrievedAt": info.get("retrievedAt"),
        "url": activity.get("sourceUrl"),
        "imageSource": activity.get("imageSource"),
        # The source's own headline for THIS record — what the Detail page
        # lists under 信息来源, so a reader can recognise the original post.
        "title": activity.get("title"),
        "publishedAt": activity.get("publishedAt"),
    }


def extract_info_of(activity):
    """Page-extraction provenance for one pipeline record."""
    return dict(((activity.get("_extra") or {}).get("extract")) or {})
