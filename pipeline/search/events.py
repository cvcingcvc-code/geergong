# EventExtractor (PHASE 5).
#
# A search result is NOT an event. This module turns a fetched page (plus the
# listing-row hint the provider saw) into the raw activity fields the
# EXISTING pipeline already understands — and nothing else.
#
# Hard rule, repeated in every branch below: if a value is not present in the
# source, the field is None. No inference from context, no "it's probably in
# Shanghai because the query said Shanghai", no LLM. Every extracted value
# also carries the field source (`fieldSources`) so the Detail page and the
# Human Review console can show exactly where each fact came from.
#
# Extraction order per field (first hit wins):
#   1. JSON-LD  Event node            (schema.org, machine-declared)
#   2. embedded page state JSON       (the site's own record, e.g. ativityJson)
#   3. listing-row hint from search   (what the search result itself said)
#   4. labelled page text             (only for date/time/price/venue, and
#                                      only when the label is explicit)
# Everything else -> None.

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from pipeline.search import placeholders
from pipeline.search.extract import IMG_PLACEHOLDER

# Provenance labels attached to individual extracted values.
SRC_JSONLD = "json-ld"
SRC_EMBEDDED = "embedded"
SRC_LISTING = "listing"
SRC_TEXT = "page-text"
SRC_META = "meta"

_ISO_DATE_RE = re.compile(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})")
_ISO_TIME_RE = re.compile(r"[T ](\d{1,2}):(\d{2})")
_DATE_TOKEN_RE = re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{1,2})[/\-.](\d{1,2})")
_TIME_TOKEN_RE = re.compile(r"(\d{1,2}[:：]\d{2})")
_TIME_RANGE_RE = re.compile(r"(\d{1,2}[:：]\d{2})\s*[-–—~至到]\s*(\d{1,2}[:：]\d{2})")

# Strings a source uses INSTEAD of telling us the value. They must be
# treated as "unknown", not stored as an address.
_PLACEHOLDER_TEXT = (
    "报名后可查看", "报名后可见", "登录后查看", "登录可见", "请登录",
    "暂无", "待定", "tbd", "to be announced", "见活动详情", "详见活动",
    "点击查看", "扫码查看", "保密", "n/a",
)

# Keys inside an embedded JSON record that we know how to read. The mapping
# is intentionally explicit: guessing at unknown key names would be exactly
# the kind of "invented fact" the contract forbids.
_EMBED_TITLE = ("title", "name", "eventname", "eventtitle", "activityname", "subject")
_EMBED_DESC = ("summary", "description", "desc", "intro", "content", "detail",
               "parsedtext", "parsed_text", "detailtext")
_EMBED_CITY = ("cityname", "city_name", "city", "district", "area")
_EMBED_PROVINCE = ("province", "region", "state")
_EMBED_ADDRESS = ("address", "addressdetail", "address_detail", "location",
                  "venueaddress", "venue_address", "addr", "fulladdress")
_EMBED_VENUE = ("venuename", "venue_name", "venue", "placename", "place_name",
                "hallname", "locationname", "location_name")
_EMBED_START = ("start", "starttime", "start_time", "begintime", "begin_time",
                "startdate", "start_date", "begindate", "begin_date", "holdtime",
                "hold_time")
_EMBED_END = ("end", "endtime", "end_time", "finishtime", "finish_time",
              "enddate", "end_date", "finishdate")
_EMBED_START_SHORT = ("startshort", "start_str", "startstr", "timestr", "starttext")
_EMBED_END_SHORT = ("endshort", "end_str", "endstr", "endtext")
_EMBED_TAGS = ("tag", "tags", "h dxtags", "keywords", "category", "topics")
_EMBED_PRICE = ("price", "pricestr", "price_str", "minprice", "fee", "cost")
_EMBED_REG_URL = ("signurl", "sign_url", "realsignurl", "real_sign_url",
                  "regurl", "registrationurl", "registration_url", "signupurl",
                  "applyurl", "ticketurl", "activityurl", "realactivityurl")
