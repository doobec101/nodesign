#!/usr/bin/env node
// Render motion/ds-promo.html with Playwright.
//
//   node motion/tools/render.mjs beats  [dark|light]        one frame per beat → motion/out/beats-<theme>/ + contact sheet
//   node motion/tools/render.mjs frames [dark|light] t1 t2…  single frames at loop times (seconds)
//   node motion/tools/render.mjs strip  [dark|light] b0 b1  frames through a transition → one sheet
//   node motion/tools/render.mjs video  [dark|light] [n]    4 subframes per 60 fps frame → tmix, n workers → motion/renders/ds-promo-<theme>.mp4
//   node motion/tools/render.mjs cues                       the sound cues (JSON) the page defines
//
// The page is a pure function of time: seek(t) is called for every (sub)frame, nothing runs in between.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'out');
const [mode = 'beats', theme = 'dark', ...rest] = process.argv.slice(2);
const FPS = 60, SUB = 4, SHUTTER = 0.5;                     // 4 subframes per frame over a 180° shutter

// Playwright from the project if it has it, else the global install (no new dependency for the site)
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); }
  catch { return require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }
})();

const ffmpeg = (() => {
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); }
  catch { return 'ffmpeg'; }
})();

async function open(th) {
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(pathToFileURL(join(ROOT, 'ds-promo.html')).href + `?render&theme=${th}`);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 30000 });
  const info = await page.evaluate(() => ({ loop: window.LOOP, beat: window.BEAT, cues: window.CUES }));
  return { browser, page, info };
}
const shot = async (page, t, type = 'png') => {
  await page.evaluate(t => window.seek(t), t);
  return page.screenshot({ type, ...(type === 'jpeg' ? { quality: 95 } : {}) });
};

