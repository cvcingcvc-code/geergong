# Page metadata extraction (PHASE 5).
#
# HTML -> PageMetadata, using the stdlib only (no bs4, no lxml: the pipeline
# stays dependency-free by contract). The extraction is deliberately
# conservative — it reports what the page SAYS and marks everything else as
# missing, because inventing facts is the one thing Gorgon must never do.
#
# Image priority is fixed and recorded per candidate, so the UI and the
# Detail page can always answer "where did this picture come from?":
#
#   100  og:image / og:image:secure_url
#    90  twitter:image / twitter:image:src
#    80  JSON-LD Event.image
#    60  main hero <img> in the page body
#    50  search-engine thumbnail (added by the provider, not read from HTML)
#     0  category placeholder (generated locally, never a real photo)

import html as _html
import json
import re
import urllib.parse
from dataclasses import dataclass, field

from pipeline.search import textnorm

# `<br>` and paragraph closers ARE line breaks in prose; every other tag is
# just noise between words.
_BR_RE = re.compile(r"</?br\s*/?>|</p\s*>|</div\s*>|</li\s*>", re.I)

# --- image provenance vocabulary ------------------------------------------

IMG_OG = "og:image"
IMG_TWITTER = "twitter:image"
IMG_JSONLD = "json-ld"
IMG_EMBEDDED = "embedded-image"
IMG_HERO = "hero"
IMG_THUMBNAIL = "thumbnail"
IMG_PLACEHOLDER = "placeholder"

IMAGE_PRIORITY = {
    IMG_OG: 100,
    IMG_TWITTER: 90,
    IMG_JSONLD: 80,
    IMG_EMBEDDED: 75,
    IMG_HERO: 60,
    IMG_THUMBNAIL: 50,
    IMG_PLACEHOLDER: 0,
}

# <img> classes/ids that are almost always chrome, not content.
_IMG_NOISE = re.compile(
    r"(logo|icon|avatar|sprite|qrcode|qr-code|banner-ad|placeholder-|spacer|"
    r"blank|pixel|tracking|wechat|weixin-|app-?store|download-|favicon|"
    r"head-?logo|site-?logo|brand-?logo|badge|stamp|sign)", re.I)

_IMG_GOOD = re.compile(
    r"(hero|cover|banner|poster|main|head-?img|headimg|thumb|photo|picture|"
    r"event|item-logo|slide)", re.I)

_META_RE = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR_RE = re.compile(r"([\w:\-]+)\s*=\s*\"([^\"]*)\"|([\w:\-]+)\s*=\s*'([^']*)'")
_LINK_RE = re.compile(r"<link\b[^>]*>", re.I)
_IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.I | re.S)
_LD_RE = re.compile(r"<script\b[^>]*application/ld\+json[^>]*>(.*?)</script>", re.I | re.S)
_BODY_RE = re.compile(r"<body\b[^>]*>(.*?)</body>", re.I | re.S)

# Embedded state blobs that commonly hold a structured event record.
_EMBEDDED_HINTS = (
    "ativityjson", "activityjson", "eventjson", "eventdetail", "eventdata",
    "eventmodel", "detailjson", "__initial_state__", "__next_data__",
    "window.__data__", "pagedata", "eventinfo", "activitydetail", "detaildata",
)

# --- anti-bot interstitials -------------------------------------------------
#
# Gorgon only reads PUBLIC pages. When a site answers with a verification
# wall instead of content, the correct behaviour is to say "this source is
# temporarily unavailable" — never to parse the wall and call whatever it
# contains an activity, and never to try to defeat it.
_CHALLENGE_HOST_PARTS = ("verify.", "captcha.", "challenge.", "waf.", "sec.")
_CHALLENGE_PHRASES = (
    "访问太快", "访问频繁", "请求过于频繁", "安全验证", "请完成验证", "滑动验证",
    "人机验证", "验证码", "系统检测到", "访问被拒绝", "access denied",
    "verify you are human", "are you a robot", "unusual traffic",
    "checking your browser", "just a moment",
)


def looks_like_challenge(html, url=None, limit=200000):
    """True when the response is an anti-bot wall, not content."""
    if url:
        host = urllib.parse.urlparse(url).netloc.casefold()
        if any(part in host for part in _CHALLENGE_HOST_PARTS):
            return True
    if not html or len(html) > limit:
        return False
    head = html[:20000]
    hits = sum(1 for phrase in _CHALLENGE_PHRASES
               if phrase.casefold() in head.casefold())
    return hits >= 1