_EMBED_ORG = ("organizer", "organizers", "host", "hostname", "host_name",
              "creator", "publisher", "company", "sponsor")
_EMBED_IMAGE = ("bannerurl", "banner_url", "cover", "coverurl", "cover_url",
                "logo", "logourl", "poster", "image", "picture", "banner")


def _is_placeholder_text(value):
    if not value:
        return True
    text = str(value).strip().casefold()
    if len(text) < 2:
        return True
    return any(token.casefold() in text for token in _PLACEHOLDER_TEXT)


def _first_present(mapping, keys):
    """First non-empty value among `keys`, compared case-insensitively."""
    if not isinstance(mapping, dict):
        return None, None
    lowered = {str(k).casefold(): v for k, v in mapping.items()}
    for key in keys:
        if key in lowered:
            value = lowered[key]
            if isinstance(value, (list, tuple)):
                value = value[0] if value else None
            if isinstance(value, dict):
                continue
            if value not in (None, "", []):
                return value, key
    return None, None


# --- date / time ------------------------------------------------------------

def _epoch_ms(value):
    """Epoch (seconds or milliseconds) -> aware datetime in Beijing time.

    Handles all three shapes real platforms use:
        \\/Date(1789880400000)\\/      Microsoft JSON date (ms)
        1792108800                     unix seconds
        "1789880400000"                stringified ms
    """
    ms = None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        ms = float(value)
    else:
        text = str(value or "")
        m = re.search(r"\((\d{9,13})\)", text)
        if m:
            ms = float(m.group(1))
        elif re.fullmatch(r"\d{9,13}", text.strip()):
            ms = float(text.strip())
    if ms is None:
        return None
    if ms < 10 ** 11:      # seconds, not milliseconds
        ms *= 1000.0
    try:
        moment = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    # Event platforms publish Beijing wall-clock; the epoch is UTC.
    return moment + timedelta(hours=8)


def _split_iso(value):
    """'2026-09-20T14:00:00+08:00' -> ('2026-09-20', '14:00')."""
    if not value:
        return None, None
    text = str(value)
    md = _ISO_DATE_RE.search(text)
    mt = _ISO_TIME_RE.search(text)
    ds = "%s-%02d-%02d" % (md.group(1), int(md.group(2)), int(md.group(3))) if md else None
    ts = "%02d:%02d" % (int(mt.group(1)), int(mt.group(2))) if mt else None
    return ds, ts


def _split_short(value):
    """'2026-10-16 周五 08:00' -> ('2026-10-16', '08:00'); '09/20 13:00' likewise.

    Full ISO dates are matched FIRST: the short-date pattern would otherwise
    happily read "26-07" out of "2026-07-21".
    """
    if not value:
        return None, None
    text = str(value).strip()
    md = _ISO_DATE_RE.search(text)
    if md:
        ds = "%s-%02d-%02d" % (md.group(1), int(md.group(2)), int(md.group(3)))
    else:
        token = _DATE_TOKEN_RE.search(text)
        ds = token.group(0) if token else None
    mt = _TIME_RANGE_RE.search(text) or _TIME_TOKEN_RE.search(text)
    ts = mt.group(0) if mt else None
    return ds, ts


def _from_range(value):
    """'14:00-17:00' -> ('14:00', '17:00')."""
    if not value:
        return None, None
    m = _TIME_RANGE_RE.search(str(value))
    if m:
        return m.group(1).replace("：", ":"), m.group(2).replace("：", ":")
    m = _TIME_TOKEN_RE.search(str(value))
    return (m.group(1).replace("：", ":"), None) if m else (None, None)


# --- JSON-LD ----------------------------------------------------------------

