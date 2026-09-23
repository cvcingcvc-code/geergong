# Ranking engine (PHASE 5).
#
# Ranking is NOT trust. Trust answers "is this information credible?".
# Ranking answers "is this activity right for THIS user?".
#
# Every sub-score is 0-100 and every point has a human-readable reason.
# All weights live in RANKING_WEIGHTS — no magic numbers in the code.

import re
from datetime import date

from pipeline.search import matching
from pipeline.search.models import RankedEvent, SearchRequest
from pipeline.search.planner import TOPIC_LEXICON, resolve_date_range

# --- configuration -----------------------------------------------------------

RANKING_WEIGHTS = {
    "relevance": 0.35,
    "trust": 0.25,
    "time_fit": 0.15,
    "location_fit": 0.10,
    "freshness": 0.10,
    "price_fit": 0.05,
}

# Topic weights by position in the user's request: the first topic the user
# named matters most. Normalised over however many topics were actually given.
TOPIC_WEIGHTS = [0.5, 0.3, 0.2]

# time_fit = period match, damped when the date is not in the requested range.
DATE_IN_RANGE_MULTIPLIER = 1.0
DATE_OUTSIDE_RANGE_MULTIPLIER = 0.35
DATE_UNKNOWN_MULTIPLIER = 0.8

PERIOD_SCORES = {"match": 100, "unknown_time": 45, "mismatch": 25, "no_preference": 100}
NO_CONSTRAINT_SCORE = 100   # used when the user expressed no preference
NEUTRAL_LOCATION_SCORE = 90
NEUTRAL_PRICE_SCORE = 90
NEUTRAL_RELEVANCE_SCORE = 60  # no topic given: topic can neither help nor hurt

LOCATION_SCORES = {"exact": 100, "same_city": 60, "unknown": 40, "other_city": 15}

PRICE_SCORES = {
    "free_only": {"free": 100, "paid": 15, "unknown": 40},
    "free_preferred": {"free": 100, "paid": 45, "unknown": 60},
    "paid_ok": {"paid": 100, "free": 90, "unknown": 60},
    "any": {"free": 90, "paid": 90, "unknown": 60},
}

FRESHNESS_BUCKETS = [(7, 100), (30, 80), (90, 60)]
FRESHNESS_OLD_SCORE = 40
FRESHNESS_UNKNOWN_SCORE = 50

# day-period boundaries (startTime is "HH:MM")
PERIOD_RANGES = {
    "morning": (0, 12 * 60),
    "afternoon": (12 * 60, 18 * 60),
    "evening": (18 * 60, 24 * 60),
}

MAX_REASONS = 6

_TOPIC_WORD_INDEX = {}
for _topic, _words in TOPIC_LEXICON.items():
    _TOPIC_WORD_INDEX[_topic] = [w.casefold() for w in [_topic] + list(_words)]


# --- helpers -----------------------------------------------------------------

def _activity_text(activity):
    parts = [
        activity.get("title"), activity.get("description"),
        " ".join(activity.get("tags") or []),
        activity.get("category"), activity.get("venue"),
        activity.get("organizer"),
    ]
    return " ".join(str(p).casefold() for p in parts if p)


def _topic_hits(activity, topics):
    """-> list of topics the activity actually mentions.

    Matching goes through pipeline.search.matching so that "ai" cannot be
    satisfied by "Shanghai" — a false positive here does not merely misorder
    results, it prints a claim ("AI 主题高度匹配") that the activity does not
    support.
    """
    text = _activity_text(activity)
    hits = []
    for topic in topics:
        words = _TOPIC_WORD_INDEX.get(topic) or [topic]
        if matching.mentions(text, words):
            hits.append(topic)
    return hits


def _minutes(hhmm):
    if not hhmm or not isinstance(hhmm, str):
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})$", hhmm.strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def _period_of(start_time):
    mins = _minutes(start_time)
    if mins is None:
        return None
    for period, (lo, hi) in PERIOD_RANGES.items():
        if lo <= mins < hi:
            return period
    return None