@dataclass
class ImageCandidate:
    url: str
    source: str            # IMG_* above
    width: int = None
    height: int = None
    alt: str = None

    @property
    def priority(self):
        return IMAGE_PRIORITY.get(self.source, 10)

    def to_dict(self):
        return {"url": self.url, "source": self.source, "width": self.width,
                "height": self.height, "alt": self.alt, "priority": self.priority}


@dataclass
class PageMetadata:
    url: str = None
    finalUrl: str = None
    title: str = None
    description: str = None
    siteName: str = None
    canonicalUrl: str = None
    lang: str = None
    publishedAt: str = None
    images: list = field(default_factory=list)      # list[ImageCandidate]
    jsonLd: list = field(default_factory=list)      # list[dict]
    embedded: dict = field(default_factory=dict)    # normalised embedded record
    agenda: list = field(default_factory=list)      # [{time,title}] only if found
    raw: dict = field(default_factory=dict)         # meta name/property -> content
    challenge: bool = False                         # anti-bot wall, not content

    def best_image(self):
        if not self.images:
            return None
        return sorted(self.images, key=lambda c: -c.priority)[0]

    def meta(self, *names):
        for name in names:
            value = self.raw.get(name)
            if value:
                return value
        return None

    def to_dict(self, withImages=True):
        out = {
            "url": self.url,
            "finalUrl": self.finalUrl,
            "title": self.title,
            "description": self.description,
            "siteName": self.siteName,
            "canonicalUrl": self.canonicalUrl,
            "publishedAt": self.publishedAt,
            "bestImage": self.best_image().url if self.best_image() else None,
            "imageSource": self.best_image().source if self.best_image() else None,
            "agenda": [dict(a) for a in self.agenda],
        }
        if withImages:
            out["images"] = [c.to_dict() for c in self.images]
            out["embedded"] = dict(self.embedded)
        return out


# --- low level helpers -----------------------------------------------------

def _attrs(tag):
    out = {}
    for m in _ATTR_RE.finditer(tag):
        key = (m.group(1) or m.group(3) or "").strip().casefold()
        value = m.group(2) if m.group(1) else m.group(4)
        if key:
            out[key] = _html.unescape(value or "")
    return out


def _clean_text(value, limit=4000):
    """Single-line field (title, venue…): tags out, entities decoded, one line."""
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", str(value))
    text = _html.unescape(text)
    return textnorm.plain_text(text, limit=limit, keep_newlines=False)


def _clean_prose(value, limit=4000):
    """Prose field (description): same, but paragraph breaks survive.

    Sources publish their own Markdown (Meetup bodies especially), and the
    detail page renders this block with pre-wrap. Flattening it would both
    leak `**` into the UI and destroy the author's paragraphs, so markup is
    stripped while newlines are kept.
    """
    if not value:
        return None
    text = _BR_RE.sub("\n", str(value))
    text = re.sub(r"<[^>]+>", " ", text)
    text = _html.unescape(text)
    return textnorm.plain_text(text, limit=limit, keep_newlines=True)


def _absolutize(url, base):
    if not url:
        return None
    url = url.strip()
    if url.startswith("//"):
        scheme = urllib.parse.urlparse(base or "").scheme or "https"
        return "%s:%s" % (scheme, url)
    if url.startswith(("http://", "https://")):
        return url
    if url.startswith("/") and base:
        return urllib.parse.urljoin(base, url)
    if base:
        return urllib.parse.urljoin(base, url)
    return None


# Sources publish several renditions of the same artwork, and the one they put
# in a listing or in og:image is the small one. A search card is ~150px wide and
# a detail hero is full-bleed, so asking for the largest published rendition is a
# free quality win: same artwork, same origin, same provenance, more pixels.
# Only renditions verified reachable are listed (douban's `medium` 418s).
_IMAGE_SIZE_UPGRADES = (
    (re.compile(r"/pview/event_poster/(?:small|median|thumb)/"),
     "/pview/event_poster/large/"),
)


def upgrade_image_size(url):
    """Swap a thumbnail rendition for the largest one the source also serves."""
    if not url:
        return url
    for pattern, replacement in _IMAGE_SIZE_UPGRADES:
        if pattern.search(url):
            return pattern.sub(replacement, url)
    return url


