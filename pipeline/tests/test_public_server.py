# Public-deployment tests for pipeline/api/server.py.
#
# The brief for this phase is "a stranger with the URL can search, and can
# reach nothing else". So these tests are mostly NEGATIVE: they assert what a
# visitor CANNOT get, because that is the part that quietly rots.
#
# Everything runs against a real ThreadingHTTPServer on an ephemeral port in
# `demo` mode, so there is no network and no fixture churn — the only thing
# under test is the HTTP boundary itself.

import base64
import hashlib
import json
import re
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.api.server import (  # noqa: E402
    DISTRICT_WHITELIST, MAX_QUERY_CHARS, MAX_RESULTS_CAP, MAX_TOPICS,
    GorgonRequestHandler, RateLimiter, client_identity, make_server,
    peer_is_a_proxy, resolve_bind_defaults, validate_search_payload,
)
from pipeline.search.settings import SearchSettings  # noqa: E402

# urllib honours the machine's HTTP_PROXY, which would 502 every request to
# our own loopback server. An explicit empty ProxyHandler opts out.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # urllib then surfaces the 3xx as an HTTPError


OPENER_NOREDIRECT = urllib.request.build_opener(
    urllib.request.ProxyHandler({}), _NoRedirect())


def fetch(request, timeout=25, follow=True):
    opener = OPENER if follow else OPENER_NOREDIRECT
    try:
        with opener.open(request, timeout=timeout) as response:
            headers = {k.lower(): v for k, v in response.headers.items()}
            return response.status, headers, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        headers = {k.lower(): v for k, v in exc.headers.items()}
        return exc.code, headers, exc.read().decode("utf-8", "replace")


