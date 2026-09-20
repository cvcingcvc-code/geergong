# Gorgon Search API + UI server.
#
# PUBLIC DEPLOYMENT (read-only) — the whole point of this file's current shape
# is that it can sit behind a Cloudflare Tunnel without handing a stranger the
# machine. Two rules drive every decision below:
#
#   1. The static surface is an ALLOWLIST. `/pipeline/**` (data + review queue),
#      `/.git/**`, `docs/`, the admin review UI and the dashboard are simply
#      not reachable — not "protected", not "hidden", unreachable.
#   2. The HTTP API never echoes internals. No stack traces, no absolute local
#      paths, no provider keys, no debug payload, no CORS wildcard.
#
# Routes:
#   GET  /                      -> the app (same as /ui_kits/app/)
#   GET  /ui_kits/app/          -> the app
#   POST /api/search            {"query": "...", "district": "徐汇", "topics": ["AI"]}
#   GET  /api/search?q=...&district=徐汇
#   GET  /api/providers         which retrieval sources are live (redacted)
#   GET  /api/health
#
#   python pipeline/api/server.py --port 8000
#   python pipeline/api/server.py --port 8000 --mode demo     # fixtures only
#   python pipeline/api/server.py --port 8000 --mode hybrid    # real + fixture
#   SEARCH_PROVIDER=brave SEARCH_API_KEY=xxx python pipeline/api/server.py
#
# The response carries the retrieval METADATA the UI needs to be honest:
#   status          ok | empty | unavailable
#   providerMode    demo | real | hybrid     -> drives the DEMO DATA / REAL SEARCH badge
#   notices[]       human-readable, renderable verbatim
#   providers[]     per-provider availability + reason (never the raw detail)
#   stages[]        the loading stages (no fake percentages anywhere)

import argparse
import json
import os
import re
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.normalize.location import DISTRICTS  # noqa: E402
from pipeline.search.service import (  # noqa: E402
    STAGES, build_providers_for_mode, search_events,
)
from pipeline.search.settings import SearchSettings, with_mode  # noqa: E402

# Canonical fields safe to expose to a client.
PUBLIC_ACTIVITY_FIELDS = (
    "id", "title", "description", "startDate", "startTime", "endDate", "endTime",
    "venue", "address", "district", "city", "category", "tags",
    "priceType", "price", "organizer", "sourceName", "sourceUrl",
    "registrationUrl", "imageUrl", "imageSource", "imageType", "agenda",
    "publishedAt", "trustScore", "trustReasons",
    "status", "duplicateOf",
)

DEFAULT_MAX_RESULTS = 20

# --- public input limits ----------------------------------------------------
# Generous enough for a real sentence ("这个周末上海有什么 AI Agent 活动？最好免费，
# 徐汇附近，下午开始。") and far below anything that could be used to make the
# server do expensive work on someone else's behalf.
MAX_QUERY_CHARS = 300
MAX_TOPIC_CHARS = 40
MAX_TOPICS = 8
MAX_PREFERENCE_CHARS = 60
MAX_RESULTS_CAP = 50
SEARCH_DEADLINE_SECONDS = 40.0
RATE_LIMIT_PER_MINUTE = 30

# The label the UI ships for "no district scoping", plus the canonical Shanghai
# districts. Taken from the pipeline module rather than retyped, so the API can
# never drift from the normaliser the rest of the product uses.
ALL_DISTRICTS = "全上海"
DISTRICT_WHITELIST = (ALL_DISTRICTS,) + tuple(DISTRICTS)

# --- public static surface --------------------------------------------------
# URL prefix -> repo-relative directory. Nothing outside this map is serveable.
PUBLIC_DIRS = {
    "/ui_kits/app": ("ui_kits", "app"),
    "/components": ("components",),
    "/tokens": ("tokens",),
    "/assets": ("assets",),
}
PUBLIC_FILES = {
    "/styles.css": ("styles.css",),
    "/_ds_bundle.js": ("_ds_bundle.js",),
}
APP_INDEX = ("ui_kits", "app", "index.html")