def _usable_image(url, base):
    """Reject data:, blob:, tracking pixels and 1x1 spacers by URL alone."""
    if not url:
        return None
    text = str(url).strip()
    if not text or text.casefold().startswith(("data:", "blob:", "javascript:")):
        return None
    if len(text) < 8:
        return None
    absolute = _absolutize(text, base)
    if not absolute:
        return None
    if not re.search(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?|$|@)", absolute, re.I) \
            and "/image" not in absolute and "?" not in absolute:
        # No extension and no query string: almost certainly not a photo.
        return None
    return upgrade_image_size(absolute)


def parse_meta_tags(html):
    """All <meta> tags as a flat name/property -> content dict (first wins)."""
    out = {}
    for tag in _META_RE.findall(html):
        attrs = _attrs(tag)
        content = attrs.get("content")
        if not content:
            continue
        for key_name in ("property", "name", "itemprop", "http-equiv"):
            key = attrs.get(key_name)
            if not key:
                continue
            key = key.strip().casefold()
            if key.startswith("og:") or key.startswith("twitter:"):
                out.setdefault(key, content)
            else:
                out.setdefault(key, content)
    return out


def parse_json_ld(html):
    """Every parseable application/ld+json block (list of nodes, flattened)."""
    nodes = []
    for blob in _LD_RE.findall(html):
        blob = blob.strip()
        if not blob:
            continue
        try:
            data = json.loads(blob)
        except (ValueError, TypeError):
            # Some sites wrap in CDATA or append a semicolon.
            cleaned = blob.strip().strip(";")
            if cleaned.startswith("<![CDATA["):
                cleaned = cleaned[len("<![CDATA["):].rstrip("]>")
            try:
                data = json.loads(cleaned)
            except (ValueError, TypeError):
                continue
        for node in _flatten_json_ld(data):
            nodes.append(node)
    return nodes


def _flatten_json_ld(data):
    if isinstance(data, list):
        for item in data:
            for node in _flatten_json_ld(item):
                yield node
        return
    if not isinstance(data, dict):
        return
    graph = data.get("@graph")
    if isinstance(graph, list):
        for item in graph:
            for node in _flatten_json_ld(item):
                yield node
        if len(data) == 1:
            return
    yield data


def json_ld_types(nodes):
    types = []
    for node in nodes or []:
        value = node.get("@type") if isinstance(node, dict) else None
        if isinstance(value, list):
            types.extend(str(v) for v in value)
        elif value:
            types.append(str(value))
    return types


def json_ld_event(nodes):
    """First node whose @type mentions Event, else None."""
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        value = node.get("@type")
        values = value if isinstance(value, list) else [value]
        for item in values:
            if item and "event" in str(item).casefold():
                return node
    return None


def extract_embedded_state(html):
    """Find the in-page JSON record that describes the event.

    Real platforms ship the record to the browser as `var xJson = {...}`, a
    hydration blob (`__NEXT_DATA__`) or similar. Two steps, both generic:

      1. brace-match every blob that follows a known state-variable hint
         (regex cannot match nested JSON, so this walks braces);
      2. pick the nested dict that looks most like a single event.

    Step 2 is what makes this work for deeply nested payloads without
    hardcoding any site's object path — a dict is judged by how many event
    signature keys it carries, and the best scoring dict wins.
    """
    lowered = html.casefold()
    starts = []
    for hint in _EMBEDDED_HINTS:
        idx = 0
        while True:
            pos = lowered.find(hint, idx)
            if pos < 0:
                break
            brace = html.find("{", pos)
            if brace > 0 and brace - pos < 400:
                starts.append(brace)
            idx = pos + len(hint)

    best = {}
    for brace in sorted(set(starts)):
        blob = _brace_slice(html, brace)
        if not blob:
            continue
        try:
            data = json.loads(blob)
        except (ValueError, TypeError):
            continue
        if not isinstance(data, dict):
            continue
        candidate = _best_event_dict(data)
        if candidate and _record_score(candidate) > _record_score(best):
            best = candidate
    return best


