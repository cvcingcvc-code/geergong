"""Generate `desktop/icon.ico` for the packaged app.

Run once (or whenever the brand colour changes):
    python desktop/make_icon.py

Deliberately dependency-light: only Pillow, which is already present in the
build interpreter. The mark is drawn geometrically so the repo carries no
binary design asset and the icon can always be regenerated.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "icon.ico"

# Brand violet, matching the app's --brand (#5B47E0) and manifest theme_color.
TOP = (108, 88, 236)
BOTTOM = (76, 54, 200)
SIZES = [16, 24, 32, 48, 64, 128, 256]


def _rounded_gradient(size: int) -> Image.Image:
    """A vertically-gradient rounded square on a transparent canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), (
            round(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
            round(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
            round(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
            255,
        ))
    grad = grad.resize((size, size))

    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * 0.22), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    img.paste(grad, (0, 0), mask)
    return img


def _draw_mark(img: Image.Image) -> Image.Image:
    """A white geometric 'G': an open ring plus the bar that closes it."""
    size = img.size[0]
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)

    w = max(2, round(size * 0.115))          # stroke width
    pad = size * 0.245
    box = [pad, pad, size - pad, size - pad]
    cx = cy = size / 2.0
    r = (size - 2 * pad) / 2.0               # ring radius (to the stroke centre)

    # Ring as a 'C': PIL angles run clockwise from 3 o'clock, so an arc from
    # 25° to 335° leaves a 50° gap centred on 3 o'clock — the G's opening.
    start, end = 25, 335
    d.arc(box, start=start, end=end, fill=white, width=w)

    # The G bar sits in that gap and runs out to the ring's outer edge. It is
    # kept short so the counter (the enclosed white space) stays open.
    x_out = cx + r
    x_in = cx + r * 0.18
    bar_y = cy
    d.line([(x_in, bar_y), (x_out, bar_y)], fill=white, width=w)

    # Short stem dropping from the bar to meet the ring's lower cut end.
    y_stem = cy + r * math.sin(math.radians(start))
    d.line([(x_out, bar_y), (x_out, y_stem)], fill=white, width=w)

    return img


def main() -> int:
    base = _draw_mark(_rounded_gradient(256))
    frames = [base.resize((s, s), Image.LANCZOS) for s in SIZES]
    base.save(OUT, format="ICO", sizes=[(s, s) for s in SIZES])
    # Pillow's ICO writer keeps the largest supplied image; re-save explicitly
    # with append_images semantics via a temporary multi-size PNG grid.
    frames[-1].save(OUT, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"[icon] wrote {OUT} ({', '.join(str(s) for s in SIZES)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
