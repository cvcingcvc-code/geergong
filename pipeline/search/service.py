# Search Service (PHASE 6, extended in PHASE 5; PHASE 3 adds nearby search).
#
#   search_events(request) ->
#     parse request -> plan queries -> provider search (demo | real | hybrid)
#     -> merge raw results
#     -> ENRICH: PageFetcher -> EventExtractor   (PHASE 5, real pages only)
#     -> EXISTING normalize -> clean -> dedupe -> trust -> route
#     -> ranking -> result
#
#   PHASE 3 — place-based nearby search ("五角场附近 3km"):
#     parse request -> PLACE RESOLVER (real geocoder; not_configured stays
#     honest, no guessed coordinates) -> EVENT REPOSITORY (Local Index,
#     primary pool) -> SPATIAL FILTER (real Haversine <= radius)
#     -> optional live web search (supplementary recall only; results
#     without coordinates can never claim to be nearby) -> merge -> dedupe
#     -> trust -> ranking (distance feeds location_fit) -> results.
#
#     "五角场附近" is NEVER "整个杨浦": a place is resolved to a real
#     coordinate and filtered by real distance, or the answer is an honest
#     zero with the reason attached.
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
#     list with an explicit, counted reason, never hidden silently;
#   * nearby results without a real distance are excluded with a counted
#     reason — "probably nearby" is not a thing this system claims.
#
# Human Review rule: a record sitting in the review queue is NEVER presented
# as a confirmed recommendation. It is returned in the `needs_review` /
# `duplicate_candidate` buckets, and callers must render it as 待核验.

import os
from datetime import date

from pipeline.clean.cleaner import clean_all
from pipeline.dedupe.deduplicator import dedupe_all
from pipeline.location.geocoder import PlaceResolver, get_geocoder
from pipeline.location.models import PlaceResolution
from pipeline.normalize.activity import normalize_all
from pipeline.normalize.location import district_matches, resolve_district
from pipeline.review.queue import route
from pipeline.schema import fill_defaults, validate
from pipeline.search.adapter import extract_info_of, provenance_of, to_raw_activities
from pipeline.search.enrich import Enricher
from pipeline.search.fetcher import PageFetcher
from pipeline.search.models import (SearchCandidate, SearchRequest,
                                    RawSearchResult, bucket_for,
                                    new_raw_result)
from pipeline.search.planner import parse_request, plan_search, resolve_date_range
from pipeline.search.provider import FixtureSearchProvider, default_provider
from pipeline.search.ranker import rank_candidates
from pipeline.search.settings import SearchSettings, with_mode
from pipeline.search.webproviders import build_real_providers
# NOTE: pipeline.store.repository is imported LAZILY inside the nearby path —
# a top-level import creates a cycle (crawlers.base -> search.fetcher ->
# search.__init__ -> service -> repository -> crawlers.base) whenever the
# crawler is the first module Python loads.
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

# --- nearby-search configuration (PHASE 3) -----------------------------------
#
# The radius default is the spec's own example (3km). It is applied ONLY when
# the user expressed no radius; an explicit radius is never widened, and an
# empty result is reported as exactly what it is.
NEARBY_DEFAULT_RADIUS_KM = 3.0
NEARBY_MAX_RADIUS_KM = 50.0
NEARBY_CANDIDATE_LIMIT = 200
LOCAL_INDEX_PROVIDER = "local_index"


def default_event_db():
    """SQLite path the nearby search reads. GORGON_DB overrides; the default
    is the crawler's own store (PHASE 2), so nearby search and the crawler
    can never drift onto two different databases."""
    env_path = os.environ.get("GORGON_DB")
    if env_path:
        return env_path
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    return os.path.join(repo_root, "pipeline", "data", "gorgon.db")


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
                or req.locationPreference or req.pricePreference
                or req.place or req.latitude is not None
                or req.longitude is not None or req.radiusKm is not None)


def _radius_is_the_only_constraint(req):
    """True when radiusKm is the caller's ONLY structured field — the prose
    query should still be parsed for a place (PHASE 4 HTTP smoke rule)."""
    return bool(req.radiusKm is not None and req.place is None
                and req.latitude is None and req.longitude is None
                and not (req.city or req.topics or req.dateRange
                         or req.timePreference or req.locationPreference
                         or req.pricePreference or req.district))


