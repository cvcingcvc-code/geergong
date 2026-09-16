# Source-text normalisation for display (PHASE 5).
#
# Some sources publish Markdown inside their own fields — Meetup event bodies
# are the clearest case — and JSON-embedded fields occasionally arrive
# double-escaped (`\n`, `\*\*`). Rendering either verbatim puts markup on the
# screen:
#
#     **Bringing Dubai AI to the Bay Area** \n 我们每周六 19:30 线下聚会
#
# The rule here is deliberately narrow and honest: remove the *markup*, keep
# every word the source wrote. Nothing is summarised, rewritten, shortened for
# style or invented — a normalised description is still the source's own text,
# just without the typewriter syntax a reader was never meant to see.
#
# Two properties the callers rely on:
#
#   * `plain_text` is IDEMPOTENT — normalising twice equals normalising once.
#     Descriptions pass through several stages (provider hint -> extracted
#     page -> canonical record -> view model), so it is called more than once.
#   * It is ASCII-aware about word boundaries. `\w` in Python matches CJK, so
#     the emphasis rules guard with an explicit `[0-9A-Za-z_]` class instead —
#     otherwise `我们**每周**聚会` would never have its asterisks removed.

import re

# --- backslash escapes ------------------------------------------------------
#
# A single pass with a lookup table, NOT sequential str.replace() calls: the
# latter would turn `\\n` (escaped backslash + "n") into a newline, which is
# wrong. One regex, one decision per escape.

_ESCAPE_RE = re.compile(r"\\(.)")
_ESCAPE_MAP = {
    "\\": "\\", "`": "`", "*": "*", "_": "_", "{": "{", "}": "}",
    "[": "[", "]": "]", "(": ")", ")": ")", "#": "#", "+": "+",
    "-": "-", ".": ".", "!": "!", ">": ">", "<": "<", "~": "~",
    "'": "'", '"': '"', "/": "/",
    "n": "\n", "r": "\r", "t": "\t",
}


def _decode_escapes(text):
    def sub(m):
        ch = m.group(1)
        if ch in _ESCAPE_MAP:
            return _ESCAPE_MAP[ch]
        return m.group(0)  # unknown escape (`C:\Users`) -> verbatim
    return _ESCAPE_RE.sub(sub, text)


# --- Markdown -> plain text -------------------------------------------------
#
# `_W` is the ASCII word class used for boundary guards (see module docstring).

_W = r"[0-9A-Za-z_]"

_MD_IMAGE_RE = re.compile(r"!\[[^\]\n]*\]\([^)\n]*\)")
_MD_LINK_RE = re.compile(r"\[([^\]\n]*)\]\([^)\n]*\)")
_MD_REF_LINK_RE = re.compile(r"\[([^\]\n]+)\]\[[^\]\n]*\]")
_MD_FENCE_RE = re.compile(r"^[ \t]{0,3}(?:```|~~~)[^\n]*$", re.M)
_MD_RULE_RE = re.compile(
    r"^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$", re.M)
_MD_HEADING_RE = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+", re.M)
# A heading marker in the MIDDLE of a line. Sources that store their body as one
# long line (or that were flattened upstream) leave `## What this event is about`
# stranded mid-sentence, where the line-anchored rule above can never see it.
# Two or more hashes are unambiguous markup; a single `#` is left alone because
# `参加 #1 上海最佳活动` is a real thing event titles say.
_MD_MIDHEADING_RE = re.compile(r"(^|\s)#{2,6}[ \t]+", re.M)
_MD_QUOTE_RE = re.compile(r"^[ \t]{0,3}>[ \t]?", re.M)
_MD_CODE_RE = re.compile(r"`([^`\n]+)`")

_MD_STRIKE_RE = re.compile(r"~~(?=\S)(.+?)(?<=\S)~~", re.S)

# Emphasis. The lookbehinds/lookaheads stop `snake_case` from being treated as
# markup, and `(?=\S)`/`(?<=\S)` stop `5 * 3` from pairing with a later `*`.
#
# The ITALIC left guard additionally excludes `*`, so a single `*` inside a
# `**` run is never taken for a delimiter: without it `a**b**c` degrades into
# `a*b*c` — half-stripped text, the worst of both worlds. Leaving an ambiguous
# run untouched is the honest outcome; mangling it is not.
#
# The italic CLOSER carries the mirror-image guard (`(?!\*)`). Without it a
# stray single `*` survives right next to a `**` run — the closer eats the first
# asterisk and abandons the second, so `hidden gem)**21:30` renders as
# `hidden gem)*21:30` and the leftover sweep has nothing left to clean.
_W_NO_STAR = r"[0-9A-Za-z_*]"

