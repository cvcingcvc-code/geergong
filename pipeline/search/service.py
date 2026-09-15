# Search Service (PHASE 6) — the single entry point.
#
#   search_events(request) ->
#     parse request -> plan queries -> provider search -> merge raw results
#     -> EXISTING normalize -> clean -> dedupe -> trust -> route
#     -> ranking -> result
#
# The existing pipeline modules are imported and called as-is. This module
# owns orchestration only: no cleaning rule, no trust rule, no dedupe rule.
#
# Human Review rule: a record sitting in the review queue is NEVER presented
# as a confirmed recommendation. It is returned in the `needs_review` /
# `duplicate_candidate` buckets, and callers must render it as 待核验.

from datetime import date

from pipeline.clean.cleaner import clean_all
from pipeline.dedupe.deduplicator import dedupe_all
from pipeline.normalize.activity import normalize_all
from pipeline.review.queue import route
from pipeline.schema import fill_defaults, validate
from pipeline.search.adapter import provenance_of, to_raw_activities
from pipeline.search.models import (
    SearchCandidate, SearchRequest, bucket_for,
)
from pipeline.search.planner import parse_request, plan_search
from pipeline.search.provider import default_provider
from pipeline.search.ranker import rank_candidates
from pipeline.trust.scorer import score_all

# Which bucket a record belongs to is decided in models.bucket_for().


class SearchServiceResult(dict):
    """Plain dict with attribute access, so callers can do result["summary"]
    or result.summary. Only documented fields are exposed unless debug=True."""

    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as exc:  # pragma: no cover - defensive
            raise AttributeError(item) from exc


def _normalize_url(url):
    if not url or not isinstance(url, str):
        return None
    return url.strip().lower().rstrip("/")


def merge_raw_results(results):
    """Merge provider output into one list.

    Two deterministic dedupe layers, both at the SEARCH layer (so the
    pipeline's dedupe never has to deal with the same page twice):
      1. identical resultId  -> same recorded hit
      2. identical URL       -> same listing page served under two ids
    First occurrence wins; drop counts are reported for transparency.
    """
    kept = []
    seen_ids = set()
    seen_urls = set()
    stats = {"in": len(results), "byResultId": 0, "byUrl": 0}

    for result in results:
        if result.resultId and result.resultId in seen_ids:
            stats["byResultId"] += 1
            continue
        url = _normalize_url(result.url)
        if url and url in seen_urls:
            stats["byUrl"] += 1
            continue
        if result.resultId:
            seen_ids.add(result.resultId)
        if url:
            seen_urls.add(url)
        kept.append(result)

    stats["out"] = len(kept)
    return kept, stats


def _provenance_rows(activity, by_id):
    """Sources describing one activity: itself + the records merged into it."""
    rows = []
    own = provenance_of(activity)
    if own:
        rows.append(own)
    act_id = activity.get("id")
    for other in by_id.values():
        if other is not activity and other.get("duplicateOf") == act_id:
            meta = provenance_of(other)
            if meta:
                rows.append(meta)
    return rows


def _build_candidates(activities, queries_by_result):
    by_id = {a.get("id"): a for a in activities if a.get("id")}
    candidates = []
    for act in activities:
        act_id = act.get("id")
        provenance = _provenance_rows(act, by_id)
        queries = []
        for row in provenance:
            for q in queries_by_result.get(row.get("resultId"), []):
                if q not in queries:
                    queries.append(q)
        candidates.append(SearchCandidate(
            activity=act,
            bucket=bucket_for(act),
            provenance=provenance,
            queries=queries,
        ))
    return candidates


def _has_constraints(req):
    """True when the caller supplied more than a bare query string."""
    return bool(req.city or req.topics or req.dateRange or req.timePreference
                or req.locationPreference or req.pricePreference)


