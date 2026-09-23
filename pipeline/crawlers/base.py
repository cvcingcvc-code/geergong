# Crawler base (REAL EVENT INDEX V1 — PHASE 1).
#
# The pagination / dedupe / stop-condition machinery, shared by every source.
# Subclasses supply exactly three things: the listing URL for a page number,
# a listing parser and a detail parser. They never re-implement the loop, so
# "stop on no-next-page / repeated page / maxPages / unavailable source" is
# one tested behaviour instead of one bug per source.
#
# Fetching reuses the existing PageFetcher (timeout, size cap, redirect limit,
# content-type gate, per-host politeness delay, failure isolation). No new
# HTTP code is introduced here, and nothing is done to get around a block:
# a captcha / login wall / 403 / 429 STOPS the crawl and is reported.

import time
import urllib.parse

from pipeline.crawlers.models import CrawlReport, RawEvent
from pipeline.search.fetcher import REASON_BLOCKED, PageFetcher
from pipeline.search.settings import SearchSettings

# Consecutive per-URL failures after which the crawl gives up. Continuing to
# hammer a source that has started refusing us is neither polite nor useful.
MAX_CONSECUTIVE_FAILURES = 5

# Stop reasons (closed vocabulary, so the report is machine-readable).
STOP_MAX_PAGES = "max_pages"
STOP_NO_NEXT = "no_next_page"
STOP_NO_NEW_URLS = "no_new_urls"
STOP_EMPTY_LISTING = "empty_listing"
STOP_REPEATED_LISTING = "repeated_listing_url"
STOP_SOURCE_UNAVAILABLE = "source_unavailable"
STOP_BLOCKED = "blocked"
STOP_REPEATED_FAILURES = "repeated_failures"
STOP_DETAIL_LIMIT = "detail_limit"


class SourceUnavailable(Exception):
    """The source stopped serving us. Fatal for the run, never retried."""

    def __init__(self, reason, detail=None, url=None, status=None):
        Exception.__init__(self, detail or reason)
        self.reason = reason
        self.detail = detail
        self.url = url
        self.status = status


def canonical_url(url):
    """Dedupe key for an activity URL.

    Douban (and most platforms) append tracking query strings
    (`?icn=list-shopitem`) to the SAME activity, so comparing raw URLs would
    keep duplicates. Scheme/host are lower-cased, a leading `www.` is dropped,
    query and fragment are removed and a trailing slash is normalised.
    """
    if not url or not isinstance(url, str):
        return None
    try:
        parts = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return None
    if not parts.netloc:
        return None
    host = parts.netloc.casefold()
    if host.startswith("www."):
        host = host[4:]
    path = parts.path.rstrip("/")
    return urllib.parse.urlunsplit(("https", host, path, "", ""))


