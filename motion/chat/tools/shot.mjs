#!/usr/bin/env node
// Stills from motion/chat/chat-promo.html through headless Chrome (GPU, Metal).
//
//   node motion/chat/tools/shot.mjs <name> "<query>" [t …]      → motion/out/chat/<name>[-t].png
//   node motion/chat/tools/shot.mjs sheet <name> "<query>" t0 t1 [n]   → a 4-column contact sheet of n frames
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, '..', 'out', 'chat');
mkdirSync(OUT, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); }
  catch { return require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }
})();

export async function openPage(query = '', { dsf = 1 } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: dsf });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('page error:', e.message); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text().slice(0, 300)); });
  await page.goto(pathToFileURL(join(ROOT, 'chat-promo.html')).href + '?render&' + query);
  await page.waitForFunction(() => window.READY === true || document.title.startsWith('ERROR'), null, { timeout: 120000 });
  const title = await page.title();
  if (title.startsWith('ERROR')) throw new Error(title);
  return { browser, page, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === 'sheet') {
    const [, name, query, t0, t1, n = 12] = args;
    const { browser, page } = await openPage(query);
    const tiles = [];
    for (let i = 0; i < Number(n); i++) {
      const t = Number(t0) + (Number(t1) - Number(t0)) * i / (Number(n) - 1);
      await page.evaluate(t => window.seek(t), t);
      const f = join(OUT, `sheet-${name}-${i}.jpg`);
      writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 90 }));
      tiles.push(`<figure><img src="${pathToFileURL(f).href}?${Date.now()}"><figcaption>${t.toFixed(2)} s</figcaption></figure>`);
    }
    await page.setContent(`<style>body{margin:0;background:#333;display:grid;grid-template-columns:repeat(4,400px)}
      figure{margin:0;position:relative;width:400px;height:300px}img{width:400px;height:300px;display:block}
      figcaption{position:absolute;left:6px;top:6px;padding:2px 6px;border-radius:4px;background:#5041ff;color:#fff;font:600 13px/16px sans-serif}</style>${tiles.join('')}`);
    await page.waitForLoadState('load');
    const f = join(OUT, `sheet-${name}.jpg`);
    writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 88, fullPage: true }));
    await browser.close();
    console.log(f);
  } else {
    const [name, query = '', ...ts] = args;
    const { browser, page } = await openPage(query);
    for (const t of (ts.length ? ts : ['0'])) {
      await page.evaluate(t => window.seek(t), Number(t));
      const f = join(OUT, `${name}${ts.length > 1 ? '-' + t : ''}.png`);
      writeFileSync(f, await page.screenshot({ type: 'png' }));
      console.log(f);
    }
    await browser.close();
  }
}
