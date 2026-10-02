// The screens. Static parts are the Figma layers (4×); what changes is drawn live with the same styles:
// typed text, caret, new bubbles, the keyboard, taps, the cursor. All sizes in pt; each draw sets its own scale.
import { clamp, lerp, smooth } from './time.js';

// Inter's vertical metrics (hhea): Figma centres ascent + descent in the line box
const ASC = 0.96875, DESC = 0.2412;
const SF = '-apple-system, "SF Pro Text", system-ui, sans-serif';

export function font(size, weight = 400, fam = 'Inter') { return `${weight} ${size}px ${fam === 'SF' ? SF : 'Inter'}`; }
export function baseline(top, size, lh) { return top + (lh - (ASC + DESC) * size) / 2 + ASC * size; }
export function text(ctx, s, x, top, st) {
  ctx.font = font(st.size, st.weight, st.fam);
  ctx.fillStyle = st.color;
  ctx.textAlign = st.align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, baseline(top, st.size, st.lh));
  return ctx.measureText(s).width;
}
export function measure(ctx, s, st) { ctx.font = font(st.size, st.weight, st.fam); return ctx.measureText(s).width; }
export function wrap(ctx, s, maxW, st) {
  ctx.font = font(st.size, st.weight, st.fam);
  const words = s.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const tryS = cur ? cur + ' ' + w : w;
    if (ctx.measureText(tryS).width <= maxW || !cur) cur = tryS; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
export function rrect(ctx, x, y, w, h, r) {
  const [a, b, c, d] = Array.isArray(r) ? r : [r, r, r, r];      // tl, tr, br, bl
  ctx.beginPath();
  ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.arcTo(x + w, y, x + w, y + b, b);
  ctx.lineTo(x + w, y + h - c); ctx.arcTo(x + w, y + h, x + w - c, y + h, c);
  ctx.lineTo(x + d, y + h); ctx.arcTo(x, y + h, x, y + h - d, d);
  ctx.lineTo(x, y + a); ctx.arcTo(x, y, x + a, y, a);
  ctx.closePath();
}

// ─────────────────────────────── bubbles (DS: message / Order=Single) ───────────────────────────────────────────
const ST = {
  body: { size: 14, lh: 16, weight: 400, color: '#ffffffd6' },
  name: { size: 12, lh: 16, weight: 700, color: '#ffffffd6' },
  time: { size: 10, lh: 12, weight: 400, color: '#ffffff66' },
  input: { size: 14, lh: 20, weight: 400, color: '#ffffffd6' },
  preview: { size: 12, lh: 16, weight: 400, color: '#ffffff85' },
  sender: { size: 12, lh: 16, weight: 400, color: '#3397ff' },
  draft: { size: 12, lh: 16, weight: 400, color: '#ff5a5f' },
  typing: { size: 12, lh: 16, weight: 400, color: '#ffffff85' },
};
export { ST };

// outgoing: right edge at `right`, top at `top`; returns the bubble's height (48 for one line, like the Figma one)
export function outBubbleH(ctx, s, maxW = 345) { return 8 + wrap(ctx, s, maxW - 16, ST.body).length * 16 + 4 + 12 + 8; }
export function outBubble(ctx, IMG, right, top, s, time, maxW = 345) {
  const lines = wrap(ctx, s, maxW - 16, ST.body);
  const tw = Math.max(...lines.map(l => measure(ctx, l, ST.body)));
  const w = Math.min(maxW, Math.max(tw + 16, 16 + 60)), h = 8 + lines.length * 16 + 4 + 12 + 8;
  const x = right - w;
  ctx.fillStyle = '#3d3d5cad'; rrect(ctx, x, top, w, h, [12, 12, 0, 12]); ctx.fill();
  lines.forEach((l, i) => text(ctx, l, x + 8, top + 8 + i * 16, ST.body));
  // time + double tick, right-aligned: tick 16.5 × 8.63 at right − 8.75, time ends 3.5 before it
  const tickX = right - 8.75 - 16.5, rowTop = top + h - 8 - 12;
  if (IMG['g-tick']) ctx.drawImage(IMG['g-tick'], tickX, rowTop + 3.5, 16.5, 11);
  ctx.textAlign = 'right';
  text(ctx, time, tickX - 3.5, rowTop, Object.assign({ align: 'right' }, ST.time));
  ctx.textAlign = 'left';
  return h;
}
// incoming, with the sender line and avatar (Dmitry Volkov - Alfa Bank); a personal chat has no sender line (name null)
export function inBubbleH(ctx, name, s, maxW = 329) {
  const n = wrap(ctx, s, maxW - 16, ST.body).length;
  return name ? 8 + 16 + 4 + n * 16 + 4 + 12 + 12 : 8 + n * 16 + 4 + 12 + 12;
}
export function inBubble(ctx, IMG, left, top, name, s, time, maxW = 329, avatar = 'g-dmitry', logo = 'g-alfa') {
  const lines = wrap(ctx, s, maxW - 16, ST.body);
  const nw = name ? measure(ctx, name, ST.name) : 0;
  const tw = Math.max(name ? nw + 8 + 16 : 0, ...lines.map(l => measure(ctx, l, ST.body)));
  const w = Math.min(maxW, tw + 16 + 30), h = inBubbleH(ctx, name, s, maxW), t0 = top + 8 + (name ? 16 + 4 : 0);
  ctx.fillStyle = '#21212c'; rrect(ctx, left, top, w, h, [12, 12, 12, 0]); ctx.fill();
  if (name) {
    text(ctx, name, left + 8, top + 8, ST.name);
    if (IMG[logo]) ctx.drawImage(IMG[logo], left + 8 + nw + 8, top + 8, 16, 16);
  }
  lines.forEach((l, i) => text(ctx, l, left + 8, t0 + i * 16, ST.body));
  text(ctx, time, left + w - 8, top + h - 12 - 12, Object.assign({ align: 'right' }, ST.time));
  ctx.textAlign = 'left';
  if (IMG[avatar]) {
    ctx.save(); ctx.beginPath(); ctx.arc(left - 32 + 12, top + h - 12, 12, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(IMG[avatar], left - 32, top + h - 24, 24, 24); ctx.restore();
  }
  return h;
}
// "Dmitry is typing" bubble with three bouncing dots; ph = phase in beats
export function typingBubble(ctx, left, top, ph) {
  ctx.fillStyle = '#21212c'; rrect(ctx, left, top, 56, 32, [12, 12, 12, 0]); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const k = Math.max(0, Math.sin((ph * 2 - i * 0.18) * Math.PI));
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.45 * k})`;
    ctx.beginPath(); ctx.arc(left + 16 + i * 12, top + 16 - 3 * k, 3, 0, Math.PI * 2); ctx.fill();
  }
}

// ─────────────────────────────── iOS 26 keyboard (dark) ────────────────────────────────────────────────────────
// Phone layout measured from Apple's iOS 26 keyboard at 402 pt (scaled to the iPhone 16's 393): keys 32.9 × 40.4,
// pitch 39.3, rows every 51.3 from 46.8 below the panel top, panel 314 tall with the predictive bar on top.
const KB = { panel: '#26262a', key: '#56565b', keyDown: '#78787e', fn: '#56565b', text: '#ffffff', sub: '#9a9aa0', bar: '#3a3a3e' };
export const PHONE_KB_H = 314;

function phoneKeys(layer) {
  const L = [];
  const row = (chars, y, x0, pitch = 39.3, w = 32.9) => chars.forEach((c, i) => L.push({ id: c, label: c, x: x0 + i * pitch, y, w, h: 40.4 }));
  const y1 = 46.8, y2 = 98.1, y3 = 149.4, y4 = 200.7;
  if (layer === '123') {
    row('1234567890'.split(''), y1, 6.4);
    row(['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'], y2, 6.4);
    L.push({ id: '#+=', label: '#+=', x: 6.4, y: y3, w: 44.9, h: 40.4, fn: true });
    row(['.', ',', '?', '!', "'"], y3, 65.1 + 13, 54.2, 47.5);
    L.push({ id: 'del', label: '⌫', x: 350.7, y: y3, w: 45.7, h: 40.4, fn: true });
    L.push({ id: 'abc', label: 'ABC', x: 6.4, y: y4, w: 43, h: 40.4, fn: true });
  } else {
    row('qwertyuiop'.split(''), y1, 6.4);
    row('asdfghjkl'.split(''), y2, 25.4);
    L.push({ id: 'shift', label: '⇧', x: 6.4, y: y3, w: 44.9, h: 40.4, fn: true });
    row('zxcvbnm'.split(''), y3, 65.1);
    L.push({ id: 'del', label: '⌫', x: 350.7, y: y3, w: 45.7, h: 40.4, fn: true });
    L.push({ id: '123', label: '123', x: 6.4, y: y4, w: 43, h: 40.4, fn: true });
  }
  L.push({ id: 'emoji', label: '☺', x: 55.4, y: y4, w: 43.4, h: 40.4, fn: true });
  L.push({ id: ' ', label: '', x: 104.8, y: y4, w: 192.4, h: 40.4, fn: true, space: true });
  L.push({ id: 'ret', label: '⏎', x: 303.2, y: y4, w: 93.2, h: 40.4, fn: true });
  return L;
}

// state: { layer, shift, down: key id pressed (or null), downK: 0..1 press amount, pop: 0..1, words: [3 suggestions] }
export function phoneKeyboard(ctx, x, y, w, st) {
  const s = w / 402;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = KB.panel; rrect(ctx, 0, 0, 402, PHONE_KB_H + 40, [30, 30, 0, 0]); ctx.fill();
  // a hairline of light on the glass edge
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; rrect(ctx, 0.5, 0.5, 401, PHONE_KB_H + 40, [30, 30, 0, 0]); ctx.stroke();
  // predictive bar
  const words = st.words || ['I', 'The', 'I’m'];
  ctx.fillStyle = KB.bar;
  for (const xx of [133.7, 253.5]) ctx.fillRect(xx, 12, 1, 20);
  words.forEach((wd, i) => text(ctx, wd, 22 + 60 + i * 120, 12, { size: 17, lh: 22, weight: 400, fam: 'SF', color: '#e5e5ea', align: 'center' }));
  ctx.textAlign = 'left';
  const keys = phoneKeys(st.layer);
  let popKey = null;
  for (const k of keys) {
    const down = st.down === k.id ? st.downK : 0;
    ctx.fillStyle = mixHex(k.fn ? KB.fn : KB.key, KB.keyDown, k.fn || k.space ? down : 0);
    rrect(ctx, k.x, k.y, k.w, k.h, 8.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rrect(ctx, k.x, k.y + k.h - 1.2, k.w, 1.2, 0.6); ctx.fill();
    const lab = k.id.length === 1 && /[a-z]/.test(k.id) ? (st.shift ? k.label.toUpperCase() : k.label) : k.label;
    if (k.id === 'shift') drawShift(ctx, k, st.shift);
    else if (k.id === 'del') drawDelete(ctx, k);
    else if (k.id === 'emoji') drawEmoji(ctx, k);
    else if (k.id === 'ret') drawReturn(ctx, k);
    else if (k.space) { text(ctx, 'EN', k.x + k.w - 8, k.y + k.h - 18, { size: 10, lh: 14, weight: 500, fam: 'SF', color: KB.sub, align: 'right' }); ctx.textAlign = 'left'; }
    else {
      const big = k.fn ? 17 : 23;
      text(ctx, lab, k.x + k.w / 2, k.y + (k.h - 28) / 2 - (k.fn ? 0 : 1), { size: big, lh: 28, weight: 400, fam: 'SF', color: KB.text, align: 'center' });
      ctx.textAlign = 'left';
    }
    if (down > 0.01 && !k.fn && !k.space) popKey = { k, lab, a: down };
  }
  // globe and dictation below the keys
  drawGlobe(ctx, 38, 277.7); drawMic(ctx, 364, 277.7);
  if (popKey) drawPop(ctx, popKey.k, popKey.lab, popKey.a);
  ctx.restore();
}

// iPad-style landscape keyboard for the Duo's inner display (w pt wide)
export function wideKeyboardHeight(w) { return Math.round(w * 0.3); }
export function wideKeyboard(ctx, x, y, w, st) {
  const H = wideKeyboardHeight(w);
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = KB.panel; rrect(ctx, 0, 0, w, H + 30, [24, 24, 0, 0]); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; rrect(ctx, 0.5, 0.5, w - 1, H + 30, [24, 24, 0, 0]); ctx.stroke();
  // the keys stay clear of the display's rounded corners (7.4 mm on the Duo): 16 pt in from the sides, 24 from the bottom
  const top = 44, gap = 8, rows = 4, side = 16, kh = (H - top - 24 - gap * (rows - 1)) / rows, u = (w - 2 * side - gap * 10) / 11.2;
  const words = st.words || ['I', 'The', 'I’m'];
  ctx.fillStyle = KB.bar; for (const k of [1, 2]) ctx.fillRect(w * k / 3, 12, 1, 20);
  words.forEach((wd, i) => text(ctx, wd, w * (i + 0.5) / 3, 11, { size: 17, lh: 22, weight: 400, fam: 'SF', color: '#e5e5ea', align: 'center' }));
  ctx.textAlign = 'left';
  const K = [];
  const R = (list, r, x0) => { let xx = x0; for (const [id, lab, span = 1, fn = false] of list) { K.push({ id, label: lab, x: xx, y: top + r * (kh + gap), w: u * span + gap * (span - 1), h: kh, fn }); xx += u * span + gap * span; } };
  if (st.layer === '123') {
    R([...'1234567890'].map(c => [c, c]).concat([['del', '⌫', 1.2, true]]), 0, side);
    R([['@', '@'], ['#', '#'], ['$', '$'], ['&', '&'], ['*', '*'], ['(', '('], [')', ')'], ["'", "'"], ['"', '"'], ['ret', 'return', 1.7, true]], 1, side + u * 0.5);
    R([['#+=', '#+=', 1.2, true], ['%', '%'], ['-', '-'], ['+', '+'], ['=', '='], ['/', '/'], [';', ';'], [':', ':'], [',', ','], ['.', '.'], ['#+=', '#+=', 1.0, true]], 2, side);
    R([['abc', 'ABC', 1.6, true], ['globe', '', 1, true], ['mic', '', 1, true], [' ', '', 4.8, true], ['abc', 'ABC', 1.6, true], ['hide', '', 1, true]], 3, side);
  } else {
    R([...'qwertyuiop'].map(c => [c, c]).concat([['del', '⌫', 1.2, true]]), 0, side);
    R([...'asdfghjkl'].map(c => [c, c]).concat([['ret', 'return', 1.7, true]]), 1, side + u * 0.5);
    R([['shift', '⇧', 1.2, true], ...[...'zxcvbnm'].map(c => [c, c]), [',', ','], ['.', '.'], ['shift', '⇧', 1.0, true]], 2, side);
    R([['123', '.?123', 1.6, true], ['globe', '', 1, true], ['mic', '', 1, true], [' ', '', 4.8, true], ['123', '.?123', 1.6, true], ['hide', '', 1, true]], 3, side);
  }
  let popKey = null;
  for (const k of K) {
    const down = st.down === k.id ? st.downK : 0;
    ctx.fillStyle = mixHex(KB.key, KB.keyDown, down);
    rrect(ctx, k.x, k.y, k.w, k.h, 9); ctx.fill();
    if (k.id === 'shift') drawShift(ctx, k, st.shift);
    else if (k.id === 'del') drawDelete(ctx, k);
    else if (k.id === 'globe') drawGlobe(ctx, k.x + k.w / 2, k.y + k.h / 2);
    else if (k.id === 'mic') drawMic(ctx, k.x + k.w / 2, k.y + k.h / 2);
    else if (k.id === 'hide') drawHide(ctx, k);
    else if (k.id !== ' ') {
      const lab = /^[a-z]$/.test(k.id) ? (st.shift ? k.label.toUpperCase() : k.label) : k.label;
      const sz = k.fn ? 16 : 24;
      text(ctx, lab, k.x + k.w / 2, k.y + (k.h - 30) / 2, { size: sz, lh: 30, weight: 400, fam: 'SF', color: KB.text, align: 'center' });
      ctx.textAlign = 'left';
      if (down > 0.01 && !k.fn) popKey = { k, lab, a: down };
    }
  }
  if (popKey) {                                   // iPad keys don't balloon; the key itself lights up
    const { k, a } = popKey;
    ctx.fillStyle = `rgba(255,255,255,${0.16 * a})`; rrect(ctx, k.x, k.y, k.w, k.h, 9); ctx.fill();
  }
  ctx.restore();
  return H;
}

function drawShift(ctx, k, on) {
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2 + 1;
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(9, 1); ctx.lineTo(4, 1); ctx.lineTo(4, 7); ctx.lineTo(-4, 7); ctx.lineTo(-4, 1); ctx.lineTo(-9, 1); ctx.closePath();
  ctx.lineJoin = 'round';
  if (on) { ctx.fillStyle = '#fff'; ctx.fill(); } else { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); }
  ctx.restore();
}
function drawDelete(ctx, k) {
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2;
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-5, -7); ctx.lineTo(11, -7); ctx.lineTo(11, 7); ctx.lineTo(-5, 7); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-1, -3); ctx.lineTo(5, 3); ctx.moveTo(5, -3); ctx.lineTo(-1, 3); ctx.stroke();
  ctx.restore();
}
function drawEmoji(ctx, k) {
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2;
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx - 3.5, cy - 2.5, 1.4, 0, Math.PI * 2); ctx.arc(cx + 3.5, cy - 2.5, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy + 1, 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}
function drawReturn(ctx, k) {
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2;
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.7; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(10, -7); ctx.lineTo(10, 2); ctx.lineTo(-9, 2); ctx.moveTo(-4, -3); ctx.lineTo(-9, 2); ctx.lineTo(-4, 7); ctx.stroke();
  ctx.restore();
}
function drawGlobe(ctx, cx, cy) {
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, 5, 11, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 11, cy); ctx.lineTo(cx + 11, cy); ctx.moveTo(cx - 9, cy - 5.5); ctx.lineTo(cx + 9, cy - 5.5); ctx.moveTo(cx - 9, cy + 5.5); ctx.lineTo(cx + 9, cy + 5.5); ctx.stroke();
  ctx.restore();
}
function drawMic(ctx, cx, cy) {
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  rrect(ctx, cx - 4.5, cy - 12, 9, 15, 4.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - 1, 8, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 7); ctx.lineTo(cx, cy + 11); ctx.stroke();
  ctx.restore();
}
function drawHide(ctx, k) {
  const cx = k.x + k.w / 2, cy = k.y + k.h / 2 - 3;
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
  rrect(ctx, cx - 12, cy - 7, 24, 14, 2); ctx.stroke();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) ctx.fillRect(cx - 9 + j * 4.2, cy - 4.5 + i * 3.4, 2, 1.6);
  ctx.beginPath(); ctx.moveTo(cx - 3, cy + 10); ctx.lineTo(cx, cy + 13); ctx.lineTo(cx + 3, cy + 10); ctx.stroke();
  ctx.restore();
}
// the key balloon: grows out of the key, the letter large inside
function drawPop(ctx, k, lab, a) {
  const e = smooth(a);
  const bw = k.w + 22, bh = 58, cx = k.x + k.w / 2, top = k.y - bh + 6;
  ctx.save();
  ctx.globalAlpha = e;
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#6a6a70';
  ctx.beginPath();
  const x0 = cx - bw / 2, x1 = cx + bw / 2, kx0 = k.x, kx1 = k.x + k.w, r = 10;
  ctx.moveTo(x0 + r, top); ctx.lineTo(x1 - r, top); ctx.arcTo(x1, top, x1, top + r, r);
  ctx.lineTo(x1, top + 30); ctx.bezierCurveTo(x1, top + 42, kx1, top + 44, kx1, top + 52);
  ctx.lineTo(kx1, k.y + k.h - 8.5); ctx.arcTo(kx1, k.y + k.h, kx1 - 8.5, k.y + k.h, 8.5);
  ctx.lineTo(kx0 + 8.5, k.y + k.h); ctx.arcTo(kx0, k.y + k.h, kx0, k.y + k.h - 8.5, 8.5);
  ctx.lineTo(kx0, top + 52); ctx.bezierCurveTo(kx0, top + 44, x0, top + 42, x0, top + 30);
  ctx.lineTo(x0, top + r); ctx.arcTo(x0, top, x0 + r, top, r);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = 'transparent';
  text(ctx, lab, cx, top + 4, { size: 34, lh: 40, weight: 400, fam: 'SF', color: '#fff', align: 'center' });
  ctx.restore();
  ctx.textAlign = 'left';
}

export function mixHex(a, b, k) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), Bc = p(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, Bc[i], clamp(k)))).join(',')})`;
}

// the text caret: solid while typing, blinking (1 s period, ease) when idle
export function caret(ctx, x, top, h, t, lastKey, color = '#ffffffd6') {
  const idle = t - lastKey;
  const on = idle < 0.5 ? 1 : 0.5 + 0.5 * Math.cos((idle - 0.5) * Math.PI * 2) > 0.5 ? 1 : 0;
  if (!on) return;
  ctx.fillStyle = color; rrect(ctx, x, top, 1.6, h, 0.8); ctx.fill();
}

// macOS arrow cursor (the one table-loop uses), tip at (x, y), size in pt
export function cursor(ctx, x, y, s = 1, press = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (1 - 0.08 * press), s * (1 - 0.08 * press));
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 18.5); ctx.lineTo(4.6, 14.2); ctx.lineTo(7.9, 21.6); ctx.lineTo(11.1, 20.2); ctx.lineTo(7.9, 13); ctx.lineTo(13.9, 13); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = '#0f0f0f'; ctx.fill();
  ctx.restore();
}
