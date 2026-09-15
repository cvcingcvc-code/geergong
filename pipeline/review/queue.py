# Review queue (PHASE 8): deterministic routing by trust score + flags.
#
#   trustScore >= 80            -> approved candidate
#   50 <= trustScore < 80       -> needs_review
#   trustScore < 50             -> needs_review (low confidence)
#   duplicate candidate         -> needs_review (exact dupes stay rejected)
#   cross-source conflict       -> needs_review
#
# Output: pipeline/data/review/review_queue.json

APPROVED_THRESHOLD = 80
LOW_CONFIDENCE_THRESHOLD = 50


def route(activities):
    """Assign final status per record. Returns (activities, summary)."""
    acts = [dict(a) for a in activities]
    approved = needs_review = low_confidence = 0

    for act in acts:
        reasons = act.get("trustReasons") or []
        if act.get("duplicateOf"):
            # exact duplicates already "rejected"; near candidates review
            if act.get("status") != "rejected":
                act["status"] = "needs_review"
            continue
        if "cross_source_conflict" in reasons:
            act["status"] = "needs_review"
            needs_review += 1
            continue
        score = act.get("trustScore") or 0
        if score >= APPROVED_THRESHOLD:
            act["status"] = "approved"
            approved += 1
        elif score >= LOW_CONFIDENCE_THRESHOLD:
            act["status"] = "needs_review"
            needs_review += 1
        else:
            act["status"] = "needs_review"
            low_confidence += 1

    summary = {
        "approved": approved,
        "needs_review": needs_review,
        "low_confidence": low_confidence,
    }
    return acts, summary


def build_queue(activities, summary):
    """Entries for review_queue.json: only records needing human eyes."""
    entries = []
    for act in activities:
        if act.get("status") != "needs_review":
            continue
        dup_candidates = []
        if act.get("duplicateOf"):
            dup_candidates.append({
                "duplicateOf": act["duplicateOf"],
                "duplicateConfidence": act.get("duplicateConfidence"),
            })
        entries.append({
            "activity": act,
            "reason": _reason_for(act),
            "trustScore": act.get("trustScore"),
            "duplicateCandidates": dup_candidates,
        })
    return {"summary": summary, "queue": entries}


def _reason_for(act):
    reasons = act.get("trustReasons") or []
    if act.get("duplicateOf"):
        return "duplicate_candidate"
    if "cross_source_conflict" in reasons:
        return "cross_source_conflict"
    if (act.get("trustScore") or 0) < LOW_CONFIDENCE_THRESHOLD:
        return "low_confidence"
    return "medium_confidence"
