# Deterministic date/time normalization (PHASE 4).
#
# Supported input shapes (examples):
#   2026/09/20, 2026-9-20, 2026.9.20, 2026年9月20日, 9月20日, 9/20,
#   09-20, 6.20 -> resolved against a default year (and default month
#   heuristically when only day is unambiguous).
# Times: "19:00", "19点", "晚上7点", "7:00 pm" is NOT supported (24h only).
# Ranges "19:00-21:30" fill start+end in one call.
#
# No LLM. Any unparseable input returns None — never a guessed value.

import re
from datetime import date, timedelta

DEFAULT_YEAR = 2026  # demo MVP: all demo data lives in 2026

_DATE_PATTERNS = [
    # 2026年9月20日 / 2026年09月20
    re.compile(r"^(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$"),
    # 2026/09/20 | 2026-9-20 | 2026.9.20
    re.compile(r"^(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})$"),
    # 9月20日 / 09月20
    re.compile(r"^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$"),
    # 9/20 | 09-20 | 6.20
    re.compile(r"^(\d{1,2})[/\-.](\d{1,2})$"),
]

_WEEKDAY_CN = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
_WEEKDAY_ZH = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}


def _mk(year, month, day):
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date(value, default_year=DEFAULT_YEAR):
    """-> 'YYYY-MM-DD' or None."""
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    # Strip weekday decorations: "周六 6.20", "周六(6/20)", "2026-09-20 周日"
    text = re.sub(r"周[一二三四五六日天]|[MonTueWdhFiSatu]{3}\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[（(].*?[)）]", "", text).strip()
    text = text.replace("／", "/")
    for pattern in _DATE_PATTERNS:
        m = pattern.match(text)
        if not m:
            continue
        parts = [int(p) for p in m.groups()]
        if len(parts) == 3:
            year, month, day = parts
            if year < 100:
                year += 2000
            parsed = _mk(year, month, day)
        else:
            month, day = parts
            parsed = _mk(default_year, month, day)
        if parsed:
            return parsed.isoformat()
        return None
    return None


def parse_time(value):
    """-> 'HH:MM' (24h) or None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("：", ":").replace("。", ":")
    # Day-period prefixes: 晚上7点 / 下午2点半 / 上午9:00 ...
    shift = 0
    m = re.match(r"^(凌晨|早上|上午|中午|下午|晚上)\s*(.+)$", text)
    if m:
        if m.group(1) in ("下午", "晚上"):
            shift = 12
        text = m.group(2).strip()
    m = re.match(r"^(\d{1,2})\s*[点时:]\s*(\d{1,2})?\s*分?$", text)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2) or 0)
    else:
        m = re.match(r"^(\d{1,2}):(\d{2})$", text)
        if not m:
            return None
        hour, minute = int(m.group(1)), int(m.group(2))
    if shift and hour < 12:
        hour += shift
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return "%02d:%02d" % (hour, minute)
    return None


def parse_range(value):
    """'19:00-21:30' / '19:00—21:30' -> (start, end) or (None, None)."""
    if value is None:
        return None, None
    text = str(value).strip()
    for sep in ("—", "–", "~", "～", "-"):
        if sep in text:
            left, right = text.split(sep, 1)
            start, end = parse_time(left), parse_time(right)
            if start and end:
                return start, end
            return None, None
    one = parse_time(text)
    return (one, None) if one else (None, None)


def weekday_key(date_str):
    """'2026-09-20' -> 'sat' etc., or None."""
    if not date_str:
        return None
    try:
        d = date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None
    return list(_WEEKDAY_CN.keys())[d.weekday()]


def date_label(date_str):
    """'2026-09-20' -> '周六 9.20' presentation label (for Gorgon UI)."""
    if not date_str:
        return None
    try:
        d = date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None
    zh = "周" + list(_WEEKDAY_ZH.keys())[d.weekday()]
    return "%s %d.%d" % (zh, d.month, d.day)


def days_until(date_str, today):
    if not date_str:
        return None
    try:
        d = date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None
    return (d - today).days
