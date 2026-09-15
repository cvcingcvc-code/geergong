# Admin review export (PHASE 2 of Human Review Loop):
#   ui_kits/admin/generated-review-data.js
#   window.GORGON_REVIEW_QUEUE = [...]
#
# Maps the REAL pipeline review queue (review_queue.json + scored records)
# into the shape the existing ReviewConsole consumes. No mock data, no
# schema rework — see docs/HUMAN_REVIEW_CONTRACT.md.

import json
from pathlib import Path

from pipeline.normalize.datetime import date_label
from pipeline.normalize.activity import price_label

# reason -> suggestion label used by the existing ReviewConsole UI.
_SUGGESTION = {
    "duplicate_candidate": "review",
    "cross_source_conflict": "review",
    "low_confidence": "reject",
    "medium_confidence": "review",
}


def build_review_items(activities, queue_entries):
    """UI-shaped review items from real pipeline records.

    activities: all post-trust records (duplicates included)
    queue_entries: queue list from review_queue.json
    """
    by_id = {a.get("id"): a for a in activities if a.get("id")}
    items = []
    for entry in queue_entries:
        act = entry["activity"]
        act_id = act.get("id")

        # Duplicate candidates: snapshot the canonical (winner) record for
        # the side-by-side comparison (title/date/venue/organizer/source).
        candidates = []
        for cand in entry.get("duplicateCandidates") or []:
            winner = by_id.get(cand.get("duplicateOf"))
            if not winner:
                continue
            candidates.append({
                "duplicateOf": winner.get("id"),
                "duplicateConfidence": cand.get("duplicateConfidence"),
                "activity": {
                    "title": winner.get("title"),
                    "startDate": winner.get("startDate"),
                    "venue": winner.get("venue"),
                    "organizer": winner.get("organizer"),
                    "sourceName": winner.get("sourceName"),
                    "sourceUrl": winner.get("sourceUrl"),
                },
            })

        conflicts = act.get("conflicts") or []

        # checks[] reuses the existing CheckRow rendering; every entry maps
        # to a real trustReason or conflict — nothing invented.
        checks = []
        for token in act.get("trustReasons") or []:
            if token in ("cross_source_conflict", "time_conflict",
                         "price_conflict", "location_conflict"):
                continue
            checks.append({"key": token, "label": token.replace("_", " "),
                           "status": "pass" if not token.startswith(("missing", "spammy", "invalid")) else "warn",
                           "detail": "pipeline trust reason"})
        for c in conflicts:
            checks.append({"key": c["type"], "label": c["type"].replace("_", " "),
                           "status": "fail", "detail": c["detail"]})

        items.append({
            "id": act_id,
            # display fields
            "title": act.get("title") or "(无标题)",
            "category": act.get("category") or "social",
            "date": date_label(act.get("startDate")) or "日期待定",
            "startDate": act.get("startDate"),
            "time": act.get("startTime") or "待定",
            "startTime": act.get("startTime"),
            "endTime": act.get("endTime"),
            "venue": act.get("venue") or "地点待定",
            "location": ((act.get("city") or "上海") + "·" + act["district"]) if act.get("district") else (act.get("city") or "上海"),
            "district": act.get("district"),
            "price": price_label(act.get("priceType"), act.get("price")),
            "priceType": act.get("priceType"),
            "priceRaw": act.get("price"),
            "organizer": act.get("organizer"),
            "registrationUrl": act.get("registrationUrl"),
            "description": act.get("description"),
            "tags": act.get("tags") or [],
            "crawledAt": (act.get("collectedAt") or "")[:16].replace("T", " "),
            "source": act.get("sourceName") or "unknown",
            "sourceUrl": act.get("sourceUrl"),
            "score": act.get("trustScore") or 0,
            "suggestion": _SUGGESTION.get(entry.get("reason"), "review"),
            # pipeline provenance (raw passthrough)
            "reviewReason": entry.get("reason"),
            "trustReasons": act.get("trustReasons") or [],
            "conflicts": conflicts,
            "checks": checks,
            "duplicateCandidates": candidates,
            "status": act.get("status"),
        })
    return items


def export_admin_review_js(activities, queue, out_path):
    """Write ui_kits/admin/generated-review-data.js."""
    entries = queue.get("queue", [])
    items = build_review_items(activities, entries)
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "// Gorgon generated review queue — DO NOT EDIT BY HAND.\n"
        "// Produced by `python pipeline/run.py` (export stage).\n"
        "// Empty or missing -> Admin falls back to queue.js DEMO data.\n"
    )
    body = json.dumps(items, ensure_ascii=False, indent=2)
    summary = json.dumps(queue.get("summary", {}), ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "window.GORGON_REVIEW_QUEUE = " + body + ";\n"
                 + "window.GORGON_REVIEW_SUMMARY = " + summary + ";\n")
    return str(path), len(items)
