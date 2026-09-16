# Real SearchProviders (PHASE 5).
#
# FixtureSearchProvider stays exactly as it was (see provider.py). This module
# adds the providers that actually talk to the internet, all of them behind
# the SAME `SearchProvider.search(query)` contract, so nothing downstream can
# tell — or needs to care — whether a hit came from a recording or the web.
#
# Two families:
#
#   WebSearchProvider     a general web search over the open web, via a
#                         regular Search API (Brave / Bing / Serper / Tavily /
#                         SearXNG). Needs SEARCH_API_KEY. If the key is
#                         missing the provider reports `not_configured`
#                         instead of quietly degrading to demo data.
#                         A keyless HTML-SERP backend is included for
#                         environments without an API subscription; it is
#                         OFF unless explicitly selected.
#
#   EventSiteProvider     a real event platform's own public listing /
#                         category page (活动行, 豆瓣同城). No key needed.
#                         This is not "building our own search engine" — the
#                         source's own page decides what is in its index.
#
# Every provider:
#   * returns RawSearchResult with title / url / snippet / sourceName /
#     publishedAt(null if absent) / retrievedAt / query / rank
#   * stamps dataOrigin="real" (fixtures stay "demo")
#   * carries the listing row's own date / venue / price / thumbnail as HINTS,
#     which the EventExtractor uses at LOWER priority than the detail page
#   * NEVER raises out of search(): a failure becomes an empty result list
#     plus a recorded reason, so one dead source cannot kill a search

import json
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from pipeline.search.models import RawSearchResult, new_raw_result
from pipeline.search.provider import SearchProvider
from pipeline.search.settings import SearchSettings

# --- failure vocabulary -----------------------------------------------------

REASON_NOT_CONFIGURED = "not_configured"
REASON_OFFLINE = "offline"
REASON_HTTP = "http_error"
REASON_TIMEOUT = "timeout"
REASON_PARSE = "parse_error"
REASON_BLOCKED = "blocked"
REASON_EMPTY = "empty"

# --- cities / topics the listing providers understand -----------------------

CITY_SLUGS = {
    "上海": "shanghai", "北京": "beijing", "广州": "guangzhou", "深圳": "shenzhen",
    "杭州": "hangzhou", "成都": "chengdu", "南京": "nanjing", "武汉": "wuhan",
    "西安": "xian", "苏州": "suzhou", "重庆": "chongqing", "长沙": "changsha",
    "天津": "tianjin", "青岛": "qingdao",
}
CITY_NAMES = list(CITY_SLUGS.keys())
DEFAULT_CITY = "上海"

# query keyword -> 豆瓣同城 category page slug
DOUBAN_CATEGORIES = (
    ("week-course", ("课程", "训练营", "工作坊", "workshop", "bootcamp")),
    ("week-exhibition", ("展览", "展", "艺术", "exhibition", "expo")),
    ("week-salon", ("讲座", "分享", "沙龙", "论坛", "talk", "峰会", "summit", "meetup")),
    ("week-party", ("派对", "聚会", "party", "市集")),
    ("week-sports", ("运动", "跑步", "骑行", "户外", "瑜伽")),
    ("week-commonweal", ("公益", "志愿")),
)

# Meetup addresses a location as "<country>--<City>"; its own city vocabulary is
# English while the planner speaks Chinese, so this bridge has to be explicit.
MEETUP_CITIES = {
    "上海": "Shanghai", "北京": "Beijing", "深圳": "Shenzhen", "广州": "Guangzhou",
    "杭州": "Hangzhou", "成都": "Chengdu", "南京": "Nanjing", "武汉": "Wuhan",
    "西安": "Xian", "苏州": "Suzhou", "重庆": "Chongqing", "长沙": "Changsha",
    "天津": "Tianjin", "青岛": "Qingdao",
}
MEETUP_EN_CITY = {v: k for k, v in MEETUP_CITIES.items()}

# The planner's query text is a sentence ("上海 AI 活动 本周末"); a search box
# wants the distinctive term. Most specific rule first — "AI Agent" must win
# over "AI", or every Agent query collapses into the broader term.
MEETUP_KEYWORDS = (
    ("vibe coding", ("vibe coding", "vibecoding", "氛围编程")),
    ("hackathon", ("hackathon", "黑客松", "黑客马拉松")),
    ("AI Agent", ("agent", "智能体", "agentic")),
    ("demo day", ("demo day", "路演", "demo 展示")),
    ("startup", ("创业", "startup", "融资")),
    ("AI", ("ai", "人工智能", "大模型", "llm", "gpt", "机器学习", "生成式")),
)

# 活动行 tag hints: the platform's own tag vocabulary benefits from the exact
# words its own listings use.
HUODONGXING_TAGS = (
    ("AI", ("ai", "人工智能", "大模型", "agent", "智能体", "llm", "vibe coding",
            "vibecoding", "机器学习", "算法")),
    ("创业", ("创业", "融资", "投资", "startup", "vc")),
    ("设计", ("设计", "design", "ux")),
    ("科技", ("科技", "技术", "开发者", "编程", "coding", "hackathon", "黑客松")),
)


def detect_city(text):
    for city in CITY_NAMES:
        if city in (text or ""):
            return city
    return None


def detect_topic_keywords(text):
    """Distinctive tokens from the query, used as source-side tag filters."""
    lowered = (text or "").casefold()
    hits = []
    for tag, words in HUODONGXING_TAGS:
        if any(w in lowered for w in words):
            hits.append(tag)
    return hits


def detect_douban_category(text):
    lowered = (text or "").casefold()
    for slug, words in DOUBAN_CATEGORIES:
        if any(w in lowered for w in words):
            return slug
    return None


