# PHASE 5 — real-time retrieval layer tests.
#
# Covers the whole new chain, offline and deterministically:
#   settings / provider registry   -> mode demo|real|hybrid, no key = no crash
#   PageFetcher                    -> timeout, max size, non-HTML, error isolation
#   metadata extraction            -> og:image, twitter:image, JSON-LD image
#   event extraction               -> fields come from the page, never invented
#   image resolution               -> priority order + category placeholder
#   adapter / schema               -> image + provenance survive to canonical
#   service                        -> provider timeout / unavailable handling
#
# No test in this file touches the network: the fetcher is always given a
# stub opener.

import sys
import unittest
import urllib.error
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.search import placeholders  # noqa: E402
from pipeline.search.adapter import to_raw_activities  # noqa: E402
from pipeline.search.events import EventExtractor, extract_events  # noqa: E402
from pipeline.search.extract import (  # noqa: E402
    IMG_JSONLD, IMG_OG, IMG_PLACEHOLDER, IMG_TWITTER, parse_page,
)
from pipeline.search.fetcher import (  # noqa: E402
    REASON_HTTP_ERROR, REASON_NOT_HTML, REASON_TIMEOUT, REASON_TOO_LARGE,
    PageFetcher,
)
from pipeline.search.models import new_raw_result  # noqa: E402
from pipeline.search.provider import FixtureSearchProvider  # noqa: E402
from pipeline.search.service import resolve_providers, search_events  # noqa: E402
from pipeline.search.settings import SearchSettings  # noqa: E402
from pipeline.search.webproviders import build_real_providers  # noqa: E402

TODAY = date(2026, 9, 15)


# ── stub HTTP layer ────────────────────────────────────────────────────────

class _Response(object):
    """Stands in for an http.client.HTTPResponse (context-manager aware)."""

    def __init__(self, body, status=200, headers=None, url="https://stub.test/"):
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.status = status
        self.headers = dict(headers or {"Content-Type": "text/html; charset=utf-8"})
        self._url = url
        self._read = False

    def read(self, n=-1):
        if self._read:
            return b""
        self._read = True
        if n is not None and n >= 0:
            return self._body[:n]
        return self._body

    def getcode(self):
        return self.status

    def geturl(self):
        return self._url

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class _StubOpener(object):
    """Minimal urlopen stand-in: url -> _Response | Exception."""

    def __init__(self, mapping):
        self.mapping = mapping
        self.seen = []
        self.timeouts = []

    def open(self, request, timeout=None):
        url = getattr(request, "full_url", request)
        headers = dict(getattr(request, "headers", {}) or {})
        self.seen.append((url, headers))
        self.timeouts.append(timeout)
        result = self.mapping.get(url)
        if result is None:
            raise OSError("no stub for %s" % url)
        if isinstance(result, Exception):
            raise result
        return result


def _fetcher(mapping, **kw):
    settings = kw.pop("settings", None) or SearchSettings(proxy=None, **kw)
    return PageFetcher(settings=settings, opener=_StubOpener(mapping))


class _NoReadOpener(object):
    """A response whose read() times out — how a real slow server behaves."""

    def __init__(self):
        self.seen = []

    def open(self, request, timeout=None):
        self.seen.append(getattr(request, "full_url", request))

        class _Slow(_Response):
            def read(self, n=-1):
                raise TimeoutError("timed out")

        return _Slow("<html></html>")


# ── PageFetcher ────────────────────────────────────────────────────────────