# The two public entry points. Both must end up at the directory form, because
# index.html pulls its siblings with RELATIVE paths (`responsive.css`,
# `../../styles.css`): serving it at `/` or at `/ui_kits/app` would resolve
# those against the wrong base and 404 every asset.
APP_DIR_URL = "/ui_kits/app/"
ENTRY_REDIRECTS = ("/", "/ui_kits/app", "/index.html")

# Dev artifacts that live inside the served trees but have no runtime purpose.
# Nothing the browser needs is a .md/.py/.map, so they stay private.
PUBLIC_DENY_EXT = (".md", ".py", ".pyc", ".map", ".ts", ".sh")

# `connect-src 'self'` is the load-bearing part: the page can only talk to its
# own origin, so a compromised/3rd-party script cannot exfiltrate the results
# the user is looking at. `script-src` has to stay permissive because the app
# runs Babel in the browser (needs eval) and ships one inline bootstrap script.
# No external script origin is allowed: React/Babel/lucide are vendored under
# assets/vendor/ (see ui_kits/app/index.html). Style/font still point at Google
# Fonts, which degrades to the system font stack rather than breaking the page.
CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' data: blob: https:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'none'; "
    "frame-ancestors 'self'"
)

SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Content-Security-Policy", CSP),
)

# Visitor-facing replacements for notices the service layer writes for the
# operator. See public_notices().
#
# Every one of these originally told the reader to set an environment variable
# — correct for a CLI or a log, wrong for an anonymous visitor, who can act on
# none of it. The wording is swapped; level and code are preserved.
PUBLIC_NOTICE_COPY = {
    "search_api_not_configured": "本次未能进行联网检索，结果可能不完整。",
    "real_search_not_configured": "真实检索当前不可用，正在使用本地示例数据。",
    "web_search_not_configured": "本次仅使用活动平台的公开检索页，结果均为真实网页。",
    "offline": "真实检索已关闭，本次仅使用本地演示数据。",
}

# Last-resort net: an env-var-shaped token (UPPER_CASE_WITH_UNDERSCORES) in a
# notice message becomes "服务端配置". Deliberately narrow — it requires an
# underscore, so ordinary words ("DEMO DATA", "AI") are untouched. This exists
# so a notice added later cannot quietly leak the config surface.
_ENV_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")


def _scrub_env_tokens(message):
    if not isinstance(message, str):
        return message
    return _ENV_TOKEN_RE.sub("服务端配置", message)


def public_notices(notices):
    """Visitor-facing notice copy — see PUBLIC_NOTICE_COPY and _ENV_TOKEN_RE."""
    out = []
    for notice in notices or []:
        notice = dict(notice)
        replacement = PUBLIC_NOTICE_COPY.get(notice.get("code"))
        if replacement is not None:
            notice["message"] = replacement
        else:
            notice["message"] = _scrub_env_tokens(notice.get("message"))
        out.append(notice)
    return out

# A single bounded pool: a slow upstream cannot spawn unbounded threads, and a
# saturated pool becomes a clean 504 instead of a growing queue.
_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="gorgon-search")


def public_activity(activity, debug=False):
    if debug:
        return dict(activity)
    out = {k: activity.get(k) for k in PUBLIC_ACTIVITY_FIELDS if k in activity}
    out["trustReasons"] = list(activity.get("trustReasons") or [])
    out["agenda"] = [dict(a) for a in (activity.get("agenda") or [])]
    return out


def public_provenance(rows):
    """One source entry per contributing record: who said it, and where."""
    out = []
    for row in rows or []:
        trust = row.get("sourceTrust") or "medium"
        out.append({
            "source": row.get("source"),
            "sourceType": row.get("sourceType"),
            "sourceTrust": trust,
            "trustLabel": {"high": "高可信", "medium": "中可信", "low": "低可信"}.get(trust, "中可信"),
            "title": row.get("title"),
            "url": row.get("url"),
            "provider": row.get("provider"),
            "dataOrigin": row.get("dataOrigin"),
            "retrievedAt": row.get("retrievedAt"),
            "query": row.get("providerQuery"),
        })
    return out