if (mode === 'cues') {
  const { browser, info } = await open(theme);
  process.stdout.write(JSON.stringify({ loop: info.loop, beat: info.beat, cues: info.cues }, null, 1));
  await browser.close();
} else if (mode === 'frames') {
  const { browser, page } = await open(theme);
  const dir = join(OUT, 'frames'); mkdirSync(dir, { recursive: true });
  for (const s of rest) {
    const f = join(dir, `${theme}-${Number(s).toFixed(3)}.png`);
    writeFileSync(f, await shot(page, Number(s)));
    console.log(f);
  }
  await browser.close();
} else if (mode === 'strip') {
  // frames through a transition: strip <theme> <fromBeat> <toBeat> [count] → one sheet, 4 columns
  const [b0, b1, count = 12] = rest.map(Number);
  const { browser, page, info } = await open(theme);
  const dir = join(OUT, 'strip'); mkdirSync(dir, { recursive: true });
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const b = b0 + (b1 - b0) * i / (count - 1), f = join(dir, `s${i}.jpg`);
    writeFileSync(f, await shot(page, b * info.beat, 'jpeg'));
    tiles.push(`<figure><img src="${pathToFileURL(f).href}?${Date.now()}"><figcaption>beat ${b.toFixed(2)}</figcaption></figure>`);
  }
  await page.setContent(`<style>body{margin:0;background:#444;display:grid;grid-template-columns:repeat(4,400px)}
    figure{margin:0;position:relative;width:400px;height:300px;outline:1px solid #444}img{width:400px;height:300px;display:block}
    figcaption{position:absolute;left:6px;top:6px;padding:2px 6px;border-radius:4px;background:#7d3ee3;color:#fff;font:600 13px/16px sans-serif}</style>${tiles.join('')}`);
  await page.waitForLoadState('load');
  const f = join(OUT, `strip-${theme}-${b0}-${b1}.jpg`);
  writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true }));
  await browser.close();
  console.log(f);
} else if (mode === 'beats') {
  // one frame per beat, taken just before the next beat lands: what each beat did, settled
  const { browser, page, info } = await open(theme);
  const dir = join(OUT, `beats-${theme}`); mkdirSync(dir, { recursive: true });
  const n = Math.round(info.loop / info.beat);
  const lead = Number(rest[0] ?? 0.9);          // fraction of the beat to wait
  for (let b = 0; b < n; b++) {
    const f = join(dir, `b${String(b).padStart(2, '0')}.jpg`);
    writeFileSync(f, await shot(page, (b + lead) * info.beat, 'jpeg'));
  }
  // contact sheets: 16 beats (4 bars) each, 4×4 tiles of 400×300, labelled with beat and bar
  const sheets = [];
  for (let k = 0; k * 16 < n; k++) {
    const tiles = [];
    for (let b = k * 16; b < Math.min(n, k * 16 + 16); b++) {
      const src = pathToFileURL(join(dir, `b${String(b).padStart(2, '0')}.jpg`)).href;
      tiles.push(`<figure><img src="${src}"><figcaption>beat ${b} · bar ${9 + Math.floor(b / 4)}.${b % 4 + 1}</figcaption></figure>`);
    }
    await page.setContent(`<style>body{margin:0;background:#444;display:grid;grid-template-columns:repeat(4,400px);gap:0}
      figure{margin:0;position:relative;width:400px;height:300px;outline:1px solid #444}img{width:400px;height:300px;display:block}
      figcaption{position:absolute;left:6px;top:6px;padding:2px 6px;border-radius:4px;background:#7d3ee3;color:#fff;font:600 13px/16px sans-serif}</style>${tiles.join('')}`);
    await page.waitForLoadState('load');
    const f = join(OUT, `beats-${theme}-${k + 1}.jpg`);
    writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true }));
    sheets.push(f);
  }
  await browser.close();
  console.log(sheets.join('\n'));
} else if (mode === 'segment') {
  // one worker: frames [from, to) → tmix → an H.264 segment. A 180° shutter: frame f's 4 subframes cover the
  // middle half of its 1/60 s (offsets −3/16, −1/16, +1/16, +3/16 of a frame), so fast zooms blur instead of
  // strobing into four copies; t < 0 wraps, the page is periodic.
  const [from, to, index] = rest.map(Number);
  const { browser, page } = await open(theme);
  const cdp = await page.context().newCDPSession(page);
  const out = join(OUT, `seg-${theme}-${index}.mp4`);
  const ff = spawn(ffmpeg, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-',
    '-vf', `tmix=frames=${SUB}:weights='1 1 1 1',select='not(mod(n+1\,${SUB}))',setpts=N/${FPS}/TB,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-x264-params', 'keyint=600',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    for (let s = 0; s < SUB; s++) {
      await page.evaluate(t => window.seek(t), (f + SHUTTER * (s - (SUB - 1) / 2) / SUB) / FPS);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    }
    if ((f - from) % 240 === 0) console.log(`${theme} #${index}: frame ${f - from}/${to - from}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
} else if (mode === 'video') {
  // split the loop over workers, render the segments in parallel, join them without re-encoding, add the mix
  const workers = Number(rest[0] ?? 3);
  const { browser, info } = await open(theme);
  await browser.close();
  const frames = Math.round(info.loop * FPS);
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const bounds = Array.from({ length: workers + 1 }, (_, i) => Math.round(frames * i / workers));
  await Promise.all(bounds.slice(0, -1).map((a, i) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'segment', theme, String(a), String(bounds[i + 1]), String(i)], { stdio: 'inherit' });
    p.on('close', c => c ? rej(new Error(`segment ${i} failed`)) : res());
  })));
  const list = join(OUT, `seg-${theme}.txt`);
  writeFileSync(list, bounds.slice(0, -1).map((_, i) => `file '${join(OUT, `seg-${theme}-${i}.mp4`)}'`).join('\n') + '\n');
  const audio = join(ROOT, 'renders', 'ds-promo-audio.m4a');
  mkdirSync(join(ROOT, 'renders'), { recursive: true });
  const out = join(ROOT, 'renders', `ds-promo-${theme}.mp4`);
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log(`${out}  (${frames} frames, ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}
