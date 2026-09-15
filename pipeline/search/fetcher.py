# PageFetcher (PHASE 5).
#
# One job: given a URL, return the page text — or a clearly-labelled failure.
# It NEVER raises out of `fetch()` and it never lets one broken website take
# down a whole search: every failure is captured as a PageFetchResult with
# `ok=False` and a machine-readable reason, and the caller keeps going.
#
# Deliberately NOT implemented here (out of scope for this phase, and
# explicitly excluded by the product contract):
#   * captcha solving          * login / session automation
#   * anti-bot circumvention   * 公众号 / 小红书 登录自动化
#   * javascript rendering     * headless browsers
# Only public HTML over plain HTTP(S) is retrieved.
#
# Guard rails that ARE implemented:
#   * per-request timeout
#   * explicit User-Agent (a bare urllib UA gets blocked everywhere)
#   * hard response-size cap (streamed, so a 500MB page cannot exhaust RAM)
#   * redirect limit
#   * content-type gate (only text/* is parsed, binary is rejected early)
#   * per-host politeness delay + per-host failure circuit breaker
#   * optional outbound proxy taken from the environment

import gzip
import io
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from dataclasses import dataclass, field

from pipeline.search.settings import SearchSettings

# Never fetched: files, binaries and media are useless to the extractor.
_BINARY_SUFFIXES = (
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif",
    ".pdf", ".zip", ".rar", ".7z", ".gz", ".tar", ".mp3", ".mp4", ".mov",
    ".avi", ".mkv", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".exe", ".dmg",
)

_TEXT_CONTENT_TYPES = ("text/html", "text/plain", "application/xhtml",
                       "application/xml", "text/xml", "application/json")

_CHARSET_RE = re.compile(r"charset\s*=\s*[\"']?([\w\-]+)", re.I)

# Reasons a fetch can fail. Kept as a closed vocabulary so the API can group
# them ("部分搜索源暂时不可用") instead of leaking exception strings.
REASON_TIMEOUT = "timeout"
REASON_HTTP_ERROR = "http_error"
REASON_TOO_LARGE = "too_large"
REASON_NOT_HTML = "not_html"
REASON_BAD_URL = "bad_url"
REASON_BLOCKED = "blocked"
REASON_UNREACHABLE = "unreachable"
REASON_REDIRECT_LOOP = "redirect_loop"
REASON_OFFLINE = "offline"


@dataclass
class PageFetchResult:
    """Outcome of one page fetch. `html` is only set when ok=True."""
    url: str
    ok: bool = False
    finalUrl: str = None
    status: int = None
    contentType: str = None
    html: str = None
    bytesRead: int = 0
    elapsedMs: int = 0
    reason: str = None           # one of REASON_* when ok=False
    detail: str = None           # short human hint, never a stack trace
    fromCache: bool = False

    def to_dict(self, withHtml=False):
        out = {
            "url": self.url,
            "ok": self.ok,
            "finalUrl": self.finalUrl,
            "status": self.status,
            "contentType": self.contentType,
            "bytesRead": self.bytesRead,
            "elapsedMs": self.elapsedMs,
            "reason": self.reason,
            "detail": self.detail,
            "fromCache": self.fromCache,
        }
        if withHtml:
            out["html"] = self.html
        return out


def _looks_binary(url):
    path = urllib.parse.urlparse(url).path.casefold()
    return path.endswith(_BINARY_SUFFIXES)


def _charset_of(content_type, head_bytes):
    if content_type:
        m = _CHARSET_RE.search(content_type)
        if m:
            return m.group(1)
    head = head_bytes.decode("latin-1", "ignore")
    m = re.search(r"<meta[^>]+charset\s*=\s*[\"']?([\w\-]+)", head, re.I)
    if m:
        return m.group(1)
    return None


def _decode(raw, content_type):
    """Bytes -> str with a deterministic, never-raising decode ladder."""
    head = raw[:4096]
    charset = _charset_of(content_type, head) or "utf-8"
    for candidate in (charset, "utf-8", "gb18030", "latin-1"):
        try:
            return raw.decode(candidate)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


class _BoundedRedirects(urllib.request.HTTPRedirectHandler):
    """Follow redirects, but only a few of them.

    Manually re-implementing the hop loop turned 302 into a hard error
    (event platforms canonicalise their URLs constantly), so redirects are
    handed to urllib with an explicit ceiling and the final URL is read back
    from the response instead.
    """

    max_redirections = 4

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.redirect_dict and sum(req.redirect_dict.values()) >= self.max_redirections:
            raise urllib.error.HTTPError(
                req.full_url, code, "too many redirects", headers, fp)
        # Redirects must keep our headers: platforms 302 to the canonical URL
        # and a missing User-Agent then gets blocked.
        new = urllib.request.Request(newurl, headers=dict(req.headers))
        new.redirect_dict = req.redirect_dict
        return new


