#!/usr/bin/env python3
"""Pixel-compare two screenshot folders: prints changed-pixel % and max channel delta per image."""
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
worst = 0.0
for f in sorted(os.listdir(a)):
    if not f.endswith('.png') or not os.path.exists(os.path.join(b, f)):
        continue
    ia, ib = Image.open(os.path.join(a, f)).convert('RGB'), Image.open(os.path.join(b, f)).convert('RGB')
    if ia.size != ib.size:
        print(f"{f}: SIZE DIFFERS {ia.size} vs {ib.size}"); worst = 100; continue
    d = ImageChops.difference(ia, ib)
    bbox = d.getbbox()
    px = sum(1 for p in d.getdata() if max(p) > 0) if bbox else 0
    pct = 100 * px / (ia.size[0] * ia.size[1])
    mx = max(max(c) for c in d.getextrema()) if bbox else 0
    worst = max(worst, pct)
    print(f"{f}: {pct:.4f}% pixels differ, max delta {mx}, bbox {bbox}")
print(f"WORST {worst:.4f}%")
