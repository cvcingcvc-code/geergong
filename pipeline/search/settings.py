# Retrieval-layer runtime configuration (PHASE 5).
#
# EVERYTHING here comes from the environment. No key, no endpoint and no
# token is ever written into the repository, and no module reads os.environ
# directly — they read a SearchSettings instance, so tests can inject a
# fully deterministic configuration.
#
#   GORGON_SEARCH_MODE      demo | real | hybrid          (default: demo for the
#                           library; pipeline/api/server.py runs real)
#   SEARCH_PROVIDER         auto | brave | bing | serper | tavily | searxng
#                           | bing_html | eventxing | fixture   (default: auto)
#   SEARCH_API_KEY          API key for the chosen backend (never committed)
#   SEARCH_API_ENDPOINT     override the backend endpoint (self-hosted SearXNG)
#   GORGON_WEB_SEARCH       auto | off | bing_html  (default: auto)
#                           auto       use the Search API when a key is set
#                           off        no generic web search at all
#                           bing_html  keyless fallback (public SERP page),
#                                      for environments with no subscription
#   GORGON_EVENT_SOURCES    comma list of event platforms, "off" to disable
#   GORGON_FETCH_PAGES      on | off   fetch candidate pages (default: on)
#   GORGON_ENRICH_LIMIT     max candidate pages fetched per search (default 14)
#   GORGON_PAGE_TIMEOUT     per-request timeout, seconds (default 12)
#   GORGON_PAGE_MAX_BYTES   response size cap, bytes (default 1_500_000)
#   GORGON_PAGE_USER_AGENT  User-Agent for page fetches
#   GORGON_CACHE_DIR        metadata cache directory (default pipeline/data/cache)
#   GORGON_ONLINE           off -> hard-disable every outbound request (tests)
#
# Precedence: explicit SearchSettings(...) arguments > environment > defaults.
# A missing API key is NOT an error: it downgrades the provider to
# `unavailable` and the caller must say so out loud instead of substituting
# demo data behind the user's back.

import os

# --- controlled vocabularies -----------------------------------------------

MODES = ("demo", "real", "hybrid")

# Generic web-search backends that need an API key.
API_BACKENDS = ("brave", "bing", "serper", "tavily", "searxng")

# Backends that work without a key (public endpoints / public listing pages).
KEYLESS_BACKENDS = ("bing_html",)

# Event-platform providers: a platform's own public listing/search page.
# These are real sources, not a search engine we built ourselves.
EVENT_SOURCES = ("segmentfault", "eventxing", "douban")

# How the generic web-search slot is filled.
WEB_SEARCH_MODES = ("auto", "off", "bing_html")

ALL_PROVIDERS = tuple(API_BACKENDS) + tuple(KEYLESS_BACKENDS) + tuple(EVENT_SOURCES)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

DEFAULT_ENDPOINTS = {
    "brave": "https://api.search.brave.com/res/v1/web/search",
    "bing": "https://api.bing.microsoft.com/v7.0/search",
    "serper": "https://google.serper.dev/search",
    "tavily": "https://api.tavily.com/search",
    "searxng": "http://127.0.0.1:8888/search",
    "bing_html": "https://www.bing.com/search",
}

_TRUE = ("1", "true", "yes", "on", "y")
_FALSE = ("0", "false", "no", "off", "n")


def _as_bool(value, default=False):
    if value is None or value == "":
        return default
    text = str(value).strip().casefold()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    return default


def _as_int(value, default):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _as_float(value, default):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def _env(env, *names):
    """First non-empty value among env aliases."""
    for name in names:
        value = env.get(name)
        if value not in (None, ""):
            return value
    return None


def detect_http_proxy(env=None):
    """Outbound proxy, if the environment declares one.

    A workstation behind a corporate/sandbox proxy must still be able to
    reach public event pages, and urllib will not pick the variables up on
    its own once we build the request ourselves — so we resolve it once,
    explicitly, and never log the credentials part.
    """
    env = env if env is not None else os.environ
    return _env(env, "GORGON_HTTP_PROXY", "https_proxy", "HTTPS_PROXY",
                "http_proxy", "HTTP_PROXY")


