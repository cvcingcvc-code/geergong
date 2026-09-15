# Human review apply (PHASE 6/7/8/11).
#
# Reads review queue + human decisions (exported from Admin) and produces
# the FINAL approved dataset. Deterministic; original raw/normalized/review
# data is never modified.

import json
from pathlib import Path

from pipeline.normalize.activity import normalize_price

# Human-editable whitelist (PHASE 5). Everything else is ignored & reported.
EDITABLE_FIELDS = [
    "title", "startDate", "startTime", "venue", "district",
    "category", "price", "organizer", "registrationUrl",
]

VALID_DECISIONS = ("approved", "rejected", "needs_edit")


class DecisionsError(ValueError):
    """Raised when a decisions file fails validation."""


def validate_decisions(doc, known_ids):
    """Validate a decisions document. Returns {id: decision_dict}.

    Rules (deterministic):
      - top level must be {"version", "decisions"}
      - every decision must have decision in (approved|rejected|needs_edit)
      - every activity id must exist in the review queue -> otherwise the
        whole file is rejected (DecisionsError)
      - duplicate keys inside `decisions`: JSON parsing keeps the LAST
        occurrence (deterministic, documented in the contract)
    """
    if not isinstance(doc, dict) or not isinstance(doc.get("decisions"), dict):
        raise DecisionsError("decisions file must contain a 'decisions' object")
    if "version" not in doc:
        raise DecisionsError("decisions file must declare 'version'")

    out = {}
    for act_id, dec in doc["decisions"].items():
        if act_id not in known_ids:
            raise DecisionsError("unknown activity id: %s" % act_id)
        if not isinstance(dec, dict) or dec.get("decision") not in VALID_DECISIONS:
            raise DecisionsError(
                "bad decision for %s: %r (expected one of %s)"
                % (act_id, (dec or {}).get("decision"), VALID_DECISIONS)
            )
        edits = dec.get("edits") or {}
        if not isinstance(edits, dict):
            raise DecisionsError("edits for %s must be an object" % act_id)
        bad = [k for k in edits if k not in EDITABLE_FIELDS]
        if bad:
            raise DecisionsError(
                "edits for %s touch non-editable fields: %s (editable: %s)"
                % (act_id, ", ".join(sorted(bad)), ", ".join(EDITABLE_FIELDS))
            )
        out[act_id] = {
            "decision": dec["decision"],
            "reviewedAt": dec.get("reviewedAt"),
            "edits": dict(edits),
        }
    return out


def _apply_edits(act, edits, warnings):
    """Return a copy of act with whitelisted human edits applied."""
    merged = dict(act)
    merged.pop("conflicts", None)
    merged["_extra"] = dict(act.get("_extra") or {})
    for key, value in edits.items():
        if key == "price":
            # Human enters a display string; normalize with the same
            # deterministic price rules (free / ¥29 / 0元 ...).
            pt, num = normalize_price(value)
            merged["priceType"] = pt
            merged["price"] = num
        else:
            merged[key] = value
    return merged


def apply_decisions(activities, decisions):
    """Merge pipeline results with human decisions.

    activities: post-trust records (auto-approved, needs_review, duplicates)
    decisions: validated {id: {decision, reviewedAt, edits}}

    Returns (final_approved, counts, warnings).
    """
    by_id = {a.get("id"): a for a in activities if a.get("id")}
    counts = {
        "auto_approved": 0,
        "human_approved": 0,
        "human_rejected": 0,
        "human_pending": 0,
        "human_edited": 0,
    }
    warnings = []
    final = []

    for act in activities:
        act_id = act.get("id")
        dec = decisions.get(act_id)

        if act.get("status") == "approved" and not act.get("duplicateOf"):
            out = dict(act)
            out.pop("conflicts", None)
            out["reviewedBy"] = "auto"
            out["reviewDecision"] = "auto_approved"
            out["reviewedAt"] = None
            out["humanEdited"] = False
            counts["auto_approved"] += 1
            final.append(out)
            continue

        if not dec or dec["decision"] == "needs_edit":
            counts["human_pending"] += 1
            continue
        if dec["decision"] == "rejected":
            counts["human_rejected"] += 1
            continue

        # human approved
        out = dict(act)
        out.pop("conflicts", None)
        edits = dec.get("edits") or {}
        if edits:
            out = _apply_edits(out, edits, warnings)
            counts["human_edited"] += 1
        out["reviewedBy"] = "human"
        out["reviewDecision"] = "approved"
        out["reviewedAt"] = dec.get("reviewedAt")
        out["humanEdited"] = bool(edits)
        if edits:
            out["humanEdits"] = dict(edits)
        counts["human_approved"] += 1
        final.append(out)

    return final, counts, warnings


def load_decisions_file(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)