# Keys that identify a single event record, grouped by what they describe.
_SIGNATURE_GROUPS = (
    ("title", "name", "eventname", "eventtitle", "subject", "activityname"),
    ("start", "starttime", "start_time", "begintime", "begin_time",
     "startdate", "start_date", "holdtime", "hold_time"),
    ("city", "cityname", "city_name", "address", "location", "venue",
     "province", "district", "area", "venuename"),
    ("end", "endtime", "end_time", "finishtime", "enddate", "end_date"),
    ("cover", "bannerurl", "banner_url", "logo", "poster", "image", "picture"),
)
_SIGNATURE_KEYS = tuple(k for group in _SIGNATURE_GROUPS for k in group)


def _norm_key(key):
    return re.sub(r"[_\-\s]", "", str(key)).casefold()


_SIGNATURE_NORM = tuple(_norm_key(k) for k in _SIGNATURE_KEYS)


def _record_score(node):
    if not isinstance(node, dict):
        return 0
    keys = {_norm_key(k) for k in node.keys()}
    score = 0
    for group in _SIGNATURE_GROUPS:
        if any(_norm_key(k) in keys for k in group):
            score += 1
    return score


def _best_event_dict(root, max_nodes=4000):
    """Breadth-first walk; best-scoring dict with >=2 signature groups."""
    best = None
    best_score = 1        # require at least 2 groups, otherwise no record
    queue = [(root, 0)]
    seen = 0
    while queue and seen < max_nodes:
        node, depth = queue.pop(0)
        seen += 1
        score = _record_score(node)
        # Prefer the most specific record; a tie at a shallower depth wins.
        if score > best_score:
            best, best_score = node, score
        if depth >= 8:
            continue
        for value in node.values():
            if isinstance(value, dict):
                queue.append((value, depth + 1))
            elif isinstance(value, list):
                for item in value[:12]:
                    if isinstance(item, dict):
                        queue.append((item, depth + 1))
    return best or (root if _record_score(root) >= 2 else {})