class PageFetcher(object):
    """Bounded, polite, failure-isolated HTML fetcher."""

    name = "page-fetcher"

    def __init__(self, settings=None, opener=None, sleeper=None, clock=None):
        self.settings = settings or SearchSettings()
        self._opener = opener
        self._sleep = sleeper or time.sleep
        self._clock = clock or time.monotonic
        self._last_hit = {}       # host -> monotonic ts of last request
        self._failures = {}       # host -> consecutive failure count
        self.stats = {"requests": 0, "ok": 0, "failed": 0, "cacheHits": 0,
                      "byReason": {}}

    # -- opener -------------------------------------------------------------

    def _build_opener(self):
        handlers = [_BoundedRedirects()]
        if self.settings.proxy:
            handlers.append(urllib.request.ProxyHandler({
                "http": self.settings.proxy,
                "https": self.settings.proxy,
            }))
        else:
            handlers.append(urllib.request.ProxyHandler({}))
        return urllib.request.build_opener(*handlers)

    @property
    def opener(self):
        if self._opener is None:
            self._opener = self._build_opener()
        return self._opener

    # -- politeness ---------------------------------------------------------

    def _throttle(self, host, delay=0.4):
        last = self._last_hit.get(host)
        now = self._clock()
        if last is not None:
            wait = delay - (now - last)
            if wait > 0:
                self._sleep(wait)
        self._last_hit[host] = self._clock()

    def _host_tripped(self, host, threshold=3):
        return self._failures.get(host, 0) >= threshold

    def _record(self, host, ok):
        if ok:
            self._failures[host] = 0
        else:
            self._failures[host] = self._failures.get(host, 0) + 1

    # -- public API ---------------------------------------------------------

    def fetch(self, url, timeout=None, max_bytes=None, allow_binary=False):
        """Fetch one URL. Never raises."""
        started = self._clock()
        settings = self.settings
        timeout = settings.page_timeout if timeout is None else timeout
        max_bytes = settings.page_max_bytes if max_bytes is None else max_bytes

        def fail(reason, detail=None, status=None, final=None, size=0):
            self.stats["requests"] += 1
            self.stats["failed"] += 1
            self.stats["byReason"][reason] = self.stats["byReason"].get(reason, 0) + 1
            return PageFetchResult(
                url=url, ok=False, status=status, finalUrl=final, bytesRead=size,
                elapsedMs=int((self._clock() - started) * 1000),
                reason=reason, detail=detail)

        if not url or not isinstance(url, str):
            return fail(REASON_BAD_URL, "empty url")
        url = url.strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return fail(REASON_BAD_URL, "unsupported scheme")
        if not settings.online:
            return fail(REASON_OFFLINE, "outbound requests disabled")
        if not allow_binary and _looks_binary(url):
            return fail(REASON_NOT_HTML, "binary resource")

        host = parsed.netloc.casefold()
        if self._host_tripped(host):
            return fail(REASON_UNREACHABLE, "host skipped after repeated failures")

        self._throttle(host)

        request = urllib.request.Request(url, headers={
            "User-Agent": settings.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate",
            "Cache-Control": "no-cache",
        })
        request.redirect_dict = {}

        try:
            response = self.opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            self._record(host, False)
            if exc.code in (301, 302, 303, 307, 308):
                return fail(REASON_REDIRECT_LOOP, "HTTP %s (redirect limit)" % exc.code,
                            status=exc.code)
            reason = REASON_BLOCKED if exc.code in (401, 403, 429) else REASON_HTTP_ERROR
            return fail(reason, "HTTP %s" % exc.code, status=exc.code)
        except urllib.error.URLError as exc:
            self._record(host, False)
            text = str(getattr(exc, "reason", exc))
            reason = REASON_TIMEOUT if "timed out" in text.casefold() else REASON_UNREACHABLE
            return fail(reason, text[:200])
        except (TimeoutError, OSError) as exc:
            self._record(host, False)
            return fail(REASON_UNREACHABLE, str(exc)[:200])

        with response:
            status = getattr(response, "status", None) or response.getcode()
            final_url = response.geturl() or url
            content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().casefold()
            encoding = response.headers.get("Content-Encoding")

            if content_type and not any(content_type.startswith(t) for t in _TEXT_CONTENT_TYPES):
                self._record(host, True)
                return fail(REASON_NOT_HTML, "content-type %s" % content_type,
                            status=status, final=final_url)

            try:
                raw = response.read(max_bytes + 1)
            except (TimeoutError, OSError) as exc:
                self._record(host, False)
                return fail(REASON_TIMEOUT, str(exc)[:200], status=status,
                            final=final_url)

        if len(raw) > max_bytes:
            self._record(host, True)
            return fail(REASON_TOO_LARGE, "response exceeded %d bytes" % max_bytes,
                        status=status, final=final_url, size=len(raw))

        raw = _decompress(raw, encoding)
        self._record(host, True)
        self.stats["requests"] += 1
        self.stats["ok"] += 1
        return PageFetchResult(
            url=url, ok=True, finalUrl=final_url, status=status,
            contentType=content_type or "text/html",
            html=_decode(raw, content_type), bytesRead=len(raw),
            elapsedMs=int((self._clock() - started) * 1000))

    def fetch_many(self, urls, timeout=None, max_bytes=None):
        """Fetch a batch, preserving order. One failure never aborts the batch."""
        return [self.fetch(u, timeout=timeout, max_bytes=max_bytes) for u in urls]


def _decompress(raw, encoding):
    encoding = (encoding or "").casefold()
    if "gzip" in encoding:
        try:
            return gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
        except (OSError, EOFError):
            return raw
    if "deflate" in encoding:
        try:
            return zlib.decompress(raw)
        except zlib.error:
            try:
                return zlib.decompress(raw, -zlib.MAX_WBITS)
            except zlib.error:
                return raw
    return raw
