"""Shrink runtime art for release: PNG -> WebP (alpha kept).

Run:  python tools/optimize_assets.py
The script is idempotent: it re-encodes the sources under assets/ into *.webp and
prints a before/after table. config/skin.json and src/assets.mjs already point at
the .webp files, so nothing else needs to change after running it.
"""

from __future__ import annotations

import argparse
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (source, output, max size, quality)
MANIFEST = [
    ("assets/sol/body.png", "assets/sol/body.webp", (424, 1024), 90),
    ("assets/sol/emote-idle.png", "assets/sol/emote-idle.webp", (384, 384), 88),
    ("assets/sol/emote-listening.png", "assets/sol/emote-listening.webp", (384, 384), 88),
    ("assets/sol/emote-thinking.png", "assets/sol/emote-thinking.webp", (384, 384), 88),
    ("assets/sol/emote-done.png", "assets/sol/emote-done.webp", (384, 384), 88),
    ("assets/sol/emote-error.png", "assets/sol/emote-error.webp", (384, 384), 88),
    ("assets/sol/emote-hug.png", "assets/sol/emote-hug.webp", (384, 384), 88),
    ("assets/chibi/chibi-happy.png", "assets/chibi/chibi-happy.webp", (256, 256), 90),
]

BACKGROUND = ("assets/background-garden.webp", (1920, 1200), 84)


def kb(path: str) -> str:
    if not os.path.exists(path):
        return "-"
    return f"{os.path.getsize(path) / 1024:.0f}K"


def convert(src: str, dst: str, box: tuple[int, int], quality: int) -> None:
    with Image.open(src) as im:
        im = im.convert("RGBA")
        im.thumbnail(box, Image.LANCZOS)
        out = os.path.join(ROOT, dst)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.save(out, "WEBP", quality=quality, method=6)
        print(f"{src:38s} {kb(os.path.join(ROOT, src)):>7s} -> {dst:35s} {kb(out):>7s}  {im.size}")


def convert_background() -> None:
    src_rel, box, quality = BACKGROUND
    src = os.path.join(ROOT, src_rel)
    if not os.path.exists(src):
        print(f"skip (missing): {src_rel}")
        return
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail(box, Image.LANCZOS)
        tmp = src + ".tmp.webp"
        im.save(tmp, "WEBP", quality=quality, method=6)
    before = os.path.getsize(src)
    os.replace(tmp, src)
    print(f"{src_rel:38s} {before / 1024:.0f}K -> {os.path.getsize(src) / 1024:.0f}K  {im.size}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="also write shots/assets-preview.png")
    args = ap.parse_args()

    for src, dst, box, q in MANIFEST:
        if not os.path.exists(os.path.join(ROOT, src)):
            print(f"skip (missing): {src}")
            continue
        convert(src, dst, box, q)

    convert_background()

    total = 0
    for _, dst, _, _ in MANIFEST:
        p = os.path.join(ROOT, dst)
        if os.path.exists(p):
            total += os.path.getsize(p)
    print(f"runtime art total: {total / 1024:.0f} KB")

    if args.preview:
        from PIL import Image as I

        canvas = I.new("RGBA", (900, 320), (18, 48, 40, 255))
        x = 10
        for _, dst, _, _ in MANIFEST:
            p = os.path.join(ROOT, dst)
            if not os.path.exists(p):
                continue
            with I.open(p) as im:
                im = im.convert("RGBA")
                im.thumbnail((140, 300), I.LANCZOS)
                canvas.alpha_composite(im, (x, 10))
                x += 150
        out = os.path.join(ROOT, "shots", "assets-preview.png")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        canvas.convert("RGB").save(out)
        print("preview ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