class PublicServerTestCase(unittest.TestCase):
    """One server for the whole class — booting is cheap, HTTP is the point."""

    @classmethod
    def setUpClass(cls):
        # A generous limiter: functional tests must not trip the 429 guard.
        cls._saved_limiter = GorgonRequestHandler.rate_limiter
        cls.server = make_server(
            port=0, host="127.0.0.1", mode="demo",
            settings=SearchSettings(mode="demo"))
        GorgonRequestHandler.rate_limiter = RateLimiter(limit=10_000)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        GorgonRequestHandler.rate_limiter = cls._saved_limiter
        cls.server.shutdown()
        cls.server.server_close()

    # -- helpers ------------------------------------------------------------

    def get(self, path, follow=True):
        return fetch(urllib.request.Request(
            self.base + quote(path, safe="/?=&%"), method="GET"), follow=follow)

    def post(self, path, payload):
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base + path, data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        return fetch(request)

    def search(self, _raw=None, **payload):
        """POST a search. `_raw` sends an exact body (no convenience defaults).

        Every other caller gets a valid query injected, so a test that means to
        send an EMPTY body has to say so explicitly — otherwise it silently
        tests the happy path and the assertion is a lie.
        """
        body = dict(payload) if _raw is None else _raw
        if _raw is None and "query" not in body:
            body["query"] = "这个周末上海有什么 AI 活动"
        status, _, text = self.post("/api/search", body)
        return status, json.loads(text)

    # -- 1. the app is reachable at both entry points -----------------------

    def test_entry_points_resolve_to_the_app(self):
        """`/` is the public URL people type; it must land on the real app.

        It redirects rather than serving the HTML in place, because index.html
        pulls its siblings with relative paths — served at `/`, every asset
        would 404.
        """
        for path in ("/", "/index.html", "/ui_kits/app"):
            with self.subTest(path=path):
                status, headers, _ = self.get(path, follow=False)
                self.assertEqual(status, 302)
                self.assertEqual(headers["location"], "/ui_kits/app/")

        for path in ("/", "/ui_kits/app/"):
            with self.subTest(path=path, follow=True):
                status, _, body = self.get(path)
                self.assertEqual(status, 200)
                self.assertIn("Gorgon", body)

    def test_root_serves_working_asset_urls(self):
        """Whatever `/` redirects to must be a base the relative URLs work from."""
        status, _, body = self.get("/")
        self.assertEqual(status, 200)
        for relative in ("responsive.css", "categories-ext.js", "generated-data.js"):
            self.assertIn(relative, body)
        # The relative references must resolve against /ui_kits/app/.
        for asset in ("/ui_kits/app/responsive.css", "/ui_kits/app/data-adapter.js",
                      "/ui_kits/app/generated-data.js"):
            with self.subTest(asset=asset):
                status, _, _ = self.get(asset)
                self.assertEqual(status, 200, "%s must exist for the app to boot" % asset)

    def test_app_assets_are_served(self):
        needed = [
            "/ui_kits/app/district.js",
            "/ui_kits/app/NaturalSearchScreen.jsx",
            "/ui_kits/app/responsive.css",
            "/styles.css",
            "/_ds_bundle.js",
            "/tokens/colors.css",
            "/components/core/ActivityCard.jsx",
            "/assets/placeholders/ai.svg",
        ]
        for path in needed:
            with self.subTest(path=path):
                status, _, _ = self.get(path)
                self.assertEqual(status, 200, "the app cannot boot without %s" % path)

    # -- 2. and nothing else is ---------------------------------------------

    def test_private_trees_are_unreachable(self):
        forbidden = [
            "/pipeline/data/review/review_queue.json",
            "/pipeline/data/approved/activities.json",
            "/pipeline/api/server.py",
            "/pipeline/tests/test_pipeline.py",
            "/.git/config",
            "/.git/HEAD",
            "/ui_kits/admin/index.html",
            "/ui_kits/dashboard/index.html",
            "/docs/DISTRICT_FILTER_REPORT.md",
            "/readme.md",
            "/ui_kits/app/README.md",
            "/components/core/Tag.prompt.md",
            "/GORGON_RECOVERY_AUDIT.md",
        ]
        for path in forbidden:
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404, "%s must not be public" % path)
                # A 404 must not hint that something exists there.
                self.assertNotIn("Traceback", body)

    def test_app_index_is_served_directly(self):
        for path in ("/ui_kits/app/", "/ui_kits/app/index.html"):
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 200)
                self.assertIn("text/html", headers["content-type"])
                self.assertIn("Gorgon", body)

    def test_no_directory_listings(self):
        for path in ("/ui_kits/", "/pipeline/", "/pipeline/data/",
                     "/components/", "/docs/", "/tokens/"):
            with self.subTest(path=path):
                status, _, body = self.get(path, follow=False)
                self.assertEqual(status, 404, "no listings: %s" % path)
                self.assertNotIn("<a href=", body)

    def test_path_traversal_cannot_escape_the_allowlist(self):
        attacks = [
            "/ui_kits/app/%2e%2e/%2e%2e/pipeline/data/review/review_queue.json",
            "/ui_kits/app/../../pipeline/data/review/review_queue.json",
            "/assets/%2e%2e/%2e%2e/.git/config",
            "/assets/../../.git/config",
            "/components/%2e%2e/%2e%2e/.git/HEAD",
            "/ui_kits/app/%2e%2e/%2e%2e/%2e%2e/Windows/win.ini",
            "/ui_kits/app/.git/config",
        ]
        for path in attacks:
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404, "%s must not resolve" % path)
                self.assertNotIn("[core]", body)

    def test_unknown_api_routes_are_not_a_control_panel(self):
        for path in ("/api/exec", "/api/admin", "/api/debug", "/api/env",
                     "/api/config", "/api/keys", "/api/shutdown", "/api/files"):
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertIn("error", body)

    def test_post_to_a_non_search_route_is_refused(self):
        status, _, body = self.post("/api/exec", {"cmd": "whoami"})
        self.assertEqual(status, 404)
        self.assertNotIn("whoami", body)

    # -- 3. response hygiene ------------------------------------------------

    def test_security_headers_are_present(self):
        for path in ("/", "/api/health"):
            with self.subTest(path=path):
                _, headers, _ = self.get(path)
                self.assertEqual(headers.get("x-content-type-options"), "nosniff")
                self.assertIn("content-security-policy", headers)
                self.assertIn("connect-src 'self'", headers["content-security-policy"])

    def test_cors_wildcard_is_gone(self):
        for path in ("/", "/api/health", "/api/search?q=hello"):
            with self.subTest(path=path):
                _, headers, _ = self.get(path)
                self.assertNotIn("access-control-allow-origin", headers)

    def test_no_local_paths_or_keys_leak(self):
        probes = [
            ("/api/health", None),
            ("/api/providers", None),
        ]
        for path, _ in probes:
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 200)
                for needle in ("cacheDir", "settings", "C:\\\\Users", "C:/Users",
                               "apiKey", "SEARCH_API_KEY", "cache_dir"):
                    self.assertNotIn(needle, body)

    def test_provider_payload_has_no_raw_detail(self):
        status, _, body = self.get("/api/providers")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertIn("providers", payload)
        for provider in payload["providers"]:
            self.assertNotIn("detail", provider)

    def test_search_response_carries_no_internals(self):
        status, payload = self.search()
        self.assertEqual(status, 200)
        raw = json.dumps(payload, ensure_ascii=False)
        for needle in ("cacheDir", "\"settings\"", "Traceback", "C:\\\\Users",
                       "C:/Users", "SEARCH_API_KEY", "\"debug\""):
            self.assertNotIn(needle, raw)
        for provider in payload["providers"]:
            self.assertNotIn("detail", provider)
        for error in payload["providerErrors"]:
            self.assertNotIn("detail", error)

    # -- 4. search input validation -----------------------------------------

    def test_query_is_required(self):
        for payload in ({}, {"query": ""}, {"query": "   "}, {"query": None},
                        {"query": 42}, {"q": ""}):
            with self.subTest(payload=payload):
                status, body = self.search(_raw=payload)
                self.assertEqual(status, 400)
                self.assertTrue(body.get("message"))

    def test_query_length_limit(self):
        status, body = self.search(query="上" * (MAX_QUERY_CHARS + 1))
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "query_too_long")

        status, _ = self.search(query="上" * MAX_QUERY_CHARS)
        self.assertEqual(status, 200)

    def test_district_whitelist(self):
        for district in DISTRICT_WHITELIST:
            with self.subTest(district=district):
                status, body = self.search(query="AI 活动", district=district)
                self.assertEqual(status, 200)
                self.assertEqual(body["district"], district)

        for bad in ("北京", "朝阳", "火星", "'; DROP TABLE", "x" * 200,
                    "徐汇区 ", "浦东新区"):
            with self.subTest(district=bad):
                status, body = self.search(query="AI 活动", district=bad)
                # "徐汇区 " strip()s to "徐汇区" which is not in the whitelist.
                self.assertEqual(status, 400, "%r must be refused" % bad)
                self.assertEqual(body["error"], "invalid_district")
                self.assertIn("allowed", body)

    def test_district_reaches_the_search_request(self):
        """The district must be a server-side constraint, not just an echo.

        It used to be validated here and then dropped, which pushed the
        scoping onto the browser — and a browser can only filter the top N
        the server already chose. That is the bug this phase removes.
        """
        status, body = self.search(query="AI 活动", district="静安")
        self.assertEqual(status, 200)
        self.assertEqual(body["district"], "静安")
        self.assertEqual(body["request"].get("district"), "静安")
        # It also steers recall and ranking through the existing soft field,
        # so the providers are actually asked about that district.
        self.assertEqual(body["request"].get("locationPreference"), "静安")
        # And it is applied, not merely recorded: nothing outside it leaks.
        for item in body["results"]:
            district = (item.get("activity") or {}).get("district")
            self.assertIn(district, (None, "静安"))

    def test_all_shanghai_is_not_a_district_filter(self):
        """'全上海' must mean "no constraint", never "district named 全上海"."""
        status, body = self.search(query="AI 活动", district="全上海")
        self.assertEqual(status, 200)
        self.assertEqual(body["district"], "全上海")
        self.assertEqual(body["request"].get("district"), "全上海")
        # Unfiltered: more than one district is present in the results.
        districts = {(r.get("activity") or {}).get("district") for r in body["results"]}
        self.assertGreater(len(districts), 1, "全上海 collapsed into a district filter")

    def test_max_results_bounds(self):
        for bad in (0, -1, MAX_RESULTS_CAP + 1, "abc", 1.5):
            with self.subTest(maxResults=bad):
                status, body = self.search(maxResults=bad)
                self.assertEqual(status, 400)
                self.assertEqual(body["error"], "invalid_max_results")
        status, _ = self.search(maxResults=MAX_RESULTS_CAP)
        self.assertEqual(status, 200)

    def test_topics_bounds(self):
        status, body = self.search(topics=["AI"] * (MAX_TOPICS + 1))
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_topics")

        status, body = self.search(topics=["A" * 100])
        self.assertEqual(status, 400)

        status, body = self.search(topics="AI")
        self.assertEqual(status, 400)

        status, _ = self.search(topics=["AI", "Agent"])
        self.assertEqual(status, 200)

    def test_oversized_body_is_refused(self):
        status, _, body = self.post("/api/search", {"query": "上" * 200_000})
        self.assertIn(status, (400, 413))
        self.assertNotIn("Traceback", body)

    # -- 5. debug is an operator switch, not a client one --------------------

    def test_client_cannot_turn_on_debug(self):
        status, body = self.search(debug=True, mode="demo")
        self.assertEqual(status, 200)
        self.assertNotIn("debug", body)
        self.assertNotIn("settings", body)
        self.assertEqual(body.get("ignoredParameters"), ["mode", "debug"])

    def test_get_search_ignores_debug_and_mode(self):
        status, headers, body = self.get(
            "/api/search?q=AI&debug=1&mode=demo&district=徐汇")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertNotIn("debug", payload)
        self.assertNotIn("settings", payload)
        self.assertEqual(payload["district"], "徐汇")

    # -- 6. failures are readable and quiet ---------------------------------

    def test_internal_error_is_readable_and_leaks_nothing(self):
        import pipeline.api.server as server_module

        def boom(*args, **kwargs):
            raise RuntimeError(
                "secret: C:\\Users\\lin\\app.db key=sk-live-1234567890")

        original = server_module.build_response
        server_module.build_response = boom
        try:
            status, body = self.search()
        finally:
            server_module.build_response = original

        self.assertEqual(status, 500)
        self.assertEqual(body["error"], "search_failed")
        self.assertIn("message", body)
        self.assertNotIn("detail", body)
        raw = json.dumps(body, ensure_ascii=False)
        for needle in ("sk-live", "app.db", "C:\\\\Users", "RuntimeError", "boom"):
            self.assertNotIn(needle, raw)

    def test_operator_only_notice_copy_is_replaced_for_visitors(self):
        """A notice telling the reader to set an env var is operator copy.

        The wording is swapped at the boundary; the level/code survive so the UI
        can still render and reason about the notice, and every other notice
        keeps its original text.
        """
        import pipeline.api.server as server_module

        original = server_module.build_response
        server_module.build_response = lambda *a, **k: {
            "status": "unavailable", "providerMode": "real", "request": {},
            "plan": {}, "providers": [], "providerErrors": [], "stages": [],
            "summary": {}, "results": [],
            "notices": [
                {"level": "warning", "code": "search_api_not_configured",
                 "message": "真实检索尚未配置。请设置 SEARCH_API_KEY。"},
                {"level": "warning", "code": "real_search_not_configured",
                 "message": "真实检索尚未配置：请设置 SEARCH_API_KEY（通用 Web 搜索）"
                            "或启用活动平台检索源。"},
                {"level": "info", "code": "web_search_not_configured",
                 "message": "通用 Web 搜索尚未配置（缺少 SEARCH_API_KEY），"
                            "本次仅使用活动平台的公开检索页，结果均为真实网页。"},
                {"level": "warning", "code": "offline",
                 "message": "真实检索已关闭（GORGON_ONLINE=off），本次仅使用本地演示数据。"},
                # A code nobody mapped yet: the generic net must still catch it.
                {"level": "info", "code": "some_future_notice",
                 "message": "请检查 GORGON_ENRICH_LIMIT 与 SEARCH_PROVIDER 设置。"},
                {"level": "warning", "code": "provider_degraded",
                 "message": "部分搜索源暂时不可用，已返回其余可用结果。"},
            ],
        }
        try:
            status, body = self.search()
        finally:
            server_module.build_response = original

        self.assertEqual(status, 200)
        raw = json.dumps(body, ensure_ascii=False)
        for secret in ("SEARCH_API_KEY", "GORGON_ONLINE", "GORGON_ENRICH_LIMIT",
                       "SEARCH_PROVIDER"):
            self.assertNotIn(secret, raw, "%s must not reach a visitor" % secret)

        by_code = {n["code"]: n for n in body["notices"]}
        # Codes and levels survive, so the UI can still reason about them.
        self.assertEqual(by_code["search_api_not_configured"]["level"], "warning")
        self.assertEqual(by_code["web_search_not_configured"]["level"], "info")
        # The useful half of a notice is kept, only the config reference goes.
        self.assertIn("公开检索页", by_code["web_search_not_configured"]["message"])
        # An unmapped notice is still scrubbed rather than passed through.
        self.assertIn("服务端配置", by_code["some_future_notice"]["message"])
        # Notices that were already visitor-safe keep their exact wording.
        self.assertIn("部分搜索源暂时不可用", by_code["provider_degraded"]["message"])

    def test_search_still_works_after_a_failure(self):
        status, _ = self.search(query="AI 活动")
        self.assertEqual(status, 200)

    # -- 7. rate limiting ---------------------------------------------------

    def test_rate_limit_returns_a_readable_429(self):
        original = GorgonRequestHandler.rate_limiter
        GorgonRequestHandler.rate_limiter = RateLimiter(limit=3)
        try:
            codes = [self.post("/api/search", {"query": "AI 活动"})[0]
                     for _ in range(4)]
            status, _, body = self.post("/api/search", {"query": "AI 活动"})
        finally:
            GorgonRequestHandler.rate_limiter = original

        self.assertEqual(codes[:3], [200, 200, 200])
        self.assertEqual(codes[3], 429)
        self.assertEqual(status, 429)
        payload = json.loads(body)
        self.assertIn("message", payload)
        self.assertIn("retryAfter", payload)

    def test_rate_limit_counts_visitors_not_the_proxy(self):
        """Behind a gateway every request arrives from the SAME socket address.

        Keying the bucket on that address lets one visitor's searches 429
        everybody else, which on a shared link is an outage rather than a rate
        limit. So the forwarded hop is what the bucket has to be built from.
        """

        def ask(forwarded):
            data = json.dumps({"query": "AI 活动"}).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if forwarded is not None:
                headers["X-Forwarded-For"] = forwarded
            request = urllib.request.Request(
                self.base + "/api/search", data=data, headers=headers,
                method="POST")
            return fetch(request)[0]

        original = GorgonRequestHandler.rate_limiter
        GorgonRequestHandler.rate_limiter = RateLimiter(limit=2)
        try:
            self.assertEqual(ask("203.0.113.1"), 200)   # visitor 1, first ask
            self.assertEqual(ask("203.0.113.2"), 200)   # visitor 2, first ask
            # The third request overall. Ignoring the header and counting the
            # (single) socket peer would already answer 429 here.
            self.assertEqual(ask("203.0.113.1"), 200)   # visitor 1, second ask
            self.assertEqual(ask("203.0.113.1"), 429)   # visitor 1 is over
            self.assertEqual(ask("203.0.113.3"), 200)   # visitor 3 unaffected
        finally:
            GorgonRequestHandler.rate_limiter = original


