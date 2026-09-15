# Query Planner (PHASE 2) — deterministic rules, no LLM.
#
# Two responsibilities, both pure functions:
#   1. parse_request(text)  natural language -> partial SearchRequest
#   2. plan_search(request) SearchRequest    -> SearchPlan
#
# Planning is RECALL planning, not fetching: this module never touches the
# network. `LLMQueryPlanner` is left as an interface only (PHASE 2 note:
# "不要为了这个模块接 LLM").

import re
from datetime import date, timedelta

from pipeline.normalize.location import DISTRICTS
from pipeline.search.models import SearchPlan, SearchQuery, SearchRequest

# --- lexicons (small on purpose; extended by editing these tables only) ------

TOPIC_LEXICON = {
    "AI": ["ai", "人工智能", "大模型", "生成式", "llm", "gpt", "机器学习", "ai 产品"],
    "Agent": ["agent", "智能体", "agentic"],
    "Vibe Coding": ["vibe coding", "vibecoding", "氛围编程"],
    "Hackathon": ["hackathon", "黑客松"],
    "Demo Day": ["demo day", "demo night", "demo 夜"],
    "Meetup": ["meetup", "分享会"],
    "Workshop": ["workshop", "工作坊", "训练营"],
    "创业": ["创业", "startup", "路演"],
}

# topic -> the search formats worth trying for it (most specific first)
FORMAT_HINTS = {
    "AI": ["Hackathon", "Demo Day"],
    "Agent": ["Meetup", "开发者沙龙"],
    "Vibe Coding": ["Workshop", "Hackathon"],
    "Hackathon": ["Demo Day"],
    "Demo Day": ["路演"],
    "Meetup": ["沙龙"],
    "Workshop": ["工作坊"],
    "创业": ["路演"],
}
DEFAULT_FORMATS = ["Meetup", "Demo Day"]

CITY_NAMES = ["上海", "北京", "杭州", "深圳", "广州", "南京"]

DATE_EXPRESSIONS = [
    ("next_weekend", ["下个周末", "下周末"]),
    ("this_weekend", ["这个周末", "本周末", "这周末", "周末"]),
    ("next_week", ["下周", "下个星期"]),
    ("this_week", ["这周", "本周", "这个星期"]),
    ("tomorrow", ["明天", "明日"]),
    ("today", ["今天", "今日"]),
]

TIME_EXPRESSIONS = [
    ("afternoon", ["下午", "午后"]),
    ("evening", ["晚上", "傍晚", "夜里"]),
    ("morning", ["上午", "早上", "早晨"]),
]

PRICE_EXPRESSIONS = [
    ("free_only", ["只要免费", "必须免费", "仅限免费"]),
    ("free_preferred", ["免费", "不要钱", "白嫖"]),
    ("paid_ok", ["付费", "收费"]),
]

# How many queries the planner may emit. Small by design.
MAX_QUERIES = 8
MIN_QUERIES = 3
MAX_TOPIC_QUERIES = 3


# --- 1. natural language -> SearchRequest -----------------------------------

def _first_index(text, words):
    """Lowest index at which any word occurs, or -1."""
    hits = [text.find(w) for w in words if w in text]
    return min(hits) if hits else -1


def parse_request(text, city_hint=None, today=None):
    """Parse a natural-language need into a *partial* SearchRequest.

    Deterministic keyword rules. Anything not found stays None/[] — the
    planner is designed to work with incomplete input.
    """
    raw = (text or "").strip()
    low = raw.casefold()

    # -- topics, ordered by where the user mentioned them -------------------
    found = []
    for topic, words in TOPIC_LEXICON.items():
        idx = _first_index(low, words)
        if idx >= 0:
            found.append((idx, topic))
    found.sort(key=lambda pair: (pair[0], pair[1]))
    topics = []
    for _, topic in found:
        if topic not in topics:
            topics.append(topic)

    # "ai" is a substring of "vibe coding"? no — but guard against
    # topic-as-substring noise by dropping a topic fully contained in another.
    topics = [t for t in topics
              if not any(t != o and t.casefold() in o.casefold() for o in topics)]

    # -- city ---------------------------------------------------------------
    city = city_hint
    if not city:
        for name in CITY_NAMES:
            if name in raw:
                city = name
                break

    # -- date ---------------------------------------------------------------
    date_range = None
    for value, words in DATE_EXPRESSIONS:
        if any(w in low for w in words):
            date_range = {"type": "relative", "value": value}
            break
    if date_range is None:
        weekday = re.search(r"周([一二三四五六日天])", raw)
        if weekday:
            date_range = {"type": "relative", "value": "weekday:%s" % weekday.group(1)}

    # -- time preference ----------------------------------------------------
    time_pref = None
    for value, words in TIME_EXPRESSIONS:
        if any(w in low for w in words):
            time_pref = value
            break

    # -- price preference ---------------------------------------------------
    price_pref = None
    for value, words in PRICE_EXPRESSIONS:
        if any(w in low for w in words):
            price_pref = value
            break

    # -- location preference (district) ------------------------------------
    location_pref = None
    for district in DISTRICTS:
        if district in raw:
            location_pref = district
            break

    return SearchRequest(
        query=raw,
        city=city,
        topics=topics,
        dateRange=date_range,
        timePreference=time_pref,
        locationPreference=location_pref,
        pricePreference=price_pref,
    )


# --- 2. date range resolution ----------------------------------------------

_WEEKDAY_NUM = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

RELATIVE_LABELS = {
    "this_weekend": "本周末",
    "next_weekend": "下周末",
    "this_week": "本周",
    "next_week": "下周",
    "today": "今天",
    "tomorrow": "明天",
}


