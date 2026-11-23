"""Sample pixels from a screenshot (CSS coords x DPR) to identify stray accents.

Usage: python tools/sample_pixels.py shots/work-tab-01.png 1.5 1012,67 700,630
"""
import sys
from PIL import Image

path = sys.argv[1]
dpr = float(sys.argv[2])
img = Image.open(path).convert("RGB")
print(f"{path} {img.width}x{img.height} dpr={dpr}")
for spec in sys.argv[3:]:
    x, y = (float(v) for v in spec.split(","))
    px = int(round(x * dpr))
    py = int(round(y * dpr))
    px = max(0, min(img.width - 1, px))
    py = max(0, min(img.height - 1, py))
    r, g, b = img.getpixel((px, py))
    print(f"  css({x:.0f},{y:.0f}) px({px},{py}) -> #{r:02x}{g:02x}{b:02x}")
