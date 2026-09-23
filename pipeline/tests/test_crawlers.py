# Crawler-layer tests (REAL EVENT INDEX V1 — PHASE 1).
#
# The HTML fixtures under tests/fixtures/crawlers/ are REAL pages captured
# from the live source, so the parsers are asserted against the markup the
# site actually serves. Fixtures are for UNIT tests only: a production crawl
# (pipeline/crawlers/run.py) always goes to the network and has no fixture
# mode, so a passing test can never be mistaken for real collected data.
#
# Everything here is offline — every fetch goes through FakeFetcher.

import sys
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.crawlers.base import (  # noqa: E402
    MAX_CONSECUTIVE_FAILURES, STOP_BLOCKED, STOP_DETAIL_LIMIT, STOP_EMPTY_LISTING,
    STOP_MAX_PAGES, STOP_NO_NEW_URLS, STOP_NO_NEXT, STOP_REPEATED_LISTING,
    STOP_SOURCE_UNAVAILABLE, canonical_url,
)
from pipeline.crawlers.douban import (  # noqa: E402
    DoubanCrawler, PAGE_SIZE, split_location,
)
from pipeline.crawlers.models import ListingEntry  # noqa: E402
from pipeline.search.fetcher import (  # noqa: E402
    REASON_BLOCKED, REASON_HTTP_ERROR, REASON_TIMEOUT, PageFetchResult,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "crawlers"


def fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def ok_result(url, html):
    return PageFetchResult(url=url, ok=True, finalUrl=url, status=200,
                           contentType="text/html", html=html, bytesRead=len(html))


def failed_result(url, reason, detail="boom", status=None):
    return PageFetchResult(url=url, ok=False, finalUrl=url, status=status,
                           reason=reason, detail=detail)


class FakeFetcher(object):
    """url -> PageFetchResult. Records what was asked for."""

    def __init__(self, pages=None, default=None):
        self.pages = dict(pages or {})
        self.default = default
        self.calls = []

    def fetch(self, url, timeout=None, max_bytes=None):
        self.calls.append(url)
        if url in self.pages:
            result = self.pages[url]
            return result if isinstance(result, PageFetchResult) else ok_result(url, result)
        if callable(self.default):
            return self.default(url)
        if self.default is not None:
            return ok_result(url, self.default)
        return failed_result(url, REASON_HTTP_ERROR, "not mapped: %s" % url, status=404)


def _renumber(html, offset):
    """REAL markup with different event ids.

    Lets one captured page stand in for several distinct pages in a
    pagination-walk test without inventing any markup of our own.
    """
    import re
    return re.sub(r"/event/(\d+)/",
                  lambda m: "/event/%d/" % (int(m.group(1)) + offset), html)


def make_crawler(pages=None, default=None, max_pages=3, **kwargs):
    fetcher = FakeFetcher(pages=pages, default=default)
    crawler = DoubanCrawler(city="上海", max_pages=max_pages, fetcher=fetcher, **kwargs)
    return crawler, fetcher


# --- listing parser --------------------------------------------------------

class ListingParserTest(unittest.TestCase):
    def setUp(self):
        self.page1 = fixture("douban_listing_page1.html")
        self.page2 = fixture("douban_listing_page2.html")
        self.crawler = DoubanCrawler(city="上海", fetcher=FakeFetcher())

    def test_parses_every_real_row(self):
        listing = self.crawler.parse_listing(self.page1, self.crawler.listing_url(1))
        self.assertEqual(10, len(listing.entries))

    def test_ignores_sidebar_rows(self):
        # The live page contains 15 `<li class="list-entry">` nodes: 10 real
        # result rows plus 5 sidebar ticket-shop rows that repeat on EVERY
        # page. Only the result rows carry the Event microdata.
        self.assertEqual(15, self.page1.count('class="list-entry'))
        listing = self.crawler.parse_listing(self.page1, self.crawler.listing_url(1))
        self.assertEqual(10, len(listing.entries))

    def test_first_row_fields_come_from_the_page(self):
        listing = self.crawler.parse_listing(self.page1, self.crawler.listing_url(1))
        first = listing.entries[0]
        self.assertEqual("https://www.douban.com/event/36988401/", first.url)
        self.assertEqual("36988401", first.sourceEventId)
        self.assertEqual("2026-10-01T08:00:00", first.startTime)
        self.assertEqual("2026-12-24T19:00:00", first.endTime)
        self.assertEqual("上海", first.city)
        self.assertEqual("长宁", first.district)
        self.assertEqual("虹桥路地铁站3口", first.address)
        self.assertEqual("178元(活动费)", first.price)
        self.assertEqual("互助网周末活动", first.organizer)
        self.assertTrue(first.title)

    def test_every_row_has_url_and_id(self):
        for name in ("douban_listing_page1.html", "douban_listing_page2.html"):
            listing = self.crawler.parse_listing(fixture(name), "https://x/")
            for entry in listing.entries:
                self.assertTrue(entry.url.startswith("https://www.douban.com/event/"))
                self.assertTrue(entry.sourceEventId.isdigit())
                self.assertTrue(entry.title)

    def test_pages_disjoint(self):
        ids1 = {e.sourceEventId for e in
                self.crawler.parse_listing(self.page1, self.crawler.listing_url(1)).entries}
        ids2 = {e.sourceEventId for e in
                self.crawler.parse_listing(self.page2, self.crawler.listing_url(2)).entries}
        self.assertEqual(10, len(ids1))
        self.assertEqual(10, len(ids2))
        self.assertEqual(set(), ids1 & ids2)

    def test_total_pages_read_from_page(self):
        listing = self.crawler.parse_listing(self.page1, self.crawler.listing_url(1))
        self.assertEqual(153, listing.totalPages)
        self.assertTrue(listing.hasNext)

    def test_last_page_has_no_next(self):
        # data-total-page is authoritative: the site keeps rendering a "next"
        # control past the end, so page N of N must report hasNext False.
        page = self.crawler.listing_url(153)
        html = self.page1.replace('data-total-page="153"', 'data-total-page="2"')
        self.assertFalse(self.crawler.parse_listing(html, self.crawler.listing_url(2)).hasNext)
        self.assertTrue(self.crawler.parse_listing(html, page).hasNext is False)

    def test_empty_listing_page(self):
        listing = self.crawler.parse_listing(
            fixture("douban_listing_empty.html"), self.crawler.listing_url(200))
        self.assertEqual([], listing.entries)


# --- pagination ------------------------------------------------------------

class PaginationTest(unittest.TestCase):
    def test_url_shape(self):
        crawler = DoubanCrawler(fetcher=FakeFetcher())
        self.assertEqual("https://shanghai.douban.com/events/future-all",
                         crawler.listing_url(1))
        self.assertEqual("https://shanghai.douban.com/events/future-all?start=10",
                         crawler.listing_url(2))
        self.assertEqual("https://shanghai.douban.com/events/future-all?start=%d"
                         % (9 * PAGE_SIZE), crawler.listing_url(10))

    def test_walks_until_max_pages(self):
        crawler, fetcher = make_crawler(max_pages=2)
        fetcher.pages = {
            crawler.listing_url(1): fixture("douban_listing_page1.html"),
            crawler.listing_url(2): fixture("douban_listing_page2.html"),
        }
        crawler.fetchDetails = False
        events, report = crawler.crawl()
        self.assertEqual(2, report.pagesFetched)
        self.assertEqual(20, report.activitiesDiscovered)
        self.assertEqual(20, report.uniqueActivityUrls)
        self.assertEqual(20, len(events))
        self.assertEqual(STOP_MAX_PAGES, report.stopReason)
        self.assertEqual([crawler.listing_url(1), crawler.listing_url(2)], fetcher.calls)

    def test_page_one_is_not_the_only_page(self):
        # Regression: a dedupe key that dropped the query string made every
        # listing URL identical, so the crawl stopped after page 1.
        crawler, fetcher = make_crawler(max_pages=5)
        page1 = fixture("douban_listing_page1.html")
        fetcher.pages = {crawler.listing_url(i): _renumber(page1, i * 1000)
                         for i in range(1, 6)}
        crawler.fetchDetails = False
        events, report = crawler.crawl()
        listing_calls = [u for u in fetcher.calls if u.startswith(crawler.base_url())]
        self.assertEqual(5, len(listing_calls))
        self.assertEqual(5, len(set(listing_calls)))
        self.assertTrue(any("start=20" in u for u in listing_calls))
        self.assertTrue(any("start=40" in u for u in listing_calls))
        self.assertEqual(50, report.uniqueActivityUrls)
        self.assertEqual(STOP_MAX_PAGES, report.stopReason)

    def test_stops_when_page_repeats(self):
        crawler, fetcher = make_crawler(max_pages=5)
        fetcher.default = fixture("douban_listing_page1.html")
        events, report = crawler.crawl()
        self.assertEqual(STOP_NO_NEW_URLS, report.stopReason)
        self.assertEqual(2, report.pagesFetched)
        self.assertEqual(10, report.uniqueActivityUrls)

    def test_stops_on_empty_listing(self):
        crawler, fetcher = make_crawler(max_pages=5)
        fetcher.default = fixture("douban_listing_empty.html")
        events, report = crawler.crawl()
        self.assertEqual(STOP_EMPTY_LISTING, report.stopReason)
        self.assertEqual(0, report.uniqueActivityUrls)
        self.assertEqual([], events)

    def test_stops_on_last_page(self):
        def two_pages(html):
            return html.replace('data-total-page="153"', 'data-total-page="2"')
        crawler, fetcher = make_crawler(max_pages=9)
        fetcher.pages = {
            crawler.listing_url(1): two_pages(fixture("douban_listing_page1.html")),
            crawler.listing_url(2): two_pages(
                _renumber(fixture("douban_listing_page2.html"), 1000)),
        }
        crawler.fetchDetails = False
        events, report = crawler.crawl()
        self.assertEqual(STOP_NO_NEXT, report.stopReason)
        self.assertEqual(2, report.pagesFetched)
        self.assertEqual(20, report.uniqueActivityUrls)

    def test_out_of_range_offset_reports_no_more_pages(self):
        # The REAL ?start=1530 page of a 153-page source: zero rows, but the
        # site still renders a "next" control — so a loop that trusted the
        # control alone would never end. data-total-page must win.
        crawler, _ = make_crawler()
        listing = crawler.parse_listing(fixture("douban_listing_empty.html"),
                                        crawler.listing_url(154))
        self.assertEqual([], listing.entries)
        self.assertEqual(153, listing.totalPages)
        self.assertFalse(listing.hasNext)

    def test_repeated_listing_url_is_detected(self):
        class RepeatCrawler(DoubanCrawler):
            def listing_url(self, page):
                return self.base_url()      # never advances
        crawler = RepeatCrawler(max_pages=5, fetcher=FakeFetcher())
        crawler.fetcher.default = fixture("douban_listing_page1.html")
        events, report = crawler.crawl()
        self.assertEqual(STOP_REPEATED_LISTING, report.stopReason)
        self.assertEqual(1, report.pagesFetched)

    def test_detail_limit_stops_the_detail_pass(self):
        crawler, fetcher = make_crawler(max_pages=2)
        fetcher.default = fixture("douban_listing_page1.html")
        crawler.limitDetails = 4
        events, report = crawler.crawl()
        self.assertEqual(4, report.detailsFetched)
        self.assertEqual(4, len(events))
        self.assertEqual(STOP_DETAIL_LIMIT, report.stopReason)


# --- detail extraction -----------------------------------------------------

class DetailExtractionTest(unittest.TestCase):
    def setUp(self):
        self.crawler = DoubanCrawler(fetcher=FakeFetcher())
        listing = self.crawler.parse_listing(
            fixture("douban_listing_page1.html"), self.crawler.listing_url(1))
        self.entry = listing.entries[0]

    def test_detail_page_fields(self):
        event = self.crawler.parse_detail(
            fixture("douban_detail.html"), "https://www.douban.com/event/36988401/",
            self.entry)
        self.assertIsNotNone(event)
        self.assertEqual("36988401", event.sourceEventId)
        self.assertEqual("https://www.douban.com/event/36988401/", event.sourceUrl)
        self.assertEqual("豆瓣同城", event.sourceName)
        self.assertEqual("2026-10-01T08:00:00", event.startTime)
        self.assertEqual("2026-12-24T19:00:00", event.endTime)
        self.assertEqual("上海", event.city)
        self.assertEqual("长宁", event.district)
        self.assertEqual("虹桥路地铁站3口", event.address)
        self.assertEqual("178元(活动费)", event.price)
        self.assertEqual("互助网周末活动", event.organizer)
        self.assertTrue(event.title)

    def test_venue_is_null_because_the_source_has_none(self):
        # 豆瓣 publishes one 地点 string and no venue field; splitting the
        # address into venue + street would be a guess, so it stays null.
        event = self.crawler.parse_detail(
            fixture("douban_detail.html"), "https://www.douban.com/event/36988401/",
            self.entry)
        self.assertIsNone(event.venueName)
        self.assertEqual("detail", event.rawData["fieldSources"]["address"])

    def test_every_field_is_traced_to_detail_or_listing(self):
        event = self.crawler.parse_detail(
            fixture("douban_detail.html"), "https://www.douban.com/event/36988401/",
            self.entry)
        sources = event.rawData["fieldSources"]
        for key in ("title", "startTime", "endTime", "city", "district",
                    "address", "price", "organizer"):
            self.assertIn(sources[key], ("detail", "listing"), key)
            self.assertTrue(getattr(event, key), key)

    def test_listing_hint_used_when_detail_missing_it(self):
        event = self.crawler.parse_detail(
            '<html><body><h1 itemprop="summary">只有标题</h1></body></html>',
            self.entry.url, self.entry)
        self.assertIsNotNone(event)
        self.assertEqual(self.entry.startTime, event.startTime)
        self.assertEqual(self.entry.district, event.district)
        self.assertEqual("listing", event.rawData["fieldSources"]["startTime"])
        self.assertIsNone(event.rawData["detail"]["streetAddress"])

    def test_detail_without_event_returns_none(self):
        self.assertIsNone(self.crawler.parse_detail(
            "<html><body><p>登录后才能查看</p></body></html>", self.entry.url, self.entry))

    def test_split_location_variants(self):
        self.assertEqual(("上海", "长宁", "虹桥路地铁站3口"),
                         split_location("上海 长宁区 虹桥路地铁站3口"))
        self.assertEqual(("上海", None, "某个地方"), split_location("上海 某个地方"))
        self.assertEqual(("上海", None, None), split_location("上海"))
        self.assertEqual((None, None, None), split_location(None))
        self.assertEqual((None, None, None), split_location("   "))


# --- duplicate URLs --------------------------------------------------------

class DuplicateUrlTest(unittest.TestCase):
    def test_canonical_url_collapses_tracking_and_slash(self):
        self.assertEqual(canonical_url("https://www.douban.com/event/36988401/"),
                         canonical_url("https://www.douban.com/event/36988401/?icn=list-shopitem"))
        self.assertEqual(canonical_url("http://douban.com/event/36988401/"),
                         canonical_url("https://www.douban.com/event/36988401"))
        self.assertIsNone(canonical_url(""))
        self.assertIsNone(canonical_url(None))

    def test_same_activity_twice_on_one_page_counts_once(self):
        crawler, _ = make_crawler()
        html = fixture("douban_listing_page1.html")
        doubled = html.replace(
            '<ul class="events-list events-list-pic100 events-list-psmall">',
            '<ul class="events-list events-list-pic100 events-list-psmall">'
            + '<li class="list-entry" itemscope itemtype="http://data-vocabulary.org/Event">'
            + '<a href="https://www.douban.com/event/36988401/?icn=list-shopitem">x</a>'
            + '<span itemprop="summary">重复行</span></li>')
        listing = crawler.parse_listing(doubled, crawler.listing_url(1))
        urls = [canonical_url(e.url) for e in listing.entries]
        self.assertEqual(len(urls), len(set(urls)) + 1)      # parser sees both

        report_urls = set()
        for entry in listing.entries:
            report_urls.add(canonical_url(entry.url))
        self.assertEqual(10, len(report_urls))               # dedupe collapses them

    def test_url_seen_on_two_pages_is_deduped(self):
        crawler, fetcher = make_crawler(max_pages=2)
        page1 = fixture("douban_listing_page1.html")
        page2 = fixture("douban_listing_page2.html")
        # Page 2 repeats one row from page 1 with a tracking suffix.
        first_url = "https://www.douban.com/event/36988401/"
        page2 = page2.replace("</ul>", '<li class="list-entry" itemscope>'
                              '<a href="%s?icn=list-shopitem">x</a>'
                              '<span itemprop="summary">重复</span>'
                              '<time itemprop="startDate" datetime="2026-10-01T08:00:00">'
                              '</time></li></ul>' % first_url, 1)
        fetcher.pages = {crawler.listing_url(1): page1, crawler.listing_url(2): page2}
        crawler.fetchDetails = False
        events, report = crawler.crawl()
        self.assertEqual(21, report.activitiesDiscovered)
        self.assertEqual(20, report.uniqueActivityUrls)
        self.assertEqual(20, len(events))


# --- malformed HTML --------------------------------------------------------

class MalformedHtmlTest(unittest.TestCase):
    def test_garbage_listing_does_not_raise(self):
        crawler, _ = make_crawler()
        for html in ("", "<html>", "<li class='list-entry' itemscope",
                     "<li class=\"list-entry\" itemscope><a href=\"/event/\">x</a>",
                     "<li class=\"list-entry\" itemscope>"
                     "<a href=\"https://www.douban.com/event/12/\">x</a>"
                     "<span itemprop=\"summary\">   </span>"):
            listing = crawler.parse_listing(html, "https://x/")
            self.assertEqual([], listing.entries)

    def test_truncated_detail_keeps_listing_values(self):
        crawler, _ = make_crawler()
        entry = ListingEntry(url="https://www.douban.com/event/1/", sourceEventId="1",
                             title="列表标题", startTime="2026-10-01T08:00:00",
                             district="静安", address="某地铁口", price="免费")
        event = crawler.parse_detail(
            '<html><body><h1 itemprop="summary">   </h1><div class="event-detail" itemprop',
            entry.url, entry)
        self.assertIsNone(event)     # blank title -> caller falls back to listing

    def test_detail_with_broken_microdata(self):
        crawler, _ = make_crawler()
        entry = ListingEntry(url="https://www.douban.com/event/1/", sourceEventId="1",
                             title="列表标题", startTime="2026-10-01T08:00:00",
                             district="静安")
        event = crawler.parse_detail(
            '<html><body><h1 itemprop="summary">真标题</h1>'
            '<span itemprop="region">上海&nbsp;</span>', entry.url, entry)
        self.assertEqual("真标题", event.title)
        self.assertEqual("上海", event.city)
        self.assertEqual("静安", event.district)     # from listing, not guessed
        self.assertIsNone(event.address)
        self.assertEqual("listing", event.rawData["fieldSources"]["district"])

    def test_unknown_second_token_is_not_a_district(self):
        # "某地" is not a Shanghai district, so it stays part of the address
        # instead of being promoted to a district.
        self.assertEqual((None, None, "某地 别的"), split_location("外太空 某地 别的"))


# --- source unavailable ----------------------------------------------------

class SourceUnavailableTest(unittest.TestCase):
    def _blocked(self, reason, status):
        crawler, fetcher = make_crawler(max_pages=5)
        fetcher.default = lambda url: failed_result(url, reason, "nope", status=status)
        events, report = crawler.crawl()
        return events, report, fetcher

    def test_403_stops_immediately(self):
        events, report, fetcher = self._blocked(REASON_BLOCKED, 403)
        self.assertEqual([], events)
        self.assertEqual(STOP_BLOCKED, report.stopReason)
        self.assertEqual(0, report.pagesFetched)
        self.assertEqual(1, len(fetcher.calls))     # never retried past the wall

    def test_429_stops_immediately(self):
        events, report, fetcher = self._blocked(REASON_BLOCKED, 429)
        self.assertEqual([], events)
        self.assertEqual(STOP_BLOCKED, report.stopReason)
        self.assertEqual(1, len(fetcher.calls))

    def test_http_error_stops_the_discovery_pass(self):
        events, report, fetcher = self._blocked(REASON_HTTP_ERROR, 500)
        self.assertEqual([], events)
        self.assertEqual(STOP_SOURCE_UNAVAILABLE, report.stopReason)
        self.assertEqual(1, len(fetcher.calls))
        self.assertEqual("listing", report.failures[0]["stage"])

    def test_timeout_stops_the_discovery_pass(self):
        events, report, _ = self._blocked(REASON_TIMEOUT, None)
        self.assertEqual([], events)
        self.assertEqual(STOP_SOURCE_UNAVAILABLE, report.stopReason)

    def test_captcha_page_is_not_parsed(self):
        crawler, fetcher = make_crawler(max_pages=5)
        wall = ("<html><head><title>安全验证</title></head><body>"
                "<p>请完成验证后继续访问</p>"
                "<li class=\"list-entry\" itemscope><a href="
                "\"https://www.douban.com/event/1/\">x</a>"
                "<span itemprop=\"summary\">假活动</span></li></body></html>")
        fetcher.default = wall
        events, report = crawler.crawl()
        self.assertEqual([], events)
        self.assertEqual(STOP_BLOCKED, report.stopReason)
        self.assertEqual(REASON_BLOCKED, report.failures[0]["reason"])

    def test_detail_failure_falls_back_to_listing(self):
        crawler, fetcher = make_crawler(max_pages=1)
        fetcher.pages = {crawler.listing_url(1): fixture("douban_listing_page1.html")}
        broken = "https://www.douban.com/event/36988401/"
        detail = fixture("douban_detail.html")

        def default(url):
            if url == broken:
                return failed_result(url, REASON_TIMEOUT, "slow")
            return ok_result(url, detail)

        fetcher.default = default
        events, report = crawler.crawl()
        self.assertEqual(10, len(events))            # discovered rows are kept
        self.assertEqual(1, report.failed)
        self.assertEqual(9, report.success)
        broken_events = [e for e in events if e.sourceUrl == broken]
        self.assertEqual(1, len(broken_events))
        self.assertFalse(broken_events[0].rawData["detailFetched"])
        self.assertEqual("listing", broken_events[0].rawData["fieldSources"]["title"])
        self.assertEqual("36988401", broken_events[0].sourceEventId)

    def test_repeated_detail_failures_stop_the_run(self):
        crawler, fetcher = make_crawler(max_pages=1, limit_details=None)
        fetcher.pages = {crawler.listing_url(1): fixture("douban_listing_page1.html")}
        fetcher.default = lambda url: failed_result(url, REASON_TIMEOUT, "slow")
        events, report = crawler.crawl()
        self.assertEqual(MAX_CONSECUTIVE_FAILURES, report.detailsFetched)
        self.assertEqual(MAX_CONSECUTIVE_FAILURES, len(events))
        self.assertEqual("repeated_failures", report.stopReason)


# --- report ----------------------------------------------------------------

class ReportTest(unittest.TestCase):
    def test_missing_counters_are_counted_not_guessed(self):
        crawler, fetcher = make_crawler(max_pages=1)
        fetcher.pages = {crawler.listing_url(1): fixture("douban_listing_page1.html")}
        fetcher.default = fixture("douban_detail.html")
        events, report = crawler.crawl()
        self.assertEqual(10, report.detailsFetched)
        self.assertEqual(10, report.success)
        self.assertEqual(0, report.failed)
        self.assertEqual(0, report.missingDate)
        self.assertEqual(0, report.missingAddress)
        # Every row: 豆瓣 publishes no venue field, so this is 10 by design.
        self.assertEqual(10, report.missingVenue)

    def test_listing_only_run_reports_zero_detail_success(self):
        crawler, fetcher = make_crawler(max_pages=1)
        fetcher.default = fixture("douban_listing_page1.html")
        crawler.fetchDetails = False
        events, report = crawler.crawl()
        self.assertEqual(10, len(events))
        self.assertEqual(0, report.detailsFetched)
        self.assertEqual(0, report.success)     # nothing was read off a detail page
        self.assertEqual(10, report.missingVenue)

    def test_report_is_json_serialisable(self):
        crawler, fetcher = make_crawler(max_pages=1)
        fetcher.default = fixture("douban_listing_page1.html")
        crawler.fetchDetails = False
        events, report = crawler.crawl()
        import json
        payload = json.loads(json.dumps(report.to_dict(), ensure_ascii=False))
        self.assertEqual(10, payload["uniqueActivityUrls"])
        self.assertEqual([json.loads(json.dumps(e.to_dict(), ensure_ascii=False))
                          for e in events][0]["sourceEventId"], "36988401")


if __name__ == "__main__":
    unittest.main()