def _jsonld_location(node):
    loc = node.get("location") if isinstance(node, dict) else None
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    if not isinstance(loc, dict):
        return {}
    address = loc.get("address")
    if isinstance(address, list):
        address = address[0] if address else None
    if not isinstance(address, dict):
        address = {}
    return {
        "venue": loc.get("name"),
        "street": address.get("streetAddress"),
        "locality": address.get("addressLocality"),
        "region": address.get("addressRegion"),
    }


def _jsonld_offers(node):
    offers = node.get("offers") if isinstance(node, dict) else None
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if not isinstance(offers, dict):
        return {}
    return {
        "price": offers.get("price") or offers.get("lowPrice"),
        "currency": offers.get("priceCurrency"),
        "url": offers.get("url"),
        "availability": offers.get("availability"),
    }


def _jsonld_organizer(node):
    org = node.get("organizer") if isinstance(node, dict) else None
    if isinstance(org, list):
        org = org[0] if org else None
    if isinstance(org, dict):
        return org.get("name")
    if isinstance(org, str):
        return org
    return None


# --- text signals -----------------------------------------------------------

# Only explicit "label + value" lines are read; a loose sentence is not a fact.
_LABELS = {
    "date": ("活动时间", "举办时间", "时间", "日期", "开始时间", "date", "when"),
    "price": ("票价", "费用", "价格", "门票", "price", "fee"),
    "venue": ("活动地点", "地点", "场地", "地址", "location", "venue", "address"),
    "organizer": ("主办方", "主办", "组织者", "organizer", "host"),
}


def _labelled(text, keys):
    """Return the text following the first `label:` occurrence."""
    if not text:
        return None
    for label in keys:
        pattern = re.compile(re.escape(label) + r"\s*[:：]?\s*([^\n]{2,80})")
        m = pattern.search(text)
        if m:
            value = m.group(1).strip(" ·|-,，。")
            if value and not _is_placeholder_text(value):
                return value
    return None


# --- main ------------------------------------------------------------------

@dataclass
class ExtractedEvent:
    """Raw activity fields taken verbatim from the source. Missing = None."""
    sourceUrl: str = None
    title: str = None
    description: str = None
    rawDate: str = None
    rawTime: str = None
    rawEndTime: str = None
    rawEndDate: str = None
    city: str = None
    district: str = None
    venue: str = None
    address: str = None
    rawPrice: str = None
    organizer: str = None
    registrationUrl: str = None
    publishedAt: str = None
    imageUrl: str = None
    imageSource: str = None
    imageType: str = None
    tags: list = field(default_factory=list)
    agenda: list = field(default_factory=list)
    fieldSources: dict = field(default_factory=dict)
    confidence: str = "thin"

    def to_dict(self):
        return {
            "sourceUrl": self.sourceUrl,
            "title": self.title,
            "description": self.description,
            "rawDate": self.rawDate,
            "rawTime": self.rawTime,
            "rawEndTime": self.rawEndTime,
            "rawEndDate": self.rawEndDate,
            "city": self.city,
            "district": self.district,
            "venue": self.venue,
            "address": self.address,
            "rawPrice": self.rawPrice,
            "organizer": self.organizer,
            "registrationUrl": self.registrationUrl,
            "publishedAt": self.publishedAt,
            "imageUrl": self.imageUrl,
            "imageSource": self.imageSource,
            "imageType": self.imageType,
            "tags": list(self.tags),
            "agenda": [dict(a) for a in self.agenda],
            "fieldSources": dict(self.fieldSources),
            "confidence": self.confidence,
        }

    def filled_fields(self):
        names = ["title", "description", "rawDate", "rawTime", "venue", "address",
                 "district", "city", "rawPrice", "organizer", "sourceUrl",
                 "imageUrl"]
        return [n for n in names if getattr(self, n)]


