"""Turn a flat-white-background character sheet into a transparent-square app icon.

Usage (run with any Python that has Pillow + numpy):
    python tools/make_app_icon.py --src assets/app-icon.png \
        --png assets/app-icon.png --ico assets/app-icon.ico --preview assets/app-icon-256.png

The background is found by flood-filling inward from the image border, so whites that
are enclosed by line art (dress, hair highlights) are preserved. The edge is then
softened so the icon does not show a white halo on coloured wallpapers.
"""

import argparse
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def flood_background(rgb: np.ndarray, tolerance: int) -> np.ndarray:
    """Return a boolean mask of border-connected near-white pixels."""
    h, w, _ = rgb.shape
    white = 255 - rgb.astype(np.int16)
    near_white = np.abs(white).max(axis=2) <= tolerance  # every channel within tolerance of 255

    mask = np.zeros((h, w), dtype=bool)
    queue = deque()

    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not mask[y, x]:
                mask[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not mask[y, x]:
                mask[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True
                queue.append((ny, nx))
    return mask


def crop_square(img: Image.Image, margin_ratio: float = 0.04) -> Image.Image:
    bbox = img.split()[3].getbbox()
    if bbox:
        img = img.crop(bbox)
    side = max(img.size)
    margin = int(side * margin_ratio)
    canvas_side = side + margin * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(img, ((canvas_side - img.width) // 2, (canvas_side - img.height) // 2), img)
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--png", default="assets/app-icon.png")
    ap.add_argument("--ico", default="assets/app-icon.ico")
    ap.add_argument("--preview", default="assets/app-icon-256.png")
    ap.add_argument("--tolerance", type=int, default=26)
    ap.add_argument("--feather", type=float, default=0.8)
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()

    src = Image.open(args.src).convert("RGBA")
    rgb = np.array(src.convert("RGB"))
    bg = flood_background(rgb, args.tolerance)

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    alpha_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(args.feather))

    out = src.copy()
    out.putalpha(alpha_img)
    out = crop_square(out)

    big = out.resize((args.size, args.size), Image.LANCZOS)
    big.save(args.png)

    ico = out.resize((256, 256), Image.LANCZOS)
    ico.save(args.ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    out.resize((256, 256), Image.LANCZOS).save(args.preview)

    removed = int(bg.sum())
    print(f"background pixels cleared: {removed} / {bg.size} ({removed / bg.size:.1%})")
    print(f"wrote {args.png}, {args.ico}, {args.preview}")


if __name__ == "__main__":
    main()