class PageFetcherTests(unittest.TestCase):

    def test_fetches_html_and_sends_a_user_agent(self):
        stub = _StubOpener({"https://ok.test/e": _Response("<html><title>Hi</title></html>")})
        f = PageFetcher(settings=SearchSettings(proxy=None), opener=stub)
        res = f.fetch("https://ok.test/e")
        self.assertTrue(res.ok)
        self.assertEqual(res.status, 200)
        self.assertIn("<title>Hi</title>", res.html)
        url, headers = stub.seen[0]
        self.assertEqual(url, "https://ok.test/e")
        # a real browser-ish UA, not the urllib default
        ua = headers.get("User-Agent") or headers.get("User-agent") or ""
        self.assertTrue(ua and "python-urllib" not in ua.lower())

    def test_timeout_is_reported_not_raised(self):
        f = PageFetcher(settings=SearchSettings(proxy=None, page_timeout=1),
                        opener=_NoReadOpener())
        res = f.fetch("https://slow.test/e")
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, REASON_TIMEOUT)

    def test_oversized_response_is_cut_off(self):
        big = "x" * 5000
        f = _fetcher({"https://big.test/e": _Response("<html>%s</html>" % big)})
        res = f.fetch("https://big.test/e", max_bytes=1024)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, REASON_TOO_LARGE)

    def test_non_html_is_rejected(self):
        f = _fetcher({"https://img.test/a.jpg": _Response(
            b"\xff\xd8\xff", headers={"Content-Type": "image/jpeg"})})
        res = f.fetch("https://img.test/a.jpg")
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, REASON_NOT_HTML)

    def test_http_error_is_reported(self):
        # urllib raises HTTPError for 4xx/5xx — the stub must do the same.
        err = urllib.error.HTTPError("https://gone.test/e", 404, "Not Found", {}, None)
        f = _fetcher({"https://gone.test/e": err})
        res = f.fetch("https://gone.test/e")
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, REASON_HTTP_ERROR)

    def test_one_bad_url_does_not_stop_the_rest(self):
        f = _fetcher({
            "https://a.test/e": _Response("<html>A</html>"),
            "https://b.test/e": OSError("boom"),
            "https://c.test/e": _Response("<html>C</html>"),
        })
        out = f.fetch_many(["https://a.test/e", "https://b.test/e", "https://c.test/e"])
        self.assertEqual(len(out), 3)
        self.assertEqual([r.ok for r in out], [True, False, True])

    def test_offline_mode_never_touches_the_network(self):
        stub = _StubOpener({})
        f = PageFetcher(settings=SearchSettings(online=False, proxy=None), opener=stub)
        res = f.fetch("https://any.test/e")
        self.assertFalse(res.ok)
        self.assertEqual(stub.seen, [])


# ── metadata extraction ────────────────────────────────────────────────────

OG_PAGE = """<html><head>
<meta property="og:image" content="/media/hero.jpg">
<meta name="twitter:image" content="https://cdn.test/tw.jpg">
<meta property="og:title" content="AI Agent Builder Meetup">
<meta property="og:description" content="面向开发者的 Agent 线下交流。">
</head><body><h1>AI Agent Builder Meetup</h1></body></html>"""

TWITTER_ONLY = """<html><head>
<meta name="twitter:image" content="https://cdn.test/tw-only.jpg">
<meta property="og:title" content="Twitter only">
</head><body>x</body></html>"""

JSONLD_PAGE = """<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Event",
 "name":"上海 AI 沙龙",
 "startDate":"2026-09-19T14:00:00+08:00",
 "endDate":"2026-09-19T17:00:00+08:00",
 "image":["https://cdn.test/ld-hero.jpg"],
 "location":{"@type":"Place","name":"西岸美术馆",
             "address":{"@type":"PostalAddress",
                        "streetAddress":"龙腾大道2600号",
                        "addressLocality":"徐汇区","addressRegion":"上海"}},
 "offers":{"@type":"Offer","price":"0","url":"https://tickets.test/join"},
 "organizer":{"@type":"Organization","name":"AI Builder 社区"}}
</script></head><body>x</body></html>"""

NO_IMAGE_PAGE = """<html><head><title>没有图的活动</title></head>
<body><h1>没有图的活动</h1></body></html>"""


