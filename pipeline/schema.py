# Gorgon Data Pipeline — Canonical Activity Schema.
#
# PHASE 2: one schema shared by every stage. Missing fields stay null.
# Never invent facts just to fill a field.
#
# Status flow:
#   raw -> normalized -> needs_review -> approved
#                                   \-> rejected

STATUSES = ("raw", "normalized", "needs_review", "approved", "rejected")

# priceType is constrained (free / paid / unknown). price stays the raw-ish
# normalized number when it can be parsed deterministically.
PRICE_TYPES = ("free", "paid", "unknown")

# Canonical field list. `None` = allowed to be null.
ACTIVITY_FIELDS = [
    "id",                    # str, stable id (source-provided or derived)
    "title",                 # str|null
    "description",           # str|null
    "startDate",             # "YYYY-MM-DD"|null (normalized)
    "startTime",             # "HH:MM"|null (normalized, 24h)
    "endDate",               # "YYYY-MM-DD"|null
    "endTime",               # "HH:MM"|null
    "venue",                 # str|null (normalized trim)
    "address",               # str|null
    "district",              # str|null (normalized, e.g. "徐汇")
    "city",                  # str|null (normalized, e.g. "上海")
    "category",              # str|null (source claim, e.g. "ai" / "讲座")
    "tags",                  # list[str]
    "priceType",             # "free"|"paid"|"unknown"
    "price",                 # number|null (CNY) or short label like "学生 ¥29"
    "organizer",             # str|null
    "sourceName",            # str|null (which raw source this came from)
    "sourceUrl",             # str|null (link to the original listing)
    "registrationUrl",       # str|null
    "imageUrl",              # str|null (real image URL, or a local placeholder)
    "imageSource",           # str|null (og:image | twitter:image | json-ld | hero | thumbnail | placeholder)
    "agenda",                # list[{time,start,end,title}] — only when the source published one
    "publishedAt",           # str|null (source-provided publish time)
    "collectedAt",           # str|null (when our ingest collected it)
    "trustScore",            # int|null (0-100, set by trust stage)
    "trustReasons",          # list[str] (explainable scoring reasons)
    "status",                # one of STATUSES
    "duplicateOf",           # id of the canonical record, if duplicate
    "duplicateConfidence",   # float|null (0-1, dedupe similarity)
]

DEFAULTS = {
    "title": None,
    "description": None,
    "startDate": None,
    "startTime": None,
    "endDate": None,
    "endTime": None,
    "venue": None,
    "address": None,
    "district": None,
    "city": None,
    "category": None,
    "tags": [],
    "priceType": "unknown",
    "price": None,
    "organizer": None,
    "sourceName": None,
    "sourceUrl": None,
    "registrationUrl": None,
    "imageUrl": None,
    "imageSource": None,
    "agenda": [],
    "publishedAt": None,
    "collectedAt": None,
    "trustScore": None,
    "trustReasons": [],
    "status": "raw",
    "duplicateOf": None,
    "duplicateConfidence": None,
}


def new_activity(activity_id, source_name, raw_fields, collected_at=None):
    """Create a raw Activity with canonical defaults. Extra unknown keys are
    kept in `_extra` so raw source data is never silently dropped."""
    act = {"id": activity_id, "sourceName": source_name, "status": "raw"}
    if collected_at:
        act["collectedAt"] = collected_at
    extra = {}
    for key, value in raw_fields.items():
        if key in DEFAULTS:
            act[key] = value
        else:
            extra[key] = value
    act["_extra"] = extra
    return act


def fill_defaults(act):
    """Ensure every canonical field exists (null where missing)."""
    for key, default in DEFAULTS.items():
        act.setdefault(key, default if not isinstance(default, list) else list(default))
    act.setdefault("_extra", {})
    return act


def validate(act):
    """Structural validation only. Returns list of problems (empty = valid).
    Deliberately does NOT judge content quality — that is trust scoring."""
    problems = []
    if not act.get("id"):
        problems.append("missing_id")
    status = act.get("status")
    if status not in STATUSES:
        problems.append("bad_status:%s" % status)
    pt = act.get("priceType")
    if pt not in PRICE_TYPES:
        problems.append("bad_priceType:%s" % pt)
    for key in ("tags", "trustReasons", "agenda"):
        if act.get(key) is not None and not isinstance(act[key], list):
            problems.append("bad_type:%s" % key)
    score = act.get("trustScore")
    if score is not None and not isinstance(score, int):
        problems.append("bad_type:trustScore")
    return problems
