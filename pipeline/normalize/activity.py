# Deterministic price normalization (PHASE 4).
#
#   "免费" / "0元" / "¥0" / "￥0" / "free" / 0  -> priceType "free", price 0
#   "¥29" / "29元" / "29.9" / "学生 ¥29"        -> priceType "paid", price 29
#   anything else                               -> "unknown", price None
#
# Pure rules, no LLM, no invented facts.

import re

_FREE_TOKENS = {"免费", "free", " Gratis", "0", "0元", "0 圆", "无票", "不收费", "公益免费"}
_YEN = "¥￥"


def _strip_spaces(text):
    return re.sub(r"\s+", "", text)


def normalize_price(value):
    """-> (priceType, price) where price is float|int|None."""
    if value is None:
        return "unknown", None
    if isinstance(value, bool):
        return "unknown", None
    if isinstance(value, (int, float)):
        return ("free", 0) if value == 0 else ("paid", value)
    text = str(value).strip()
    if not text:
        return "unknown", None
    compact = _strip_spaces(text)
    low = compact.lower()
    # Explicit free words.
    if low in {t.lower() for t in _FREE_TOKENS}:
        return "free", 0
    # ¥0 / ￥0 / 0元 / 0.00元
    if re.fullmatch(r"[%s]?0(\.0+)?[元圆]?" % _YEN, compact):
        return "free", 0
    if re.fullmatch(r"[%s]?0+(\.0+)?[元圆]?/人" % _YEN, compact):
        return "free", 0
    # Money with symbol: ¥29 / ￥29.9 / ¥ 29
    m = re.fullmatch(r"[%s](\d+(?:\.\d+)?)[元圆]?(?:/人)?" % _YEN, compact)
    if m:
        return "paid", float(m.group(1)) if "." in m.group(1) else int(m.group(1))
    # Bare number with unit: 29元 / 29.9元 / 29
    m = re.fullmatch(r"(\d+(?:\.\d+)?)[元圆块](?:/人)?", compact)
    if m:
        return "paid", float(m.group(1)) if "." in m.group(1) else int(m.group(1))
    # Compound labels like "学生¥29" / "早鸟票99" -> paid with first number.
    m = re.search(r"[%s]?(\d+(?:\.\d+)?)[元圆]?" % _YEN, compact)
    if m and re.search(r"[%s]|[元圆块]|price|ticket" % _YEN, low):
        return "paid", float(m.group(1)) if "." in m.group(1) else int(m.group(1))
    return "unknown", None


def price_label(price_type, price):
    """Presentation label for the Gorgon UI (deterministic)."""
    if price_type == "free":
        return "免费"
    if price_type == "paid" and price is not None:
        return ("¥%g" % price)
    return "待确认"


# ---------------------------------------------------------------------------
# Stage orchestration: raw -> normalized
# ---------------------------------------------------------------------------

def normalize_activity(act, default_year=2026):
    """Normalize one raw activity IN PLACE (deterministic, no LLM).

    Applies: title/venue text rules, date & time parsing, city/district
    rules, price rules. Values that cannot be parsed become None — never
    guessed. Sets status to "normalized".
    """
    from pipeline.normalize import datetime as dtmod
    from pipeline.normalize import location as locmod
    from pipeline.normalize.text import normalize_title, strip_emoji, collapse_spaces

    act = act if isinstance(act, dict) else {}
    act["title"] = normalize_title(act.get("title"))
    act["venue"] = locmod.clean_venue(act.get("venue"))
    act["address"] = collapse_spaces(act.get("address")) or None

    city, district = locmod.split_location(act.get("location") or "")
    if act.get("city") is None:
        act["city"] = city
    if act.get("district") is None:
        act["district"] = district
    else:
        act["district"] = locmod.normalize_district(act["district"]) or act["district"]
        if act.get("city") is None:
            act["city"] = "上海"  # demo MVP is Shanghai-scoped
    if act.get("city") is None and act.get("district"):
        act["city"] = "上海"

    # Dates & times. startTime may carry a range like "19:00-21:30".
    act["startDate"] = dtmod.parse_date(act.get("startDate"), default_year)
    act["endDate"] = dtmod.parse_date(act.get("endDate"), default_year)
    range_start, range_end = dtmod.parse_range(act.get("startTime"))
    if range_start:
        act["startTime"] = range_start
    else:
        act["startTime"] = dtmod.parse_time(act.get("startTime"))
    act["endTime"] = range_end or dtmod.parse_time(act.get("endTime"))

    price_type, price = normalize_price(act.get("price"))
    act["priceType"] = price_type
    act["price"] = price

    if isinstance(act.get("tags"), str):
        act["tags"] = [t.strip() for t in re.split(r"[,，/、|]", act["tags"]) if t.strip()]
    if not isinstance(act.get("tags"), list):
        act["tags"] = []

    act["status"] = "normalized"
    return act


def normalize_all(activities, default_year=2026):
    return [normalize_activity(dict(a), default_year) for a in activities]
