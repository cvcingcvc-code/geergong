# RawEvent -> SQLite row mapping (PHASE 2).
#
# The crawler writes a flat ``RawEvent`` whose fields are exactly what the
# source published. The store needs a wider shape (a canonical key for
# cross-source matching, a coarse price_type for filtering, the source URL
# indexed, etc.). This module owns that translation so the repository can
# stay focused on SQL.
#
# Rules:
#   * No fetching, no LLM, no guessing: a fact the crawler did not record
#     stays null in the row, never a plausible default.
#   * ``canonical_key`` is the crawler's own canonical_url(source_url),
#     which lower-cases the host, drops the "www." prefix, removes tracking
#     query strings and strips a trailing slash. A future second source
#     that points at the same real-world event will land on the same key.
#   * ``price_type`` is a coarse label ("free" / "paid" / None) computed
#     from the price text the crawler recorded. It is a derived column, so
#     it is recomputed on every upsert — the source page may change its
#     mind about whether an event is free.
#   * ``category`` is taken from ``rawData.detail.category`` when the
#     detail page published one; otherwise null. Nothing is guessed here
#     either — the crawler's parser is the only thing allowed to set it.
#   * ``raw_json`` is the verbatim ``RawEvent.to_dict()`` JSON, so any
#     later dispute about a row's provenance can be resolved by reading
#     it back without re-running the crawl.

import hashlib
import json
import re

from pipeline.crawlers.base import canonical_url
from pipeline.crawlers.models import RawEvent


# Free-text markers the source uses. "免费" is the dominant shape; the
# rest are defensive against any future source the schema still accepts.
_FREE_PATTERNS = (
    re.compile(r"^\s*免费\s*$"),
    re.compile(r"^\s*free\s*$", re.IGNORECASE),
)


def derive_price_type(price):
    """Coarse price bucket, or None when unknown.

    "免费" / "free" -> "free". Anything else with content -> "paid".
    Empty / None stays None so the stats column "withPrice" stays honest.
    """
    if not price or not isinstance(price, str):
        return None
    text = price.strip()
    if not text:
        return None
    for pattern in _FREE_PATTERNS:
        if pattern.match(text):
            return "free"
    return "paid"


def derive_category(raw_data):
    """Detail-page category, or None. Never guessed."""
    if not isinstance(raw_data, dict):
        return None
    detail = raw_data.get("detail")
    if not isinstance(detail, dict):
        return None
    value = detail.get("category")
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def derive_canonical_key(source_url):
    """Stable identity for the activity, suitable for cross-source matching.

    The crawler's own ``canonical_url`` already collapses Douban's tracking
    suffixes (``?icn=list-shopitem``) and removes trailing-slash noise,
    so the canonical key is just that normalised URL. We still hash it
    down to a fixed-width string so the column reads as an opaque key
    rather than a URL — that lets the same column later carry values from
    sources that don't have a public URL at all.
    """
    if not source_url:
        return None
    norm = canonical_url(source_url) or source_url
    digest = hashlib.sha256(norm.encode("utf-8")).hexdigest()
    return digest[:16]


def event_to_row(event, *, now):
    """RawEvent -> flat row dict matching the events table.

    ``now`` is an ISO timestamp injected by the caller so the same wall
    clock value can be shared across an entire batch (first/last seen are
    derived from it). It is the repository that decides what "now" means;
    the normalisation layer stays clock-agnostic.
    """
    if not isinstance(event, RawEvent):
        # Defensive: a malformed call should not produce a half-truth row.
        raise TypeError("event_to_row expected a RawEvent, got %r"
                        % type(event).__name__)
    raw_dict = event.to_dict()
    raw_json = json.dumps(raw_dict, ensure_ascii=False, sort_keys=True)
    # source_url goes through canonical_url() so that the URL the row is
    # keyed on is the form the repository's _find_by_source_url will
    # produce from ANY of the URL variants the crawler may hand back.
    # This is what makes "https://x.com/event/1/" and
    # "https://x.com/event/1/?icn=track" the same row.
    canonical_source_url = canonical_url(event.sourceUrl) or event.sourceUrl
    return {
        "canonical_key":   derive_canonical_key(event.sourceUrl),
        "title":           event.title,
        "start_time":      event.startTime,
        "end_time":        event.endTime,
        "city":            event.city,
        "district":        event.district,
        "venue_name":      event.venueName,
        "address":         event.address,
        "latitude":        None,
        "longitude":       None,
        # Coordinates are OWNED by the geocoding layer (pipeline.location),
        # never by the crawler: a fresh crawl cannot fabricate them, and the
        # upsert merge treats blank as "don't touch" so a re-crawl never
        # wipes a geocoded coordinate. These stay None here on purpose.
        "geocode_source":  None,
        "geocoded_at":     None,
        "category":        derive_category(event.rawData),
        "price_type":      derive_price_type(event.price),
        "price":           event.price,
        "organizer":       event.organizer,
        "source_name":     event.sourceName,
        "source_url":      canonical_source_url,
        "source_event_id": event.sourceEventId,
        "first_seen_at":   now,
        "last_seen_at":    now,
        "fetched_at":      now,
        "status":          "active",
        "raw_json":        raw_json,
        "created_at":      now,
        "updated_at":      now,
    }


# Columns the upsert is allowed to overwrite on a same-source-URL row.
# Anything in this list is recomputed on every crawl; anything not in it
# (notably ``id`` and ``first_seen_at``) is preserved across updates.
UPDATABLE_COLUMNS = (
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
    "category",
    "price_type",
    "price",
    "organizer",
    "source_name",
    "source_event_id",
    "last_seen_at",
    "fetched_at",
    "status",
    "raw_json",
    "updated_at",
)


def merge_for_update(existing_row, new_row):
    """Pick which fields actually changed and need to be written.

    A NULL/blank value in ``new_row`` is treated as "this run did not
    observe a fact" rather than as "the source published null" — so we
    never overwrite an existing value with an empty one. The reverse
    direction (a previously-missing field finally has data) is honoured:
    that is a legitimate change and we want to record it.

    Timestamps and raw_json are always refreshed when they are present
    in ``new_row`` — they describe the crawl, not the activity, and
    ``raw_json`` in particular changes whenever any field was observed
    differently this time around. Tests can pass partial dicts; in
    production the row dict is always the full output of
    ``event_to_row``.
    """
    if not existing_row:
        return dict(new_row)
    changed = {}
    for key in UPDATABLE_COLUMNS:
        old_value = existing_row.get(key)
        new_value = new_row.get(key)
        # Never overwrite an existing fact with an empty observation.
        # The crawler produces None when it could not read the field;
        # that is "we don't know this time", not "the source says null".
        if _is_blank(new_value):
            continue
        if _is_blank(old_value) or old_value != new_value:
            changed[key] = new_value
    # Timestamps and raw_json are always refreshed when present — they
    # are part of the "we saw this row today" contract, not part of the
    # activity record. .get() so a partial test dict still works.
    for key in ("last_seen_at", "fetched_at", "raw_json"):
        if key in new_row:
            changed[key] = new_row[key]
    return changed


def _is_blank(value):
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    return False