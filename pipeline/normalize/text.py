# Deterministic text normalization helpers (PHASE 4).
#
# No LLM. Pure string rules, fully explainable and idempotent.

import re

# Full-width -> half-width pairs + common unicode variants.
_FULLWIDTH_MAP = {
    "，": ",", "。": ".", "！": "!", "？": "?", "：": ":", "；": ";",
    "（": "(", "）": ")", "《": "<", "》": ">", "“": '"', "”": '"',
    "‘": "'", "’": "'", "｜": "|", "～": "~",
}

# Zero-width / junk characters that carry no meaning.
_JUNK_RE = re.compile(
    "[\u200b\u200c\u200d\ufeff\u2060\u202a-\u202e]"  # zero-width & bidi marks
)

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\u2b50\u2705\u274c\u2764\ufe0f]"
)


def to_halfwidth(text):
    if not isinstance(text, str):
        return text
    out = []
    for ch in text:
        code = ord(ch)
        if ch in _FULLWIDTH_MAP:
            out.append(_FULLWIDTH_MAP[ch])
        elif code == 0x3000:  # ideographic space
            out.append(" ")
        elif 0xFF01 <= code <= 0xFF5E and ch not in ("～",):
            out.append(chr(code - 0xFEE0))
        elif code in (0xA5, 0xFFE5):  # yen signs stay as-is (price logic uses them)
            out.append(ch)
        else:
            out.append(ch)
    return "".join(out)


def collapse_spaces(text):
    if not isinstance(text, str):
        return text
    return re.sub(r"[ \t\r\f\v]+", " ", text.replace("\u3000", " ")).strip()


def collapse_repeated_punct(text):
    """!!! -> !  ？？？ -> ?  。。。 -> 。 ……. collapse runs of the same punct."""
    if not isinstance(text, str):
        return text
    text = re.sub(r"([!！?？~—|])\1{1,}", lambda m: m.group(1)[:1], text)
    text = re.sub(r"([.,。;；])\1{1,}", lambda m: m.group(1)[:1], text)
    text = re.sub(r"\.{3,}", "...", text)
    return text


def strip_emoji(text):
    if not isinstance(text, str):
        return text
    return _EMOJI_RE.sub(" ", text)


def strip_junk_chars(text):
    if not isinstance(text, str):
        return text
    return _JUNK_RE.sub("", text)


def normalize_title(text):
    """Title normalization: trim, full-width folding, collapse spaces,
    collapse repeated punctuation, drop decorative wraps like 【】/[]/「」
    prefixes and trailing separators. Keeps the original semantics."""
    if not isinstance(text, str):
        return None
    t = strip_junk_chars(to_halfwidth(text))
    t = collapse_spaces(t)
    t = collapse_repeated_punct(t)
    # Remove decorative brackets commonly used for shouting, keep inner text.
    t = re.sub(r"[\[【〔]\s*转载\s*[\]】〕]\s*", "", t)
    t = t.strip()
    # Collapse whitespace left by emoji/bracket removal.
    t = collapse_spaces(t)
    return t or None


def title_key(text):
    """Case/punct-insensitive key for dedupe matching."""
    if not isinstance(text, str):
        return ""
    t = normalize_title(text) or ""
    t = t.casefold()
    t = re.sub(r"[\s\-—·:：,，。.!！?？()'\"（）【】\[\]{}|/\\]+", "", t)
    return t


def similarity(a, b):
    """0-1 similarity between two title strings (difflib based)."""
    import difflib

    ka, kb = title_key(a), title_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    return difflib.SequenceMatcher(None, ka, kb).ratio()