def search_events(request, provider=None, providers=None, today=None, debug=False):
    """Run the whole retrieval chain. `request` may be a SearchRequest, a
    dict, or a plain natural-language string."""
    today = today or date.today()

    if isinstance(request, str):
        req = parse_request(request)
    else:
        req = SearchRequest.from_dict(request)
        # A bare {"query": "..."} carries no structure yet: parse it, so API
        # clients can post natural language. Explicit fields are never
        # overridden by the parser.
        if req.query and not _has_constraints(req):
            parsed = parse_request(req.query)
            parsed.maxResults = req.maxResults or parsed.maxResults
            req = parsed

    # 1. plan
    plan = plan_search(req, today=today)

    # 2. fetch (fixture / manual only — never the network in this phase)
    if providers is None:
        providers = [provider] if provider is not None else [default_provider()]

    raw_results = []
    queries_by_result = {}
    for query in plan.queries:
        for prov in providers:
            for result in prov.search(query):
                if not result.providerQuery:
                    result.providerQuery = query.text
                if not result.provider:
                    result.provider = prov.name
                raw_results.append(result)
                queries_by_result.setdefault(result.resultId, [])
                if query.text not in queries_by_result[result.resultId]:
                    queries_by_result[result.resultId].append(query.text)

    # 3. merge (same id / same URL)
    merged, merge_stats = merge_raw_results(raw_results)

    # 4. adapter -> EXISTING pipeline
    collected_at = "%sT00:00:00" % today.isoformat()
    raw_activities = to_raw_activities(merged, collected_at=collected_at)

    normalized = normalize_all(raw_activities)
    for act in normalized:
        fill_defaults(act)
    schema_problems = ["%s: %s" % (a.get("id"), p)
                       for a in normalized for p in validate(a)]

    cleaned = clean_all(normalized)
    deduped, dedupe_stats = dedupe_all(cleaned)
    scored = score_all(deduped)
    routed, review_summary = route(scored)

    # 5. candidates + ranking
    candidates = _build_candidates(routed, queries_by_result)
    ranked = rank_candidates(candidates, req, today=today)

    ranked = [r for r in ranked if r.candidate.bucket != "rejected"]
    max_results = req.maxResults or 20
    shown = ranked[:max_results]

    buckets = {"approved": 0, "needs_review": 0, "duplicate_candidate": 0, "rejected": 0}
    for act in routed:
        buckets[bucket_for(act)] += 1

    summary = {
        "rawResults": len(raw_results),
        "mergedRawResults": merge_stats["out"],
        "mergedDuplicates": merge_stats["byResultId"] + merge_stats["byUrl"],
        "normalized": len(normalized),
        "duplicates": dedupe_stats["duplicates_exact"] + dedupe_stats["duplicates_near"],
        "duplicatesExact": dedupe_stats["duplicates_exact"],
        "duplicatesNear": dedupe_stats["duplicates_near"],
        "canonical": dedupe_stats["canonical"],
        "approved": buckets["approved"],
        "needsReview": buckets["needs_review"],
        "duplicateCandidates": buckets["duplicate_candidate"],
        "rejected": buckets["rejected"],
        "ranked": len(ranked),
        "returned": len(shown),
        "reviewQueue": review_summary,
    }

    result = SearchServiceResult({
        "request": req.to_dict(),
        "plan": plan.to_dict(),
        "summary": summary,
        "results": [r.to_dict() for r in shown],
    })

    if debug:
        result["debug"] = {
            "providers": [p.name for p in providers],
            "merge": merge_stats,
            "dedupe": dedupe_stats,
            "bucketCounts": buckets,
            "schemaProblems": schema_problems,
            "truncated": len(ranked) - len(shown),
            "stages": {
                "raw": len(raw_results),
                "merged": merge_stats["out"],
                "normalized": len(normalized),
                "cleaned": len(cleaned),
                "deduped": len(deduped),
                "scored": len(scored),
                "routed": len(routed),
                "candidates": len(candidates),
                "ranked": len(ranked),
            },
        }
    return result


def search_events_from_text(text, **kwargs):
    """Convenience: natural language in, same result out."""
    return search_events(text, **kwargs)