class ValidationUnitTest(unittest.TestCase):
    """validate_search_payload is pure — cheaper to pin directly."""

    def test_clean_payload_only_has_known_keys(self):
        clean, error = validate_search_payload({
            "query": "AI 活动", "maxResults": 10, "topics": ["AI"],
            "city": "上海", "district": "徐汇",
            "debug": True, "mode": "demo", "rm -rf /": "yes",
        })
        self.assertIsNone(error)
        allowed = {"query", "maxResults", "topics", "city", "timePreference",
                   "locationPreference", "pricePreference", "district",
                   "__ignored"}
        self.assertTrue(set(clean).issubset(allowed), set(clean) - allowed)
        self.assertNotIn("rm -rf /", clean)
        self.assertNotIn("mode", clean)

    def test_q_is_accepted_as_an_alias_for_query(self):
        clean, error = validate_search_payload({"q": "AI 活动"})
        self.assertIsNone(error)
        self.assertEqual(clean["query"], "AI 活动")

    def test_debug_only_honoured_for_the_operator(self):
        clean, _ = validate_search_payload({"query": "AI", "debug": True},
                                           allow_debug=True)
        self.assertTrue(clean.get("debug"))
        clean, _ = validate_search_payload({"query": "AI", "debug": True},
                                           allow_debug=False)
        self.assertNotIn("debug", clean)

    def test_exactly_one_of_clean_or_error(self):
        for payload in ({}, {"query": "ok"}, {"query": "x" * 400},
                        {"query": "ok", "district": "火星"}):
            clean, error = validate_search_payload(payload)
            self.assertNotEqual(clean is None, error is None,
                                "one of the two must be set: %r" % (payload,))