def public_result(ranked, debug=False):
    """One ranked event, trimmed to the public contract."""
    activity = ranked.get("activity") or {}
    provenance = public_provenance(ranked.get("provenance"))
    sources = []
    for row in provenance:
        label = row.get("source")
        if label and label not in sources:
            sources.append(label)
    out = {
        "id": ranked.get("id"),
        "bucket": ranked.get("bucket"),
        "finalScore": ranked.get("finalScore"),
        "scores": dict(ranked.get("scores") or {}),
        "reasons": list(ranked.get("reasons") or []),
        "provenance": provenance,
        "sourceCount": len(sources) or 1,
        "sources": sources,
        "dataOrigin": (provenance[0].get("dataOrigin") if provenance else None) or "demo",
        "queries": list(ranked.get("queries") or []),
        "activity": public_activity(activity, debug=debug),
    }
    if debug:
        out["weights"] = dict(ranked.get("weights") or {})
        out["extract"] = dict(
            ((activity.get("_extra") or {}).get("extract")) or {})
    return out


def build_response(payload, debug=False, today=None, settings=None, mode=None):
    """SearchRequest payload -> API response dict."""
    payload = dict(payload or {})
    if not payload.get("query") and payload.get("q"):
        payload["query"] = payload["q"]
    if not mode and payload.get("mode"):
        mode = payload["mode"]
    payload.pop("mode", None)
    max_results = payload.get("maxResults") or payload.get("max_results") or DEFAULT_MAX_RESULTS
    payload["maxResults"] = int(max_results)
    payload.pop("q", None)

    inner_debug = bool(debug or payload.pop("debug", False))
    result = search_events(payload, today=today, debug=inner_debug,
                           settings=settings, mode=mode)

    response = {
        "status": result.get("status", "ok"),
        "providerMode": result.get("providerMode", "demo"),
        "request": result["request"],
        "plan": result["plan"],
        "notices": list(result.get("notices") or []),
        "providers": list(result.get("providers") or []),
        "providerErrors": list(result.get("providerErrors") or []),
        "stages": list(result.get("stages") or [{"key": k, "label": v} for k, v in STAGES]),
        "summary": result["summary"],
        "results": [public_result(r, debug=inner_debug) for r in result["results"]],
    }
    if inner_debug:
        response["debug"] = result.get("debug", {})
        response["settings"] = result.get("settings", {})
    return response


def providers_payload(settings, mode=None, redact=True):
    settings = with_mode(settings, mode)
    providers, notices, provider_mode = build_providers_for_mode(
        settings.mode, settings=settings)
    payload = {
        "providerMode": provider_mode,
        "mode": settings.mode,
        "providers": [
            getattr(p, "status", None).to_dict() if getattr(p, "status", None)
            else {"name": getattr(p, "name", "provider"), "kind": "fixture",
                  "available": True, "reason": None, "detail": None, "hits": None}
            for p in providers
        ],
        "notices": notices,
        "stages": [{"key": k, "label": v} for k, v in STAGES],
    }
    if redact:
        payload["providers"] = [
            {"name": p.get("name"), "kind": p.get("kind"),
             "available": p.get("available"), "reason": p.get("reason"),
             "hits": p.get("hits")}
            for p in payload["providers"]
        ]
    else:
        payload["settings"] = settings.describe()
    return payload


# --- input validation -------------------------------------------------------

def _too_long(value, limit):
    return isinstance(value, str) and len(value) > limit