def _is_nearby_request(req):
    """A place or explicit coordinates make this a PHASE 3 nearby search."""
    return bool(req.place) or (
        req.latitude is not None and req.longitude is not None)


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


# --- PHASE 3: place-based nearby search --------------------------------------

def _resolve_nearby_target(req, resolver=None):
    """-> (PlaceResolution, notice_or_None).

    An injected `resolver` (tests, alternative providers) wins outright.
    Otherwise: explicit caller coordinates skip resolution entirely (the
    caller owns their provenance); a place text goes through the geocoding
    layer; a missing configuration is reported, never worked around.
    """
    if req.latitude is not None and req.longitude is not None:
        return PlaceResolution(
            place=req.place or "指定坐标", status="resolved",
            latitude=float(req.latitude), longitude=float(req.longitude),
            provider="caller", displayName=req.place), None

    if resolver is not None:
        resolution = resolver.resolve(req.place, city=req.city or "上海")
        if resolution.status == "not_found":
            return resolution, {
                "level": "warning", "code": "place_not_found",
                "message": "没有找到「%s」的真实坐标，无法进行附近搜索。"
                           % req.place,
            }
        if resolution.status == "error":
            return resolution, {
                "level": "warning", "code": "geocoder_error",
                "message": "Geocoding 服务暂不可用：%s"
                           % (resolution.detail or ""),
            }
        return resolution, None

    try:
        geocoder = get_geocoder()
    except ValueError as exc:
        return PlaceResolution(place=req.place, status="error",
                               detail=str(exc)), {
            "level": "warning", "code": "geocoder_misconfigured",
            "message": "Geocoding 配置有误：%s" % exc,
        }
    if geocoder is None:
        return PlaceResolution(
            place=req.place, status="not_configured",
            detail="未配置 Geocoding 数据源：设置 AMAP_KEY 或 BAIDU_MAP_AK "
                   "后启用真实坐标解析"), {
            "level": "warning", "code": "geocoder_not_configured",
            "message": "附近搜索需要真实地图坐标：尚未配置 Geocoding 服务"
                       "（设置 AMAP_KEY 或 BAIDU_MAP_AK）。系统不会猜测坐标，"
                       "也不会把地点降级为区级搜索。",
        }
    resolver = resolver or PlaceResolver(geocoder)
    resolution = resolver.resolve(req.place, city=req.city or "上海")
    if resolution.status == "not_found":
        return resolution, {
            "level": "warning", "code": "place_not_found",
            "message": "没有找到「%s」的真实坐标，无法进行附近搜索。"
                       % req.place,
        }
    if resolution.status == "error":
        return resolution, {
            "level": "warning", "code": "geocoder_error",
            "message": "Geocoding 服务暂不可用：%s" % (resolution.detail or ""),
        }
    return resolution, None


def _nearby_row_to_result(row, today):
    """One event-store row -> a RawSearchResult the EXISTING pipeline eats.

    dataOrigin="real": these rows came from the real crawler (PHASE 1/2) —
    the local index is a real source, not a fixture.
    """
    start = row.get("start_time")
    end = row.get("end_time")
    return new_raw_result(
        resultId="db_%s" % row.get("id"),
        provider=LOCAL_INDEX_PROVIDER,
        source=row.get("source_name") or "本地活动索引",
        sourceType="web",
        sourceTrust="medium",
        dataOrigin="real",
        title=row.get("title"),
        url=row.get("source_url"),
        rawDate=(start[:10] if start else None),
        rawTime=(start[11:16] if start and len(start) >= 16 else None),
        rawEndTime=(end[11:16] if end and len(end) >= 16 else None),
        rawVenue=row.get("venue_name"),
        address=row.get("address"),
        city=row.get("city"),
        district=row.get("district"),
        rawPrice=row.get("price"),
        organizer=row.get("organizer"),
        retrievedAt="%sT00:00:00" % today.isoformat(),
    )


def _nearby_sort_key(ranked):
    """distance asc, then finalScore, then trust, then id — deterministic.

    For a nearby search distance IS the user's question ("多近？"), so it
    leads; relevance/time/trust (already folded into finalScore) break ties.
    """
    nearby = ((ranked.candidate.activity.get("_extra") or {}).get("nearby") or {})
    distance = nearby.get("distanceKm")
    return (
        float(distance) if distance is not None else float("inf"),
        -ranked.finalScore,
        -ranked.trustScore,
        ranked.candidate.activity.get("id") or "",
    )


