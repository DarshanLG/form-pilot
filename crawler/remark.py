"""Redraw set-of-marks on saved clean screenshots, without recrawling.

Usage:
    python crawler/remark.py --raw data/raw                 # writes <id>_marked.png next to each _clean.png
    python crawler/remark.py --raw data/raw --out /tmp/m    # elsewhere (to compare first)

Same look as MARK_JS in crawler/capture.py: 2px red box, white-on-red number top-right of the box,
except radio/checkbox numbers go top-left so they don't cover the option text.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RED = "#e11d48"
OPTION_TYPES = ("radio", "checkbox")
FONTS = ("consolab.ttf", "DejaVuSansMono-Bold.ttf", "LiberationMono-Bold.ttf")


def font() -> ImageFont.ImageFont:
    for name in FONTS:
        try:
            return ImageFont.truetype(name, 12)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_marks(img: Image.Image, marks: list[dict], fnt) -> Image.Image:
    d = ImageDraw.Draw(img)
    for m in marks:
        x, y, w, h = m["bbox"]
        d.rectangle([x, y, x + w - 1, y + h - 1], outline=RED, width=2)
        text = str(m["mark"])
        tw = d.textlength(text, font=fnt) + 8  # 4px padding each side
        tx = x - 4 - tw if m.get("type") in OPTION_TYPES else x + w + 4
        d.rounded_rectangle([tx, y, tx + tw, y + 16], radius=3, fill=RED)
        d.text((tx + 4, y + 8), text, font=fnt, fill="white", anchor="lm")
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", help="output dir (default: overwrite <id>_marked.png in --raw)")
    args = ap.parse_args()

    Image.MAX_IMAGE_PIXELS = None
    raw, fnt = Path(args.raw), font()
    out = Path(args.out) if args.out else raw
    out.mkdir(parents=True, exist_ok=True)
    for meta in sorted(raw.glob("*.json")):
        clean = raw / f"{meta.stem}_clean.png"
        if not clean.exists():
            continue
        rec = json.loads(meta.read_text(encoding="utf-8"))
        img = draw_marks(Image.open(clean).convert("RGB"), rec["marks"], fnt)
        img.save(out / f"{meta.stem}_marked.png")
        print(meta.stem, len(rec["marks"]))


if __name__ == "__main__":
    main()
