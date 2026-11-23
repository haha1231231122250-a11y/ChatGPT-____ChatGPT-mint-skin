"""Cut one expression out of a 3x3 sticker sheet and clear its white background.

Usage:
    python tools/make_chibi.py --cell 1                 # top-left, 1..9 reading order
    python tools/make_chibi.py --cell 5 --out assets/chibi/chibi-angry.png
    python tools/make_chibi.py --preview-all            # write previews/chibi-cell-N.png

The sheet is assumed to be a square 3x3 grid. White background is removed by a
flood fill that starts at the borders, so enclosed white areas (hair highlights,
sleeves) survive. Because the sheet's tiles are light-on-light, a generous
tolerance plus a small feather keeps the outline clean.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "assets" / "chibi" / "sheet-src.png"
DEFAULT_OUT = ROOT / "assets" / "chibi" / "chibi-happy.png"
STATE = ROOT / "shots" / "chibi"


def flood_clear_white(im: Image.Image, tolerance: int, feather: float) -> Image.Image:
    """Make border-connected near-white pixels transparent."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    visited = bytearray(w * h)
    stack = []

    def is_bg(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        if a == 0:
            return True
        return r >= 255 - tolerance and g >= 255 - tolerance and b >= 255 - tolerance

    for x in range(w):
        for y in (0, h - 1):
            if is_bg(x, y):
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(x, y):
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        if not is_bg(x, y):
            continue
        px[x, y] = (255, 255, 255, 0)
        if x > 0:
            stack.append((x - 1, y))
        if x < w - 1:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y < h - 1:
            stack.append((x, y + 1))

    if feather > 0:
        alpha = im.getchannel("A").filter(ImageFilter.GaussianBlur(feather))
        im.putalpha(alpha)
    return im


def square_pad(im: Image.Image, margin: float) -> Image.Image:
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    side = max(im.size)
    pad = int(side * margin)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(SHEET))
    ap.add_argument("--cell", type=int, default=1, help="1..9, reading order")
    ap.add_argument("--out", default="")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--tolerance", type=int, default=30)
    ap.add_argument("--feather", type=float, default=0.6)
    ap.add_argument("--margin", type=float, default=0.03)
    ap.add_argument("--preview-all", action="store_true")
    args = ap.parse_args()

    src = Image.open(Path(args.src))
    w, h = src.size
    cw, ch = w // 3, h // 3

    def cut(cell: int) -> Image.Image:
        idx = cell - 1
        col, row = idx % 3, idx // 3
        tile = src.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        return square_pad(flood_clear_white(tile, args.tolerance, args.feather), args.margin)

    if args.preview_all:
        STATE.mkdir(parents=True, exist_ok=True)
        sheet = Image.new("RGBA", (args.size * 3 + 40, args.size * 3 + 40), (18, 48, 40, 255))
        for cell in range(1, 10):
            im = cut(cell).resize((args.size, args.size), Image.LANCZOS)
            x = ((cell - 1) % 3) * (args.size + 10) + 5
            y = ((cell - 1) // 3) * (args.size + 10) + 5
            sheet.alpha_composite(im, (x, y))
        out = STATE / "preview-all.png"
        sheet.convert("RGB").save(out)
        print(f"sheet -> {out}")
        return

    out = Path(args.out) if args.out else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    im = cut(args.cell).resize((args.size, args.size), Image.LANCZOS)
    im.save(out)
    print(f"cell {args.cell} -> {out} ({out.stat().st_size}B)")


if __name__ == "__main__":
    main()