class EventExtractor(object):
    """PageMetadata (+ listing hint) -> ExtractedEvent. Never guesses."""

    name = "event-extractor"

    def __init__(self, today=None, placeholder_base=placeholders.PLACEHOLDER_URL_BASE):
        self.today = today
        self.placeholder_base = placeholder_base
        self.stats = {"extracted": 0, "withImage": 0, "placeholder": 0,
                      "structured": 0}

    # -- image -------------------------------------------------------------

    def resolve_image(self, page, hint=None, extract=None, embedded_image=None):
        """(imageUrl, imageSource, imageType) following the fixed priority."""
        candidates = list(page.images or []) if page else []

        from pipeline.search.extract import ImageCandidate, IMG_EMBEDDED, IMG_THUMBNAIL
        if embedded_image:
            candidates.append(ImageCandidate(url=embedded_image, source=IMG_EMBEDDED))

        thumb = (hint or {}).get("thumbnail") or (hint or {}).get("imageUrl")
        if thumb:
            candidates.append(ImageCandidate(url=thumb, source=IMG_THUMBNAIL))

        candidates = [c for c in candidates if c and c.url]
        if candidates:
            best = sorted(candidates, key=lambda c: -c.priority)[0]
            return best.url, best.source, "remote"

        slug = placeholders.slug_for(
            (extract.city if extract else None) or (hint or {}).get("city"),
            (hint or {}).get("title"), (extract.tags if extract else None),
            (extract.title if extract else None))
        return (placeholders.placeholder_url(slug, self.placeholder_base),
                IMG_PLACEHOLDER, "placeholder")

    # -- main --------------------------------------------------------------

    def extract(self, page, hint=None, source_url=None, fallback_title=None):
        hint = dict(hint or {})
        url = source_url or (page.finalUrl if page else None) or (page.url if page else None)
        event = ExtractedEvent(sourceUrl=url)
        src = event.fieldSources
        text = None

        jsonld = {}
        if page and page.jsonLd:
            from pipeline.search.extract import json_ld_event
            jsonld = json_ld_event(page.jsonLd) or {}
        # An anti-bot wall carries no facts. Refuse to read anything out of it.
        embedded = {} if (page and page.challenge) else dict(page.embedded or {}) if page else {}

        def mark(field_name, value, origin):
            if value in (None, "", [], {}):
                return
            if _is_placeholder_text(value) and field_name not in ("rawPrice",):
                return
            setattr(event, field_name, value if not isinstance(value, str) else value.strip())
            src[field_name] = origin

        # ---- title ----
        value = jsonld.get("name")
        if value:
            mark("title", str(value), SRC_JSONLD)
        else:
            value, _key = _first_present(embedded, _EMBED_TITLE)
            if value and not isinstance(value, (dict, list)):
                mark("title", str(value), SRC_EMBEDDED)
        if not event.title:
            value = hint.get("title") or fallback_title
            if value:
                mark("title", str(value), SRC_LISTING)
        if not event.title and page and page.title:
            mark("title", _strip_site_suffix(page.title, page), SRC_META)

        # ---- description ----
        if isinstance(jsonld.get("description"), str):
            mark("description", jsonld["description"], SRC_JSONLD)
        if not event.description:
            value, _key = _first_present(embedded, _EMBED_DESC)
            if isinstance(value, str):
                mark("description", _strip_html_text(value), SRC_EMBEDDED)
        if not event.description and page and page.description:
            mark("description", page.description, SRC_META)
        if not event.description:
            value = hint.get("snippet")
            if value:
                mark("description", str(value), SRC_LISTING)

        # ---- date & time ----
        start_iso, start_clock = _split_iso(jsonld.get("startDate"))
        end_iso, end_clock = _split_iso(jsonld.get("endDate"))
        if start_iso:
            mark("rawDate", start_iso, SRC_JSONLD)
        if start_clock:
            mark("rawTime", start_clock, SRC_JSONLD)
        if end_iso and end_iso != start_iso:
            mark("rawEndDate", end_iso, SRC_JSONLD)
        if end_clock:
            mark("rawEndTime", end_clock, SRC_JSONLD)

        if not event.rawDate or not event.rawTime:
            short_start, _ = _first_present(embedded, _EMBED_START_SHORT)
            short_end, _ = _first_present(embedded, _EMBED_END_SHORT)
            start_raw, _ = _first_present(embedded, _EMBED_START)
            end_raw, _ = _first_present(embedded, _EMBED_END)
            if short_start or short_end:
                ds, ts = _split_short(short_start)
                if not event.rawDate and ds:
                    mark("rawDate", ds, SRC_EMBEDDED)
                if not event.rawTime:
                    s, e = _from_range(ts) if ts else (None, None)
                    if s:
                        mark("rawTime", s, SRC_EMBEDDED)
                    if e:
                        mark("rawEndTime", e, SRC_EMBEDDED)
                _, ts_end = _split_short(short_end)
                if ts_end:
                    s2, e2 = _from_range(ts_end)
                    start_clock = start_clock or s2
                    if not event.rawEndTime and (e2 or s2):
                        mark("rawEndTime", e2 or s2, SRC_EMBEDDED)
            if start_raw is not None:
                moment = _epoch_ms(start_raw)
                if moment:
                    if not event.rawDate:
                        mark("rawDate", moment.date().isoformat(), SRC_EMBEDDED)
                    if not event.rawTime:
                        mark("rawTime", moment.strftime("%H:%M"), SRC_EMBEDDED)
            if end_raw is not None:
                moment = _epoch_ms(end_raw)
                if moment:
                    if not event.rawEndDate and moment.date().isoformat() != (event.rawDate or ""):
                        mark("rawEndDate", moment.date().isoformat(), SRC_EMBEDDED)
                    if not event.rawEndTime:
                        mark("rawEndTime", moment.strftime("%H:%M"), SRC_EMBEDDED)

        if not event.rawDate or not event.rawTime:
            hint_date = hint.get("rawDate")
            hint_time = hint.get("rawTime")
            if hint_date:
                ds, ts = _split_short(hint_date)
                if not event.rawDate:
                    mark("rawDate", ds or hint_date, SRC_LISTING)
                if not event.rawTime and ts:
                    s, e = _from_range(ts)
                    if s:
                        mark("rawTime", s, SRC_LISTING)
                    if e and not event.rawEndTime:
                        mark("rawEndTime", e, SRC_LISTING)
            if hint_time and not event.rawTime:
                s, e = _from_range(hint_time)
                if s:
                    mark("rawTime", s, SRC_LISTING)
                if e and not event.rawEndTime:
                    mark("rawEndTime", e, SRC_LISTING)

        if not event.rawDate or not event.rawTime:
            text = text or _safe_text(page)
            blob = _labelled(text, _LABELS["date"])
            if blob:
                ds, _ = _split_short(blob) or (None, None)
                iso, clock = _split_iso(blob)
                if not event.rawDate and (iso or ds):
                    mark("rawDate", iso or ds, SRC_TEXT)
                if not event.rawTime:
                    s, e = _from_range(blob)
                    if clock:
                        mark("rawTime", clock, SRC_TEXT)
                    elif s:
                        mark("rawTime", s, SRC_TEXT)
                    if e and not event.rawEndTime:
                        mark("rawEndTime", e, SRC_TEXT)

        # ---- location ----
        loc = _jsonld_location(jsonld)
        if loc.get("venue"):
            mark("venue", str(loc["venue"]), SRC_JSONLD)
        if loc.get("street"):
            mark("address", str(loc["street"]), SRC_JSONLD)
        if loc.get("locality"):
            mark("district", str(loc["locality"]), SRC_JSONLD)
        if loc.get("region"):
            mark("city", str(loc["region"]), SRC_JSONLD)

        if not event.venue:
            value, _key = _first_present(embedded, _EMBED_VENUE)
            if value:
                mark("venue", str(value), SRC_EMBEDDED)
        if not event.address:
            value, _key = _first_present(embedded, _EMBED_ADDRESS)
            if value:
                mark("address", str(value), SRC_EMBEDDED)
        if not event.district:
            value, _key = _first_present(embedded, _EMBED_CITY)
            if value:
                mark("district", str(value), SRC_EMBEDDED)
        if not event.city:
            value, _key = _first_present(embedded, _EMBED_PROVINCE)
            if value:
                mark("city", str(value), SRC_EMBEDDED)

        if not event.venue:
            value = hint.get("rawVenue")
            if value:
                mark("venue", str(value), SRC_LISTING)
        if not event.district:
            value = hint.get("district") or hint.get("rawLocation")
            if value:
                mark("district", str(value), SRC_LISTING)
        if not event.city:
            value = hint.get("city")
            if value:
                mark("city", str(value), SRC_LISTING)
        if not event.address:
            value = hint.get("address")
            if value:
                mark("address", str(value), SRC_LISTING)

        if not event.venue and not event.address:
            text = text or _safe_text(page)
            blob = _labelled(text, _LABELS["venue"])
            if blob:
                mark("address", blob, SRC_TEXT)

        # ---- price ----
        if not event.rawPrice:
            offers = _jsonld_offers(jsonld)
            if offers.get("price") is not None:
                mark("rawPrice", _price_text(offers.get("price"), offers.get("currency")), SRC_JSONLD)
        if not event.rawPrice:
            value, _key = _first_present(embedded, _EMBED_PRICE)
            if value is not None and not isinstance(value, (dict, list)):
                mark("rawPrice", _price_text(value, None), SRC_EMBEDDED)
        if not event.rawPrice:
            tickets = embedded.get("ActivityTickets") or embedded.get("activityTickets")
            if isinstance(tickets, list) and tickets:
                first = tickets[0] if isinstance(tickets[0], dict) else {}
                label = first.get("PriceStr") or first.get("priceStr")
                if label:
                    mark("rawPrice", str(label), SRC_EMBEDDED)
                elif first.get("Price") is not None:
                    mark("rawPrice", _price_text(first.get("Price"), None), SRC_EMBEDDED)
        if not event.rawPrice and hint.get("rawPrice"):
            mark("rawPrice", str(hint["rawPrice"]), SRC_LISTING)
        if not event.rawPrice:
            text = text or _safe_text(page)
            blob = _labelled(text, _LABELS["price"])
            if blob:
                mark("rawPrice", blob[:40], SRC_TEXT)

        # ---- organizer ----
        org = _jsonld_organizer(jsonld)
        if org:
            mark("organizer", str(org), SRC_JSONLD)
        if not event.organizer:
            value, _key = _first_present(embedded, _EMBED_ORG)
            name = _name_of(value)
            if name:
                mark("organizer", name, SRC_EMBEDDED)
        if not event.organizer and hint.get("organizer"):
            mark("organizer", str(hint["organizer"]), SRC_LISTING)

        # ---- tags ----
        tags = []
        for key in ("keywords", "article:tag"):
            value = (page.raw or {}).get(key) if page else None
            if value:
                tags.extend(_split_tags(value))
        value, _key = _first_present(embedded, _EMBED_TAGS)
        if value is not None:
            tags.extend(_split_tags(value))
        for key in ("tags", "topics"):
            if isinstance(embedded.get(key), list):
                tags.extend(_split_tags(embedded[key]))
        tags.extend(_split_tags(hint.get("tags")))
        event.tags = _dedupe([t for t in tags if t])[:8]

        # ---- registration url ----
        offers = _jsonld_offers(jsonld)
        reg = offers.get("url")
        reg_origin = SRC_JSONLD
        if not reg:
            value, _key = _first_present(embedded, _EMBED_REG_URL)
            if value:
                reg, reg_origin = value, SRC_EMBEDDED
        if not reg and hint.get("registrationUrl"):
            reg, reg_origin = hint["registrationUrl"], SRC_LISTING
        if reg and str(reg).startswith(("http://", "https://")):
            mark("registrationUrl", str(reg), reg_origin)

        # ---- published ----
        if page and page.publishedAt:
            mark("publishedAt", str(page.publishedAt), SRC_META)

        # ---- agenda ----
        event.agenda = list(page.agenda) if page else []

        # ---- image ----
        embedded_image = None
        value, _key = _first_present(embedded, _EMBED_IMAGE)
        name = _name_of(value) or (value if isinstance(value, str) else None)
        if isinstance(name, str) and name.startswith(("http://", "https://")):
            embedded_image = name
        image_url, image_source, image_type = self.resolve_image(
            page, hint, event, embedded_image=embedded_image)
        event.imageUrl = image_url
        event.imageSource = image_source
        event.imageType = image_type
        src["imageUrl"] = image_source

        # ---- confidence ----
        structured = any(v in (SRC_JSONLD, SRC_EMBEDDED) for v in src.values())
        filled = len(event.filled_fields())
        if structured and filled >= 8:
            event.confidence = "structured"
        elif filled >= 5:
            event.confidence = "partial"
        else:
            event.confidence = "thin"

        self.stats["extracted"] += 1
        if image_type == "placeholder":
            self.stats["placeholder"] += 1
        else:
            self.stats["withImage"] += 1
        if event.confidence == "structured":
            self.stats["structured"] += 1
        return event


