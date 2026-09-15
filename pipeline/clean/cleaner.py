# Cleaning stage (PHASE 5): strip HTML, junk chars, redundant whitespace,
# duplicate tags — while preserving the original semantics. No AI rewriting.

import re

from pipeline.normalize.text import (
    collapse_spaces,
    collapse_repeated_punct,
    strip_emoji,
    strip_junk_chars,
)

_HTML_TAG_RE = re.compile(r"<[^>]{1,200}>")
_ENTITY_MAP = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#39;": "'", "&nbsp;": " ", "&ldquo;": "“", "&rdquo;": "”",
}


def strip_html(text):
    if not isinstance(text, str):
        return text
    text = _HTML_TAG_RE.sub(" ", text)
    for ent, ch in _ENTITY_MAP.items():
        text = text.replace(ent, ch)
    return text


def tidy_text(text):
    """Strip HTML + junk + emoji + collapsed whitespace, keep meaning."""
    if not isinstance(text, str):
        return text
    text = strip_html(text)
    text = strip_emoji(text)
    text = strip_junk_chars(text)
    text = text.replace("\\n", " ")
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = collapse_repeated_punct(text)
    return collapse_spaces(text)


def dedupe_tags(tags):
    """Case-insensitive tag dedupe, order preserved."""
    if not isinstance(tags, list):
        return []
    seen = set()
    out = []
    for tag in tags:
        if not isinstance(tag, str):
            continue
        t = tidy_text(tag)
        if not t:
            continue
        key = t.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def clean_activity(act):
    """Clean one normalized activity in place. Returns the same dict."""
    for field in ("title", "description", "venue", "address", "organizer"):
        value = act.get(field)
        if isinstance(value, str):
            act[field] = tidy_text(value) or None
    act["tags"] = dedupe_tags(act.get("tags"))
    if isinstance(act.get("sourceUrl"), str):
        act["sourceUrl"] = act["sourceUrl"].strip() or None
    if isinstance(act.get("registrationUrl"), str):
        act["registrationUrl"] = act["registrationUrl"].strip() or None
    return act


def clean_all(activities):
    return [clean_activity(dict(a)) for a in activities]