class SearchSettings(object):
    """Immutable-ish configuration object handed to every provider."""

    def __init__(self, mode=None, provider=None, api_key=None, endpoint=None,
                 web_search=None, event_sources=None, fetch_pages=None,
                 enrich_limit=None, page_timeout=None, page_max_bytes=None,
                 user_agent=None, cache_dir=None, online=None, proxy=None,
                 enrich_budget=None, enrich_workers=None, env=None):
        env = os.environ if env is None else env

        # Library default is `demo`: importing pipeline.search must never open
        # a socket. The product entry point (pipeline/api/server.py) starts in
        # `real` mode unless told otherwise, so the running app searches the
        # live internet while unit tests stay deterministic and offline.
        self.mode = (mode or _env(env, "GORGON_SEARCH_MODE", "SEARCH_MODE")
                     or "demo").strip().casefold()
        if self.mode not in MODES:
            self.mode = "demo"

        self.provider = (provider or _env(env, "SEARCH_PROVIDER")
                         or "auto").strip().casefold()
        if self.provider not in ALL_PROVIDERS + ("auto", "fixture"):
            self.provider = "auto"

        self.api_key = api_key if api_key is not None else _env(
            env, "SEARCH_API_KEY", "GORGON_SEARCH_API_KEY") or ""

        raw_endpoint = endpoint if endpoint is not None else _env(
            env, "SEARCH_API_ENDPOINT", "GORGON_SEARCH_API_ENDPOINT")
        self.endpoint = raw_endpoint or DEFAULT_ENDPOINTS.get(self.provider)

        wsm = web_search if web_search is not None else _env(env, "GORGON_WEB_SEARCH")
        if wsm is None:
            wsm = "auto"
        elif isinstance(wsm, bool):
            wsm = "auto" if wsm else "off"
        self.web_search = str(wsm).strip().casefold()
        if self.web_search not in WEB_SEARCH_MODES:
            self.web_search = "auto"

        raw_sources = event_sources if event_sources is not None else _env(
            env, "GORGON_EVENT_SOURCES")
        if raw_sources is None:
            self.event_sources = list(EVENT_SOURCES)
        else:
            # Accept BOTH "a,b" (env var / CLI) and ["a", "b"] / ("a",) (code).
            # Stringifying a sequence would produce "('a',)" and silently
            # disable every source, so the two shapes are handled separately.
            if isinstance(raw_sources, str):
                items = raw_sources.split(",")
            elif isinstance(raw_sources, (list, tuple, set, frozenset)):
                items = list(raw_sources)
            else:
                items = [raw_sources]
            cleaned = [str(s).strip().casefold() for s in items if str(s).strip()]
            if cleaned == ["off"] or cleaned == ["none"]:
                self.event_sources = []
            else:
                self.event_sources = [s for s in cleaned if s in EVENT_SOURCES]

        self.fetch_pages = _as_bool(
            fetch_pages if fetch_pages is not None else _env(env, "GORGON_FETCH_PAGES"),
            default=True)

        self.enrich_limit = _as_int(
            enrich_limit if enrich_limit is not None else _env(env, "GORGON_ENRICH_LIMIT"),
            default=14)

        self.enrich_budget = _as_float(
            enrich_budget if enrich_budget is not None else _env(env, "GORGON_ENRICH_BUDGET"),
            default=30.0)

        self.enrich_workers = _as_int(
            enrich_workers if enrich_workers is not None else _env(env, "GORGON_ENRICH_WORKERS"),
            default=4)

        self.page_timeout = _as_float(
            page_timeout if page_timeout is not None else _env(env, "GORGON_PAGE_TIMEOUT"),
            default=12.0)

        self.page_max_bytes = _as_int(
            page_max_bytes if page_max_bytes is not None else _env(env, "GORGON_PAGE_MAX_BYTES"),
            default=1_500_000)

        self.user_agent = (
            user_agent or _env(env, "GORGON_PAGE_USER_AGENT") or DEFAULT_USER_AGENT)

        self.cache_dir = (cache_dir or _env(env, "GORGON_CACHE_DIR")
                          or default_cache_dir())

        self.online = _as_bool(
            online if online is not None else _env(env, "GORGON_ONLINE"),
            default=True)

        self.proxy = proxy if proxy is not None else detect_http_proxy(env)

    # -- derived ------------------------------------------------------------

    @property
    def is_demo(self):
        return self.mode == "demo"

    @property
    def wants_web_search(self):
        """A generic web-search provider should be attempted."""
        if self.web_search == "off" or self.provider in tuple(EVENT_SOURCES) + ("fixture",):
            return False
        if self.web_search == "bing_html":
            return True
        return bool(self.api_key)

    def describe(self):
        """Safe to log / expose: never contains the API key itself."""
        return {
            "mode": self.mode,
            "provider": self.provider,
            "apiKeyConfigured": bool(self.api_key),
            "endpoint": self.endpoint if self.api_key or self.provider in KEYLESS_BACKENDS else None,
            "webSearch": self.web_search,
            "webSearchActive": self.wants_web_search,
            "eventSources": list(self.event_sources),
            "fetchPages": bool(self.fetch_pages),
            "enrichLimit": self.enrich_limit,
            "enrichBudgetSeconds": self.enrich_budget,
            "enrichWorkers": self.enrich_workers,
            "pageTimeout": self.page_timeout,
            "pageMaxBytes": self.page_max_bytes,
            "online": bool(self.online),
            "usesProxy": bool(self.proxy),
            "cacheDir": self.cache_dir,
        }


def default_cache_dir():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "cache")


def settings_from_env(env=None, **overrides):
    return SearchSettings(env=env, **overrides)


def with_mode(settings, mode):
    """Return `settings` unchanged when it already runs in `mode`, else a copy
    with only the mode swapped — every other choice (key, limit, cache) is
    preserved, so `--mode` can never silently reset configuration."""
    if not mode or settings.mode == mode:
        return settings
    return SearchSettings(
        mode=mode,
        provider=settings.provider,
        api_key=settings.api_key,
        endpoint=settings.endpoint,
        web_search=settings.web_search,
        event_sources=settings.event_sources,
        fetch_pages=settings.fetch_pages,
        enrich_limit=settings.enrich_limit,
        enrich_budget=settings.enrich_budget,
        enrich_workers=settings.enrich_workers,
        page_timeout=settings.page_timeout,
        page_max_bytes=settings.page_max_bytes,
        user_agent=settings.user_agent,
        cache_dir=settings.cache_dir,
        online=settings.online,
        proxy=settings.proxy,
    )


def provider_list(settings):
    """Which real sources a settings object would actually use. For the UI."""
    return {
        "webSearch": settings.web_search,
        "apiBackend": settings.provider if settings.provider in API_BACKENDS else None,
        "eventSources": list(settings.event_sources),
    }
