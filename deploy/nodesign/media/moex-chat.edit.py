#!/usr/bin/env python3
"""The MOEX preview: from the Jitter export (SLIDER-1-02-5-8.json) to media/moex-chat.lottie.json.

    python3 media/moex-chat.edit.py ~/Downloads/SLIDER-1-02-5-8.json && python3 media/lottie-to-js.py media/moex-chat.lottie.json moex-chat

- transparent: the grey backdrop, the dark floor gradient and the jitter.video watermark are dropped,
  so the page's glass plate shows through, as under the composer
- the carousel (null 21) is scaled 90 -> 125 %, re-pinned so the middle phone stays centred
- the carousel ring is closed: Jitter left 7 slots for 5 phones, so two empty slots rolled through the
  frame; a phone now jumps 5 slots instead of 6 and the loop is 5 slides instead of 6 (one repeated state)
- 50 fps instead of 60: the same keyframes, a little slower
"""
import json, os, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'moex-chat.lottie.json')
d = json.load(open(src))
by_ind = {l['ind']: l for l in d['layers']}

# 1. transparent, no watermark: shape 105 (backdrop), precomp 20 + null 16 (floor gradient), precomp 15 + null 7 (watermark)
d['layers'] = [l for l in d['layers'] if l['ind'] not in {105, 20, 16, 15, 7}]
def used(ids):
    out = set(ids)
    for a in d['assets']:
        if a['id'] in ids and 'layers' in a:
            out |= used({l['refId'] for l in a['layers'] if l.get('refId')})
    return out
keep = used({l['refId'] for l in d['layers'] if l.get('refId')})
d['assets'] = [a for a in d['assets'] if a['id'] in keep]

# 2. bigger phones: the carousel null scales up around the middle phone (x = 800 on the canvas)
car = by_ind[21]
S, MID_X = 1.25, 1107.15                       # middle phone's centre in the carousel's own space at frame 0
car['ks']['s']['k'] = [S * 100, S * 100]
car['ks']['p']['k'][0] = 800 - (MID_X - car['ks']['a']['k'][0]) * S

# 3. close the ring: after its jump a phone lands one slot nearer (5 slots, not 6); the loop ends where the
#    sixth slide would start, so every phone is back on its starting slot
SLOT, OP = 467, 648.48
for l in d['layers']:
    if l.get('ty') != 3 or l.get('parent') != 21:
        continue
    keys = l['ks']['p']['k']
    start = keys[0]['s'][0]
    jump_at = next((k['t'] for a, b in zip(keys, keys[1:]) if a['t'] == b['t'] and b['s'][0] > a['s'][0] for k in [b]), None)
    keys = [k for k in keys if k['t'] <= OP]
    if jump_at is not None:
        for k in keys:
            if k['t'] >= jump_at and k['s'][0] > start - SLOT:   # the jump key and everything after it
                k['s'][0] -= SLOT
                if 'e' in k: k['e'][0] -= SLOT
        # the pre-jump key that shares the jump's time keeps its value; the keys after the last slide equal frame 0 exactly
    for k in keys:
        if abs(k['s'][0] - start) <= 2 and k['t'] > OP - 20:
            k['s'][0] = start
    l['ks']['p']['k'] = keys
d['op'] = OP

# 4. a little slower
d['fr'] = 50

json.dump(d, open(out, 'w'), separators=(',', ':'))
print(f"wrote {out}: {len(d['layers'])} layers, {len(d['assets'])} assets, {d['fr']} fps, {(d['op'] - d['ip']) / d['fr']:.2f} s")