def validate_search_payload(payload, allow_debug=False):
    """Untrusted payload -> (clean_payload, error).

    Exactly one of the two is non-None. The clean payload only ever contains
    keys `search_events` already understands, so this cannot change retrieval
    behaviour — it only refuses requests, it never rewrites them.

    `district` is validated against the whitelist and echoed back to the
    caller, but deliberately NOT forwarded: the district scoping happens in the
    client over the returned result set (PHASE 5.1), and re-planning a request
    server-side would change ranking.
    """
    if not isinstance(payload, dict):
        return None, {"error": "invalid_request",
                      "message": "请求体必须是 JSON 对象。"}

    raw_query = payload.get("query")
    if raw_query in (None, ""):
        raw_query = payload.get("q")
    if raw_query is None:
        raw_query = ""
    if not isinstance(raw_query, str):
        return None, {"error": "invalid_query",
                      "message": "query 必须是字符串。"}

    query = raw_query.strip()
    if not query:
        return None, {"error": "empty_query",
                      "message": "请输入想要检索的活动内容。"}
    if len(query) > MAX_QUERY_CHARS:
        return None, {"error": "query_too_long",
                      "message": "检索词过长（最多 %d 个字符，当前 %d 个）。"
                                 % (MAX_QUERY_CHARS, len(query))}

    clean = {"query": query}

    raw_max = payload.get("maxResults", payload.get("max_results"))
    if raw_max in (None, ""):
        clean["maxResults"] = DEFAULT_MAX_RESULTS
    else:
        # Integers (JSON) and digit-strings (query string) only. `int()` would
        # also silently accept 1.5 -> 1 and True -> 1, which lets a caller pass
        # a value that never round-trips.
        numeric = (isinstance(raw_max, int) and not isinstance(raw_max, bool)) or (
            isinstance(raw_max, str) and raw_max.strip().isdigit())
        if not numeric:
            return None, {"error": "invalid_max_results",
                          "message": "maxResults 必须是 1 到 %d 之间的整数。"
                                     % MAX_RESULTS_CAP}
        value = int(raw_max)
        if value < 1 or value > MAX_RESULTS_CAP:
            return None, {"error": "invalid_max_results",
                          "message": "maxResults 必须在 1 到 %d 之间。" % MAX_RESULTS_CAP}
        clean["maxResults"] = value

    raw_topics = payload.get("topics")
    if raw_topics not in (None, "", []):
        if not isinstance(raw_topics, (list, tuple)):
            return None, {"error": "invalid_topics",
                          "message": "topics 必须是字符串数组。"}
        topics = []
        for item in raw_topics:
            if not isinstance(item, str):
                return None, {"error": "invalid_topics",
                              "message": "topics 必须是字符串数组。"}
            item = item.strip()
            if not item:
                continue
            if len(item) > MAX_TOPIC_CHARS:
                return None, {"error": "invalid_topics",
                              "message": "单个 topic 不得超过 %d 个字符。" % MAX_TOPIC_CHARS}
            topics.append(item)
        if len(topics) > MAX_TOPICS:
            return None, {"error": "invalid_topics",
                          "message": "topics 最多 %d 个。" % MAX_TOPICS}
        if topics:
            clean["topics"] = topics

    district = payload.get("district")
    if district not in (None, ""):
        if not isinstance(district, str):
            return None, {"error": "invalid_district",
                          "message": "district 必须是字符串。"}
        district = district.strip()
        if district not in DISTRICT_WHITELIST:
            return None, {"error": "invalid_district",
                          "message": "不支持的地区：%s" % district,
                          "allowed": list(DISTRICT_WHITELIST)}
        clean["district"] = district

    for key in ("city", "timePreference", "locationPreference", "pricePreference"):
        value = payload.get(key)
        if value in (None, ""):
            continue
        if not isinstance(value, str):
            return None, {"error": "invalid_parameter",
                          "message": "%s 必须是字符串。" % key}
        if _too_long(value, MAX_PREFERENCE_CHARS):
            return None, {"error": "invalid_parameter",
                          "message": "%s 不得超过 %d 个字符。"
                                     % (key, MAX_PREFERENCE_CHARS)}
        clean[key] = value.strip()

    # `mode` and `debug` are accepted only when the operator explicitly opted
    # into a local debug server; a public deployment ignores both outright.
    if allow_debug:
        if payload.get("mode"):
            clean["mode"] = str(payload["mode"])
        if payload.get("debug"):
            clean["debug"] = True
    elif payload.get("mode") or payload.get("debug"):
        clean["__ignored"] = [k for k in ("mode", "debug") if payload.get(k)]

    return clean, None


