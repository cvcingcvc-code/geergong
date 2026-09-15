# Search Service (PHASE 6, extended in PHASE 5) — the single entry point.
#
#   search_events(request) ->
#     parse request -> plan queries -> provider search (demo | real | hybrid)
#     -> merge raw results
#     -> ENRICH: PageFetcher -> EventExtractor   (PHASE 5, real pages only)
#     -> EXISTING normalize -> clean -> dedupe -> trust -> route
#     -> ranking -> result
#
# The existing pipeline modules are imported and called as-is. This module
# owns orchestration only: no cleaning rule, no trust rule, no dedupe rule.
#
# Honesty rules enforced here (not in the UI, where they could be skipped):
#   * every result carries dataOrigin = real | demo, so a demo record can
#     never be rendered inside a REAL SEARCH session by accident;
#   * when mode=real and no real provider is usable, the payload says
#     status="unavailable" — it does NOT quietly fall back to fixtures;
#   * thin records (no date AND no place) are excluded from the presented
#     list with an explicit, counted reason, never hidden silently.
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
from pipeline.search.adapter import extract_info_of, provenance_of, to_raw_activities
from pipeline.search.enrich import Enricher
from pipeline.search.fetcher import PageFetcher
from pipeline.search.models import SearchCandidate, SearchRequest, bucket_for
from pipeline.search.planner import parse_request, plan_search
from pipeline.search.provider import FixtureSearchProvider, default_provider
from pipeline.search.ranker import rank_candidates
from pipeline.search.settings import SearchSettings, with_mode
from pipeline.search.webproviders import build_real_providers
from pipeline.trust.scorer import score_all

# Which bucket a record belongs to is decided in models.bucket_for().

# Deterministic result-screen stage list. The UI shows these in order; there
# is NO fake percentage anywhere.
STAGES = (
    ("understood", "正在理解你的需求…"),
    ("planned", "正在生成检索计划…"),
    ("searching", "正在检索活动…"),
    ("extracting", "正在访问候选活动页面…"),
    ("merging", "正在整理多来源信息…"),
    ("deduping", "正在去重…"),
    ("scoring", "正在评估可信度…"),
    ("ranking", "正在生成推荐…"),
)

# A record with neither a date nor a place is not usable as a recommendation.
THIN_EXCLUSION_REASON = "缺少可确认的时间与地点"


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


def resolve_providers(settings, fetcher=None):
    """(providers, notices, providerMode) for the configured mode.

    providerMode is what the UI badge shows: "demo" | "real" | "hybrid".
    """
    notices = []
    if settings.mode == "demo":
        notices.append({
            "level": "warning", "code": "demo_data",
            "message": "DEMO DATA：本次结果来自本地录制的 fixture，未访问互联网。",
        })
        return [FixtureSearchProvider()], notices, "demo"

    real, real_notices = build_real_providers(settings, fetcher=fetcher)
    notices.extend(real_notices)
    if settings.mode == "real":
        return real, notices, "real"

    # hybrid: real first, fixtures only as an explicitly-labelled backfill
    if real:
        notices.append({
            "level": "info", "code": "hybrid_mode",
            "message": "HYBRID：优先使用真实来源，缺失部分由 DEMO 数据补足，"
                       "每条结果都标注了来源类型。",
        })
        return real + [FixtureSearchProvider()], notices, "hybrid"
    notices.append({
        "level": "warning", "code": "real_search_not_configured",
        "message": "真实检索尚未配置，本次仅返回 DEMO 数据。",
    })
    return [FixtureSearchProvider()], notices, "demo"


def _data_origin_of(activity):
    return ((activity.get("_extra") or {}).get("search") or {}).get("dataOrigin")


def _is_thin(activity):
    """No date AND no place, and the page extraction found nothing solid."""
    has_time = bool(activity.get("startDate") or activity.get("startTime"))
    has_place = bool(activity.get("venue") or activity.get("district")
                     or activity.get("address"))
    return not has_time and not has_place


