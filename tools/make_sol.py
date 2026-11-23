"""Cut Sol's full-body art out of its dark canvas.

The source is RGBA with an opaque background: a dark navy gradient plus a thin grid.
A pixel is background when it is either
  * close to the canvas colour sampled along the border (covers the gradient + grid), or
  * very dark (covers the darkest corners).
After the border-seeded flood fill we keep only the largest remaining foreground
component, which drops the leftover grid islands that would otherwise survive.

Usage:
    python tools/make_sol.py --preview                # write assets/sol/body.png + previews
    python tools/make_sol.py --tol 95 --lum 90        # more aggressive
"""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "sol" / "body-src.png"
OUT = ROOT / "assets" / "sol" / "body.png"
SHOTS = ROOT / "shots" / "sol"


def border_color(px, w: int, h: int):
    samples = []
    for x in range(0, w, max(1, w // 40)):
        samples.append(px[x, 0][:3])
        samples.append(px[x, h - 1][:3])
    for y in range(0, h, max(1, h // 40)):
        samples.append(px[0, y][:3])
        samples.append(px[w - 1, y][:3])
    samples.sort(key=lambda c: c[0] + c[1] + c[2])
    mid = samples[len(samples) // 2]
    return mid


def cut(im: Image.Image, tol: float, dark_lum: float, feather: float) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    ref = border_color(px, w, h)
    rr, rg, rb = ref

    def is_bg(r: int, g: int, b: int, a: int) -> bool:
        if a == 0:
            return True
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if lum < dark_lum:
            return True
        return ((r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2) ** 0.5 < tol

    alpha = bytearray(w * h)
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        idx = y * w + x
        if seen[idx]:
            continue
        r, g, b, a = px[x, y]
        if not is_bg(r, g, b, a):
            continue
        seen[idx] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))

    # Anything the background flood never reached belongs to the character (including
    # enclosed holes such as eyes and outline interiors).
    for i in range(w * h):
        if not seen[i]:
            alpha[i] = 255

    # Everything the flood did not reach is foreground; keep only the largest blob so
    # grid fragments floating outside the silhouette disappear.
    visited = bytearray(w * h)
    best = 0
    best_id = -1
    comp = [0] * (w * h)
    cid = 0
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if visited[i] or not alpha[i]:
                continue
            cid += 1
            size = 0
            stack = [(x, y)]
            visited[i] = 1
            while stack:
                cx, cy = stack.pop()
                comp[cy * w + cx] = cid
                size += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if alpha[j] and not visited[j]:
                            visited[j] = 1
                            stack.append((nx, ny))
            if size > best:
                best = size
                best_id = cid

    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not alpha[i] or comp[i] != best_id:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)

    if feather > 0:
        im.putalpha(im.getchannel("A").filter(ImageFilter.GaussianBlur(feather)))
    return im


def trim_pad(im: Image.Image, margin: float) -> Image.Image:
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    pad = int(max(im.size) * margin)
    canvas = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(im, (pad, pad))
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--tol", type=float, default=78.0, help="colour distance from canvas colour")
    ap.add_argument("--lum", type=float, default=92.0, help="luminance below this is always background")
    ap.add_argument("--feather", type=float, default=0.8)
    ap.add_argument("--margin", type=float, default=0.04)
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    im = Image.open(Path(args.src))
    out_im = trim_pad(cut(im, args.tol, args.lum, args.feather), args.margin)
    if out_im.height != args.height:
        scale = args.height / out_im.height
        out_im = out_im.resize((max(1, round(out_im.width * scale)), args.height), Image.LANCZOS)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out_im.save(out)
    print(f"body -> {out} ({out.stat().st_size}B, {out_im.width}x{out_im.height})")

    if args.preview:
        SHOTS.mkdir(parents=True, exist_ok=True)
        for bg, label in (((234, 247, 240, 255), "mint"), ((15, 42, 34, 255), "dark")):
            canvas = Image.new("RGBA", (out_im.width + 40, out_im.height + 40), bg)
            canvas.alpha_composite(out_im, (20, 20))
            p = SHOTS / f"body-on-{label}.png"
            canvas.convert("RGB").save(p)
            print(f"preview -> {p}")


if __name__ == "__main__":
    main()
