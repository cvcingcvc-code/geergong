# 豆瓣同城 crawler (REAL EVENT INDEX V1 — PHASE 1).
#
# Entry point: https://shanghai.douban.com/events/future-all
#
# Every rule below was read off the LIVE page (see docs/REAL_SOURCE_Douban.md),
# not from memory and not from a fixture. Where the source does not publish a
# fact, the field stays null — in particular 豆瓣 publishes ONE 地点 string
# (region + locality + street-address) and NO separate venue field, so
# venueName is always null rather than being split out of the address by
# guesswork.
#
# Pagination is offset based: `?start=<offset>`, PAGE_SIZE rows per page.

import html as _html
import re
import urllib.parse

from pipeline.crawlers.base import BaseCrawler
from pipeline.crawlers.models import ListingEntry, ListingPage, RawEvent
from pipeline.normalize.location import normalize_city, normalize_district
from pipeline.search import textnorm

_TAG_RE = re.compile(r"<[^>]+>")

# --- listing page ----------------------------------------------------------

# 10 rows per page on the live site (verified: data-total-page=153, offsets
# 0/10/20/.../1520).
PAGE_SIZE = 10

# Only the main result list carries the Event microdata; the sidebar's
# "ticket shop" rows are plain `<li class="... list-entry">` WITHOUT
# `itemscope`, and they repeat unchanged on every page — matching on
# `itemscope` is what keeps them out.
_ENTRY_START_RE = re.compile(r'<li class="list-entry"\s+itemscope[^>]*>', re.S)

# The id is what identifies the activity, so the URL is rebuilt from it: rows
# that carry a `?icn=list-shopitem` suffix are then the SAME activity as the
# clean URL, instead of a second one.
_DB_LINK_RE = re.compile(r'href="https://www\.douban\.com/event/(\d+)/?[^"]*"')
_DB_URL_TEMPLATE = "https://www.douban.com/event/%s/"
_DB_TITLE_RE = re.compile(r'<span itemprop="summary">(.*?)</span>', re.S)
_DB_START_RE = re.compile(r'itemprop="startDate"\s+datetime="([^"]+)"')
_DB_END_RE = re.compile(r'itemprop="endDate"\s+datetime="([^"]+)"')
# The location row states the whole place in its title attribute:
# title="上海 长宁区 虹桥路地铁站3口"
_DB_LOC_RE = re.compile(r'<li title="([^"]{4,200})"')
_DB_FEE_RE = re.compile(r'<li class="fee">(.*?)</li>', re.S)
_DB_OWNER_RE = re.compile(
    r'<span class="meta-title">\s*发起：\s*</span>\s*<a[^>]*>(.*?)</a>', re.S)
_DB_IMG_RE = re.compile(r'<img[^>]+data-lazy="([^"]+)"', re.S)

# Pagination
_TOTAL_PAGE_RE = re.compile(r'data-total-page="(\d+)"')
_NEXT_HREF_RE = re.compile(r'<span class="next">.*?href="\?start=(\d+)"', re.S)

# --- detail page -----------------------------------------------------------

_D_TITLE_RE = re.compile(r'<h1 itemprop="summary">(.*?)</h1>', re.S)
_D_START_RE = re.compile(r'<time itemprop="startDate" datetime="([^"]+)"')
_D_END_RE = re.compile(r'<time itemprop="endDate" datetime="([^"]+)"')
_D_REGION_RE = re.compile(r'itemprop="region"[^>]*>(.*?)</span>', re.S)
_D_LOCALITY_RE = re.compile(r'itemprop="locality"[^>]*>(.*?)</span>', re.S)
_D_STREET_RE = re.compile(r'itemprop="street-address"[^>]*>(.*?)</span>', re.S)
_D_FEE_RE = re.compile(r'itemprop="ticketAggregate"[^>]*>(.*?)</span>', re.S)
_D_TYPE_RE = re.compile(r'itemprop="eventType"[^>]*>(.*?)</a>', re.S)
_D_ORG_RE = re.compile(r'主办方.{0,200}?itemprop="name"[^>]*>(.*?)</a>', re.S)

