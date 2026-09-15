# Trust scoring (PHASE 7) — 100% deterministic and explainable.
#
# Every point comes from a named rule recorded in trustReasons. No model,
# no mystery numbers. Score is clamped to 0-100.

import re

# --- positive rules ---------------------------------------------------------
POINTS = {
    "has_source_url": 15,
    "has_registration_url": 5,
    "has_organizer": 10,
    "has_explicit_date": 15,
    "has_explicit_time": 10,
    "has_venue": 10,
    "has_district_or_address": 10,
    "confirmed_by_multiple_sources": 15,
    "source_fields_complete": 10,
}

# --- negative rules ---------------------------------------------------------
PENALTIES = {
    "missing_date": -20,
    "missing_place": -15,
    "missing_source": -10,
    "spammy_title": -10,
    "time_conflict": -10,
    "cross_source_conflict": -15,
}

# Marketing-spam keywords (deterministic blocklist; small on purpose).
_SPAM_WORDS = ["速看", "惊了", "震惊", "转发", "福利", "速抢", "错过后悔", "点击领取"]
_SPAM_RE = re.compile("|".join(_SPAM_WORDS))
_EXCLAM_RUN = re.compile("[!！]{3,}")


def _fill_ratio(act):
    fields = [
        "title", "description", "startDate", "startTime", "venue", "address",
        "district", "city", "organizer", "sourceUrl", "registrationUrl",
    ]
    filled = sum(1 for f in fields if act.get(f))
    return filled / len(fields)


def score_activity(act, source_counts=None, conflict=False):
    """Return (score:int, reasons:list[str]) for one activity.

    source_counts: {title_key+date: n} from ingest — used for the
    multi-source confirmation bonus.
    conflict: True when another source disagrees on venue/price for the
    same normalized title+date (computed in the trust stage runner).
    """
    reasons = []
    score = 0

    if act.get("sourceUrl"):
        score += POINTS["has_source_url"]; reasons.append("has_source_url")
    if act.get("registrationUrl"):
        score += POINTS["has_registration_url"]; reasons.append("has_registration_url")
    if act.get("organizer"):
        score += POINTS["has_organizer"]; reasons.append("has_organizer")
    if act.get("startDate"):
        score += POINTS["has_explicit_date"]; reasons.append("has_explicit_date")
    if act.get("startTime"):
        score += POINTS["has_explicit_time"]; reasons.append("has_explicit_time")
    if act.get("venue"):
        score += POINTS["has_venue"]; reasons.append("has_venue")
    if act.get("district") or act.get("address"):
        score += POINTS["has_district_or_address"]; reasons.append("has_district_or_address")

    if source_counts:
        key = (act.get("title") or "", act.get("startDate") or "")
        if key[0] and key[1] and source_counts.get(key, 1) > 1:
            score += POINTS["confirmed_by_multiple_sources"]
            reasons.append("confirmed_by_multiple_sources")

    if _fill_ratio(act) >= 0.7:
        score += POINTS["source_fields_complete"]; reasons.append("source_fields_complete")

    # Penalties -----------------------------------------------------------
    if not act.get("startDate"):
        score += PENALTIES["missing_date"]; reasons.append("missing_date")
    if not act.get("venue") and not act.get("district") and not act.get("address"):
        score += PENALTIES["missing_place"]; reasons.append("missing_place")
    if not act.get("sourceName") and not act.get("sourceUrl"):
        score += PENALTIES["missing_source"]; reasons.append("missing_source")

    title = act.get("title") or ""
    if title and (_SPAM_RE.search(title) or _EXCLAM_RUN.search(title)):
        score += PENALTIES["spammy_title"]; reasons.append("spammy_title")

    if act.get("startTime") and act.get("endTime") and act["endTime"] <= act["startTime"]:
        score += PENALTIES["time_conflict"]; reasons.append("time_conflict")

    if conflict:
        score += PENALTIES["cross_source_conflict"]; reasons.append("cross_source_conflict")

    return max(0, min(100, score)), reasons


def score_all(activities):
    """Score every activity; also flags cross-source conflicts.

    Conflict rule (deterministic): same title_key+startDate appears in
    records with different venue keys -> both conflicting records flagged.
    """
    acts = [dict(a) for a in activities]

    # source_counts counts distinct sourceNames per (title, date).
    counts = {}
    venue_by_key = {}
    for act in acts:
        if act.get("duplicateOf"):
            continue
        key = (act.get("title") or "", act.get("startDate") or "")
        if not key[0] or not key[1]:
            continue
        src = act.get("sourceName") or ""
        counts.setdefault(key, set()).add(src)
        vk = (act.get("venue") or "").casefold()
        venue_by_key.setdefault(key, set()).add(vk)

    conflict_keys = {
        key for key, venues in venue_by_key.items()
        if len([v for v in venues if v]) > 1
    }

    for act in acts:
        key = (act.get("title") or "", act.get("startDate") or "")
        src_n = len(counts.get(key, set())) if (key[0] and key[1]) else 1
        # confirmed_by_multiple_sources requires 2+ DISTINCT sources
        conflict = key in conflict_keys
        score, reasons = score_activity(act, source_counts=None if src_n <= 1 else {key: src_n}, conflict=conflict)
        act["trustScore"] = score
        act["trustReasons"] = sorted(set(list(act.get("trustReasons") or []) + reasons))
    return acts
