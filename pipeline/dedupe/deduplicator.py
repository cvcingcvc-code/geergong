# Deduplication (PHASE 6) — the core stage. Two layers, fully deterministic
# (difflib only, no LLM). Records are NEVER deleted: duplicates keep their
# record and get duplicateOf (+ duplicateConfidence) pointing at the winner.
#
# Layer 1 — exact match:  title_key + startDate + venue all equal
#           -> duplicate (confidence 1.0), status "rejected" (dup)
# Layer 2 — near match:   title similarity >= 0.82 AND same date AND
#           (same district OR same venue)
#           -> duplicate candidate (confidence = similarity),
#              status "needs_review"
# Same title but DIFFERENT date is never a duplicate.

from pipeline.normalize.text import similarity, title_key

NEAR_DUPE_THRESHOLD = 0.82


def _venue_key(venue):
    if not isinstance(venue, str):
        return ""
    return title_key(venue)


def _match_reason(a, b, conf):
    if conf == 1.0:
        return "exact_match:title+date+venue"
    return "near_match:title_similarity=%.2f" % conf


def dedupe_all(activities):
    """Returns (activities, stats). Winner = earliest record in input order;
    later duplicates point at it via duplicateOf."""
    acts = [dict(a) for a in activities]
    canon = []  # indices of canonical (non-duplicate) records so far
    duplicates = 0
    candidates = 0

    for i, act in enumerate(acts):
        act.setdefault("duplicateOf", None)
        act.setdefault("duplicateConfidence", None)
        best = None  # (index, confidence, layer)
        for j in canon:
            other = acts[j]
            if not act.get("title") or not other.get("title"):
                continue
            if not act.get("startDate") or act.get("startDate") != other.get("startDate"):
                continue  # different (or missing) date -> never a dupe
            same_venue = _venue_key(act.get("venue")) and _venue_key(act.get("venue")) == _venue_key(other.get("venue"))
            same_district = act.get("district") and act.get("district") == other.get("district")
            if not (same_venue or same_district):
                continue
            conf = similarity(act.get("title"), other.get("title"))
            if conf >= 1.0 and same_venue:
                layer2 = False
                cand = (j, 1.0, "exact")
            elif conf >= NEAR_DUPE_THRESHOLD:
                cand = (j, conf, "near")
            else:
                continue
            if best is None or cand[1] > best[1]:
                best = cand
        if best:
            j, conf, layer = best
            act["duplicateOf"] = acts[j]["id"]
            act["duplicateConfidence"] = round(conf, 3)
            act["status"] = "rejected" if layer == "exact" else "needs_review"
            act.setdefault("trustReasons", []).append(_match_reason(act, acts[j], conf))
            if layer == "exact":
                duplicates += 1
            else:
                candidates += 1
        else:
            canon.append(i)

    stats = {
        "duplicates_exact": duplicates,
        "duplicates_near": candidates,
        "canonical": len(canon),
    }
    return acts, stats