class BindDefaultsTest(unittest.TestCase):
    """The deployment sandbox sets PORT; a local run must NOT go wide."""

    def test_local_run_stays_on_loopback(self):
        self.assertEqual(resolve_bind_defaults({}), ("127.0.0.1", 8000))

    def test_injected_port_also_opens_the_interface(self):
        # Hosting sandboxes only inject PORT when they terminate the public
        # connection themselves, so we have to listen on every interface.
        self.assertEqual(resolve_bind_defaults({"PORT": "3000"}), ("0.0.0.0", 3000))

    def test_garbage_port_falls_back_to_local_defaults(self):
        for bad in ("", "   ", "abc", "80.5", "-1"):
            self.assertEqual(resolve_bind_defaults({"PORT": bad}),
                             ("127.0.0.1", 8000), bad)

    def test_explicit_host_wins_over_the_inferred_one(self):
        self.assertEqual(
            resolve_bind_defaults({"PORT": "9000", "GORGON_HOST": "127.0.0.1"}),
            ("127.0.0.1", 9000))

    def test_reads_the_real_environment_when_called_without_arguments(self):
        # The default path is the one the process actually starts on, so it has
        # to be exercised rather than assumed (a missing `import os` here only
        # shows up at server start-up, not in a dict-driven test).
        host, port = resolve_bind_defaults()
        self.assertIsInstance(host, str)
        self.assertIsInstance(port, int)
        self.assertTrue(host)
        self.assertGreater(port, 0)