def _brace_slice(text, start, max_len=400000):
    """Balanced-brace slice starting at `start` (string-literal aware)."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    escaped = False
    for i in range(start, min(len(text), start + max_len)):
        ch = text[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


# --- image extraction ------------------------------------------------------

def extract_images(html, base_url, limit=8):
    """Priority-ordered image candidates found in the HTML itself."""
    meta = parse_meta_tags(html)
    found = []
    seen = set()

    def add(url, source, width=None, height=None, alt=None):
        absolute = _usable_image(url, base_url)
        if not absolute:
            return
        key = absolute.split("?")[0]
        if key in seen:
            return
        seen.add(key)
        found.append(ImageCandidate(url=absolute, source=source,
                                    width=width, height=height, alt=alt))

    for key in ("og:image:secure_url", "og:image:url", "og:image"):
        if meta.get(key):
            add(meta[key], IMG_OG)
            break
    for key in ("twitter:image", "twitter:image:src", "twitter:image:url"):
        if meta.get(key):
            add(meta[key], IMG_TWITTER)
            break

    nodes = parse_json_ld(html)
    event = json_ld_event(nodes)
    if event:
        for value in _image_values(event.get("image")):
            add(value, IMG_JSONLD)
            break

    body = _BODY_RE.search(html)
    scope = body.group(1) if body else html
    scored = []
    for tag in _IMG_RE.findall(scope):
        attrs = _attrs(tag)
        source_url = (attrs.get("src") or attrs.get("data-src")
                      or attrs.get("data-original") or attrs.get("data-lazy-src"))
        if not source_url:
            continue
        haystack = " ".join(str(v) for v in (
            attrs.get("class"), attrs.get("id"), attrs.get("alt"),
            attrs.get("title"), source_url) if v)
        if _IMG_NOISE.search(haystack) and not _IMG_GOOD.search(haystack):
            continue
        width = _int_or_none(attrs.get("width"))
        height = _int_or_none(attrs.get("height"))
        score = 0
        if _IMG_GOOD.search(haystack):
            score += 40
        if width and height:
            if width >= 600:
                score += 30
            elif width >= 300:
                score += 15
            if height and width and height >= 200:
                score += 10
        if score <= 0:
            continue
        scored.append((score, source_url, width, height, attrs.get("alt")))
    for score, source_url, width, height, alt in sorted(scored, key=lambda r: -r[0]):
        add(source_url, IMG_HERO, width=width, height=height, alt=alt)
        if len(found) >= limit:
            break

    return found[:limit]


def _image_values(value):
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [value.get("url") or value.get("contentUrl") or value.get("@id")]
    if isinstance(value, list):
        out = []
        for item in value:
            out.extend(_image_values(item))
        return [v for v in out if v]
    return []


def _int_or_none(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


# --- agenda ---------------------------------------------------------------

# Only structured, unambiguous timetables are accepted. A prose paragraph
# that happens to contain "14:00" is not an agenda, and we would rather show
# nothing than a hallucinated schedule.
_AGENDA_ROW_RE = re.compile(
    r"(?:^|[\n>])\s*(\d{1,2}[:：]\d{2})\s*(?:[-–—~至]\s*(\d{1,2}[:：]\d{2}))?\s*"
    r"([^\n<]{2,60})", re.M)


def extract_agenda(text, max_rows=12):
    """Deterministic timetable rows from a text block, or []."""
    if not text:
        return []
    rows = []
    for m in _AGENDA_ROW_RE.finditer(text):
        start, end, title = m.group(1), m.group(2), (m.group(3) or "").strip()
        title = title.strip(" \t·-—:：|•>")
        if not title or len(title) < 2:
            continue
        if re.fullmatch(r"[\d\s:：\-–—~]+", title):
            continue
        rows.append({
            "time": _norm_clock(start) + (("–" + _norm_clock(end)) if end else ""),
            "start": _norm_clock(start),
            "end": _norm_clock(end) if end else None,
            "title": title[:60],
        })
        if len(rows) >= max_rows:
            break
    # A single stray time is noise, not a schedule.
    return rows if len(rows) >= 2 else []


def _norm_clock(value):
    if not value:
        return None
    text = value.replace("：", ":")
    parts = text.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except (ValueError, IndexError):
        return None
    if hour > 23 or minute > 59:
        return None
    return "%02d:%02d" % (hour, minute)


def text_blocks(html):
    """Visible-ish text blocks, used for date/price/agenda fallbacks."""
    body = _BODY_RE.search(html)
    scope = body.group(1) if body else html
    scope = re.sub(r"<(script|style)\b.*?</\1>", " ", scope, flags=re.I | re.S)
    scope = re.sub(r"<br\s*/?>", "\n", scope, flags=re.I)
    scope = re.sub(r"</(p|div|li|tr|h[1-6]|section)>", "\n", scope, flags=re.I)
    return _html.unescape(re.sub(r"<[^>]+>", " ", scope))


# --- top level ------------------------------------------------------------

def parse_page(html, url=None, final_url=None, extract_agenda_rows=True):
    """HTML string -> PageMetadata."""
    if not html:
        return PageMetadata(url=url, finalUrl=final_url)
    base = final_url or url
    challenge = looks_like_challenge(html, url=base)
    if challenge:
        # Do not derive ANYTHING from a verification wall.
        return PageMetadata(url=url, finalUrl=base, challenge=True,
                            title=_page_title(html))
    meta = parse_meta_tags(html)
    nodes = parse_json_ld(html)
    event = json_ld_event(nodes) or {}
    embedded = extract_embedded_state(html)

    title = (meta.get("og:title") or meta.get("twitter:title")
             or _page_title(html) or event.get("name"))
    description = (meta.get("og:description") or meta.get("description")
                   or meta.get("twitter:description") or event.get("description"))
    canonical = None
    for tag in _LINK_RE.findall(html):
        attrs = _attrs(tag)
        if (attrs.get("rel") or "").casefold() == "canonical":
            canonical = _absolutize(attrs.get("href"), base)
            break

    agenda = extract_agenda(text_blocks(html)) if extract_agenda_rows else []

    return PageMetadata(
        url=url,
        finalUrl=base,
        title=_clean_text(title, 300),
        description=_clean_prose(description, 2000),
        siteName=meta.get("og:site_name") or meta.get("application-name"),
        canonicalUrl=canonical,
        lang=meta.get("og:locale") or _html_lang(html),
        publishedAt=(meta.get("article:published_time")
                     or meta.get("og:published_time")
                     or event.get("datePublished")),
        images=extract_images(html, base),
        jsonLd=nodes,
        embedded=embedded,
        agenda=agenda,
        raw=meta,
    )


def _page_title(html):
    m = _TITLE_RE.search(html)
    return _clean_text(m.group(1), 300) if m else None


def _html_lang(html):
    m = re.search(r"<html\b[^>]*\blang\s*=\s*[\"']([\w\-]+)", html, re.I)
    return m.group(1) if m else None
