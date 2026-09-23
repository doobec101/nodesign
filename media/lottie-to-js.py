#!/usr/bin/env python3
"""Wrap a Lottie export as a classic script for the portfolio page.

    python3 media/lottie-to-js.py ~/Downloads/SLIDER-1-02-5-8.json moex-chat

writes media/moex-chat.js, which sets window.NODESIGN_MEDIA['moex-chat'] to the animation.
A classic <script src> loads from file:// where fetch() of a local .json would be refused.
Embedded PNGs are re-encoded as lossless WebP (pixel-identical, ~2.5x smaller); WebP assets pass through.
The edited source of the MOEX preview lives in media/moex-chat.lottie.json (the Jitter export minus backdrop,
floor gradient and watermark; carousel at 125 %; 50 fps).
"""
import base64, io, json, os, sys

src, name = sys.argv[1], sys.argv[2]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + '.js')
anim = json.load(open(src))

before = after = 0
try:
    from PIL import Image
except ImportError:
    Image = None
for asset in anim.get('assets', []):
    p = asset.get('p', '')
    if not p.startswith('data:image/png;base64,') or Image is None:
        continue
    raw = base64.b64decode(p.split(',', 1)[1])
    buf = io.BytesIO()
    Image.open(io.BytesIO(raw)).save(buf, 'WEBP', lossless=True, method=6)
    before += len(raw); after += len(buf.getvalue())
    asset['p'] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()

dur = (anim['op'] - anim['ip']) / anim['fr']
note = f"; images re-encoded as lossless WebP ({before/1e6:.1f} MB -> {after/1e6:.1f} MB)" if before else ""
header = (f"/* {name} — Lottie ({os.path.basename(src)}): {anim['w']}x{anim['h']}, {anim['fr']} fps, {dur:.2f} s.\n"
          f"   Built by media/lottie-to-js.py{note}. */\n")
with open(out, 'w') as f:
    f.write(header)
    f.write("window.NODESIGN_MEDIA = window.NODESIGN_MEDIA || {};\n")
    f.write(f"window.NODESIGN_MEDIA[{json.dumps(name)}] = ")
    json.dump(anim, f, separators=(',', ':'))
    f.write(";\n")
print(f"wrote {out}: {os.path.getsize(out)/1e6:.2f} MB (images {before/1e6:.2f} -> {after/1e6:.2f} MB)")