# "费用：", "费用:" and the &nbsp; padding the site puts after the label.
_LABEL_RE = re.compile(r'^\s*(?:费用|主办方|地点|类型)\s*[：:]\s*')
_NBSP_RE = re.compile(r"[ \s]+")


def _text(value):
    """HTML fragment -> single-line text. Blank stays None (missing is missing).

    HTML tags are removed FIRST: textnorm.strip_markup() is a Markdown
    cleaner and would happily leave `<strong>79元</strong>` intact.
    """
    if value is None:
        return None
    text = _html.unescape(str(value))
    text = _TAG_RE.sub(" ", text)          # <strong>79元</strong> -> 79元
    text = textnorm.strip_markup(text)     # markdown noise the source wrote
    text = textnorm.normalize_whitespace(text, keep_newlines=False)
    if not text:
        return None
    return text.strip()


def _first(html, pattern, cleaner=_text):
    """First capture group of `pattern` in the page, cleaned, or None."""
    match = pattern.search(html or "")
    if not match:
        return None
    return cleaner(match.group(1))


def _clean_label(value):
    """Drop a leading 费用/主办方/... label the site renders inside the field."""
    text = _text(value)
    if not text:
        return None
    return _LABEL_RE.sub("", text).strip() or None


def split_location(raw):
    """'上海 长宁区 虹桥路地铁站3口' -> (city, district, address).

    Purely structural: the source's own space-separated region / locality /
    place triple. A second token that is NOT a recognised district is not
    treated as one — it stays part of the address instead.
    """
    if not raw:
        return None, None, None
    parts = _NBSP_RE.split(_text(raw) or "")
    parts = [p for p in parts if p]
    if not parts:
        return None, None, None
    city = normalize_city(parts[0])
    if len(parts) == 1:
        return city, None, None
    district = None
    rest = parts[1:]
    if len(parts) >= 3 and normalize_district(parts[1]):
        district = normalize_district(parts[1])
        rest = parts[2:]
    address = " ".join(rest).strip() or None
    return city, district, address


