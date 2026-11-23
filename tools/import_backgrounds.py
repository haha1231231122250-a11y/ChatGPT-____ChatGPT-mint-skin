#!/usr/bin/env python3
"""Import wallpaper sources into ``assets/backgrounds`` as WebP + index.json.

Sources live in ``assets/backgrounds/_src`` and are named ``NN-<chinese title>.png``
(``NN`` keeps the display order).  Each source becomes ``bg-NN.webp`` and one entry
in ``index.json``:

    [{"id": "bg-01", "name": "翡翠玫瑰宫", "asset": "assets/backgrounds/bg-01.webp"}]

Usage:
    python tools/import_backgrounds.py                  # all sources
    python tools/import_backgrounds.py --width 1440 --quality 74
    python tools/import_backgrounds.py --force          # re-encode existing outputs
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - Pillow ships with the DSH runtime
    print("Pillow is required (pip install pillow)", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "backgrounds"
SRC_DIR = OUT_DIR / "_src"
INDEX = OUT_DIR / "index.json"

SOURCE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
NAME_RE = re.compile(r"^(\d{2})[-_ ]?(.+)$")


def parse_name(path: Path) -> tuple[str, str]:
    """``03-秋日童话.png`` -> (``03``, ``秋日童话``)."""
    stem = path.stem
    m = NAME_RE.match(stem)
    if m:
        return m.group(1), m.group(2).strip()
    return "", stem.strip()


def load_existing() -> dict[str, dict]:
    if not INDEX.exists():
        return {}
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {entry.get("asset", ""): entry for entry in data if isinstance(entry, dict)}


def convert(src: Path, out: Path, width: int, quality: int) -> tuple[int, int, int]:
    """Resize to a ``width`` long edge (never upscale) and save as WebP."""
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, width / max(w, h))
        if scale < 1.0:
            im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        im.save(out, "WEBP", quality=quality, method=6)
        size = out.stat().st_size
    return im.size[0], im.size[1], size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--width", type=int, default=1600, help="max long edge (default 1600)")
    ap.add_argument("--quality", type=int, default=78, help="WebP quality (default 78)")
    ap.add_argument("--force", action="store_true", help="re-encode outputs that already exist")
    args = ap.parse_args()

    if not SRC_DIR.is_dir():
        print(f"missing source directory: {SRC_DIR}", file=sys.stderr)
        return 2

    sources = sorted(
        (p for p in SRC_DIR.iterdir() if p.suffix.lower() in SOURCE_SUFFIXES),
        key=lambda p: (p.stem.split("-")[0], p.name),
    )
    if not sources:
        print(f"no images in {SRC_DIR}", file=sys.stderr)
        return 2

    existing = load_existing()
    entries: list[dict] = []
    total = 0
    print(f"{'id':<6}{'name':<26}{'source':>16}{'output':>16}{'size':>10}")
    for src in sources:
        order, name = parse_name(src)
        if not order:
            order = f"{len(entries) + 1:02d}"
        with Image.open(src) as probe:
            src_size = f"{probe.width}x{probe.height}"
        asset_rel = f"assets/backgrounds/bg-{order}.webp"
        out = ROOT / asset_rel
        if out.exists() and not args.force:
            with Image.open(out) as im:
                w, h = im.size
            size = out.stat().st_size
            kept = True
        else:
            w, h, size = convert(src, out, args.width, args.quality)
            kept = False
        total += size
        entry = {"id": f"bg-{order}", "name": name, "asset": asset_rel}
        entries.append(entry)
        print(
            f"{entry['id']:<6}{name:<26}{src_size:>16}"
            f"{f'{w}x{h}':>16}{f'{size / 1024:.0f}KB':>10}"
            + ("  (kept)" if kept else "")
        )

    INDEX.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n{len(entries)} backgrounds, output {total / 1024 / 1024:.2f} MB, index -> {INDEX.relative_to(ROOT)}")
    print("payload estimate:", f"{total * 4 / 3 / 1024 / 1024:.2f} MB as base64 data URLs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