class BaseCrawler(object):
    """listing page -> activity URLs -> dedupe -> detail page -> RawEvent."""

    name = "base"
    sourceName = None

    def __init__(self, city="上海", max_pages=10, settings=None, fetcher=None,
                 fetch_details=True, limit_details=None, politeness_delay=None):
        self.city = city
        self.settings = settings or SearchSettings(online=True)
        # PageFetcher is the project's existing fetcher: reuse, do not rewrite.
        # PHASE 5: an explicit politeness_delay slows per-host pacing for
        # sources that rate-limit long detail runs (douban tripped at 0.4s).
        if fetcher is not None:
            self.fetcher = fetcher
        elif politeness_delay is not None:
            self.fetcher = PageFetcher(self.settings,
                                       politeness_delay=politeness_delay)
        else:
            self.fetcher = PageFetcher(self.settings)
        self.maxPages = max(1, int(max_pages or 1))
        self.fetchDetails = bool(fetch_details)
        self.limitDetails = limit_details
        self.report = None

    # -- source-specific (subclasses implement) ---------------------------

    def listing_url(self, page):  # pragma: no cover - abstract
        raise NotImplementedError

    def parse_listing(self, html, url):  # pragma: no cover - abstract
        """-> ListingPage"""
        raise NotImplementedError

    def parse_detail(self, html, url, entry):  # pragma: no cover - abstract
        """-> RawEvent (or None when the page carries no activity)."""
        raise NotImplementedError

    # -- fetching ---------------------------------------------------------

    def _fetch(self, url):
        """-> (html|None, PageFetchResult). Raises SourceUnavailable when the
        source has put up a wall: that is a stop, not a retry."""
        result = self.fetcher.fetch(url)
        if not result.ok:
            if result.reason == REASON_BLOCKED:
                raise SourceUnavailable(result.reason, result.detail, url=url,
                                        status=result.status)
            return None, result
        from pipeline.search.extract import looks_like_challenge
        if looks_like_challenge(result.html, url=result.finalUrl or url):
            raise SourceUnavailable(REASON_BLOCKED,
                                    "anti-bot / verification page", url=url,
                                    status=result.status)
        return result.html, result

    # -- discovery --------------------------------------------------------

    def discover(self, report):
        """Walk listing pages until a stop condition. -> list[ListingEntry]."""
        entries = []
        seen_urls = set()
        seen_listings = set()
        page = 1
        while page <= self.maxPages:
            url = self.listing_url(page)
            # Listing URLs are compared as written: unlike activity URLs they
            # carry a real `?start=` offset, and canonical_url() deliberately
            # drops the query (that is what collapses tracking-suffixed
            # activity links into one).
            key = (url or "").strip()
            if key in seen_listings:
                report.stopReason = STOP_REPEATED_LISTING
                break
            seen_listings.add(key)
            try:
                html, result = self._fetch(url)
            except SourceUnavailable as exc:
                report.failures.append({"stage": "listing", "url": url,
                                        "reason": exc.reason,
                                        "detail": exc.detail})
                report.stopReason = (STOP_BLOCKED if exc.reason == REASON_BLOCKED
                                     else STOP_SOURCE_UNAVAILABLE)
                break
            if html is None:
                report.failures.append({"stage": "listing", "url": url,
                                        "reason": result.reason,
                                        "detail": result.detail})
                report.stopReason = STOP_SOURCE_UNAVAILABLE
                break

            report.pagesFetched += 1
            report.listingUrls.append(url)
            try:
                listing = self.parse_listing(html, url)
            except Exception as exc:  # noqa: BLE001 - parser boundary
                report.failures.append({"stage": "listing-parse", "url": url,
                                        "reason": "parse_error",
                                        "detail": repr(exc)[:200]})
                report.stopReason = STOP_SOURCE_UNAVAILABLE
                break

            report.activitiesDiscovered += len(listing.entries)
            fresh = []
            for entry in listing.entries:
                ckey = canonical_url(entry.url)
                if not ckey or ckey in seen_urls:
                    continue
                seen_urls.add(ckey)
                fresh.append(entry)
            entries.extend(fresh)

            if not listing.entries:
                report.stopReason = STOP_EMPTY_LISTING
                break
            # "The source says this was the last page" is a stronger statement
            # than "these rows looked familiar", so it is checked first: with
            # data-total-page in hand, an out-of-range offset is reported as
            # no_next_page rather than as a duplicate page.
            if not listing.hasNext:
                report.stopReason = STOP_NO_NEXT
                break
            if not fresh:
                # Same rows as a page we already have: the source is no longer
                # advancing, and continuing would loop forever over them.
                report.stopReason = STOP_NO_NEW_URLS
                break
            if page >= self.maxPages:
                report.stopReason = STOP_MAX_PAGES
                break
            page += 1

        report.uniqueActivityUrls = len(seen_urls)
        return entries

    # -- detail pass ------------------------------------------------------

    def _event_from_listing(self, entry):
        """RawEvent built from listing hints only.

        Used when the detail page is not fetched or could not be read, so a
        discovered activity is never dropped just because one request failed.
        Every value here came off the source's own listing row.
        """
        return RawEvent(
            title=entry.title,
            startTime=entry.startTime,
            endTime=entry.endTime,
            city=entry.city,
            district=entry.district,
            venueName=None,      # no source publishes a venue on a listing row
            address=entry.address,
            price=entry.price,
            organizer=entry.organizer,
            sourceName=self.sourceName,
            sourceUrl=entry.url,
            sourceEventId=entry.sourceEventId,
            rawData={"listing": entry.to_dict(),
                     "detailFetched": False,
                     "fieldSources": {k: "listing" for k in (
                         "title", "startTime", "endTime", "city", "district",
                         "address", "price", "organizer") if getattr(entry, k)}},
        )

    def fetch_details(self, entries, report):
        """-> list[RawEvent] in discovery order."""
        events = []
        consecutive = 0
        for entry in entries:
            if self.limitDetails and len(events) >= self.limitDetails:
                report.stopReason = STOP_DETAIL_LIMIT
                break
            report.detailsFetched += 1
            try:
                html, result = self._fetch(entry.url)
            except SourceUnavailable as exc:
                report.failures.append({"stage": "detail", "url": entry.url,
                                        "reason": exc.reason,
                                        "detail": exc.detail})
                report.stopReason = (STOP_BLOCKED if exc.reason == REASON_BLOCKED
                                     else STOP_SOURCE_UNAVAILABLE)
                break
            if html is None:
                report.failed += 1
                consecutive += 1
                report.failures.append({"stage": "detail", "url": entry.url,
                                        "reason": result.reason,
                                        "detail": result.detail,
                                        "fallback": "listing"})
                events.append(self._event_from_listing(entry))
                if consecutive >= MAX_CONSECUTIVE_FAILURES:
                    report.stopReason = STOP_REPEATED_FAILURES
                    break
                continue

            consecutive = 0
            try:
                event = self.parse_detail(html, entry.url, entry)
            except Exception as exc:  # noqa: BLE001 - parser boundary
                report.failed += 1
                report.failures.append({"stage": "detail-parse", "url": entry.url,
                                        "reason": "parse_error",
                                        "detail": repr(exc)[:200],
                                        "fallback": "listing"})
                events.append(self._event_from_listing(entry))
                continue
            if event is None:
                report.failed += 1
                report.failures.append({"stage": "detail", "url": entry.url,
                                        "reason": "no_activity",
                                        "detail": "detail page carried no event",
                                        "fallback": "listing"})
                events.append(self._event_from_listing(entry))
                continue
            events.append(event)
        return events

    # -- entry point ------------------------------------------------------

    def crawl(self):
        self.report = CrawlReport(source=self.name, city=self.city,
                                  maxPages=self.maxPages,
                                  startedAt=_now())
        report = self.report
        entries = self.discover(report)
        if self.fetchDetails:
            events = self.fetch_details(entries, report)
        else:
            events = [self._event_from_listing(e) for e in entries]
        report.finishedAt = _now()
        report.finish(events)
        return events, report


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")