def search_events(request, provider=None, providers=None, today=None, debug=False,
                  settings=None, fetcher=None, enricher=None, mode=None,
                  enrich=True):
    """Run the whole retrieval chain. `request` may be a SearchRequest, a
    dict, or a plain natural-language string."""
    today = today or date.today()
    settings = settings or (SearchSettings(mode=mode) if mode else SearchSettings())
    settings = with_mode(settings, mode)

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

    # 2. resolve providers (fixture only in demo mode; real network otherwise)
    provider_notices = []
    provider_mode = "demo"
    if providers is None:
        if provider is not None:
            providers = [provider]
            provider_mode = "demo" if isinstance(provider, FixtureSearchProvider) else "real"
        else:
            providers, provider_notices, provider_mode = resolve_providers(
                settings, fetcher=fetcher)
    else:
        # Caller-injected providers: infer the label from what they actually
        # are, so an injected REAL provider set can never be presented as
        # DEMO DATA (and vice versa). Mixed sets are honest "hybrid".
        kinds = {"demo" if isinstance(p, FixtureSearchProvider) else "real"
                 for p in providers} or {"demo"}
        provider_mode = next(iter(kinds)) if len(kinds) == 1 else "hybrid"

    # 3. fetch
    raw_results = []
    queries_by_result = {}
    provider_errors = []
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
        # record provider-level failures once per provider, not per query
    for prov in providers:
        err = getattr(prov, "lastError", None)
        status = getattr(prov, "status", None)
        tried = getattr(prov, "requestCount", 0) > 0
        if status is not None and not status.available and tried:
            provider_errors.append({
                "provider": getattr(prov, "name", "provider"),
                "reason": getattr(status, "reason", None),
                "detail": getattr(status, "detail", None),
            })
        elif err is not None and tried:
            provider_errors.append({
                "provider": getattr(prov, "name", "provider"),
                "reason": getattr(err, "reason", None),
                "detail": getattr(err, "detail", None),
            })

    # 3b. nothing came back from a real-only run -> say so, do not fake it
    if not raw_results and provider_mode == "real":
        notices = provider_notices + _provider_error_notices(provider_errors)
        if not provider_errors:
            notices.append({
                "level": "warning", "code": "no_results_from_real_sources",
                "message": "真实检索没有返回任何结果，请调整关键词，"
                           "或检查网络与 SEARCH_API_KEY 配置。",
            })
        return SearchServiceResult({
            "status": "unavailable",
            "providerMode": provider_mode,
            "request": req.to_dict(),
            "plan": plan.to_dict(),
            "notices": notices,
            "providerErrors": provider_errors,
            "providers": [_provider_status(p) for p in providers],
            "summary": _empty_summary(),
            "results": [],
            "stages": [{"key": k, "label": v} for k, v in STAGES],
            "settings": settings.describe(),
        })

    # 4. merge (same id / same URL)
    merged, merge_stats = merge_raw_results(raw_results)

    # 5. ENRICH: real page fetch + event extraction (bounded, failure-isolated)
    enrich_stats = None
    if enrich and settings.fetch_pages and merged:
        enricher = enricher or Enricher(settings=settings, fetcher=fetcher, today=today)
        merged, enrich_stats = enricher.enrich(merged)

    if provider_mode == "real" and not any(
            getattr(r, "dataOrigin", None) == "real" for r in merged):
        provider_mode = "demo"

    # 6. adapter -> EXISTING pipeline
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

    # 7. candidates + ranking
    candidates = _build_candidates(routed, queries_by_result)
    ranked = rank_candidates(candidates, req, today=today)

    ranked = [r for r in ranked if r.candidate.bucket != "rejected"]

    thin = [r for r in ranked
            if _is_thin(r.candidate.activity) and r.candidate.bucket != "approved"]
    presentable = [r for r in ranked if r not in thin]

    max_results = req.maxResults or 20
    shown = presentable[:max_results]

    buckets = {"approved": 0, "needs_review": 0, "duplicate_candidate": 0, "rejected": 0}
    for act in routed:
        buckets[bucket_for(act)] += 1

    origins = [(_data_origin_of(r.candidate.activity) or "demo") for r in presentable]
    real_count = sum(1 for o in origins if o == "real")
    demo_count = sum(1 for o in origins if o != "real")

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
        "excludedThin": len(thin),
        "excludedThinReason": THIN_EXCLUSION_REASON,
        "realResults": real_count,
        "demoResults": demo_count,
        "withImage": sum(1 for r in shown
                         if r.candidate.activity.get("imageUrl")
                         and r.candidate.activity.get("imageSource") != "placeholder"),
        "placeholderImage": sum(1 for r in shown
                                if r.candidate.activity.get("imageSource") == "placeholder"),
        "reviewQueue": review_summary,
    }

    notices = list(provider_notices)
    notices.extend(_provider_error_notices(provider_errors, raw_results))
    if thin:
        notices.append({
            "level": "info", "code": "thin_excluded",
            "message": "另有 %d 条信息缺少可确认的时间与地点，已排除在推荐之外。"
                       % len(thin),
        })

    if shown:
        status = "ok"
    elif provider_mode == "real":
        status = "empty"
    else:
        status = "empty"

    result = SearchServiceResult({
        "status": status,
        "providerMode": provider_mode,
        "request": req.to_dict(),
        "plan": plan.to_dict(),
        "notices": notices,
        "providerErrors": provider_errors,
        "providers": [_provider_status(p) for p in providers],
        "summary": summary,
        "results": [r.to_dict() for r in shown],
        "stages": [{"key": k, "label": v} for k, v in STAGES],
        "settings": settings.describe(),
    })

    if debug:
        result["debug"] = {
            "providers": [p.name for p in providers],
            "merge": merge_stats,
            "dedupe": dedupe_stats,
            "enrich": enrich_stats,
            "bucketCounts": buckets,
            "schemaProblems": schema_problems,
            "truncated": len(presentable) - len(shown),
            "origins": {"real": real_count, "demo": demo_count},
            "stages": {
                "raw": len(raw_results),
                "merged": merge_stats["out"],
                "enriched": (enrich_stats or {}).get("fetched"),
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


def _provider_status(provider):
    status = getattr(provider, "status", None)
    if status is not None and hasattr(status, "to_dict"):
        return status.to_dict()
    return {"name": getattr(provider, "name", "provider"), "kind": "fixture",
            "available": True, "reason": None, "detail": None, "hits": None}


def _provider_error_notices(provider_errors, raw_results=None):
    """Turn provider failures into the copy the contract asks for."""
    notices = []
    if not provider_errors:
        return notices
    reasons = {e.get("reason") for e in provider_errors}
    if reasons and reasons <= {"timeout", "http_error", "blocked", "unreachable", "parse_error"}:
        notices.append({
            "level": "warning", "code": "provider_degraded",
            "message": "部分搜索源暂时不可用，已返回其余可用结果。",
        })
    if "not_configured" in reasons:
        notices.append({
            "level": "warning", "code": "search_api_not_configured",
            "message": "真实检索尚未配置。请设置 SEARCH_API_KEY。",
        })
    return notices


def _empty_summary():
    keys = ("rawResults", "mergedRawResults", "mergedDuplicates", "normalized",
            "duplicates", "duplicatesExact", "duplicatesNear", "canonical",
            "approved", "needsReview", "duplicateCandidates", "rejected",
            "ranked", "returned", "excludedThin", "realResults", "demoResults",
            "withImage", "placeholderImage")
    summary = {k: 0 for k in keys}
    summary["excludedThinReason"] = THIN_EXCLUSION_REASON
    summary["reviewQueue"] = {}
    return summary


def search_events_from_text(text, **kwargs):
    """Convenience: natural language in, same result out."""
    return search_events(text, **kwargs)


def build_providers_for_mode(mode="real", settings=None, fetcher=None):
    """Public helper so the API/CLI can report provider availability up front."""
    settings = with_mode(settings or SearchSettings(), mode)
    providers, notices, provider_mode = resolve_providers(
        settings, fetcher=fetcher or PageFetcher(settings))
    return providers, notices, provider_mode