def redact_response(response):
    """Strip anything that describes the machine rather than the activities."""
    out = dict(response)
    out.pop("settings", None)
    out.pop("debug", None)
    out["notices"] = public_notices(response.get("notices"))
    out["providerErrors"] = [
        {"provider": e.get("provider"), "reason": e.get("reason")}
        for e in response.get("providerErrors") or []
    ]
    out["providers"] = [
        {"name": p.get("name"), "kind": p.get("kind"),
         "available": p.get("available"), "reason": p.get("reason"),
         "hits": p.get("hits")}
        for p in response.get("providers") or []
    ]
    return out


class RateLimiter(object):
    """Fixed-window per-client counter. In-memory is the right scope here: the
    process is the deployment."""

    def __init__(self, limit=RATE_LIMIT_PER_MINUTE, window=60.0):
        self.limit = limit
        self.window = window
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key):
        now = time.time()
        with self._lock:
            window_start = now - self.window
            recent = [t for t in self._hits.get(key, ()) if t > window_start]
            if len(recent) >= self.limit:
                self._hits[key] = recent
                return False, max(1, int(self.window - (now - recent[0])) + 1)
            recent.append(now)
            self._hits[key] = recent
            # Opportunistic pruning keeps the dict from growing forever on a
            # public URL without needing a background sweeper.
            if len(self._hits) > 512:
                for k in [k for k, v in self._hits.items()
                          if not v or v[-1] < window_start]:
                    self._hits.pop(k, None)
            return True, 0


RATE_LIMITER = RateLimiter()