def detect_search_keyword(text):
    """The distinctive term to put in a source's own search box.

    Returns None when the query carries no recognisable topic — in that case
    the caller browses rather than searches, which is the honest reading of
    "这个周末上海有什么活动".
    """
    lowered = (text or "").casefold()
    for keyword, words in MEETUP_KEYWORDS:
        if any(w in lowered for w in words):
            return keyword
    return None


# --- provider status --------------------------------------------------------

class ProviderStatus(object):
    """Machine-readable provider availability, surfaced to the UI verbatim.

    The UI contract: if `available` is False for every real provider, the
    search screen must say 真实搜索尚未配置 / unavailable and must NOT show
    fixture results dressed up as real ones.
    """

    def __init__(self, name, kind, available, reason=None, detail=None, hits=0):
        self.name = name
        self.kind = kind              # web-search | event-site | fixture
        self.available = available
        self.reason = reason
        self.detail = detail
        self.hits = hits

    def to_dict(self):
        return {"name": self.name, "kind": self.kind, "available": self.available,
                "reason": self.reason, "detail": self.detail, "hits": self.hits}


class ProviderUnavailable(Exception):
    def __init__(self, reason, detail=None):
        Exception.__init__(self, detail or reason)
        self.reason = reason
        self.detail = detail


# --- shared HTTP helper for API backends -----------------------------------

def _post_json(url, payload, headers, settings, timeout=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    return _open(request, settings, timeout)


def _get_json(url, headers, settings, timeout=None):
    request = urllib.request.Request(url, headers=headers)
    return _open(request, settings, timeout)


def _open(request, settings, timeout=None):
    handlers = []
    if settings.proxy:
        handlers.append(urllib.request.ProxyHandler({
            "http": settings.proxy, "https": settings.proxy}))
    else:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    request.add_header("User-Agent", settings.user_agent)
    request.add_header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
    try:
        response = opener.open(request, timeout=timeout or settings.page_timeout)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise ProviderUnavailable(REASON_BLOCKED, "HTTP %s" % exc.code)
        if exc.code == 429:
            raise ProviderUnavailable(REASON_HTTP, "rate limited (HTTP 429)")
        raise ProviderUnavailable(REASON_HTTP, "HTTP %s" % exc.code)
    except urllib.error.URLError as exc:
        text = str(getattr(exc, "reason", exc))
        reason = REASON_TIMEOUT if "timed out" in text.casefold() else REASON_HTTP
        raise ProviderUnavailable(reason, text[:160])
    except (TimeoutError, OSError) as exc:
        raise ProviderUnavailable(REASON_TIMEOUT, str(exc)[:160])
    with response:
        raw = response.read(settings.page_max_bytes)
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except ValueError as exc:
        raise ProviderUnavailable(REASON_PARSE, str(exc)[:160])


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _host_of(url):
    try:
        return urllib.parse.urlparse(url).netloc
    except ValueError:
        return None


def _topic_words(topic):
    """The planner's lexicon entry for a topic, lower-cased."""
    if not topic:
        return []
    try:
        from pipeline.search.planner import TOPIC_LEXICON
    except ImportError:  # pragma: no cover - defensive
        return [str(topic).casefold()]
    words = TOPIC_LEXICON.get(topic) or []
    return [str(w).casefold() for w in [topic] + list(words)]


def _row_matches(row, words):
    haystack = " ".join(str(x) for x in (
        row.get("title"), row.get("snippet"), row.get("organizer"),
        " ".join(row.get("tags") or []),
    ) if x)
    from pipeline.search.matching import mentions
    return mentions(haystack, words)


def relevance_gate(rows, words, strict=False):
    """Keep the rows that actually address the query's topic.

    A browse-style listing page answers "everything in this city", not the
    user's question, so a topic-specific query has to narrow it — exactly
    what a search layer is for.

    `strict` decides what happens when the filter removes everything, and the
    two cases are genuinely different:

    * strict=False (a search engine's results): the rows are query-derived by
      construction, so an unmatched row is a near miss rather than a
      different topic. Returning the unfiltered set preserves recall.
    * strict=True (a platform's own browse listing): the rows are "everything
      on this platform today". Keeping them when none match the topic is not
      recall — it is a browse page wearing a search result's clothes, and it
      is how 音乐剧 and 脱口秀 end up in an answer about AI meetups. An empty
      list is the honest answer, and the caller reports it as such.
    """
    if not words or not rows:
        return rows
    kept = [r for r in rows if _row_matches(r, words)]
    if kept or strict:
        return kept
    return rows


def _today():
    return time.strftime("%Y-%m-%d")


def _not_ended(raw_date, today=None):
    """False only when the source itself dates the row in the past.

    Filtering is done on the SOURCE's own date (and, where available, the
    source's own 已结束 badge) — this is a presentation rule, not an
    inference: an event the source says has ended is not a weekend plan.
    """
    if not raw_date:
        return True
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(raw_date))
    if not m:
        return True
    return m.group(0) >= (today or _today())


def _query_text(query):
    return getattr(query, "text", None) or str(query)


def _listing_image_source(url):
    """Provenance label for an image taken straight off a listing row."""
    if not url:
        return None
    from pipeline.search.extract import IMG_THUMBNAIL
    return IMG_THUMBNAIL


# --- generic web search ----------------------------------------------------