def _nearby_result_distance(ranked):
    return ((ranked.candidate.activity.get("_extra") or {}).get("nearby") or {}).get("distanceKm")


def nearby_search_payload(request, *, today=None, settings=None,
                          repository=None, db_path=None, resolver=None,
                          providers=None, debug=False):
    """The PHASE 3 chain: place -> coordinates -> Local Index -> spatial
    filter -> (optional web supplement) -> existing pipeline -> ranking.

    Injection points mirror search_events so tests can run fully offline:
    `repository` (in-memory EventRepository), `resolver` (stub place
    resolver), `providers` (explicit supplement set).
    """
    today = today or date.today()
    settings = settings or SearchSettings()
    req = SearchRequest.from_dict(request)

    # Radius: the caller's explicit value is never widened (spec rule). Only
    # a missing value falls back to the default, and a nonsense value is
    # clamped into the documented range with a visible notice.
    notices = []
    radius = req.radiusKm
    if radius is None:
        radius = NEARBY_DEFAULT_RADIUS_KM
    radius = float(radius)
    if radius <= 0 or radius > NEARBY_MAX_RADIUS_KM:
        notices.append({
            "level": "warning", "code": "radius_clamped",
            "message": "radiusKm 需在 (0, %g] 之间，已按 %g 公里处理。"
                       % (NEARBY_MAX_RADIUS_KM,
                          min(max(radius, 0.1), NEARBY_MAX_RADIUS_KM)),
        })
        radius = min(max(radius, 0.1), NEARBY_MAX_RADIUS_KM)

    plan = plan_search(req, today=today)
    resolution, resolve_notice = _resolve_nearby_target(req, resolver=resolver)
    if resolve_notice:
        notices.append(resolve_notice)

    if not resolution.ok:
        status = ("empty" if resolution.status == "not_found"
                  else "unavailable")
        return {
            "status": status,
            "providerMode": settings.mode,
            "request": req.to_dict(),
            "plan": plan.to_dict(),
            "notices": notices,
            "providerErrors": [],
            "providers": [],
            "summary": _empty_summary(),
            "results": [],
            "stages": [{"key": k, "label": v} for k, v in STAGES],
            "settings": settings.describe(),
            "placeResolution": resolution.to_dict(),
            "radiusKm": radius,
        }

    # --- Local Event Index: the primary candidate pool ----------------------
    date_range = resolve_date_range(req, today=today)
    repo = repository
    own_repo = False
    if repo is None:
        from pipeline.store.repository import EventRepository  # lazy: cycle
        repo = EventRepository(db_path or default_event_db())
        repo.open()
        own_repo = True
    try:
        rows = repo.search_nearby(
            latitude=resolution.latitude,
            longitude=resolution.longitude,
            radius_km=radius,
            date_start=(date_range["start"] if date_range else None),
            date_end=(date_range["end"] if date_range else None),
            limit=NEARBY_CANDIDATE_LIMIT,
        )
    finally:
        if own_repo:
            repo.close()

    query_text = plan.query_texts()[0] if plan.queries else req.query
    raw_results = []
    queries_by_result = {}
    distances = {}
    for row in rows:
        result = _nearby_row_to_result(row, today)
        if not result.providerQuery:
            result.providerQuery = query_text
        raw_results.append(result)
        distances[result.resultId] = row["distance_km"]
        if query_text not in queries_by_result.setdefault(result.resultId, []):
            queries_by_result[result.resultId].append(query_text)

    # --- optional live web supplement (NEVER the primary pool) --------------
    # A web hit carries no verified coordinate, so it cannot honestly claim
    # to be within the radius — it is fetched, merged, and then dropped at
    # the spatial-eligibility stage with a counted reason.
    provider_errors = []
    supplement = providers
    provider_mode = "real"
    if supplement is None:
        if settings.mode == "demo":
            supplement = []
            provider_mode = "demo"
        else:
            supplement, _, provider_mode = resolve_providers(settings)
            # Fixtures are demo data: they can never pass a real spatial
            # check, so they are not even fetched here.
            supplement = [p for p in supplement
                          if not isinstance(p, FixtureSearchProvider)]
    for query in plan.queries:
        for prov in supplement:
            for result in prov.search(query):
                if not result.providerQuery:
                    result.providerQuery = query.text
                if not result.provider:
                    result.provider = prov.name
                raw_results.append(result)
                if query.text not in queries_by_result.setdefault(
                        result.resultId, []):
                    queries_by_result[result.resultId].append(query.text)
    for prov in supplement:
        err = getattr(prov, "lastError", None)
        status = getattr(prov, "status", None)
        if status is not None and not status.available:
            provider_errors.append({
                "provider": getattr(prov, "name", "provider"),
                "reason": getattr(status, "reason", None),
                "detail": getattr(status, "detail", None),
            })
        elif err is not None:
            provider_errors.append({
                "provider": getattr(prov, "name", "provider"),
                "reason": getattr(err, "reason", None),
                "detail": getattr(err, "detail", None),
            })

    # --- merge -> adapter -> EXISTING pipeline ------------------------------
    merged, merge_stats = merge_raw_results(raw_results)
    collected_at = "%sT00:00:00" % today.isoformat()
    raw_activities = to_raw_activities(merged, collected_at=collected_at)
    normalized = normalize_all(raw_activities)
    for act in normalized:
        fill_defaults(act)

    # Spatial eligibility: a candidate is nearby IFF the local index assigned
    # it a real distance within the radius (already enforced by SQL-side
    # filter + Haversine). Everything else — including web hits — is
    # excluded with a counted reason, never silently.
    eligible = []
    excluded_no_distance = 0
    for act in normalized:
        result_id = ((act.get("_extra") or {}).get("search") or {}).get("resultId")
        distance = distances.get(result_id)
        if distance is None:
            excluded_no_distance += 1
            continue
        act.setdefault("_extra", {})["nearby"] = {
            "distanceKm": round(float(distance), 3),
            "targetPlace": resolution.displayName or req.place,
            "targetLatitude": resolution.latitude,
            "targetLongitude": resolution.longitude,
        }
        eligible.append(act)

    cleaned = clean_all(eligible)
    deduped, dedupe_stats = dedupe_all(cleaned)
    scored = score_all(deduped)
    routed, review_summary = route(scored)

    candidates = _build_candidates(routed, queries_by_result)
    ranked = rank_candidates(candidates, req, today=today)
    ranked = [r for r in ranked if r.candidate.bucket != "rejected"]
    thin = [r for r in ranked
            if _is_thin(r.candidate.activity) and r.candidate.bucket != "approved"]
    presentable = [r for r in ranked if r not in thin]
    presentable.sort(key=_nearby_sort_key)

    max_results = req.maxResults or 20
    shown = presentable[:max_results]

    results = []
    for r in shown:
        payload_row = r.to_dict()
        distance = _nearby_result_distance(r)
        if distance is not None:
            payload_row["distanceKm"] = distance
        results.append(payload_row)

    if shown:
        status = "ok"
    else:
        status = "empty"
        if radius < 5.0:
            suggestion = 5.0
        else:
            suggestion = radius + 5.0
        notices.append({
            "level": "info", "code": "no_results_within_radius",
            "message": "%.1f 公里内暂无活动。可以试试扩大半径（例如 %.0f "
                       "公里）——需要你确认，系统不会自动扩大搜索范围。"
                       % (radius, suggestion),
        })

    buckets = {"approved": 0, "needs_review": 0, "duplicate_candidate": 0,
               "rejected": 0}
    for act in routed:
        buckets[bucket_for(act)] += 1

    origins = ["real" if (r.get("provenance") or [{}])[0].get("dataOrigin") == "real"
               else "demo" for r in results]
    real_count = sum(1 for o in origins if o == "real")

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
        "demoResults": len(results) - real_count,
        "withImage": 0,
        "placeholderImage": 0,
        "reviewQueue": review_summary,
        "nearby": {
            "place": req.place,
            "placeStatus": resolution.status,
            "radiusKm": radius,
            "localCandidates": len(rows),
            "excludedNoDistance": excluded_no_distance,
            "primaryPool": LOCAL_INDEX_PROVIDER,
        },
    }

    payload = {
        "status": status,
        # The local index is a REAL source (crawled from real sites), so a
        # populated nearby result list is never badged DEMO DATA.
        "providerMode": "real" if rows else provider_mode,
        "request": req.to_dict(),
        "plan": plan.to_dict(),
        "notices": notices,
        "providerErrors": provider_errors,
        "providers": [_provider_status(p) for p in supplement] if supplement else [],
        "summary": summary,
        "results": results,
        "stages": [{"key": k, "label": v} for k, v in STAGES],
        "settings": settings.describe(),
        "placeResolution": resolution.to_dict(),
        "radiusKm": radius,
    }
    if debug:
        payload["debug"] = {
            "nearby": {
                "distances": {k: round(v, 4) for k, v in distances.items()},
                "localRows": len(rows),
                "excludedNoDistance": excluded_no_distance,
                "merge": merge_stats,
                "dedupe": dedupe_stats,
            },
        }
    return payload