_MD_BOLD_RE = re.compile(
    r"(?<!%s)\*\*(?=\S)(.+?)(?<=\S)\*\*(?!%s)" % (_W, _W), re.S)
_MD_BOLD_U_RE = re.compile(
    r"(?<!%s)__(?=\S)(.+?)(?<=\S)__(?!%s)" % (_W, _W), re.S)
_MD_ITALIC_RE = re.compile(
    r"(?<!%s)\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)(?!%s)" % (_W_NO_STAR, _W))
_MD_ITALIC_U_RE = re.compile(
    r"(?<!%s)_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!%s)" % (_W, _W))

# After stripping, a field made ONLY of punctuation is an unpaired marker such
# as a lone `**` — never prose. It counts as missing, not as content.
_NOISE_ONLY_RE = re.compile(r"^[\s*_~`#>=\-—.·]+$")


# Leftover emphasis runs — the safety net, and the reason this module guarantees
# "no marker ever reaches the page".
#
# The paired rules above deliberately REFUSE ambiguous delimiters, because
# eating the asterisks in `a**b**c` or the underscores in `snake_case` would
# mangle real text. But a real Meetup body is full of pairs the guards reject —
# `**Cost:**` sitting next to `**Free**(`, or a bold run whose closing `**` is
# immediately followed by a digit. The result of refusing them is worse than
# either extreme: HALF-STRIPPED text, which is what PHASE 5 actually shipped
# until a screenshot showed `**19:30–21:30 … hidden gem**21:30`.
#
# So once the meaningful pairs have been handled, any `**` / `__` run still
# standing is unambiguously a marker: it is a typographic artifact, and a reader
# gains nothing from it. Single `*` and `_` are left untouched, so `5 * 3`,
# `snake_case` and `get_user_name` all survive.
_MD_LEFTOVER_STAR_RE = re.compile(r"\*{2,}")
_MD_LEFTOVER_UNDERSCORE_RE = re.compile(r"_{2,}")


def strip_markup(text):
    """Remove Markdown syntax; keep every word the author wrote."""
    text = _MD_IMAGE_RE.sub("", text)          # ![alt](url) -> nothing
    text = _MD_LINK_RE.sub(r"\1", text)        # [text](url) -> text
    text = _MD_REF_LINK_RE.sub(r"\1", text)    # [text][id]  -> text
    text = _MD_FENCE_RE.sub("", text)          # ``` fences
    text = _MD_RULE_RE.sub("", text)           # --- / *** / ___ rules
    text = _MD_MIDHEADING_RE.sub(r"\1", text)  # mid-line "## Heading"
    text = _MD_HEADING_RE.sub("", text)        # "## Heading" -> "Heading"
    text = _MD_QUOTE_RE.sub("", text)          # > quote   -> quote
    text = _MD_CODE_RE.sub(r"\1", text)        # `code`    -> code
    text = _MD_STRIKE_RE.sub(r"\1", text)
    text = _MD_BOLD_RE.sub(r"\1", text)
    text = _MD_BOLD_U_RE.sub(r"\1", text)
    text = _MD_ITALIC_RE.sub(r"\1", text)
    text = _MD_ITALIC_U_RE.sub(r"\1", text)
    text = _MD_LEFTOVER_STAR_RE.sub("", text)
    text = _MD_LEFTOVER_UNDERSCORE_RE.sub("", text)
    return text


def normalize_whitespace(text, keep_newlines=True):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if keep_newlines:
        text = re.sub(r"[ \t\u00a0]+", " ", text)
        text = re.sub(r" *\n *", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    else:
        text = re.sub(r"\s+", " ", text)
    return text.strip()


def plain_text(value, limit=None, keep_newlines=True):
    """Source prose -> the text a reader should have seen.

    None / blank input returns None (a missing value stays missing). Markup is
    removed, escapes are decoded, whitespace is tidied. Paragraph breaks are
    preserved when keep_newlines, because a prose block is rendered with
    `white-space: pre-wrap`.
    """
    if value is None:
        return None
    text = str(value)
    if not text.strip():
        return None
    text = _decode_escapes(text)
    text = strip_markup(text)
    text = normalize_whitespace(text, keep_newlines=keep_newlines)
    if not text or _NOISE_ONLY_RE.match(text):
        return None
    if limit is not None and len(text) > limit:
        text = text[:limit].rstrip()
    return text or None