class WebSearchProvider(SearchProvider):
    """A general web search over the open web.

    Subclasses implement `_run(query_text)` -> list[dict] with the normalised
    hit shape {title, url, snippet, publishedAt, thumbnail, siteName}.
    """

    kind = "web-search"
    name = "web"
    source_trust = "medium"
    source_type = "web"

    def __init__(self, settings=None, fetcher=None):
        self.settings = settings or SearchSettings()
        self.fetcher = fetcher
        self.status = ProviderStatus(self.name, self.kind, False,
                                     REASON_NOT_CONFIGURED,
                                     "SEARCH_API_KEY 未配置")
        self.lastError = None
        self.requestCount = 0

    # -- availability -------------------------------------------------------

    def available(self):
        """-> None when usable, otherwise a ProviderUnavailable."""
        if not self.settings.online:
            return ProviderUnavailable(REASON_OFFLINE, "GORGON_ONLINE=off")
        return None

    def configure(self):
        """Called lazily on first search; sets self.status."""
        problem = self.available()
        if problem is not None:
            self.status = ProviderStatus(self.name, self.kind, False,
                                         problem.reason, problem.detail)
            return problem
        self.status = ProviderStatus(self.name, self.kind, True)
        return None

    # -- SearchProvider -----------------------------------------------------

    def search(self, query):
        problem = self.configure() if not self.status.available else None
        if problem is not None:
            self.lastError = problem
            return []
        text = _query_text(query)
        try:
            rows = self._run(text)
        except ProviderUnavailable as exc:
            self.lastError = exc
            self.status = ProviderStatus(self.name, self.kind, False,
                                         exc.reason, exc.detail)
            return []
        except Exception as exc:  # noqa: BLE001 - provider boundary
            self.lastError = ProviderUnavailable(REASON_PARSE, repr(exc)[:160])
            self.status = ProviderStatus(self.name, self.kind, False,
                                         REASON_PARSE, repr(exc)[:160])
            return []

        self.requestCount += 1
        results = []
        for i, row in enumerate(rows, 1):
            url = row.get("url")
            if not url:
                continue
            result = new_raw_result(
                provider=self.name,
                providerQuery=text,
                source=row.get("siteName") or _host_of(url) or self.name,
                sourceType=self.source_type,
                sourceTrust=self.source_trust,
                dataOrigin="real",
                title=row.get("title"),
                snippet=row.get("snippet"),
                url=url,
                publishedAt=row.get("publishedAt"),
                retrievedAt=_now(),
                rank=i,
                imageUrl=row.get("thumbnail"),
            )
            results.append(result)
        self.status = ProviderStatus(self.name, self.kind, True,
                                     hits=len(results))
        return results

    def _run(self, query_text):  # pragma: no cover - abstract
        raise NotImplementedError


class ApiWebSearchProvider(WebSearchProvider):
    """A real Search API backend, selected by SEARCH_PROVIDER.

    Supported: brave | bing | serper | tavily | searxng.
    Nothing is hardcoded: endpoint and key come from SearchSettings.
    """

    def __init__(self, settings=None, backend=None, fetcher=None):
        self.backend = (backend or (settings or SearchSettings()).provider or "brave")
        if self.backend not in ("brave", "bing", "serper", "tavily", "searxng"):
            self.backend = "brave"
        self.name = "web:%s" % self.backend
        WebSearchProvider.__init__(self, settings=settings, fetcher=fetcher)
        self.status = ProviderStatus(self.name, self.kind, False,
                                     REASON_NOT_CONFIGURED,
                                     "SEARCH_API_KEY 未配置（backend=%s）" % self.backend)

    def available(self):
        problem = WebSearchProvider.available(self)
        if problem is not None:
            return problem
        if self.backend != "searxng" and not self.settings.api_key:
            return ProviderUnavailable(
                REASON_NOT_CONFIGURED,
                "SEARCH_API_KEY 未配置（backend=%s）" % self.backend)
        if not self.settings.endpoint:
            return ProviderUnavailable(REASON_NOT_CONFIGURED,
                                       "SEARCH_API_ENDPOINT 未配置")
        return None

    def _run(self, query_text):
        handler = getattr(self, "_run_%s" % self.backend)
        return handler(query_text)

    # -- backends -----------------------------------------------------------

    def _run_brave(self, q):
        url = "%s?%s" % (self.settings.endpoint, urllib.parse.urlencode(
            {"q": q, "count": 20, "search_lang": "zh-hans"}))
        data = _get_json(url, {"X-Subscription-Token": self.settings.api_key,
                               "Accept": "application/json"}, self.settings)
        rows = []
        for item in ((data.get("web") or {}).get("results") or []):
            rows.append({
                "title": item.get("title"),
                "url": item.get("url"),
                "snippet": item.get("description"),
                "publishedAt": item.get("page_age") or item.get("age"),
                "thumbnail": ((item.get("thumbnail") or {}).get("src")),
                "siteName": item.get("profile") or _host_of(item.get("url")),
            })
        return rows

    def _run_bing(self, q):
        url = "%s?%s" % (self.settings.endpoint, urllib.parse.urlencode(
            {"q": q, "count": 20, "mkt": "zh-CN"}))
        data = _get_json(url, {"Ocp-Apim-Subscription-Key": self.settings.api_key,
                               "Accept": "application/json"}, self.settings)
        rows = []
        for item in ((data.get("webPages") or {}).get("value") or []):
            rows.append({
                "title": item.get("name"),
                "url": item.get("url"),
                "snippet": item.get("snippet"),
                "publishedAt": item.get("datePublished") or item.get("dateLastCrawled"),
                "siteName": item.get("siteName") or _host_of(item.get("url")),
            })
        return rows

    def _run_serper(self, q):
        data = _post_json(self.settings.endpoint, {"q": q, "num": 20, "gl": "cn",
                                                   "hl": "zh-cn"},
                          {"X-API-KEY": self.settings.api_key,
                           "Content-Type": "application/json"}, self.settings)
        rows = []
        for item in (data.get("organic") or []):
            rows.append({
                "title": item.get("title"),
                "url": item.get("link"),
                "snippet": item.get("snippet"),
                "publishedAt": item.get("date"),
                "siteName": item.get("source") or _host_of(item.get("link")),
            })
        return rows

    def _run_tavily(self, q):
        data = _post_json(self.settings.endpoint,
                          {"api_key": self.settings.api_key, "query": q,
                           "max_results": 20, "search_depth": "basic"},
                          {"Content-Type": "application/json"}, self.settings)
        rows = []
        for item in (data.get("results") or []):
            rows.append({
                "title": item.get("title"),
                "url": item.get("url"),
                "snippet": item.get("content"),
                "publishedAt": item.get("published_date"),
                "siteName": _host_of(item.get("url")),
            })
        return rows

    def _run_searxng(self, q):
        url = "%s?%s" % (self.settings.endpoint,
                         urllib.parse.urlencode({"q": q, "format": "json"}))
        data = _get_json(url, {"Accept": "application/json"}, self.settings)
        rows = []
        for item in (data.get("results") or []):
            rows.append({
                "title": item.get("title"),
                "url": item.get("url"),
                "snippet": item.get("content"),
                "publishedAt": item.get("publishedDate"),
                "thumbnail": item.get("thumbnail"),
                "siteName": item.get("engine") or _host_of(item.get("url")),
            })
        return rows


