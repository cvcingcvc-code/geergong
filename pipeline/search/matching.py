"""Token matching for topic words — one rule, used everywhere.

The rule exists because a naive `token in text` is actively wrong for this
vocabulary. Chinese has no word delimiters, so a CJK token must match as a
substring ("智能体" inside a longer title is a real mention). Latin tokens must
not: "ai" as a substring matches Shangh**ai**, em**ai**l, av**ai**lable and
tr**ai**n, so every Shanghai event became an "AI 主题高度匹配" result and the
reason string shown to the user was simply false.

Hence: boundary-aware for latin, substring for CJK. One helper, so the
provider gate and the ranker can never disagree about what a mention is.
"""
import re

# CJK ideographs + kana + compatibility ideographs. Anything outside this is
# treated as a latin-ish token and gets word boundaries.
_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_EDGE_ALNUM = re.compile(r"[a-z0-9]")

_PATTERN_CACHE = {}


def token_pattern(token):
    """Compiled regex matching one topic token, or None for an empty token."""
    text = str(token or "").strip().casefold()
    if not text:
        return None
    cached = _PATTERN_CACHE.get(text)
    if cached is not None:
        return cached

    body = re.escape(text)
    # Anchor only the ends that are latin: "ai 产品" needs its leading
    # boundary (so "Shanghai 产品" fails) but its trailing char is CJK, and
    # there is nothing to anchor against on that side.
    lead = r"(?<![a-z0-9])" if _EDGE_ALNUM.match(text) else ""
    tail = r"(?![a-z0-9])" if _EDGE_ALNUM.search(text[-1]) else ""
    compiled = re.compile(lead + body + tail)
    _PATTERN_CACHE[text] = compiled
    return compiled


def mentions(text, tokens):
    """True when `text` mentions any of `tokens` under the rule above."""
    lowered = str(text or "").casefold()
    if not lowered:
        return False
    for token in tokens or ():
        pattern = token_pattern(token)
        if pattern is not None and pattern.search(lowered):
            return True
    return False


def matched_tokens(text, tokens):
    """The subset of `tokens` that `text` mentions, order preserved."""
    lowered = str(text or "").casefold()
    if not lowered:
        return []
    out = []
    for token in tokens or ():
        pattern = token_pattern(token)
        if pattern is not None and pattern.search(lowered):
            out.append(token)
    return out