class GorgonRequestHandler(SimpleHTTPRequestHandler):
    """Static file server (allowlisted) + the search API (read-only)."""

    repo_root = str(REPO_ROOT)
    debug_default = False
    today_override = None
    settings = None
    rate_limiter = RATE_LIMITER

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.repo_root, **kwargs)

    # -- helpers ------------------------------------------------------------

    def version_string(self):
        # Don't advertise the interpreter/OS to a public scanner.
        return "Gorgon"

    def end_headers(self):
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)
        super().end_headers()

    def _settings(self):
        return self.settings or SearchSettings(mode="real")

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, status, error, message, **extra):
        payload = {"error": error, "message": message}
        payload.update(extra)
        self._send_json(payload, status=status)

    def _client_key(self):
        return self.client_address[0] if self.client_address else "unknown"

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 64_000:
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {"query": raw.decode("utf-8", "replace")}

    def log_message(self, fmt, *args):  # quieter, but still useful
        sys.stderr.write("[gorgon-api] %s\n" % (fmt % args))

    # -- static (allowlisted) -----------------------------------------------

    def resolve_public_path(self, url_path):
        """URL path -> absolute Path, or None when it is not public.

        Allowlist first, then traversal checks: a path is only ever served if
        it maps into one of PUBLIC_DIRS/PUBLIC_FILES *and* still lives inside
        that directory after resolution.
        """
        if not url_path or not url_path.startswith("/"):
            return None
        path = unquote(url_path)
        if path.lower().endswith(PUBLIC_DENY_EXT):
            return None
        if path == APP_DIR_URL:
            return REPO_ROOT.joinpath(*APP_INDEX)
        if path in PUBLIC_FILES:
            return REPO_ROOT.joinpath(*PUBLIC_FILES[path])
        for prefix, parts in PUBLIC_DIRS.items():
            if path != prefix and not path.startswith(prefix + "/"):
                continue
            rel = path[len(prefix):].strip("/")
            segments = [s for s in rel.split("/") if s not in ("", ".")]
            if any(s == ".." or s.startswith(".") for s in segments):
                return None
            base = REPO_ROOT.joinpath(*parts).resolve()
            target = base.joinpath(*segments).resolve()
            if target != base and base not in target.parents:
                return None
            if target.is_dir():
                # No directory listings anywhere, on principle.
                return None
            return target
        return None

    def send_head(self):
        target = self.resolve_public_path(urlparse(self.path).path)
        if target is None or not target.is_file():
            self._fail(404, "not_found", "没有这个资源。")
            return None
        try:
            handle = open(target, "rb")
        except OSError:
            self._fail(404, "not_found", "没有这个资源。")
            return None
        try:
            size = target.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(target)))
            self.send_header("Content-Length", str(size))
            # `no-cache` = revalidate, never a stale bundle behind a new build.
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return handle
        except Exception:
            handle.close()
            raise

    # -- routes -------------------------------------------------------------

    def do_OPTIONS(self):
        # No CORS headers on purpose: the UI is same-origin, so nothing
        # legitimate needs cross-origin access to this API.
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, OPTIONS")
        self.end_headers()

    def _run_search(self, payload):
        """Validate, rate-limit, search with a deadline, redact."""
        clean, error = validate_search_payload(payload,
                                              allow_debug=self.debug_default)
        if error:
            self._send_json(error, status=400)
            return

        allowed, retry_after = self.rate_limiter.allow(self._client_key())
        if not allowed:
            self._send_json({"error": "rate_limited",
                             "message": "请求过于频繁，请稍后再试。",
                             "retryAfter": retry_after}, status=429)
            return

        ignored = clean.pop("__ignored", None)
        # `district` is validated above but never forwarded: scoping happens in
        # the client, and re-planning server-side would change ranking.
        district = clean.pop("district", None)
        req_mode = clean.pop("mode", None)
        clean.pop("debug", None)
        # The debug payload is an operator opt-in (--debug), never a client one.
        debug_payload = bool(self.debug_default)

        future = _EXECUTOR.submit(
            build_response, clean, debug=debug_payload, today=self.today_override,
            settings=self._settings(), mode=req_mode)
        try:
            response = future.result(timeout=SEARCH_DEADLINE_SECONDS)
        except FutureTimeout:
            self._fail(504, "search_timeout",
                       "检索超时，请稍后重试，或换一个更具体的关键词。")
            return
        except Exception:  # noqa: BLE001 - API boundary
            # Full detail goes to the operator's stderr, never to the browser.
            traceback.print_exc(file=sys.stderr)
            self._fail(500, "search_failed", "检索服务暂时不可用，请稍后重试。")
            return

        response = redact_response(response) if not debug_payload else response
        if district:
            # Echoed so the client (and the E2E) can prove the value was
            # accepted; the scoping itself stays client-side.
            response["district"] = district
        if ignored:
            response["ignoredParameters"] = ignored
        self._send_json(response, status=200)

    def do_POST(self):
        if urlparse(self.path).path.rstrip("/") != "/api/search":
            self._fail(404, "not_found", "没有这个接口。")
            return
        try:
            payload = self._read_body()
        except ValueError:
            self._fail(413, "payload_too_large", "请求体过大。")
            return
        if isinstance(payload, str):
            payload = {"query": payload}
        self._run_search(payload)

    def _redirect(self, location, status=302):
        self.send_response(status)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/favicon.ico":
            # No favicon shipped; answer quietly instead of spamming the
            # browser console with a 404 on every page load.
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path.rstrip("/") == "/api/health":
            settings = self._settings()
            self._send_json({
                "status": "ok",
                "providerMode": settings.mode,
                "demoData": settings.mode == "demo",
                "today": (self.today_override or date.today()).isoformat(),
            })
            return
        if parsed.path.rstrip("/") == "/api/providers":
            params = parse_qs(parsed.query)
            try:
                self._send_json(providers_payload(
                    self._settings(),
                    mode=(params.get("mode") or [None])[0] if self.debug_default else None,
                    redact=not self.debug_default), status=200)
            except Exception:  # noqa: BLE001
                traceback.print_exc(file=sys.stderr)
                self._fail(500, "providers_failed", "来源状态暂时不可用。")
            return
        if parsed.path.rstrip("/") == "/api/search":
            params = parse_qs(parsed.query)
            payload = {
                "query": (params.get("q") or params.get("query") or [""])[0],
            }
            if params.get("district"):
                payload["district"] = params["district"][0]
            if params.get("maxResults"):
                payload["maxResults"] = params["maxResults"][0]
            for key in ("city", "timePreference", "locationPreference",
                        "pricePreference"):
                if params.get(key):
                    payload[key] = params[key][0]
            if params.get("topics"):
                payload["topics"] = [t for t in params["topics"][0].split(",") if t]
            if self.debug_default:
                if params.get("mode"):
                    payload["mode"] = params["mode"][0]
                if (params.get("debug") or ["0"])[0] not in ("0", "", "false"):
                    payload["debug"] = True
            self._run_search(payload)
            return
        # Public entry points -> the directory form, so the app's relative
        # asset paths resolve against /ui_kits/app/ instead of the site root.
        if parsed.path in ENTRY_REDIRECTS:
            self._redirect(APP_DIR_URL)
            return
        super().do_GET()