class BingHtmlWebSearchProvider(WebSearchProvider):
    """Keyless backend: reads Bing's public HTML result page.

    Included because a fresh workstation may have no Search API subscription,
    and "no search at all" is a worse product than "search via a public
    result page". It is NOT the default and it is never silently used to
    replace a configured API. Only the public HTML page is read — no
    captcha solving, no login, no anti-bot circumvention.
    """

    name = "web:bing_html"
    source_trust = "medium"

    def available(self):
        problem = WebSearchProvider.available(self)
        if problem is not None:
            return problem
        if self.fetcher is None:
            from pipeline.search.fetcher import PageFetcher
            self.fetcher = PageFetcher(self.settings)
        return None

    def _run(self, q):
        endpoint = self.settings.endpoint or "https://www.bing.com/search"
        url = "%s?%s" % (endpoint, urllib.parse.urlencode(
            {"q": q, "count": 20, "setlang": "zh-CN"}))
        page = self.fetcher.fetch(url)
        if not page.ok:
            raise ProviderUnavailable(page.reason or REASON_HTTP, page.detail)
        return parse_bing_html(page.html or "", self.settings)


_BING_BLOCK_RE = re.compile(r'<li class="b_algo".*?</li>', re.S)
_BING_TITLE_RE = re.compile(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_BING_SNIPPET_RE = re.compile(
    r'<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)</p>', re.S)
_TAG_STRIP_RE = re.compile(r"<[^>]+>")


def parse_bing_html(html, settings=None):
    """Bing SERP HTML -> normalised rows. Deterministic, no guessing."""
    rows = []
    for block in _BING_BLOCK_RE.findall(html or ""):
        m = _BING_TITLE_RE.search(block)
        if not m:
            continue
        url, raw_title = m.group(1), m.group(2)
        title = _text(raw_title)
        snippet_match = _BING_SNIPPET_RE.search(block)
        snippet = _text(snippet_match.group(1)) if snippet_match else None
        if not url or not title:
            continue
        rows.append({"title": title, "url": url, "snippet": snippet,
                     "siteName": _host_of(url)})
    return rows


def _text(value):
    if value is None:
        return None
    import html as _html
    return re.sub(r"\s+", " ", _html.unescape(_TAG_STRIP_RE.sub(" ", value))).strip() or None


# --- real event platforms --------------------------------------------------

class EventSiteProvider(SearchProvider):
    """Base for providers reading an event platform's own public pages.

    These providers are the keyless real path, and they are also the richest:
    the listing row already states date / city / district / price / organizer,
    so those travel onward as `listing` hints while the detail page is still
    fetched for description, real image and registration link.
    """

    kind = "event-site"
    name = "events"
    sourceName = "活动源"
    sourceType = "event-platform"
    sourceTrust = "medium"
    homepage = None

    def __init__(self, settings=None, fetcher=None):
        from pipeline.search.fetcher import PageFetcher
        self.settings = settings or SearchSettings()
        self.fetcher = fetcher or PageFetcher(self.settings)
        # Optimistic until proven otherwise: this provider needs no key, so
        # "unavailable" would be an alarming lie before the first request.
        self.status = ProviderStatus(self.name, self.kind, True, None, "待请求")
        self.lastError = None
        self.lastGate = None
        self.requestCount = 0
        self.pagesFetched = 0

    def available(self):
        if not self.settings.online:
            return ProviderUnavailable(REASON_OFFLINE, "GORGON_ONLINE=off")
        return None

    # -- SearchProvider -----------------------------------------------------

    def search(self, query):
        problem = self.available()
        if problem is not None:
            self.lastError = problem
            self.status = ProviderStatus(self.name, self.kind, False,
                                         problem.reason, problem.detail)
            return []
        text = _query_text(query)
        topic = getattr(query, "topic", None)
        try:
            rows = self._run(text)
        except ProviderUnavailable as exc:
            self.lastError = exc
            self.status = ProviderStatus(self.name, self.kind, False,
                                         exc.reason, exc.detail)
            return []
        except Exception as exc:  # noqa: BLE001 - provider boundary
            self.lastError = ProviderUnavailable(REASON_PARSE, repr(exc)[:160])
            self.status = ProviderStatus(self.name, self.kind, False,
                                         REASON_PARSE, repr(exc)[:160])
            return []

        gate_before = len(rows)
        # strict: these are platform browse listings, not query-derived hits,
        # so a topic query that matches nothing must yield nothing — see
        # relevance_gate for why the lenient fallback would be a lie here.
        rows = relevance_gate(rows, _topic_words(topic), strict=True)
        self.lastGate = {"topic": topic, "before": gate_before, "after": len(rows),
                         "dropped": gate_before - len(rows)}

        self.requestCount += 1
        results = []
        for i, row in enumerate(rows, 1):
            url = row.get("url")
            if not url:
                continue
            results.append(new_raw_result(
                provider=self.name,
                providerQuery=text,
                source=row.get("sourceName") or self.sourceName,
                sourceType=self.sourceType,
                sourceTrust=row.get("sourceTrust") or self.sourceTrust,
                dataOrigin="real",
                title=row.get("title"),
                snippet=row.get("snippet"),
                url=url,
                registrationUrl=row.get("registrationUrl"),
                publishedAt=row.get("publishedAt"),
                retrievedAt=_now(),
                rank=i,
                rawDate=row.get("rawDate"),
                rawTime=row.get("rawTime"),
                rawEndTime=row.get("rawEndTime"),
                rawVenue=row.get("rawVenue"),
                address=row.get("address"),
                city=row.get("city"),
                district=row.get("district"),
                rawPrice=row.get("rawPrice"),
                organizer=row.get("organizer"),
                imageUrl=row.get("thumbnail"),
                # The pair must never disagree: an image that came from the
                # listing row is a thumbnail, and saying so is what lets the
                # detail page upgrade it later. Rows the enricher never
                # reaches keep this honest label instead of a blank.
                imageSource=_listing_image_source(row.get("thumbnail")),
                tags=list(row.get("tags") or []),
            ))
        self.status = ProviderStatus(self.name, self.kind, True, hits=len(results))
        return results

    def _fetch(self, url):
        page = self.fetcher.fetch(url)
        self.pagesFetched += 1
        if not page.ok:
            raise ProviderUnavailable(page.reason or REASON_HTTP,
                                      "%s (%s)" % (page.detail, url))
        from pipeline.search.extract import looks_like_challenge
        if looks_like_challenge(page.html, url=page.finalUrl or url):
            # Anti-bot wall: mark the source unavailable rather than scraping
            # it. Never parsed, never bypassed.
            raise ProviderUnavailable(REASON_BLOCKED,
                                      "被来源站点的反爬验证拦截 (%s)"
                                      % (page.finalUrl or url))
        return page.html or ""

    def _run(self, query_text):  # pragma: no cover - abstract
        raise NotImplementedError


# 活动行 — https://www.huodongxing.com/events?city=上海&tag=AI
_HDX_IMG_RE = re.compile(r'<img class="item-logo"\s+src="([^"]+)"\s+alt="([^"]*)"')
_HDX_LINK_RE = re.compile(r'<a class="item-title"[^>]*href="([^"]+)"', re.S)
_HDX_DRESS_RE = re.compile(r'<div class="item-dress flex">\s*<p>\s*(.*?)\s*</p>(.*?)</div>', re.S)
_HDX_PLACE_RE = re.compile(r'<span class="item-dress-pp">\s*(.*?)\s*</span>', re.S)
_HDX_ORG_RE = re.compile(r'<p class="user-name">(.*?)</p>', re.S)
_HDX_PRICE_RE = re.compile(r'<p class="item-price[^"]*">(.*?)</p>', re.S)


class HuodongxingProvider(EventSiteProvider):
    """活动行 — a real event registration platform, public listing pages."""

    name = "events:huodongxing"
    sourceName = "活动行"
    sourceTrust = "high"
    homepage = "https://www.huodongxing.com"

    def build_url(self, query_text, page=1, with_tag=True):
        city = detect_city(query_text) or DEFAULT_CITY
        params = {"city": city}
        if page:
            params["page"] = page
        if with_tag:
            tags = detect_topic_keywords(query_text)
            if tags:
                params["tag"] = tags[0]
        return "%s/events?%s" % (self.homepage, urllib.parse.urlencode(params))

    def _run(self, query_text):
        rows = self.parse_listing(self._fetch(self.build_url(query_text)))
        if not rows and detect_topic_keywords(query_text):
            # A tag the platform does not know must not zero out recall:
            # fall back to the plain city listing for the same query.
            rows = self.parse_listing(
                self._fetch(self.build_url(query_text, with_tag=False)))
        return rows

    def parse_listing(self, html):
        """活动行 listing page -> rows. Deterministic regex parse."""
        rows = []
        starts = [m.start() for m in re.finditer(r'<img class="item-logo"', html or "")]
        for i, start in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else min(len(html), start + 6000)
            block = html[start:end]
            img = _HDX_IMG_RE.search(block)
            link = _HDX_LINK_RE.search(block)
            if not (img and link):
                continue
            url = urllib.parse.urljoin(self.homepage, link.group(1))
            url = url.split("?")[0]
            title = _text(img.group(2))
            if not title:
                m = re.search(r'<span style="vertical-align: middle;">(.*?)</span>', block, re.S)
                title = _text(m.group(1)) if m else None
            if not title:
                continue
            dress = _HDX_DRESS_RE.search(block)
            raw_date = raw_time = district = None
            if dress:
                stamp = _text(dress.group(1))
                if stamp:
                    dm = re.search(r"(\d{1,2}/\d{1,2})", stamp)
                    tm = re.search(r"(\d{1,2}:\d{2})", stamp)
                    raw_date = dm.group(1) if dm else None
                    raw_time = tm.group(1) if tm else None
                place = _HDX_PLACE_RE.search(dress.group(2) or "")
                if place:
                    district = _text(place.group(1))
            org = _HDX_ORG_RE.search(block)
            price = _HDX_PRICE_RE.search(block)
            city = detect_city(district or "") or DEFAULT_CITY
            rows.append({
                "title": title,
                "url": url,
                "snippet": None,
                "rawDate": raw_date,
                "rawTime": raw_time,
                "district": district,
                "city": city,
                "rawVenue": None,
                "organizer": _text(org.group(1)) if org else None,
                "rawPrice": _text(price.group(1)) if price else None,
                "thumbnail": _abs_image(img.group(1)),
                "sourceName": self.sourceName,
            })
        return rows


# 豆瓣同城 — https://www.douban.com/location/shanghai/events
_DB_CARD_RE = re.compile(r'<li class="list-entry".*?</li>', re.S)
_DB_IMG_RE = re.compile(r'<img[^>]+data-lazy="([^"]+)"', re.S)
_DB_LINK_RE = re.compile(r'<a href="(https://www\.douban\.com/event/\d+/?)"', re.S)
_DB_TITLE_RE = re.compile(r'<span itemprop="summary">(.*?)</span>', re.S)
_DB_START_RE = re.compile(r'itemprop="startDate"\s+datetime="([^"]+)"')
_DB_END_RE = re.compile(r'itemprop="endDate"\s+datetime="([^"]+)"')
_DB_LOC_RE = re.compile(r'<li title="([^"]{4,160})"')
_DB_FEE_RE = re.compile(r'<li class="fee">(.*?)</li>', re.S)
_DB_OWNER_RE = re.compile(r'<span class="meta-title">\s*发起：\s*</span>\s*<a[^>]*>(.*?)</a>', re.S)


class DoubanEventsProvider(EventSiteProvider):
    """豆瓣同城 — public city / category event pages (user-generated → medium)."""

    name = "events:douban"
    sourceName = "豆瓣同城"
    sourceTrust = "medium"
    homepage = "https://www.douban.com"

    def build_url(self, query_text):
        city = detect_city(query_text) or DEFAULT_CITY
        slug = CITY_SLUGS.get(city, "shanghai")
        category = detect_douban_category(query_text)
        path = "/location/%s/events" % slug
        if category:
            path = "/events/%s" % category
            return "https://%s.douban.com%s" % (slug, path)
        return "%s%s" % (self.homepage, path)

    def _run(self, query_text):
        return self.parse_listing(self._fetch(self.build_url(query_text)))

    def parse_listing(self, html):
        rows = []
        for block in _DB_CARD_RE.findall(html or ""):
            link = _DB_LINK_RE.search(block)
            if not link:
                continue
            title_match = _DB_TITLE_RE.search(block)
            title = _text(title_match.group(1)) if title_match else None
            if not title:
                continue
            img = _DB_IMG_RE.search(block)
            start = _DB_START_RE.search(block)
            end = _DB_END_RE.search(block)
            raw_date = raw_time = raw_end_time = None
            if start:
                ds, ts = _split_iso_local(start.group(1))
                raw_date, raw_time = ds, ts
            if end:
                _de, te = _split_iso_local(end.group(1))
                raw_end_time = te
            place = _DB_LOC_RE.search(block)
            location = _text(place.group(1)) if place else None
            district = None
            if location:
                parts = location.split()
                if len(parts) >= 2 and parts[1].endswith(("区", "县")):
                    district = parts[1]
            fee = _DB_FEE_RE.search(block)
            owner = _DB_OWNER_RE.search(block)
            if not _not_ended(raw_date):
                continue          # already over — not a weekend plan
            rows.append({
                "title": title,
                "url": link.group(1),
                "snippet": None,
                "rawDate": raw_date,
                "rawTime": raw_time,
                "rawEndTime": raw_end_time,
                "district": district,
                "rawVenue": None,
                "address": location,
                "organizer": _text(owner.group(1)) if owner else None,
                "rawPrice": _text(_TAG_STRIP_RE.sub(" ", fee.group(1))) if fee else None,
                "thumbnail": _abs_image(img.group(1)) if img else None,
                "sourceName": self.sourceName,
                "sourceTrust": self.sourceTrust,
            })
        return rows


def _split_iso_local(value):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", value or "")
    if not m:
        return None, None
    return ("%s-%s-%s" % (m.group(1), m.group(2), m.group(3)),
            "%s:%s" % (m.group(4), m.group(5)))


def _abs_image(url):
    if not url:
        return None
    if url.startswith("//"):
        absolute = "https:" + url
    elif url.startswith("/"):
        absolute = "https://www.douban.com" + url
    else:
        absolute = url
    from pipeline.search.extract import upgrade_image_size
    return upgrade_image_size(absolute)


# SegmentFault 技术活动 — https://segmentfault.com/events?city=上海
_SF_CARD_SPLIT = re.compile(r'(?=<a href="/e/\d+")')
_SF_LINK_RE = re.compile(r'<a href="(/e/(\d+))"')
_SF_IMG_RE = re.compile(r'<img class="card-img[^"]*"\s+src="([^"]+)"')
_SF_TITLE_RE = re.compile(r'<a class="h6[^"]*"\s+href="/e/\d+"[^>]*>(.*?)</a>', re.S)
_SF_DATE_RE = re.compile(
    r'<div class="text-secondary font-size-14 mb-1"><span>(.*?)</span>', re.S)
_SF_PLACE_BLOCK_RE = re.compile(
    r'<div class="text-secondary\s*">(.*?)</div>', re.S)
_SF_SPAN_RE = re.compile(r"<span[^>]*>(.*?)</span>", re.S)
_SF_BADGE_RE = re.compile(r'<span class="badge[^"]*">(.*?)</span>', re.S)
_SF_COMMENT_RE = re.compile(r"<!--.*?-->")


class SegmentFaultProvider(EventSiteProvider):
    """SegmentFault 技术活动 — developer/AI event listings (public page)."""

    name = "events:segmentfault"
    sourceName = "SegmentFault 技术活动"
    sourceTrust = "medium"
    homepage = "https://segmentfault.com"

    def build_url(self, query_text, page=None):
        """The site-wide list, NOT the city-filtered view.

        SegmentFault's `?city=上海` view only ever contains that city's
        FINISHED events, so using it produced zero upcoming activities. The
        nationwide list (which separates 进行中的 from 过往活动) is the honest
        source; city affinity is then handled by the ranking stage.
        """
        params = {}
        if page:
            params["page"] = page
        base = "%s/events" % self.homepage
        return "%s?%s" % (base, urllib.parse.urlencode(params)) if params else base

    def _run(self, query_text):
        return self.parse_listing(self._fetch(self.build_url(query_text)))

    def parse_listing(self, html):
        rows = []
        for block in _SF_CARD_SPLIT.split(html or "")[1:]:
            link = _SF_LINK_RE.search(block)
            if not link:
                continue
            title_match = _SF_TITLE_RE.search(block)
            title = _text(_SF_COMMENT_RE.sub("", title_match.group(1))) if title_match else None
            if not title:
                continue
            url = self.homepage + link.group(1)
            img = _SF_IMG_RE.search(block)
            date_text = None
            dm = _SF_DATE_RE.search(block)
            if dm:
                date_text = _text(_SF_COMMENT_RE.sub("", dm.group(1)))
            raw_date = raw_time = None
            if date_text:
                dm2 = re.search(r"(20\d{2})-(\d{1,2})-(\d{1,2})", date_text)
                tm2 = re.search(r"(\d{1,2}:\d{2})", date_text)
                if dm2:
                    raw_date = "%s-%02d-%02d" % (dm2.group(1), int(dm2.group(2)),
                                                 int(dm2.group(3)))
                if tm2:
                    raw_time = tm2.group(1)

            place_block = _SF_PLACE_BLOCK_RE.search(block)
            pieces = []
            if place_block:
                pieces = [_text(_SF_COMMENT_RE.sub("", s))
                          for s in _SF_SPAN_RE.findall(place_block.group(1))]
            pieces = [p for p in pieces if p]
            online = any("线上" in p for p in pieces)
            city = detect_city(" ".join(pieces))
            badge = _SF_BADGE_RE.search(block)
            badge_text = _text(_SF_COMMENT_RE.sub("", badge.group(1))) if badge else None
            if badge_text and "已结束" in badge_text:
                continue          # the source itself says this event has ended
            if not _not_ended(raw_date):
                continue
            rows.append({
                "title": title,
                "url": url,
                "snippet": None,
                "rawDate": raw_date,
                "rawTime": raw_time,
                "city": city,
                "district": None,
                "rawVenue": "线上活动" if online else None,
                "rawPrice": None,
                "organizer": None,
                "thumbnail": img.group(1) if img else None,
                "tags": [badge_text] if badge_text else [],
                "sourceName": self.sourceName,
                "sourceTrust": self.sourceTrust,
            })
        return rows


# --- Meetup -----------------------------------------------------------------
#
# https://www.meetup.com/find/?keywords=AI&location=cn--Shanghai
#
# The one source here that is genuinely keyword-scoped: Meetup's own search
# runs the term inside a city, so its rows are query-derived rather than a
# browse dump. The results ship as a normalised Apollo cache inside
# __NEXT_DATA__, which means every field is read from the platform's own
# record — no text scraping, nothing inferred from prose.

_MU_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _meetup_state(html):
    """The Apollo cache inside __NEXT_DATA__, or None when it is absent."""
    match = _MU_NEXT_DATA_RE.search(html or "")
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except (ValueError, TypeError):
        return None
    page_props = ((payload or {}).get("props") or {}).get("pageProps") or {}
    state = page_props.get("__APOLLO_STATE__")
    return state if isinstance(state, dict) else None


def _split_meetup_dt(value):
    """'2026-09-19T19:30:00+08:00' -> ('2026-09-19', '19:30')."""
    m = re.match(r"(20\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", str(value or ""))
    if not m:
        return None, None
    return ("%s-%s-%s" % (m.group(1), m.group(2), m.group(3)),
            "%s:%s" % (m.group(4), m.group(5)))


def _meetup_price(fee_settings):
    """The price Meetup states, or None.

    `feeSettings` carries {amount, currency} for a ticketed event. It is
    absent for most events — and absent is NOT the same as free: the page
    renders no 免费/Free marker either, so we hold no source fact about the
    price and report null rather than guessing one.
    """
    if not isinstance(fee_settings, dict):
        return None
    amount = fee_settings.get("amount")
    if amount in (None, ""):
        return None
    currency = fee_settings.get("currency")
    return ("%s %s" % (currency, amount)) if currency else str(amount)


class MeetupProvider(EventSiteProvider):
    """Meetup 公开搜索页 — real keyword search, no API key required."""

    name = "events:meetup"
    sourceName = "Meetup"
    sourceTrust = "medium"
    homepage = "https://www.meetup.com"

    def build_url(self, query_text):
        city = detect_city(query_text) or DEFAULT_CITY
        keyword = detect_search_keyword(query_text)
        params = {"location": "cn--%s" % MEETUP_CITIES.get(city, "Shanghai")}
        if keyword:
            params["keywords"] = keyword
        return "%s/find/?%s" % (self.homepage, urllib.parse.urlencode(params))

    def _run(self, query_text):
        state = _meetup_state(self._fetch(self.build_url(query_text)))
        if state is None:
            raise ProviderUnavailable(REASON_PARSE,
                                      "Meetup 页面未包含可解析的活动数据")
        return self.parse_state(state)

    def parse_state(self, state):
        rows = []
        for _key, node in (state or {}).items():
            if not isinstance(node, dict) or node.get("__typename") != "Event":
                continue
            title = _text(node.get("title"))
            url = node.get("eventUrl")
            if not title or not url:
                continue

            raw_date, raw_time = _split_meetup_dt(node.get("dateTime"))
            if not _not_ended(raw_date):
                continue

            venue = _deref(state, node.get("venue")) or {}
            group = _deref(state, node.get("group")) or {}
            online = str(node.get("eventType") or "").upper() == "ONLINE"

            rows.append({
                "title": title,
                # The platform's own description also acts as the snippet: it
                # is where an event whose title says "language model" states
                # the word AI, so the topic gate can actually see it. It is
                # never promoted to our description — the detail page is.
                "snippet": _text(node.get("description")),
                "url": url,
                "registrationUrl": url,   # the event page IS the RSVP page
                "rawDate": raw_date,
                "rawTime": raw_time,
                "city": MEETUP_EN_CITY.get(_text(venue.get("city")) or ""),
                "district": None,         # Meetup gives a street, not a 区
                "rawVenue": "线上活动" if online else _text(venue.get("name")),
                "address": _text(venue.get("address")),
                "rawPrice": _meetup_price(node.get("feeSettings")),
                "organizer": _text(group.get("name")),
                "thumbnail": _meetup_photo(state, node),
                "tags": [],
                "sourceName": self.sourceName,
                "sourceTrust": self.sourceTrust,
            })
        return rows


def _deref(state, node):
    """Apollo stores either an inline object or {"__ref": "Type:id"}."""
    if not isinstance(node, dict):
        return None
    ref = node.get("__ref")
    if not ref:
        return node
    target = (state or {}).get(ref)
    return target if isinstance(target, dict) else None


def _meetup_photo(state, node):
    for field in ("featuredEventPhoto", "displayPhoto"):
        info = _deref(state, node.get(field))
        if info:
            photo = info.get("highResUrl") or info.get("baseUrl")
            if photo:
                return photo
    return None


# --- registry ---------------------------------------------------------------

EVENT_SITE_CLASSES = {
    "segmentfault": SegmentFaultProvider,
    "eventxing": HuodongxingProvider,
    "douban": DoubanEventsProvider,
    "meetup": MeetupProvider,
}

API_BACKEND_SET = ("brave", "bing", "serper", "tavily", "searxng")


def build_real_providers(settings=None, fetcher=None):
    """Real providers for the configured settings.

    Returns (providers, notices). A notice is a dict the UI can render
    verbatim — it is how "真实搜索尚未配置" reaches the user instead of a
    stack trace or, worse, silently swapped-in demo data.
    """
    from pipeline.search.fetcher import PageFetcher
    settings = settings or SearchSettings()
    fetcher = fetcher or PageFetcher(settings)
    providers = []
    notices = []

    if not settings.online:
        notices.append({
            "level": "warning", "code": "offline",
            "message": "真实检索已关闭（GORGON_ONLINE=off），本次仅使用本地演示数据。",
        })
        return providers, notices

    only = settings.provider

    # 1. generic web search
    #    auto      -> the Search API, but only when a key exists
    #    bing_html -> keyless public SERP fallback, explicitly requested
    #    off       -> nothing (an honest "未配置" is better than noisy results)
    if only in API_BACKEND_SET:
        providers.append(ApiWebSearchProvider(settings, backend=only))
    elif only == "bing_html":
        providers.append(BingHtmlWebSearchProvider(settings, fetcher=fetcher))
    elif only == "auto":
        if settings.wants_web_search:
            if settings.api_key:
                backend = settings.provider if settings.provider in API_BACKEND_SET else "brave"
                providers.append(ApiWebSearchProvider(settings, backend=backend))
            elif settings.web_search == "bing_html":
                providers.append(BingHtmlWebSearchProvider(settings, fetcher=fetcher))

    # 2. event platforms
    wanted_sources = list(settings.event_sources)
    if only in EVENT_SITE_CLASSES:
        wanted_sources = [only]
    for key in wanted_sources:
        cls = EVENT_SITE_CLASSES.get(key)
        if cls:
            providers.append(cls(settings, fetcher=fetcher))

    if not providers:
        notices.append({
            "level": "warning", "code": "real_search_not_configured",
            "message": "真实检索尚未配置：请设置 SEARCH_API_KEY（通用 Web 搜索）"
                       "或启用活动平台检索源。",
        })
    elif not settings.api_key and not settings.web_search == "bing_html" \
            and only not in EVENT_SITE_CLASSES:
        notices.append({
            "level": "info", "code": "web_search_not_configured",
            "message": "通用 Web 搜索尚未配置（缺少 SEARCH_API_KEY），"
                       "本次仅使用活动平台的公开检索页，结果均为真实网页。",
        })
    return providers, notices