def _parse_iso(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


# --- sub-scores --------------------------------------------------------------

def score_relevance(activity, topics):
    """Topic coverage, weighted by the order the user named the topics."""
    if not topics:
        return NEUTRAL_RELEVANCE_SCORE, [], []
    hits = _topic_hits(activity, topics)
    weights = []
    total = 0.0
    for i, topic in enumerate(topics):
        w = TOPIC_WEIGHTS[i] if i < len(TOPIC_WEIGHTS) else 0.0
        total += w
        if topic in hits:
            weights.append((topic, w))
    if total <= 0:
        return NEUTRAL_RELEVANCE_SCORE, [], hits
    score = 100.0 * sum(w for _, w in weights) / total
    reasons = ["%s 主题高度匹配" % hits[0]] if hits else []
    for topic in hits[1:]:
        reasons.append("%s 主题匹配" % topic)
    if not hits:
        reasons.append("与 %s 主题不符" % " / ".join(topics[:2]))
    return int(round(score)), reasons, hits


def score_time_fit(activity, request, date_range):
    """Start-time preference, damped when the date is outside the range."""
    reasons = []
    period_pref = request.timePreference
    period = _period_of(activity.get("startTime"))

    if not period_pref:
        period_score = NO_CONSTRAINT_SCORE
    elif period is None:
        period_score = PERIOD_SCORES["unknown_time"]
        reasons.append("活动开始时间待确认")
    elif period == period_pref:
        period_score = PERIOD_SCORES["match"]
        reasons.append("活动时间符合%s偏好" % _period_cn(period_pref))
    else:
        period_score = PERIOD_SCORES["mismatch"]
        reasons.append("活动在%s开始，与%s偏好不符"
                       % (_period_cn(period), _period_cn(period_pref)))

    # date-range fit
    mult = DATE_IN_RANGE_MULTIPLIER
    if date_range:
        start = activity.get("startDate")
        d = _parse_iso(start)
        if d is None:
            mult = DATE_UNKNOWN_MULTIPLIER
            reasons.append("活动日期待确认")
        elif not (date.fromisoformat(date_range["start"]) <= d
                  <= date.fromisoformat(date_range["end"])):
            mult = DATE_OUTSIDE_RANGE_MULTIPLIER
            reasons.append("不在%s范围内" % (date_range.get("label") or "指定日期"))

    return int(round(period_score * mult)), reasons


def _period_cn(period):
    return {"morning": "上午", "afternoon": "下午", "evening": "晚上"}.get(period, period)


# distance -> location_fit curve for place-based nearby searches. Every band
# exists so a 2.9km event and a 0.4km event cannot share one score.
NEARBY_DISTANCE_BANDS = (
    (0.5, 100),
    (1.0, 92),
    (2.0, 85),
    (3.0, 72),
    (5.0, 55),
    (10.0, 35),
)
NEARBY_DISTANCE_FLOOR_SCORE = 20


def _distance_fit_score(distance_km, place):
    for limit, score in NEARBY_DISTANCE_BANDS:
        if distance_km <= limit:
            return score, ["距%s约%.1f公里" % (place, distance_km)]
    return NEARBY_DISTANCE_FLOOR_SCORE, ["距%s约%.1f公里" % (place, distance_km)]


def score_location_fit(activity, request):
    pref = request.locationPreference
    # PHASE 3: a place-based nearby search scores location fit from the REAL
    # Haversine distance the repository computed — never from the district a
    # place happens to sit in. Closer is better, and the reason string says
    # the actual distance ("约", because GCJ-02 datum + address-level geocoding
    # both carry uncertainty we do not hide).
    nearby = ((activity.get("_extra") or {}).get("nearby") or {})
    distance = nearby.get("distanceKm")
    if request.place and distance is not None:
        try:
            distance = float(distance)
        except (TypeError, ValueError):
            distance = None
        if distance is not None:
            return _distance_fit_score(distance, request.place)
    if not pref:
        return NEUTRAL_LOCATION_SCORE, []
    district = activity.get("district")
    city = activity.get("city")
    # A wrong city is decidable even when the district is unknown. Checking it
    # first matters: the missing-district branch used to return early, so a
    # 北京 event with no district scored "unknown" and outranked in-city
    # events. "Not in your city" is a fact we already hold — use it.
    if city and request.city and city != request.city:
        return LOCATION_SCORES["other_city"], ["不在%s" % request.city]
    if not district:
        return LOCATION_SCORES["unknown"], ["活动区域待确认"]
    if district == pref:
        return LOCATION_SCORES["exact"], ["位于%s" % district]
    return LOCATION_SCORES["same_city"], ["在%s，不在%s附近" % (district, pref)]


def score_price_fit(activity, request):
    pref = request.pricePreference or "any"
    table = PRICE_SCORES.get(pref, PRICE_SCORES["any"])
    price_type = activity.get("priceType") or "unknown"
    score = table.get(price_type, table["unknown"])
    if price_type == "free":
        reasons = ["免费"]
    elif price_type == "paid":
        price = activity.get("price")
        label = "¥%g" % price if isinstance(price, (int, float)) else "收费"
        reasons = ["%s，与免费偏好不符" % label] if pref in ("free_only", "free_preferred") else [label]
    else:
        reasons = ["价格待确认"]
    return score, reasons


def score_freshness(activity, today):
    published = _parse_iso(activity.get("publishedAt")) or _parse_iso(activity.get("collectedAt"))
    if published is None:
        return FRESHNESS_UNKNOWN_SCORE, ["发布时间未知"]
    age = (today - published).days
    for limit, score in FRESHNESS_BUCKETS:
        if age <= limit:
            return score, ["信息较新（%d 天前发布）" % max(age, 0)]
    return FRESHNESS_OLD_SCORE, ["发布时间较早（%d 天前）" % age]


def score_trust(activity):
    score = activity.get("trustScore")
    score = int(score) if isinstance(score, (int, float)) else 0
    reasons = []
    if "cross_source_conflict" in (activity.get("trustReasons") or []):
        reasons.append("来源之间存在冲突，待核验")
    return score, reasons


def score_provenance(source_count, source_trusts):
    """Extra explainability derived from the SEARCH layer (not the trust stage)."""
    reasons = []
    if source_count > 1:
        reasons.append("%d 个来源信息一致" % source_count)
    if "low" in source_trusts and source_count == 1:
        reasons.append("单一低可信来源")
    elif "high" in source_trusts and source_count == 1:
        reasons.append("来源可信度较高")
    return reasons


# --- main entry --------------------------------------------------------------

def score_candidate(candidate, request, today=None):
    """-> RankedEvent (all sub-scores + reasons + weights)."""
    today = today or date.today()
    request = SearchRequest.from_dict(request)
    activity = candidate.activity
    date_range = resolve_date_range(request, today=today)

    relevance, rel_reasons, _ = score_relevance(activity, request.topics)
    trust, trust_reasons = score_trust(activity)
    time_fit, time_reasons = score_time_fit(activity, request, date_range)
    location_fit, loc_reasons = score_location_fit(activity, request)
    price_fit, price_reasons = score_price_fit(activity, request)
    freshness, fresh_reasons = score_freshness(activity, today)

    scores = {
        "relevance": relevance,
        "trust": trust,
        "time_fit": time_fit,
        "location_fit": location_fit,
        "freshness": freshness,
        "price_fit": price_fit,
    }
    final = sum(RANKING_WEIGHTS[key] * value for key, value in scores.items())
    final = int(round(max(0.0, min(100.0, final))))

    trusts = [p.get("sourceTrust") or "" for p in candidate.provenance]
    reasons = _merge_reasons([
        rel_reasons,
        score_provenance(candidate.source_count, trusts),
        time_reasons,
        loc_reasons,
        price_reasons,
        fresh_reasons,
        trust_reasons,
    ])

    return RankedEvent(
        candidate=candidate,
        finalScore=final,
        relevanceScore=relevance,
        trustScore=trust,
        timeFitScore=time_fit,
        locationFitScore=location_fit,
        priceFitScore=price_fit,
        freshnessScore=freshness,
        reasons=reasons,
        weights=dict(RANKING_WEIGHTS),
    )


def _merge_reasons(groups):
    out = []
    for group in groups:
        for reason in group or []:
            if reason not in out:
                out.append(reason)
    return out[:MAX_REASONS]


BUCKET_ORDER = {"approved": 0, "needs_review": 1, "duplicate_candidate": 2, "rejected": 3}


def rank_candidates(candidates, request, today=None, respect_buckets=True):
    """Rank candidates. Approved always precedes 待核验 (never mixed).

    Sorted by finalScore desc, then trust desc, then id — fully deterministic.
    """
    request = SearchRequest.from_dict(request)
    ranked = [score_candidate(c, request, today=today) for c in candidates]
    ranked.sort(key=lambda r: (
        BUCKET_ORDER.get(r.candidate.bucket, 9) if respect_buckets else 0,
        -r.finalScore,
        -r.trustScore,
        r.candidate.activity.get("id") or "",
    ))
    return ranked