def resolve_date_range(request, today=None):
    """-> {"type","value","start","end","label"} or None.

    Pure date arithmetic; `today` is injectable so demos and tests are
    reproducible.
    """
    today = today or date.today()
    req = SearchRequest.from_dict(request)
    dr = req.dateRange
    if not dr:
        return None

    kind = dr.get("type") or "relative"
    if kind == "absolute" and dr.get("start"):
        start = dr["start"]
        end = dr.get("end") or start
        return {"type": "absolute", "value": None, "start": start, "end": end,
                "label": _date_label(start)}

    value = str(dr.get("value") or "this_weekend")

    if value.startswith("weekday:"):
        token = value.split(":", 1)[1]
        target = _WEEKDAY_NUM.get(token)
        if target is None:
            return None
        ahead = (target - today.weekday()) % 7
        start = today + timedelta(days=ahead)
        return _rng(start, start, "周%s" % token)

    if value == "this_weekend":
        # Saturday is weekday 5. On Saturday the weekend starts today.
        ahead = (5 - today.weekday()) % 7
        start = today + timedelta(days=ahead)
        return _rng(start, start + timedelta(days=1), RELATIVE_LABELS[value])

    if value == "next_weekend":
        ahead = (5 - today.weekday()) % 7
        start = today + timedelta(days=ahead if ahead else 7)
        return _rng(start, start + timedelta(days=1), RELATIVE_LABELS[value])

    if value == "this_week":
        start = today
        end = today + timedelta(days=(6 - today.weekday()))
        return _rng(start, end, RELATIVE_LABELS[value])

    if value == "next_week":
        start = today + timedelta(days=(7 - today.weekday()))
        return _rng(start, start + timedelta(days=6), RELATIVE_LABELS[value])

    if value == "today":
        return _rng(today, today, RELATIVE_LABELS[value])

    if value == "tomorrow":
        tmr = today + timedelta(days=1)
        return _rng(tmr, tmr, RELATIVE_LABELS[value])

    return None


def _rng(start, end, label):
    return {
        "type": "relative",
        "value": None,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "label": label,
    }


def _date_label(iso_str):
    try:
        d = date.fromisoformat(str(iso_str)[:10])
    except ValueError:
        return None
    return "%d月%d日" % (d.month, d.day)


# --- 3. SearchRequest -> SearchPlan ----------------------------------------

def plan_search(request, today=None):
    """Build a small, deterministic list of queries for the request.

    Priorities (in order): city, topic, date. Same-topic queries come first,
    then format exploration for the primary topic, then one location-refined
    query when the user named a district. 3-8 queries, deduped.
    """
    req = SearchRequest.from_dict(request)
    city = req.city or "上海"
    topics = [t for t in (req.topics or [])]
    resolved = resolve_date_range(req, today=today)

    notes = []
    if not topics:
        notes.append("request has no topic -> generic city queries only")
    if not resolved:
        notes.append("request has no date range -> queries stay date-free")

    date_label = resolved["label"] if resolved else None
    queries = []
    seen = set()

    def add(text, topic=None, kind="topic"):
        text = re.sub(r"\s+", " ", (text or "").strip())
        if not text or text in seen:
            return
        seen.add(text)
        queries.append(SearchQuery(text=text, topic=topic, kind=kind))

    primary = topics[0] if topics else None

    # (a) topic queries — city first, then topic, then date condition
    for i, topic in enumerate(topics[:MAX_TOPIC_QUERIES]):
        if i == 0:
            add("%s %s 活动 %s" % (city, topic, date_label) if date_label
                else "%s %s 活动" % (city, topic), topic)
        elif i == 1:
            fmt = (FORMAT_HINTS.get(topic) or DEFAULT_FORMATS)[0]
            add("%s %s %s %s" % (city, topic, fmt, date_label) if date_label
                else "%s %s %s" % (city, topic, fmt), topic, "format")
        else:
            add("%s %s 活动" % (city, topic), topic)

    # (b) format exploration for the primary topic (no date: broader recall)
    if primary:
        for fmt in (FORMAT_HINTS.get(primary) or DEFAULT_FORMATS)[:2]:
            add("%s %s %s" % (city, primary, fmt), primary, "format")

    # (c) one location-refined query when the user named a district
    if req.locationPreference and primary:
        add("%s %s 活动 %s" % (city, primary, req.locationPreference),
            primary, "location")

    # (d) pad only if the plan is too thin (never pad beyond MIN_QUERIES)
    if len(queries) < MIN_QUERIES:
        if date_label:
            add("%s %s活动" % (city, date_label))
        add("%s 活动" % city)
        add("%s 周末活动" % city)
        add("%s 活动推荐" % city)

    queries = queries[:MAX_QUERIES]
    if len(queries) < MIN_QUERIES:
        notes.append("plan shorter than MIN_QUERIES=%s" % MIN_QUERIES)

    return SearchPlan(queries=queries, dateRange=resolved, notes=notes)


class LLMQueryPlanner:
    """Reserved interface — NOT implemented in this phase.

    A future planner may expand a request semantically (synonyms, intent,
    multi-hop queries). Keeping the shape identical means the service can
    swap planners without touching providers, ranking or the API.

        plan = LLMQueryPlanner(...).plan_search(request)
    """

    name = "llm"

    def plan_search(self, request, today=None):
        raise NotImplementedError(
            "LLMQueryPlanner is an interface only — this phase uses the "
            "deterministic plan_search() rules."
        )
