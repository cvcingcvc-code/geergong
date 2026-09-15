# Category placeholders (PHASE 5).
#
# Not every real event page publishes an image, and a card without an image
# must not collapse the layout. So every activity always has SOMETHING to
# render — but a placeholder is never allowed to masquerade as source data:
# it is registered with imageSource="placeholder", and the UI shows the
# neutral category illustration only in that case.
#
# The SVGs are deterministic (same bytes for the same slug), written once
# into assets/placeholders/ and committed, so running the pipeline never
# produces spurious git churn.

import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLACEHOLDER_DIR = os.path.join(REPO_ROOT, "assets", "placeholders")
PLACEHOLDER_URL_BASE = "/assets/placeholders"

# slug -> (label, accent, tint)
CATEGORIES = {
    "ai":         ("AI",          "#5B47E0", "#EEEBFE"),
    "agent":      ("AGENT",       "#4338CA", "#E8E6FD"),
    "vibecoding": ("VIBE CODING", "#7C3AED", "#F1EAFE"),
    "hackathon":  ("HACKATHON",   "#0F766E", "#E1F5F2"),
    "meetup":     ("MEETUP",      "#1D4ED8", "#E4ECFE"),
    "demoday":    ("DEMO DAY",    "#B45309", "#FDF0DC"),
    "exhibition": ("展览",         "#9D174D", "#FCE7F1"),
    "startup":    ("创业",         "#047857", "#E1F6EE"),
    "talk":       ("分享会",       "#BE123C", "#FDE7EC"),
    "workshop":   ("WORKSHOP",    "#0369A1", "#E2F1FB"),
    "party":      ("派对",         "#C2410C", "#FDEBE0"),
    "sports":     ("运动",         "#15803D", "#E4F4E7"),
    "default":    ("GORGON",      "#5B47E0", "#EDEBFB"),
}

# Keyword -> slug. Checked against category / tags / title, in this order,
# so a title mentioning "hackathon" upgrades the generic "ai" bucket.
_KEYWORDS = (
    ("hackathon", ("hackathon", "黑客松", "hack", "编程马拉松")),
    ("demoday", ("demo day", "demoday", "路演", "demo night", "展示日")),
    ("vibecoding", ("vibe coding", "vibecoding", "vibe-coding")),
    ("agent", ("agent", "智能体", "llm", "大模型", "rag", "mcp")),
    ("meetup", ("meetup", "沙龙", "交流", "线下聚会", "networking")),
    ("workshop", ("workshop", "工作坊", "训练营", "bootcamp", "课程")),
    ("exhibition", ("展览", "展", "expo", "博览会", "艺术")),
    ("startup", ("创业", "投资", "融资", "startup", "vc", "路演会")),
    ("talk", ("分享", "讲座", "talk", "论坛", "峰会", "summit")),
    ("party", ("派对", "party", "市集", "音乐")),
    ("sports", ("运动", "跑步", "骑行", "球", "瑜伽", "户外")),
    ("ai", ("ai", "人工智能", "机器学习", "深度学习", "算法", "科技")),
)


def slug_for(*texts):
    """Pick the most specific placeholder slug for the given text blobs."""
    haystack = " ".join(str(t).casefold() for t in texts if t)
    if not haystack:
        return "default"
    for slug, words in _KEYWORDS:
        for word in words:
            if word in haystack:
                return slug
    return "default"


def render_svg(slug):
    """Deterministic placeholder artwork for one slug."""
    label, accent, tint = CATEGORIES.get(slug, CATEGORIES["default"])
    safe = label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    font_size = 54 if len(label) <= 6 else 40
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" '
        'width="640" height="360" role="img" aria-label="{safe}">'
        '<defs>'
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0%" stop-color="{tint}"/>'
        '<stop offset="100%" stop-color="#FFFFFF"/>'
        '</linearGradient>'
        '</defs>'
        '<rect width="640" height="360" fill="url(#g)"/>'
        '<g opacity="0.16" stroke="{accent}" stroke-width="2">'
        '<path d="M0 90 H640 M0 180 H640 M0 270 H640 M160 0 V360 M320 0 V360 M480 0 V360"/>'
        '</g>'
        '<circle cx="552" cy="84" r="46" fill="{accent}" opacity="0.14"/>'
        '<circle cx="88" cy="288" r="64" fill="{accent}" opacity="0.10"/>'
        '<rect x="40" y="40" width="8" height="72" rx="4" fill="{accent}"/>'
        '<text x="76" y="204" font-family="Inter, \'PingFang SC\', \'Microsoft YaHei\', '
        'system-ui, sans-serif" font-size="{font_size}" font-weight="800" '
        'fill="{accent}" letter-spacing="1">{safe}</text>'
        '<text x="76" y="242" font-family="Inter, \'PingFang SC\', \'Microsoft YaHei\', '
        'system-ui, sans-serif" font-size="19" font-weight="600" fill="{accent}" '
        'opacity="0.66">GORGON · 暂无图片</text>'
        '</svg>'
    )


def placeholder_path(slug):
    return os.path.join(PLACEHOLDER_DIR, "%s.svg" % slug)


def placeholder_url(slug, base=PLACEHOLDER_URL_BASE):
    slug = slug if slug in CATEGORIES else "default"
    return "%s/%s.svg" % (base.rstrip("/"), slug)


def ensure_placeholder_files(directory=None):
    """Write any missing placeholder SVG. Idempotent + deterministic."""
    directory = directory or PLACEHOLDER_DIR
    written = []
    if not os.path.isdir(directory):
        os.makedirs(directory)
    for slug in sorted(CATEGORIES):
        path = os.path.join(directory, "%s.svg" % slug)
        content = render_svg(slug)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                if fh.read() == content:
                    continue
        except (OSError, UnicodeDecodeError):
            pass
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
        written.append(path)
    return written


def is_placeholder(url):
    if not url:
        return False
    return "/assets/placeholders/" in str(url) or str(url).startswith("placeholder:")


def placeholder_slug_of(url):
    if not url:
        return None
    m = re.search(r"/assets/placeholders/([\w\-]+)\.svg", str(url))
    return m.group(1) if m else None