class MetadataExtractionTests(unittest.TestCase):

    def test_og_image_wins(self):
        page = parse_page(OG_PAGE, url="https://site.test/e")
        best = sorted(page.images, key=lambda c: -c.priority)[0]
        self.assertEqual(best.source, IMG_OG)
        self.assertTrue(best.url.endswith("/media/hero.jpg"))
        self.assertTrue(best.url.startswith("https://"), "relative og:image must be absolutised")

    def test_twitter_image_is_used_when_og_is_absent(self):
        page = parse_page(TWITTER_ONLY, url="https://site.test/e")
        best = sorted(page.images, key=lambda c: -c.priority)[0]
        self.assertEqual(best.source, IMG_TWITTER)
        self.assertEqual(best.url, "https://cdn.test/tw-only.jpg")

    def test_json_ld_event_image_and_fields(self):
        page = parse_page(JSONLD_PAGE, url="https://site.test/e")
        sources = {c.source for c in page.images}
        self.assertIn(IMG_JSONLD, sources)
        from pipeline.search.extract import json_ld_event
        event = json_ld_event(page.jsonLd)
        self.assertEqual(event.get("name"), "上海 AI 沙龙")
        self.assertEqual(event.get("startDate"), "2026-09-19T14:00:00+08:00")

    def test_page_without_images_yields_no_image_candidates(self):
        page = parse_page(NO_IMAGE_PAGE, url="https://site.test/e")
        self.assertEqual([c for c in page.images if c.url], [])

    def test_priority_order_is_og_then_twitter_then_jsonld(self):
        from pipeline.search.extract import IMAGE_PRIORITY
        self.assertGreater(IMAGE_PRIORITY[IMG_OG], IMAGE_PRIORITY[IMG_TWITTER])
        self.assertGreater(IMAGE_PRIORITY[IMG_TWITTER], IMAGE_PRIORITY[IMG_JSONLD])
        self.assertGreater(IMAGE_PRIORITY[IMG_JSONLD], IMAGE_PRIORITY[IMG_PLACEHOLDER])


# ── event extraction ───────────────────────────────────────────────────────

class EventExtractionTests(unittest.TestCase):

    def test_json_ld_event_is_read_faithfully(self):
        page = parse_page(JSONLD_PAGE, url="https://site.test/e")
        ex = EventExtractor(today=TODAY).extract(page, source_url="https://site.test/e")
        self.assertEqual(ex.title, "上海 AI 沙龙")
        self.assertTrue(ex.rawDate and ex.rawDate.startswith("2026-09-19"))
        self.assertTrue(ex.rawTime and ex.rawTime.startswith("14:00"))
        self.assertEqual(ex.venue, "西岸美术馆")
        # schema.org addressLocality/addressRegion are kept verbatim as
        # district/city — the extractor reports, the normalizer cleans.
        self.assertEqual(ex.district, "徐汇区")
        self.assertEqual(ex.city, "上海")
        self.assertEqual(ex.address, "龙腾大道2600号")
        self.assertEqual(ex.registrationUrl, "https://tickets.test/join")
        self.assertEqual(ex.organizer, "AI Builder 社区")
        self.assertEqual(ex.imageSource, IMG_JSONLD)
        self.assertEqual(ex.imageType, "remote")
        self.assertEqual(ex.fieldSources.get("organizer"), "json-ld")

    def test_missing_fields_stay_none_and_are_never_guessed(self):
        page = parse_page(NO_IMAGE_PAGE, url="https://site.test/e")
        ex = EventExtractor(today=TODAY).extract(
            page, source_url="https://site.test/e", fallback_title="没有图的活动")
        self.assertIsNone(ex.rawPrice)
        self.assertIsNone(ex.organizer)
        self.assertIsNone(ex.registrationUrl)
        self.assertIsNone(ex.address)
        # nothing invented for a page that published nothing
        self.assertIsNone(ex.rawDate)
        self.assertIsNone(ex.venue)

    def test_no_image_falls_back_to_a_category_placeholder(self):
        page = parse_page("<html><head><title>上海 AI Hackathon</title></head><body>x</body></html>",
                          url="https://site.test/e")
        ex = EventExtractor(today=TODAY).extract(page, source_url="https://site.test/e")
        self.assertEqual(ex.imageType, "placeholder")
        self.assertEqual(ex.imageSource, IMG_PLACEHOLDER)
        self.assertIn("/assets/placeholders/", ex.imageUrl)
        self.assertIn("hackathon", ex.imageUrl)

    def test_placeholder_is_never_mistaken_for_source_art(self):
        for slug in ("ai", "hackathon", "meetup", "demoday", "default"):
            url = placeholders.placeholder_url(slug)
            self.assertTrue(placeholders.is_placeholder(url))
            self.assertEqual(placeholders.placeholder_slug_of(url), slug)
        self.assertFalse(placeholders.is_placeholder("https://cdn.test/real.jpg"))

    def test_agenda_is_only_reported_when_the_page_states_it(self):
        html = """<html><body>
        <h2>活动流程</h2>
        <p>14:00-14:30 签到</p><p>14:30-15:30 主题分享</p>
        <p>15:30-16:30 Demo 展示</p><p>16:30-17:00 Q&amp;A</p>
        </body></html>"""
        page = parse_page(html, url="https://site.test/e")
        rows = page.agenda
        self.assertGreaterEqual(len(rows), 3)
        self.assertTrue(any("签到" in (r.get("title") or "") for r in rows))

        empty = parse_page("<html><body><h1>无流程</h1></body></html>", url="https://site.test/e")
        self.assertEqual(empty.agenda, [])

    def test_extract_events_keeps_the_source_url(self):
        page = parse_page(OG_PAGE, url="https://site.test/e")
        events = extract_events([page], hints=[{"title": "hint"}],
                                source_urls=["https://site.test/e"], today=TODAY)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].sourceUrl, "https://site.test/e")
        self.assertEqual(events[0].fieldSources.get("sourceUrl"), None)  # not a "source" fact