# --- helpers ---------------------------------------------------------------

def _safe_text(page):
    if not page or not page.raw:
        return None
    return None


def _strip_site_suffix(title, page):
    if not title:
        return None
    text = str(title).strip()
    for site in filter(None, (page.siteName,)):
        for sep in (" - ", " | ", "_", "—"):
            marker = sep + site
            if text.endswith(marker):
                return text[: -len(marker)].strip()
    # Generic "… - 活动行" / "… | 某某网" tail: only strip a short trailing
    # segment, and only when the head is still substantial.
    m = re.match(r"^(.*?)\s*[-|—]\s*([^\s\-|—]{2,12})$", text)
    if m and len(m.group(1)) >= 6:
        return m.group(1).strip()
    return text


def _price_text(value, currency):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        if float(value) == 0:
            return "免费"
        return ("¥%g" % value) if not currency or currency in ("CNY", "RMB") else ("%s%g" % (currency, value))
    text = str(value).strip()
    if not text:
        return None
    if text in ("0", "0.0", "0.00"):
        return "免费"
    return text[:40]


def _split_tags(value):
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            out.extend(_split_tags(item))
        return out
    if isinstance(value, dict):
        for key in ("name", "title", "label", "tag", "value"):
            if isinstance(value.get(key), str):
                return [value[key].strip()]
        return []
    return [t.strip() for t in re.split(r"[,，/、|;]", str(value)) if t.strip()]


def _name_of(value):
    """A human name out of a str / {name} / [{name}] shape, else None."""
    if value in (None, "", []):
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        for key in ("name", "title", "label", "company", "nickname", "fullname"):
            if isinstance(value.get(key), str) and value[key].strip():
                return value[key].strip()
        return None
    if isinstance(value, (list, tuple)):
        for item in value:
            name = _name_of(item)
            if name:
                return name
    return None


def _strip_html_text(value, limit=2000):
    if not isinstance(value, str):
        return None
    import html as _html
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", value, flags=re.I | re.S)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|li|h[1-6])>", "\n", text, flags=re.I)
    text = _html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:limit] or None


def _dedupe(items):
    seen = set()
    out = []
    for item in items:
        key = str(item).casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def extract_events(pages, hints=None, today=None, extractor=None, source_urls=None):
    """Batch helper: list[(page, hint)] -> list[ExtractedEvent]."""
    extractor = extractor or EventExtractor(today=today)
    hints = hints or []
    out = []
    for i, page in enumerate(pages):
        hint = hints[i] if i < len(hints) else {}
        url = source_urls[i] if source_urls and i < len(source_urls) else None
        out.append(extractor.extract(page, hint=hint, source_url=url))
    return out
