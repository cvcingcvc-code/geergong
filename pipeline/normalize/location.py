# Deterministic location normalization (PHASE 4).
#
# Shanghai districts for the demo MVP. Rules:
#   "上海市徐汇区" -> city "上海", district "徐汇"
#   "徐汇区"       -> district "徐汇"
#   "徐汇"         -> district "徐汇"
#   "上海·徐汇"    -> city "上海", district "徐汇"
# Unknown districts stay as trimmed input (never guessed).

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
