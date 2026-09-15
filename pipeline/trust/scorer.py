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
        score += PENALTIES["time_conflict"]; reasons.append("invalid_time_range")

    if conflict:
        score += PENALTIES["cross_source_conflict"]; reasons.append("cross_source_conflict")

    return max(0, min(100, score)), reasons


def _conflict_groups(acts):
    """Deterministic cross-source conflict detection (PHASE 9).

    Groups canonical records by (title, startDate); within a group, compares
    venue / start time / price. Returns ({key: [conflict dicts]}, {key: n}).
    """
    groups = {}
    for act in acts:
        if act.get("duplicateOf"):
            continue
        key = (act.get("title") or "", act.get("startDate") or "")
        if not key[0] or not key[1]:
            continue
        groups.setdefault(key, []).append(act)

    conflicts = {}
    counts = {}
    for key, members in groups.items():
        counts[key] = len({m.get("sourceName") or "" for m in members})
        found = []

        venues = sorted({(m.get("venue") or "").strip() for m in members if (m.get("venue") or "").strip()})
        if len(venues) > 1:
            found.append({"type": "location_conflict", "detail": "场地不一致: %s" % " vs ".join(venues)})

        times = sorted({m.get("startTime") for m in members if m.get("startTime")})
        if len(times) > 1:
            found.append({"type": "time_conflict", "detail": "开始时间不一致: %s" % " vs ".join(times)})

        prices = sorted({(m.get("priceType"), m.get("price")) for m in members})
        if len(prices) > 1:
            def _fmt(pair):
                pt, p = pair
                return "免费" if pt == "free" else ("¥%g" % p if pt == "paid" and p is not None else "未知")
            found.append({"type": "price_conflict", "detail": "价格不一致: %s" % " vs ".join(_fmt(p) for p in prices)})

        if found:
            conflicts[key] = found
    return conflicts, counts


def score_all(activities):
    """Score every activity; also flags cross-source conflicts.

    Conflict rule (deterministic): same normalized title+date appears in
    records with different venue / start time / price -> all members of the
    group get cross_source_conflict + a specific *_conflict reason, and a
    `conflicts` detail list. Never auto-resolved: routing sends them to
    needs_review.
    """
    acts = [dict(a) for a in activities]
    conflicts, counts = _conflict_groups(acts)

    for act in acts:
        key = (act.get("title") or "", act.get("startDate") or "")
        src_n = counts.get(key, 1)
        conflict = key in conflicts
        score, reasons = score_activity(act, source_counts=None if src_n <= 1 else {key: src_n}, conflict=conflict)
        if conflict:
            for c in conflicts[key]:
                reasons.append(c["type"])
            act["conflicts"] = conflicts[key]
        act["trustScore"] = score
        act["trustReasons"] = sorted(set(list(act.get("trustReasons") or []) + reasons))
    return acts
