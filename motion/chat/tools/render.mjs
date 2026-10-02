#!/usr/bin/env node
// Render motion/chat/chat-promo.html to video with Chrome (GPU, Metal) through Playwright.
//
//   node motion/chat/tools/render.mjs cues                > motion/chat/data/cues.json
//   node motion/chat/tools/render.mjs video [workers] [from] [to]   → motion/chat/renders/chat-promo.mp4
//   node motion/chat/tools/render.mjs frames t1 t2 …      → motion/out/chat/frames/*.png
//
// The page is a pure function of time: seek(t) for every (sub)frame. 60 fps, 12 subframes per frame over a 180°
// shutter, averaged with ffmpeg's tmix, so fast camera moves blur like film instead of strobing (4 subframes left
// visible copies of the text on the fast moves). CHAT_SUB=4 renders a quick draft.
// The page renders WebGL at 2× (pixel ratio 2) and the screenshot is 1×: every frame is supersampled too.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, '..', 'out', 'chat');
const [mode = 'video', ...rest] = process.argv.slice(2);
const FPS = 60, SUB = Number(process.env.CHAT_SUB || 12), SHUTTER = 0.5;

const ffmpeg = (() => {
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); }
  catch { return 'ffmpeg'; }
})();

if (mode === 'cues') {
  const { browser, page } = await openPage('pr=1');
  const info = await page.evaluate(() => ({ length: window.LENGTH, beat: window.BEAT, audioStart: window.AUDIO_START, fadeOut: window.FADE,
    cuts: window.MUSIC_CUTS || [], cues: window.CUES }));
  process.stdout.write(JSON.stringify(info, null, 1));
  await browser.close();
} else if (mode === 'frames') {
  const { browser, page } = await openPage('pr=2');
  const dir = join(OUT, 'frames'); mkdirSync(dir, { recursive: true });
  for (const s of rest) {
    await page.evaluate(t => window.seek(t), Number(s));
    const f = join(dir, `f-${Number(s).toFixed(3)}.png`);
    writeFileSync(f, await page.screenshot({ type: 'png' }));
    console.log(f);
  }
  await browser.close();
} else if (mode === 'segment') {
  const [from, to, index] = rest.map(Number);
  const { browser, page } = await openPage('pr=2');
  const cdp = await page.context().newCDPSession(page);
  const out = join(OUT, `seg-${index}.mp4`);
  const ff = spawn(ffmpeg, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-',
    '-vf', `tmix=frames=${SUB}:weights='${Array(SUB).fill(1).join(' ')}',select='not(mod(n+1\\,${SUB}))',setpts=N/${FPS}/TB,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-x264-params', 'keyint=600',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    for (let s = 0; s < SUB; s++) {
      const t = Math.max(0, (f + SHUTTER * (s - (SUB - 1) / 2) / SUB) / FPS);
      await page.evaluate(t => window.seek(t), t);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    }
    if ((f - from) % 120 === 0) console.log(`#${index}: frame ${f - from}/${to - from}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
} else if (mode === 'video') {
  const workers = Number(rest[0] ?? 3);
  const { browser, page } = await openPage('pr=1');
  const L = await page.evaluate(() => window.LENGTH);
  await browser.close();
  const total = Math.round(L * FPS);
  const from = Math.round(Number(rest[1] ?? 0) * FPS), to = rest[2] != null ? Math.round(Number(rest[2]) * FPS) : total;
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const bounds = Array.from({ length: workers + 1 }, (_, i) => from + Math.round((to - from) * i / workers));
  await Promise.all(bounds.slice(0, -1).map((a, i) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'segment', String(a), String(bounds[i + 1]), String(i)], { stdio: 'inherit' });
    p.on('close', c => c ? rej(new Error(`segment ${i} failed`)) : res());
  })));
  const list = join(OUT, 'segs.txt');
  writeFileSync(list, bounds.slice(0, -1).map((_, i) => `file '${join(OUT, `seg-${i}.mp4`)}'`).join('\n') + '\n');
  const audio = join(ROOT, 'renders', 'chat-promo-audio.m4a');
  mkdirSync(join(ROOT, 'renders'), { recursive: true });
  const partial = from > 0 || to < total;
  const out = join(ROOT, 'renders', partial ? `chat-promo-${(from / FPS).toFixed(1)}-${(to / FPS).toFixed(1)}.mp4` : 'chat-promo.mp4');
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  if (existsSync(audio)) args.push('-ss', String(from / FPS), '-i', audio, '-map', '0:v', '-map', '1:a', '-shortest', '-c:a', 'copy');
  args.push('-c:v', 'copy', '-movflags', '+faststart', out);
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
  console.log(`${out}  (${to - from} frames, ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}