APP_INDEX = REPO_ROOT / "ui_kits" / "app" / "index.html"


class FrontendIsolationTest(unittest.TestCase):
    """The public page must boot with no third-party origin involved.

    Vendoring React/Babel/lucide is not a style preference. unpkg is
    unreachable from a lot of networks, and when it fails the app renders a
    blank page — the one failure mode a link you hand to strangers cannot have.
    """

    def test_index_html_loads_no_external_script(self):
        srcs = re.findall(r'<script[^>]*\ssrc="([^"]+)"',
                          APP_INDEX.read_text(encoding="utf-8"))
        external = [s for s in srcs if s.startswith(("http://", "https://", "//"))]
        self.assertEqual(external, [],
                         "an external script origin is back: %r" % (external,))

    def test_vendored_runtime_matches_the_declared_hashes(self):
        html = APP_INDEX.read_text(encoding="utf-8")
        pairs = re.findall(r'src="([^"]+)"\s+integrity="sha384-([^"]+)"', html)
        self.assertTrue(pairs, "no integrity-pinned script found — tags changed?")
        for src, digest in pairs:
            path = (APP_INDEX.parent / src).resolve()
            self.assertTrue(path.is_file(), "missing vendored file: %s" % (path,))
            got = base64.b64encode(hashlib.sha384(path.read_bytes()).digest())
            self.assertEqual(got.decode(), digest,
                             "vendored bytes drifted: %s" % (path.name,))

    def test_no_shipped_source_reaches_for_a_cdn(self):
        roots = [REPO_ROOT / "ui_kits" / "app", REPO_ROOT / "components"]
        offenders = []
        for root in roots:
            for path in list(root.rglob("*.js")) + list(root.rglob("*.jsx")):
                text = path.read_text(encoding="utf-8", errors="ignore")
                for host in ("unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"):
                    if host in text:
                        offenders.append("%s -> %s" % (path.name, host))
        self.assertEqual(offenders, [])


