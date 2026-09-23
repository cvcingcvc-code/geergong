# Deterministic location normalization (PHASE 4).
#
# Shanghai districts for the demo MVP. Rules:
#   "上海市徐汇区" -> city "上海", district "徐汇"
#   "徐汇区"       -> district "徐汇"
#   "徐汇"         -> district "徐汇"
#   "上海·徐汇"    -> city "上海", district "徐汇"
# Unknown districts stay as trimmed input (never guessed).
#
# PHASE 5.2 addition — district ELIGIBILITY. This module already owned "what
# is a district", so it also owns "does this record belong to one". The rule
# is deliberately the same normaliser the whole pipeline (and the browser's
# district.js mirror) uses: an unrecognised value normalises to None, so a
# record with an unknown district is eligible for NOTHING and can never be
# guessed into the district the user happens to have selected.

import re

DISTRICTS = [
    "黄浦", "徐汇", "长宁", "静安", "普陀", "虹口", "杨浦",
    "闵行", "宝山", "嘉定", "浦东", "金山", "松江", "青浦",
    "奉贤", "崇明",
]

_CITIES = ["上海", "北京市", "北京", "杭州市", "杭州", "南京市", "南京", "深圳市", "深圳", "广州市", "广州"]
# Longest-first matching for city prefixes.
_CITY_PREFIXES = sorted(_CITIES, key=len, reverse=True)


def normalize_city(text):
    if not isinstance(text, str) or not text.strip():
        return None
    t = text.strip()
    for city in _CITY_PREFIXES:
        if t.startswith(city):
            base = city.rstrip("市")
            return base
    return None


def normalize_district(text):
    """-> district short name (e.g. '徐汇') or None."""
    if not isinstance(text, str) or not text.strip():
        return None
    t = text.strip()
    t = re.sub(r"\s+", "", t)
    # Drop city prefix (with optional 市) if present.
    for city in _CITY_PREFIXES:
        if t.startswith(city):
            t = t[len(city):]
            if t.startswith("市"):
                t = t[1:]
            break
    # Split on separators and look for a known district token.
    parts = re.split(r"[·\-—/，,]", t)
    for part in parts:
        p = part.strip()
        for d in DISTRICTS:
            if p == d or p == d + "区" or p == d + "新区" and d == "浦东":
                return d
    # Fallback: strip trailing 区/县 and accept if it matches a known district.
    t2 = t.rstrip("区县")
    for d in DISTRICTS:
        if t2 == d:
            return d
        if t2.startswith(d):
            return d
    return None


# --- district eligibility (PHASE 5.2) --------------------------------------
#
# The label the UI ships for "no district scoping". It is the one value a
# caller can send that must never remove a candidate, so it is named here —
# next to the vocabulary — and imported by the API instead of being retyped.
ALL_DISTRICTS_LABEL = "全上海"

# Everything that means "the whole city" rather than one district.
_NO_DISTRICT_VALUES = frozenset({"", ALL_DISTRICTS_LABEL, "上海"})


def resolve_district(value):
    """A caller-supplied district -> a HARD constraint, or None.

    None is the only value that leaves every candidate eligible: "全上海"
    (and the city name) resolve to it, so the UI's whole-city choice can
    never turn into a filter by accident.

    A recognised district resolves to its short name ("徐汇区" -> "徐汇").
    An unrecognised one is passed through untouched rather than dropped: it
    then matches nothing, which is the honest answer for a district that
    does not exist in this vocabulary.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text in _NO_DISTRICT_VALUES:
        return None
    return normalize_district(text) or text


def district_of_record(activity):
    """The district a normalized record belongs to, or None when unknown.

    Only `normalize_district` decides — the same function the record was
    normalised with. An unrecognised value therefore yields None, never the
    district the caller happens to have selected. The address/location
    fallback only fires when the district field itself says nothing; it is
    evidence the record carries, not an inference.
    """
    if not isinstance(activity, dict):
        return None
    for key in ("district", "address", "location"):
        district = normalize_district(activity.get(key))
        if district:
            return district
    return None


def district_matches(activity, district):
    """Eligibility under the district constraint (absent constraint = pass).

    This is the predicate the retrieval pipeline applies BEFORE dedupe,
    trust, ranking and the maxResults cut — never to an already-truncated
    list, which is what silently dropped district hits that ranked below
    the city-wide top N.
    """
    # Resolved here as well as by the pipeline, so a caller that hands over
    # the raw UI value ("全上海") cannot turn it into a filter by accident.
    district = resolve_district(district)
    if not district:
        return True
    return district_of_record(activity) == district


def split_location(text):
    """'上海·徐汇' / '上海 - 徐汇' -> (city, district)."""
    if not isinstance(text, str) or not text.strip():
        return None, None
    parts = re.split(r"[·\-—/]", text.strip())
    city = normalize_city(parts[0]) if parts else None
    district = None
    if len(parts) > 1:
        district = normalize_district(parts[1])
    if district is None:
        district = normalize_district(text)
    return city, district


def clean_venue(text):
    if not isinstance(text, str) or not text.strip():
        return None
    t = re.sub(r"\s+", " ", text.strip())
    return t or None