# ── settings + provider registry ───────────────────────────────────────────

class ProviderModeTests(unittest.TestCase):

    def test_demo_mode_uses_only_the_fixture(self):
        settings = SearchSettings(mode="demo")
        providers, notices, mode = resolve_providers(settings)
        self.assertEqual(mode, "demo")
        self.assertTrue(all(isinstance(p, FixtureSearchProvider) for p in providers))
        self.assertTrue(any(n["code"] == "demo_data" for n in notices))

    def test_real_mode_without_an_api_key_does_not_crash(self):
        settings = SearchSettings(mode="real", provider="auto", api_key=None,
                                  event_sources=(), web_search="off", proxy=None)
        providers, notices, mode = resolve_providers(settings)
        self.assertEqual(mode, "real")
        self.assertEqual(providers, [])
        self.assertTrue(any(n["code"] == "real_search_not_configured" for n in notices))
        self.assertFalse(settings.api_key)
        self.assertFalse(settings.describe()["apiKeyConfigured"])

    def test_describe_never_leaks_the_key(self):
        settings = SearchSettings(mode="real", provider="brave", api_key="sk-secret")
        blob = str(settings.describe())
        self.assertNotIn("sk-secret", blob)
        self.assertTrue(settings.describe()["apiKeyConfigured"])

    def test_keyless_event_platforms_are_real_providers(self):
        settings = SearchSettings(mode="real", provider="auto", api_key=None,
                                  event_sources=("huodongxing", "segmentfault"),
                                  proxy=None)
        providers, notices = build_real_providers(settings)
        self.assertTrue(providers, "keyless event platforms must still be usable")
        self.assertTrue(all(not isinstance(p, FixtureSearchProvider) for p in providers))

    def test_hybrid_labels_itself(self):
        settings = SearchSettings(mode="hybrid", provider="auto", api_key=None,
                                  event_sources=("segmentfault",), proxy=None)
        providers, notices, mode = resolve_providers(settings)
        self.assertIn(mode, ("hybrid", "demo"))
        if mode == "hybrid":
            self.assertTrue(any(isinstance(p, FixtureSearchProvider) for p in providers))
            self.assertTrue(any(n["code"] == "hybrid_mode" for n in notices))


# ── service-level honesty ──────────────────────────────────────────────────

class _DeadProvider(object):
    """A real provider whose every request times out."""
    name = "dead"
    kind = "web-search"

    def __init__(self):
        from pipeline.search.webproviders import ProviderStatus
        self.lastError = None
        self.status = ProviderStatus(self.name, self.kind, False, REASON_TIMEOUT,
                                     "连接超时")
        self.requestCount = 0

    def search(self, query):
        self.requestCount += 1
        return []