class ClientIdentityTest(unittest.TestCase):
    """Who the rate limiter counts — the one place a proxy changes the answer."""

    def test_behind_a_proxy_the_forwarded_hop_is_the_visitor(self):
        self.assertEqual(client_identity("127.0.0.1", "203.0.113.7", True),
                         "203.0.113.7")

    def test_the_last_hop_is_the_one_our_proxy_appended(self):
        # A client that invents the header cannot pick its own bucket: its
        # proxy appends the address it actually saw, last.
        self.assertEqual(
            client_identity("127.0.0.1", "1.2.3.4, 203.0.113.7", True),
            "203.0.113.7")

    def test_without_a_proxy_the_socket_address_wins(self):
        # Otherwise a directly-exposed process would hand a fresh bucket to any
        # client that sends the header.
        self.assertEqual(client_identity("203.0.113.9", "1.2.3.4", False),
                         "203.0.113.9")

    def test_a_missing_or_empty_header_falls_back_to_the_peer(self):
        for forwarded in (None, "", "   ", ",", " , "):
            self.assertEqual(client_identity("127.0.0.1", forwarded, True),
                             "127.0.0.1", repr(forwarded))

    def test_workspace_and_injected_port_both_mean_a_proxy(self):
        for peer in ("127.0.0.1", "::1", "10.0.0.5", "192.168.1.20", "172.16.4.4"):
            self.assertTrue(peer_is_a_proxy(peer, {}), peer)
        self.assertTrue(peer_is_a_proxy("127.0.0.1", {"PORT": "8000"}))
        # A sandbox peer that is not itself a workspace address still counts,
        # because the injected PORT is the signal that something proxies us.
        self.assertTrue(peer_is_a_proxy("8.8.8.8", {"PORT": "8000"}))

    def test_a_direct_public_peer_is_not_treated_as_a_proxy(self):
        # NB: the documentation ranges (192.0.2.0/24, 198.51.100.0/24,
        # 203.0.113.0/24) report is_private=True in Python, so they are useless
        # as stand-ins for "a stranger on the internet" here.
        for peer in ("8.8.8.8", "93.184.216.34", "not-an-ip", ""):
            self.assertFalse(peer_is_a_proxy(peer, {}), repr(peer))


if __name__ == "__main__":
    unittest.main()