class DoubanCrawler(BaseCrawler):
    """豆瓣同城 — 上海 future-all listing, real pagination, real detail pages."""

    name = "douban"
    sourceName = "豆瓣同城"

    CITY_SLUGS = {
        "上海": "shanghai", "北京": "beijing", "广州": "guangzhou",
        "深圳": "shenzhen", "杭州": "hangzhou", "成都": "chengdu",
        "南京": "nanjing", "武汉": "wuhan", "西安": "xian",
        "苏州": "suzhou", "重庆": "chongqing", "长沙": "changsha",
        "天津": "tianjin", "青岛": "qingdao",
    }

    def __init__(self, city="上海", max_pages=10, path="future-all", **kwargs):
        BaseCrawler.__init__(self, city=city, max_pages=max_pages, **kwargs)
        self.path = path

    # -- URLs ---------------------------------------------------------------

    @property
    def slug(self):
        return self.CITY_SLUGS.get(self.city, "shanghai")

    def base_url(self):
        return "https://%s.douban.com/events/%s" % (self.slug, self.path)

    def listing_url(self, page):
        """Page 1 is the bare list URL; page N adds the real `?start=` offset."""
        page = max(1, int(page or 1))
        base = self.base_url()
        if page == 1:
            return base
        return "%s?start=%d" % (base, (page - 1) * PAGE_SIZE)

    def _page_from_url(self, url):
        """Page number back out of a listing URL (used for the hasNext rule)."""
        try:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url or "").query)
        except ValueError:
            return 1
        raw = (query.get("start") or ["0"])[0]
        try:
            return int(raw) // PAGE_SIZE + 1
        except (TypeError, ValueError):
            return 1

    # -- listing ------------------------------------------------------------

    def parse_listing(self, html, url):
        starts = [m.start() for m in _ENTRY_START_RE.finditer(html or "")]
        entries = []
        for i, start in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else min(len(html), start + 8000)
            entry = self._parse_entry(html[start:end])
            if entry:
                entries.append(entry)

        total = None
        total_match = _TOTAL_PAGE_RE.search(html or "")
        if total_match:
            total = int(total_match.group(1))

        page = self._page_from_url(url)
        if total:
            # The page states how many pages exist: trust that over the
            # "next" control, which the site keeps rendering past the end.
            has_next = page < total
        else:
            has_next = bool(_NEXT_HREF_RE.search(html or ""))
        return ListingPage(url=url, entries=entries, totalPages=total,
                           hasNext=has_next)

    def _parse_entry(self, block):
        link = _DB_LINK_RE.search(block)
        if not link:
            return None
        title_match = _DB_TITLE_RE.search(block)
        title = _text(title_match.group(1)) if title_match else None
        if not title:
            return None                   # no summary -> not an activity row
        start_match = _DB_START_RE.search(block)
        end_match = _DB_END_RE.search(block)
        loc_match = _DB_LOC_RE.search(block)
        city, district, address = split_location(
            loc_match.group(1) if loc_match else None)
        fee_match = _DB_FEE_RE.search(block)
        owner_match = _DB_OWNER_RE.search(block)
        img_match = _DB_IMG_RE.search(block)
        event_id = link.group(1)
        return ListingEntry(
            url=_DB_URL_TEMPLATE % event_id,
            sourceEventId=event_id,
            title=title,
            startTime=start_match.group(1) if start_match else None,
            endTime=end_match.group(1) if end_match else None,
            city=city,
            district=district,
            address=address,
            price=_clean_label(fee_match.group(1)) if fee_match else None,
            organizer=_text(owner_match.group(1)) if owner_match else None,
            imageUrl=img_match.group(1) if img_match else None,
        )

    # -- detail -------------------------------------------------------------

    def parse_detail(self, html, url, entry):
        title_match = _D_TITLE_RE.search(html)
        if not title_match:
            return None          # not an activity page — caller keeps the hint
        title = _text(title_match.group(1))
        if not title:
            return None

        start_match = _D_START_RE.search(html)
        end_match = _D_END_RE.search(html)
        region = _first(html, _D_REGION_RE)
        locality = _first(html, _D_LOCALITY_RE)
        street = _first(html, _D_STREET_RE)
        fee = _first(html, _D_FEE_RE, cleaner=_clean_label)
        etype = _first(html, _D_TYPE_RE)
        org = _first(html, _D_ORG_RE)

        city = normalize_city(region) if region else None
        district = normalize_district(locality) if locality else None

        # Detail wins; a listing hint is used only for a field the detail page
        # did not state. fieldSources records which one it was.
        sources = {}
        values = {
            "title": (title, entry.title),
            "startTime": (start_match.group(1) if start_match else None, entry.startTime),
            "endTime": (end_match.group(1) if end_match else None, entry.endTime),
            "city": (city, entry.city),
            "district": (district, entry.district),
            "address": (street, entry.address),
            "price": (fee, entry.price),
            "organizer": (org, entry.organizer),
        }
        resolved = {}
        for key, (detail_value, hint_value) in values.items():
            if detail_value:
                resolved[key] = detail_value
                sources[key] = "detail"
            elif hint_value:
                resolved[key] = hint_value
                sources[key] = "listing"
            else:
                resolved[key] = None

        return RawEvent(
            title=resolved["title"],
            startTime=resolved["startTime"],
            endTime=resolved["endTime"],
            city=resolved["city"],
            district=resolved["district"],
            # 豆瓣 publishes no venue field distinct from the address.
            venueName=None,
            address=resolved["address"],
            price=resolved["price"],
            organizer=resolved["organizer"],
            sourceName=self.sourceName,
            sourceUrl=url,
            sourceEventId=entry.sourceEventId,
            rawData={
                "listing": entry.to_dict(),
                "detail": {
                    "title": title,
                    "startTime": start_match.group(1) if start_match else None,
                    "endTime": end_match.group(1) if end_match else None,
                    "region": region,
                    "locality": locality,
                    "streetAddress": street,
                    "price": fee,
                    "category": etype,
                    "organizer": org,
                },
                "detailFetched": True,
                "fieldSources": sources,
            },
        )


CRAWLERS = {"douban": DoubanCrawler}


def build_crawler(name, city="上海", max_pages=10, **kwargs):
    """Factory used by the CLI. Unknown source -> KeyError, not a silent default."""
    return CRAWLERS[name](city=city, max_pages=max_pages, **kwargs)