class ServiceHonestyTests(unittest.TestCase):

    def test_real_run_with_a_dead_provider_is_unavailable_not_demo(self):
        settings = SearchSettings(mode="real", proxy=None, fetch_pages=False)
        result = search_events("这个周末上海有哪些 AI 活动",
                               providers=[_DeadProvider()], settings=settings,
                               today=TODAY)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["providerMode"], "real")
        self.assertEqual(result["results"], [])
        self.assertEqual(result["summary"]["demoResults"], 0)
        self.assertTrue(result["stages"])

    def test_timeout_notice_copy_matches_the_contract(self):
        settings = SearchSettings(mode="real", proxy=None, fetch_pages=False)
        result = search_events("上海 AI 活动", providers=[_DeadProvider()],
                               settings=settings, today=TODAY)
        messages = " ".join(n["message"] for n in result["notices"])
        self.assertIn("部分搜索源暂时不可用", messages)

    def test_fixture_run_is_labelled_demo_end_to_end(self):
        from pipeline.api.server import public_result
        result = search_events("这个周末上海有什么 AI 活动？", today=TODAY,
                               settings=SearchSettings(mode="demo"))
        self.assertEqual(result["providerMode"], "demo")
        self.assertGreater(len(result["results"]), 0)
        rows = [public_result(r) for r in result["results"]]
        self.assertTrue(rows)
        self.assertTrue(all(r["dataOrigin"] == "demo" for r in rows))
        self.assertTrue(any(n["code"] == "demo_data" for n in result["notices"]))

    def test_injected_real_providers_are_labelled_real_not_demo(self):
        """A caller-provided provider set must never be presented as DEMO."""
        settings = SearchSettings(mode="real", proxy=None, fetch_pages=False)
        result = search_events("上海 AI 活动", providers=[_DeadProvider()],
                               settings=settings, today=TODAY)
        self.assertEqual(result["providerMode"], "real")
        self.assertNotEqual(result["providerMode"], "demo")

    def test_thin_records_are_counted_not_hidden(self):
        result = search_events("这个周末上海有什么活动？", today=TODAY,
                               settings=SearchSettings(mode="demo"))
        self.assertIn("excludedThin", result["summary"])
        self.assertIn("excludedThinReason", result["summary"])


# ── adapter: image + provenance survive into canonical ─────────────────────

class AdapterImageTests(unittest.TestCase):

    def _result_with_image(self):
        return new_raw_result(
            resultId="x1", providerQuery="上海 AI 活动", provider="segmentfault",
            source="SegmentFault", sourceType="web", sourceTrust="medium",
            title="上海 AI Agent Meetup", url="https://site.test/e",
            rawDate="2026-09-19", rawTime="14:00-17:00",
            rawVenue="西岸美术馆", rawLocation="上海·徐汇", rawPrice="免费",
            dataOrigin="real", retrievedAt="2026-09-15T00:00:00",
            imageUrl="https://cdn.test/hero.jpg", imageSource=IMG_OG,
            imageType="remote")

    def test_image_and_source_survive_the_adapter(self):
        acts = to_raw_activities([self._result_with_image()],
                                 collected_at="2026-09-15T00:00:00")
        act = acts[0]
        self.assertEqual(act["imageUrl"], "https://cdn.test/hero.jpg")
        self.assertEqual(act["imageSource"], IMG_OG)
        self.assertEqual(act["sourceUrl"], "https://site.test/e")

    def test_remote_image_wins_over_a_placeholder_in_the_adapter(self):
        r = self._result_with_image()
        r.imageUrl = None
        r.imageSource = None
        acts = to_raw_activities([r], collected_at="2026-09-15T00:00:00")
        # The adapter must not invent an image: absent stays absent, and the
        # UI layer is what decides to draw a category placeholder.
        self.assertIn(acts[0].get("imageUrl"), (None, ""))
        self.assertNotEqual(acts[0].get("imageSource"), IMG_OG)


# ── UI view model (Node) ───────────────────────────────────────────────────
#
# The normaliser every surface shares (search card, detail page, Discover,
# My Weekend) runs in the browser, so it is tested by a small plain-Node
# harness. Wired in here so "the suite is green" means the UI contract holds
# too, not just the Python side.

class UIViewModelTests(unittest.TestCase):

    def test_view_model_harness_passes(self):
        import shutil
        import subprocess

        node = shutil.which("node") or shutil.which("node.exe")
        if not node:
            self.skipTest("node not available")
        script = PIPELINE_DIR / "tests" / "ui_view_model.test.mjs"
        self.assertTrue(script.exists(), "view-model harness is missing")
        proc = subprocess.run([node, str(script)], capture_output=True, text=True,
                              encoding="utf-8", errors="replace",
                              cwd=str(REPO_ROOT))
        if proc.returncode != 0:
            self.fail("ui_view_model.test.mjs failed:\n%s\n%s"
                      % (proc.stdout, proc.stderr))


if __name__ == "__main__":
    unittest.main()