def make_server(port=8000, host="127.0.0.1", debug=False, today=None,
                mode="real", settings=None):
    handler = GorgonRequestHandler
    handler.debug_default = debug
    handler.today_override = today
    handler.settings = with_mode(settings or SearchSettings(mode=mode), mode)
    return ThreadingHTTPServer((host, port), handler)


def resolve_bind_defaults(env=None):
    """Pick the bind host/port from the environment.

    Hosting sandboxes inject ``PORT`` when they start a service behind their
    reverse proxy. Seeing it means something else is terminating the public
    connection for us, so we have to accept connections on every interface.
    A plain local run has no ``PORT`` and stays on loopback, so the demo is
    never exposed to the LAN (or a tunnel) just by being started.
    """
    env = os.environ if env is None else env
    raw_port = str(env.get("PORT") or "").strip()
    port = int(raw_port) if raw_port.isdigit() else 8000
    host = str(env.get("GORGON_HOST") or "").strip() or (
        "0.0.0.0" if raw_port.isdigit() else "127.0.0.1")
    return host, port


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Gorgon static server + /api/search (read-only public build)")
    _default_host, _default_port = resolve_bind_defaults()
    parser.add_argument("--port", type=int, default=_default_port)
    parser.add_argument("--host", default=_default_host)
    parser.add_argument("--debug", action="store_true",
                        help="include internal debug payload (LOCAL ONLY — never tunnel this)")
    parser.add_argument("--today", help="pin the reference date (YYYY-MM-DD) for demos/tests")
    parser.add_argument("--mode", default="real", choices=("real", "hybrid", "demo"),
                        help="retrieval mode: real (network) | hybrid (real + fixture) | demo (fixture)")
    parser.add_argument("--no-fetch", action="store_true",
                        help="skip candidate page fetching (results keep listing-only facts)")
    args = parser.parse_args(argv)

    today = date.fromisoformat(args.today) if args.today else None
    settings = SearchSettings(mode=args.mode,
                              fetch_pages=False if args.no_fetch else None)
    server = make_server(args.port, args.host, debug=args.debug, today=today,
                         mode=args.mode, settings=settings)
    banner = {"real": "REAL SEARCH", "hybrid": "HYBRID", "demo": "DEMO DATA"}[args.mode]
    print("GORGON SERVER (%s)" % banner)
    print("  app       : http://%s:%d/" % (args.host, args.port))
    print("  app (alt) : http://%s:%d/ui_kits/app/" % (args.host, args.port))
    print("  api       : POST http://%s:%d/api/search" % (args.host, args.port))
    print("  providers : http://%s:%d/api/providers" % (args.host, args.port))
    print("  health    : http://%s:%d/api/health" % (args.host, args.port))
    describe = settings.describe()
    print("  provider  : %s | apiKey=%s | sources=%s | fetchPages=%s"
          % (describe["provider"], "yes" if describe["apiKeyConfigured"] else "no",
             ",".join(describe["eventSources"]) or "-", describe["fetchPages"]))
    if today:
        print("  today     : %s (pinned)" % today.isoformat())
    print("  exposure  : app + read-only search only (no pipeline/, .git, admin, debug)")
    if args.debug:
        print("  !! --debug IS ON: responses carry internal payload.")
        print("  !! Do NOT publish this process through a tunnel. Restart without --debug.")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