def search_events(request, provider=None, providers=None, today=None, debug=False,
                  settings=None, fetcher=None, enricher=None, mode=None,
                  enrich=True, repository=None, db_path=None, resolver=None):
    """Run the whole retrieval chain. `request` may be a SearchRequest, a
    dict, or a plain natural-language string.

    PHASE 3 injection points: `repository` / `db_path` swap the Local Event
    Index (tests use an in-memory store); `resolver` swaps the place
    resolver (tests inject a stub geocoder)."""
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
            # A hard district constraint is the one thing the prose parser
            # must NOT be trusted to reproduce — it would silently drop it
            # and the caller's scoping would vanish without a word.
            parsed.district = req.district
            # NOTE: the nearby fields must NOT be copied back over the parse
            # result. This branch only runs when the caller supplied NOTHING
            # but a query (else _has_constraints is True), so req.place etc.
            # are all None — copying them would erase the place the parser
            # just extracted from the prose.
            req = parsed
        elif req.query and _radius_is_the_only_constraint(req):
            # PHASE 4: a client-supplied radiusKm must NOT suppress prose
            # place parsing. POST {"query": "静安寺附近…", "radiusKm": 3} is
            # ONE nearby request — "静安寺附近" in the prose names the place,
            # the caller's explicit radius caps it. Skipping the parse here
            # silently demoted nearby queries to web-first keyword search.
            parsed = parse_request(req.query)
            parsed.radiusKm = req.radiusKm   # caller's explicit value wins
            req = parsed

    # PHASE 3: a place (or explicit coordinates) routes to the LOCAL INDEX +
    # real spatial filter instead of the web-first chain.
    if _is_nearby_request(req):
        return SearchServiceResult(nearby_search_payload(
            req, today=today, settings=settings, repository=repository,
            db_path=db_path, resolver=resolver, debug=debug))

    # The district constraint, resolved once. `None` means every candidate
    # stays eligible; "全上海" resolves to it, so the city-wide choice can
    # never become a filter.
    district = resolve_district(req.district)

    # A hard district ALSO steers recall and ranking, and it overwrites the
    # soft preference when the two disagree: an explicit "静安" from the
    # picker beats a "徐汇附近" the prose happened to mention, otherwise the
    # ranking would optimise for a district the filter is about to delete.
    # Without this the planner would only ask for city-wide results anyway,
    # and the eligibility filter would have almost nothing left to keep.
    if district:
        req.locationPreference = district

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

    # 6b. DISTRICT ELIGIBILITY — before dedupe / trust / ranking / maxResults.
    #
    # THIS ORDER IS THE FIX. District scoping used to happen in the browser,
    # over a list the server had already ranked and cut to the city-wide top
    # N. A 徐汇 event that ranked 21st was therefore reported as "徐汇暂无
    # 符合条件的活动" even though retrieval had found it. Eligibility is a
    # property of a candidate, not of a position, so it is decided here —
    # while every candidate is still present — and the survivors are what
    # dedupe, trust, ranking and maxResults then work on.
    eligible = normalized
    district_stats = None
    if district:
        eligible = [a for a in normalized if district_matches(a, district)]
        district_stats = {
            "district": district,
            "candidates": len(normalized),
            "eligible": len(eligible),
            "excluded": len(normalized) - len(eligible),
        }

    cleaned = clean_all(eligible)
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
            "districtFilter": district_stats,
            "truncated": len(presentable) - len(shown),
            "origins": {"real": real_count, "demo": demo_count},
            "stages": {
                "raw": len(raw_results),
                "merged": merge_stats["out"],
                "enriched": (enrich_stats or {}).get("fetched"),
                "normalized": len(normalized),
                "districtEligible": len(eligible),
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
