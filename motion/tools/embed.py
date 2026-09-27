#!/usr/bin/env python3
"""Keep ds-promo.html a single file: inline the Inter faces and the beat data into their marked blocks.

    python3 motion/tools/embed.py [path/to/fontsource-inter/files]

- <style id="fonts">…</style>                        Inter 400/500/600, latin subset, woff2 as data: URIs (OFL-1.1)
- <script type="application/json" id="beats">…</script>  motion/data/beats.json minus the per-beat table

The font files come from the @fontsource/inter npm package (`npm pack @fontsource/inter`); pass the
package's files/ directory, or leave the current fonts in place when it is omitted.
"""
import base64, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HTML = os.path.join(ROOT, 'ds-promo.html')
BEATS = os.path.join(ROOT, 'data', 'beats.json')


def replace_block(html, open_re, close, body):
    m = re.search(open_re, html)
    if not m:
        raise SystemExit(f'marker not found: {open_re}')
    end = html.index(close, m.end())
    return html[:m.end()] + body + html[end:]


def main():
    html = open(HTML, encoding='utf-8').read()
    if len(sys.argv) > 1:
        faces = []
        for w in (400, 500, 600):
            with open(os.path.join(sys.argv[1], f'inter-latin-{w}-normal.woff2'), 'rb') as f:
                b64 = base64.b64encode(f.read()).decode()
            faces.append(f'@font-face{{font-family:Inter;font-style:normal;font-weight:{w};font-display:block;'
                         f'src:url(data:font/woff2;base64,{b64}) format("woff2")}}')
        html = replace_block(html, r'<style id="fonts">', '</style>', '\n' + '\n'.join(faces) + '\n')
    data = json.load(open(BEATS))
    keep = {k: data[k] for k in ('source', 'bpm', 'period', 'bar', 'drop', 'window', 'sections', 'eq')}
    keep['accents'] = [b['onset'] for b in data['beats']]
    html = replace_block(html, r'<script type="application/json" id="beats">', '</script>', json.dumps(keep, separators=(',', ':')))
    open(HTML, 'w', encoding='utf-8').write(html)
    print(f'{HTML}: {len(html) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
