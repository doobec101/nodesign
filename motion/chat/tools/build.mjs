#!/usr/bin/env node
// Build motion/chat/chat-promo.html: one self-contained file (it has to open from file:// and inside Playwright).
//
//   node motion/chat/tools/build.mjs            bundle src/main.js with esbuild, inline fonts, layers, the MacBook, beats
//
// Everything the page needs travels inside it: the JS bundle (three.js included), Inter (variable, latin + cyrillic),
// the Figma layers (WebP data URLs), the MacBook model (GLB, base64) and the beat grid.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');                         // motion/chat
const PROJ = resolve(ROOT, '..', '..');                   // portfolio2026
const b64 = p => readFileSync(p).toString('base64');

// layers: PNG exports from Figma → WebP (lossless for anything with alpha, q 94 for the opaque plates), cached
const LAYERS = join(ROOT, 'layers'), CACHE = join(ROOT, '..', 'out', 'chat-webp');
mkdirSync(CACHE, { recursive: true });
execFileSync('python3', ['-c', `
import os, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'): continue
    a, b = os.path.join(src, f), os.path.join(dst, f[:-4] + '.webp')
    if os.path.exists(b) and os.path.getmtime(b) >= os.path.getmtime(a): continue
    im = Image.open(a)
    opaque = im.mode != 'RGBA' or im.getchannel('A').getextrema()[0] == 255
    if opaque: im.convert('RGB').save(b, 'WEBP', quality=94, method=6)
    else: im.save(b, 'WEBP', lossless=True, method=6)
`, LAYERS, CACHE]);
const layers = {};
for (const f of readdirSync(CACHE).filter(f => f.endsWith('.webp')).sort()) {
  layers[f.replace(/\.webp$/, '')] = 'data:image/webp;base64,' + b64(join(CACHE, f));
}

const fonts = ['latin', 'cyrillic'].map(s => `@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:block;` +
  `src:url(data:font/woff2;base64,${b64(join(ROOT, 'fonts', `inter-var-${s}.woff2`))}) format('woff2');` +
  (s === 'latin' ? 'unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;'
                 : 'unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;') + '}').join('\n');

const glb = b64(join(PROJ, 'node_modules', 'rigged-macbook-3d', 'assets', 'macbook-rigged.glb'));
const beats = readFileSync(join(ROOT, 'data', 'beats.json'), 'utf8');
const figma = JSON.parse(readFileSync(join(ROOT, 'data', 'layout.json'), 'utf8'));

const bundle = await build({
  entryPoints: [join(ROOT, 'src', 'main.js')], bundle: true, format: 'iife', write: false, minify: false,
  target: 'chrome120', legalComments: 'none', absWorkingDir: PROJ, nodePaths: [join(PROJ, 'node_modules')],
});
const js = bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script');

const html = readFileSync(join(ROOT, 'src', 'page.html'), 'utf8')
  .replace('/*FONTS*/', () => fonts)
  .replace('/*ASSETS*/', () => JSON.stringify({ layers, glb, layout: figma }).replace(/<\//g, '<\\/'))
  .replace('/*BEATS*/', () => beats)
  .replace('/*BUNDLE*/', () => js);
const out = join(ROOT, 'chat-promo.html');
writeFileSync(out, html);
console.log(`${out}  ${(statSync(out).size / 1e6).toFixed(1)} MB  (js ${(js.length / 1e6).toFixed(2)} MB, ${Object.keys(layers).length} layers)`);
