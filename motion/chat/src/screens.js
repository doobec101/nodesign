// Screen compositors: each draws one device's display for a state. Units are Figma pt; the canvas scale is set
// from the canvas width, so the same state renders on the iPhone (402 pt), the Duo's outer display (466 pt), etc.
import { clamp, lerp, smooth, step, spring } from './time.js';
import { text, measure, rrect, outBubble, outBubbleH, inBubble, inBubbleH, typingBubble, phoneKeyboard, PHONE_KB_H, wideKeyboard, wideKeyboardHeight,
  caret, cursor, ST } from './ui.js';

const BG = '#16161d', PANEL = '#111112';

// draw an image region (in pt of a layer exported at `k`×) to a destination rect in pt
function blit(ctx, im, k, sx, sy, sw, sh, dx, dy, dw = sw, dh = sh) {
  ctx.drawImage(im, sx * k, sy * k, sw * k, sh * k, dx, dy, dw, dh);
}

// ─────────────────────────────── mobile (393 pt design) ──────────────────────────────────────────────────────────
// st: { t, push (0 list → 1 chat), tapRow, kb (0..1), kbState, input, lastKey, caretOn,
//       sent: [{ text, time, k }], typing (0..1), typingPh, reply: { name, text, time, k } | null, dim, backPress (0..1),
//       chat: 'ofz' (the group, as on the Duo) | 'marcus' (Marcus Chen's chat, the one that bells), bellT: s since the bell,
//       chatBellT: s since Marcus's chat opened (its header bell rings),
//       H: the height drawn (pt; the display's aspect, the canvas may be taller), iphone: 0 Duo outer display → 1 iPhone }
// The Duo's outer display keeps its status in the top right corner, under the camera hole: the time, then Wi‑Fi in a
// ring (Apple's photos). On the iPhone it is the usual bar; in the morph the time travels from one place to the other.
export const DUO_OUTER_STATUS = { x: 352.8, hole: 39.2, time: 73, ring: 102, ringD: 32, shift: 64 };
export function drawMobile(ctx, canvas, IMG, L, st) {
  const s = canvas.width / 393, H = st.H ?? canvas.height / s, ip = clamp(st.iphone ?? 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const p = smooth(st.push ?? 0);
  // list, sliding left and dimming as the chat pushes in
  if (p < 0.999) {
    ctx.save(); ctx.translate(-0.28 * 393 * p, 0);
    drawList(ctx, IMG, L, st, H, DUO_OUTER_STATUS.shift * (1 - smooth(ip)));
    ctx.fillStyle = `rgba(0,0,0,${0.32 * p})`; ctx.fillRect(0, 0, 393, H);
    ctx.restore();
  }
  if (p > 0.001) {
    ctx.save(); ctx.translate(393 * (1 - p), 0);
    // the pushed page's edge shadow
    const g = ctx.createLinearGradient(-18, 0, 0, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.35 * (1 - p)})`);
    ctx.fillStyle = g; ctx.fillRect(-18, 0, 18, H);
    drawChat(ctx, IMG, L, st, H, DUO_OUTER_STATUS.shift * (1 - smooth(ip)));
    ctx.restore();
  }
  mobileStatus(ctx, IMG, ip);
  if (st.dim) { ctx.fillStyle = `rgba(0,0,0,${st.dim})`; ctx.fillRect(0, 0, 393, H); }
}

// the status bar: a clean strip (a column of the plate between the clock and the icons), then the clock where the
// device keeps it, Wi‑Fi in a ring on the Duo and the plate's own icons on the iPhone
function mobileStatus(ctx, IMG, ip) {
  const D = DUO_OUTER_STATUS, e = smooth(ip);
  blit(ctx, IMG['m-list'], 4, 200, 0, 1, 62, 0, 0, 393, 62);
  if (e > 0.002) { ctx.save(); ctx.globalAlpha = e; blit(ctx, IMG['m-list'], 4, 270, 18, 95, 30, 270, 18); ctx.restore(); }
  // the clock: 12.5 pt under the hole → the iPhone's 17 pt on the left (centre 76.4, digits 26…38.25)
  const size = lerp(12.5, 17, e), cx = lerp(D.x, 76.4, e), cy = lerp(D.time, 32.1, e);
  text(ctx, '9:41', cx, cy - size * 0.68, { size, lh: size * 1.36, weight: 600, fam: 'SF', color: '#fff', align: 'center' });
  ctx.textAlign = 'left';
  if (e < 0.998) { ctx.save(); ctx.globalAlpha = 1 - e; statusRing(ctx, D.x, D.ring, D.ringD); ctx.restore(); }
}

// Wi‑Fi in a ring, the bottom of the ring dotted (iPhone Duo)
export function statusRing(ctx, cx, cy, d) {
  const r = d / 2, k = d / 32;
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round';
  ctx.lineWidth = 2.4 * k;
  ctx.beginPath(); ctx.arc(cx, cy, r - 1.2 * k, Math.PI * 150 / 180, Math.PI * 390 / 180); ctx.stroke();
  for (const a of [56, 78.7, 101.3, 124]) {
    const q = a * Math.PI / 180;
    ctx.beginPath(); ctx.arc(cx + (r - 1.2 * k) * Math.cos(q), cy + (r - 1.2 * k) * Math.sin(q), 1.35 * k, 0, Math.PI * 2); ctx.fill();
  }
  const ay = cy + 4.6 * k;                                   // the Wi‑Fi wedge's apex
  ctx.lineWidth = 1.9 * k;
  for (const rr of [9.2, 5.6]) { ctx.beginPath(); ctx.arc(cx, ay, rr * k, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(cx, ay - 0.6 * k, 1.7 * k, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// header icons moved left (they make way for the Duo's status column): the background under them is rebuilt from a
// clean row of the plate stretched down, the icons go back on with 'lighten' so their own background leaves no seam
function shiftIcons(ctx, im, sx, sy, sw, sh, bgRow, dx) {
  if (dx < 0.05) return blit(ctx, im, 4, sx, sy, sw, sh, sx, sy);
  blit(ctx, im, 4, sx - dx, bgRow, sw + dx, 1, sx - dx, sy, sw + dx, sh);
  ctx.save(); ctx.globalCompositeOperation = 'lighten';
  blit(ctx, im, 4, sx, sy, sw, sh, sx - dx, sy);
  ctx.restore();
}

// ─────────────────────────────── the bell (DS: Bell bg, Avatar Picture Bell=On, the bell icon) ─────────────────────
// As the bell rings in the product (a screen recording of it, measured frame by frame): a 2 s loop. The row's yellow
// breathes in (0.2 → 0.8 s) and out (0.85 → 1.8 s); at 0.83 s the bell swings about its top — a damped swing, ±21°,
// 2.9 Hz, settled by 1.5 s — and a thin, half-bright echo leaves the avatar's ring: 24.5 → 30 pt, brightest at 1.05 s,
// gone by 1.85 s.
export const BELL_LOOP = 2.0, BELL_SWING_AT = 0.83;
export function bellSwing(s) { return s > 0 ? 21 * Math.exp(-s / 0.32) * Math.sin(2 * Math.PI * 2.9 * s) : 0; }
export function bellLoop(tau) {                         // tau: s into the loop (any value; it repeats)
  const x = ((tau % BELL_LOOP) + BELL_LOOP) % BELL_LOOP;
  const bg = x < 0.2 ? 0 : x < 0.8 ? smooth((x - 0.2) / 0.6) : x < 0.85 ? 1 : x < 1.8 ? 1 - smooth((x - 0.85) / 0.95) : 0;
  const e = x - 0.85;
  const echo = e > 0 && e < 1.0 ? { r: 24.5 + 5.5 * (1 - (1 - Math.min(1, e / 0.8)) ** 2), a: e < 0.2 ? smooth(e / 0.2) : 1 - smooth((e - 0.2) / 0.8), k: e } : null;
  return { bg, ang: bellSwing(x - BELL_SWING_AT), echo };
}
function drawBell(ctx, IMG, b, deg, scale = 1, dx = 0) {
  const im = IMG[b.img]; if (!im || scale < 0.01) return;
  ctx.save(); ctx.translate(b.pivot[0] - dx, b.pivot[1]); ctx.rotate(deg * Math.PI / 180); ctx.scale(scale, scale);
  ctx.drawImage(im, b.x - b.pivot[0], b.y - b.pivot[1], im.width / 8, im.height / 8);
  ctx.restore();
}
function echoRing(ctx, cx, cy, e) {
  ctx.strokeStyle = `rgba(255,212,0,${0.55 * e.a})`; ctx.lineWidth = 1.9 - 0.7 * Math.min(1, e.k);
  ctx.beginPath(); ctx.arc(cx, cy, e.r, 0, Math.PI * 2); ctx.stroke();
}
const BELL_POP = spring(0.34, 0.55);
const DRAFT_ROW = 4;                                     // OFZ Rates Desk, where the Duo's draft waits

function drawList(ctx, IMG, L, st, H, iconShift = 0) {
  const BL = L.mobile.blist, im = IMG[BL.base0];
  const hh = Math.min(852, H);
  blit(ctx, im, 4, 0, 0, 393, hh, 0, 0);
  if (iconShift > 0.05) shiftIcons(ctx, im, 276, 70, 112, 32, 64, iconShift);
  if (H > 852) { ctx.fillStyle = BG; ctx.fillRect(0, 852, 393, H - 852); }
  const row = L.mobile.list, y0 = row.rows0 + BL.row * row.rowH;   // Marcus Chen's row, the one that bells
  const bt = st.bellT ?? -1;
  if (bt >= 0 && st.bellOn) {
    // the row turns to its bell state (the ring, the yellow counter); its yellow breathes, the bell rings, the echo goes
    const a = smooth(bt / 0.25), lp = bellLoop(st.bellLoopT ?? bt);
    ctx.save(); ctx.globalAlpha = a; blit(ctx, IMG[BL.base2], 4, 0, y0, 393, row.rowH, 0, y0);
    ctx.globalAlpha = a * 0.7 * lp.bg; blit(ctx, IMG[BL.base1], 4, 0, y0, 393, row.rowH, 0, y0); ctx.restore();
    if (lp.echo) { ctx.save(); ctx.globalAlpha = a; echoRing(ctx, BL.avatar[0], BL.avatar[1], lp.echo); ctx.restore(); }
    drawBell(ctx, IMG, BL.bell, lp.ang, step(bt, BELL_POP));
  }
  // the tap on Marcus's row: its pressed state (the yellow, deeper)
  if (st.tapRow > 0.001) { ctx.fillStyle = `rgba(255,212,0,${0.13 * st.tapRow})`; ctx.fillRect(0, y0, 393, row.rowH); }
  // back from his chat: his reply in the row (the bell is off by then: the plain plate is under it)
  rowLast(ctx, 393, 0, { top: y0, bg: BG, pr: 318 }, st.marcusLast);
  // the OFZ group: the draft started on the Duo, and the tap that opens it
  const yd = row.rows0 + DRAFT_ROW * row.rowH;
  if (st.tapDraft > 0.001) { ctx.fillStyle = `rgba(80,65,255,${0.22 * st.tapDraft})`; ctx.fillRect(0, yd, 393, row.rowH); }
  if (st.draft) {
    // replace "You: Switching to pay-fixed…" and the sent ticks with the draft line
    ctx.fillStyle = st.tapDraft > 0.001 ? mixRow(st.tapDraft) : BG;
    ctx.fillRect(74, yd + 30, 393 - 74 - 50, 18);
    ctx.fillRect(326, yd + 9, 20, 18);
    const w = text(ctx, 'Draft:', 76.3, yd + 31, ST.draft);
    text(ctx, st.draft, 76.3 + w + 5, yd + 31, ST.preview);
  }
}

function mixRow(k) {           // the row's background with the tap highlight on it
  const a = 0.22 * k, bg = [22, 22, 29], hi = [80, 65, 255];
  return `rgb(${bg.map((v, i) => Math.round(v * (1 - a) + hi[i] * a)).join(',')})`;
}

function drawChat(ctx, IMG, L, st, H, iconShift = 0) {
  const C = L.mobile.chat, marcus = st.chat === 'marcus';
  const im = IMG[marcus ? L.mobile.bchat.base : 'm-chat-base'], msgs = marcus ? L.mobile.bchat.msgs : C.msgs;
  const kbH = PHONE_KB_H * smooth(st.kb ?? 0);
  const inputTop = H - 72 - kbH;
  // dialog background and messages, bottom-anchored above the input bar
  ctx.fillStyle = BG; ctx.fillRect(0, 110, 393, H - 110);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 110, 393, inputTop - 110); ctx.clip();
  let extra = 0;                                       // height the new bubbles take (animated)
  const news = [];
  for (const m of st.sent || []) news.push({ kind: 'out', ...m });
  if (st.typing > 0.001) news.push({ kind: 'typing', k: st.typing });
  for (const m of st.incoming || []) news.push({ kind: 'in', ...m });
  const hOf = n => n.kind === 'out' ? 12 + outBubbleH(ctx, n.text) : n.kind === 'typing' ? 12 + 32 : 12 + inBubbleH(ctx, n.name, n.text);
  for (const n of news) extra += hOf(n) * smooth(n.k);
  const shift = (inputTop - 780) - extra;
  if (marcus) {
    // his chat is written here (st.history): bubbles in the DS styles, bottom-anchored like the plate's messages
    let yb = 772 + shift;
    for (let i = (st.history || []).length - 1; i >= 0; i--) {
      const m = st.history[i];
      if (m.kind === 'sys') { yb -= 32; blit(ctx, IMG['m-bsys-0'], 4, 0, 0, 393, 32, 0, yb); continue; }
      if (m.kind === 'date') {                           // the day divider, in the chat's quiet time style
        yb -= 36; text(ctx, m.text, 393 / 2, yb + 14, { ...ST.time, align: 'center' }); ctx.textAlign = 'left'; continue;
      }
      const h = m.kind === 'out' ? outBubbleH(ctx, m.text) : inBubbleH(ctx, null, m.text);
      yb -= 12 + h;
      if (m.kind === 'out') outBubble(ctx, IMG, 385, yb + 12, m.text, m.time);
      else inBubble(ctx, IMG, 40, yb + 12, null, m.text, m.time, 329, m.avatar);
    }
  } else for (const m of msgs) {
    const [x, y, w, h] = m.r;
    blit(ctx, IMG[m.layer], 4, 0, 0, w, h, x, y + shift);
  }
  let y = 772 + shift;
  for (const n of news) {
    const hh = hOf(n), k = smooth(n.k);
    ctx.save();
    ctx.globalAlpha = clamp(n.k * 1.6);
    const rise = (1 - k) * 22;
    if (n.kind === 'out') outBubble(ctx, IMG, 385, y + 12 + rise, n.text, n.time);
    else if (n.kind === 'typing') typingBubble(ctx, 40, y + 12 + rise, n.ph ?? st.typingPh ?? 0);
    else inBubble(ctx, IMG, 40, y + 12 + rise, n.name, n.text, n.time, 329, n.avatar, n.logo);
    ctx.restore();
    y += hh * k;
  }
  ctx.restore();
  // header + status (from the plate), input bar at its place above the keyboard
  blit(ctx, im, 4, 0, 62, 393, 48, 0, 62);
  // on the Duo's outer display the group's avatar moves left of the status column (the time and Wi‑Fi under the hole)
  if (!marcus && iconShift > 0.05) shiftIcons(ctx, im, 349, 66, 40, 40, 64, iconShift);
  // Marcus's chat: the header bell, ringing as the chat opens
  if (marcus) drawBell(ctx, IMG, L.mobile.bchat.bell, bellSwing(st.chatBellT ?? -1), 1, iconShift);
  // the back button pressed (the way back to the list)
  if (st.backPress > 0.001) {
    ctx.fillStyle = `rgba(255,255,255,${0.14 * st.backPress})`;
    ctx.beginPath(); ctx.arc(24, 86, 17, 0, Math.PI * 2); ctx.fill();
  }
  blit(ctx, im, 4, 0, 780, 393, 72, 0, inputTop);
  if (kbH < 0.5 && H > 852) { ctx.fillStyle = PANEL; ctx.fillRect(0, inputTop + 72, 393, H - inputTop - 72); }
  // the typed text, clipped to the field, and the caret
  const f = C.field, fx = f[0] + 8, ftop = inputTop + (C.text[1] - 780);
  ctx.save(); ctx.beginPath(); ctx.rect(f[0], inputTop + 16, f[2], 40); ctx.clip();
  const tw = st.input ? measure(ctx, st.input, ST.input) : 0;
  const scroll = Math.max(0, tw - (f[2] - 18));
  if (st.input) text(ctx, st.input, fx - scroll, ftop, ST.input);
  else if (!st.caretOn) text(ctx, 'Message', fx, ftop, { ...ST.input, color: '#ffffff47' });
  if (st.caretOn) caret(ctx, fx + tw - scroll + 1.5, ftop + 1.5, 17, st.t, st.lastKey ?? -9);
  ctx.restore();
  // the send arrow lights when there is text; pressed on send
  if (st.sendPress > 0.001) {
    ctx.fillStyle = `rgba(80,65,255,${0.25 * st.sendPress})`;
    ctx.beginPath(); ctx.arc(C.send[0] + 16, inputTop + 36, 18, 0, Math.PI * 2); ctx.fill();
  }
  if (kbH > 0.5) phoneKeyboard(ctx, 0, H - kbH, 393, st.kbState || {});
}

// ─────────────────────────────── list rows that follow their chats ──────────────────────────────────────────────
// A row's last line, rewritten over a plate: the sender in blue if any (You / Emily Walsh), the text in the preview grey
// cut with an ellipsis, the time; our own messages keep the plate's double tick. Measured on the plates (the same in the
// phone, desk and widget lists): the time's digits at row top + 15.5, the preview's caps at + 35, the time ends at W − 17,
// ticks W − 65…W − 48.75. r: { top: the row's top in plate pt, bg: its flat colour, pr: where the preview may end };
// W: the list's width (393 phone, 476 desk, 296 widget); dy: where the plate's y 0 lands.
export function rowLast(ctx, W, dy, r, last) {
  if (!last) return;
  const y = dy + r.top;
  ctx.fillStyle = r.bg;
  ctx.fillRect(74, y + 33, r.pr - 74 + 1, 15.5);                         // below the name line (and its logo)
  ctx.fillRect(last.ticks ? W - 45 : W - 67, y + 12, last.ticks ? 29 : 51, 14);
  let x = 76.3;
  if (last.who) x += text(ctx, last.who + ':', x, y + 31.33, ST.sender) + 4;
  let s = last.text;
  if (measure(ctx, s, ST.preview) > r.pr - x) {
    while (s.length && measure(ctx, s + '...', ST.preview) > r.pr - x) s = s.slice(0, -1);
    s = s.trimEnd() + '...';
  }
  text(ctx, s, x, y + 31.33, ST.preview);
  text(ctx, last.time, W - 17, y + 13.13, { size: 10, lh: 12, weight: 400, color: '#ffffff85', align: 'right' });
  ctx.textAlign = 'left';
}
// the rows in the desk and widget lists: Marcus Chen (row 0, pinned) and the OFZ Rates Desk group (row 4, selected)
const DESK_ROWS = { marcus: { top: 136, bg: 'rgb(27,25,47)' }, ofz: { top: 392, bg: 'rgb(34,31,74)' } };
const listRow = (key, W) => ({ ...DESK_ROWS[key], pr: W === 476 ? 398 : key === 'marcus' ? 213 : 219 });

// Marcus Chen's row in every list says what his chat says. The plates are rewritten once: on the MacBook and the Duo
// (before he bells) his last message is our answer at 09:43; on the phone his request at 10:29, the one that bells
// (the three bell-list plates: before, with the yellow, without it)
const MARCUS_ROW = { desk: { who: 'You', text: 'Bid around 10.45, paper is thin', time: '09:43', ticks: true },
  phone: { text: 'Client needs 100M. Can you offer him?', time: '10:29' } };
export function rewritePlates(IMG, L) {
  const redo = (key, k, fn) => {
    const im = IMG[key], c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.setTransform(k, 0, 0, k, 0, 0); fn(g); IMG[key] = c;
  };
  redo('d-base', 4, g => rowLast(g, 476, 0, listRow('marcus', 476), MARCUS_ROW.desk));
  redo('t-widget', 6, g => rowLast(g, 296, 0, listRow('marcus', 296), MARCUS_ROW.desk));
  const BL = L.mobile.blist;
  for (const [key, bg] of [[BL.base0, BG], [BL.base1, 'rgb(44,40,26)'], [BL.base2, BG]])
    redo(key, 4, g => rowLast(g, 393, 0, { top: L.mobile.list.rows0, bg, pr: 318 }, MARCUS_ROW.phone));
}

// ─────────────────────────────── desk layout (952 pt), the Duo's inner display ──────────────────────────────────
// st: { t, kb, kbState, input, lastKey, caretOn, sent, reply, statusBar (pt) }
export function drawDesk(ctx, canvas, IMG, L, st) {
  const s = canvas.width / 952, H = canvas.height / s, im = IMG['d-base'];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const sb = st.statusBar ?? 24;
  // the top inset: the header's own top row stretched (the status lives in the corner column, drawn last)
  blit(ctx, im, 4, 0, 0, 952, 1, 0, 0, 952, sb);
  // list column
  blit(ctx, im, 4, 0, 0, 476, H - sb, 0, sb);
  rowLast(ctx, 476, sb, listRow('ofz', 476), st.ofzLast);
  rowLast(ctx, 476, sb, listRow('marcus', 476), st.marcusLast);
  // chat column
  const kbH = wideKeyboardHeight(952) * smooth(st.kb ?? 0);
  const inputTop = H - 72 - kbH;
  ctx.fillStyle = PANEL; ctx.fillRect(476, sb + 48, 476, H);
  ctx.save(); ctx.beginPath(); ctx.rect(476, sb + 48, 476, inputTop - sb - 48); ctx.clip();
  let extra = 0;
  const news = [];
  for (const m of st.sent || []) news.push({ kind: 'out', ...m });
  for (const m of st.incoming || []) news.push({ kind: 'in', ...m });
  const hOf = n => n.kind === 'out' ? 12 + outBubbleH(ctx, n.text, 428) : 12 + inBubbleH(ctx, n.name, n.text, 412);
  for (const n of news) extra += hOf(n) * smooth(n.k);
  const shift = (inputTop - 640) - extra;
  for (const m of L.desk.chat.msgs) {
    const [x, y, w, h] = m.r;
    blit(ctx, IMG[m.layer], 4, 0, 0, w, h, x, y + shift);
  }
  let y = 632 + shift;
  for (const n of news) {
    const k = smooth(n.k);
    ctx.save(); ctx.globalAlpha = clamp(n.k * 1.6);
    if (n.kind === 'out') outBubble(ctx, IMG, 944, y + 12 + (1 - k) * 22, n.text, n.time, 428);
    else inBubble(ctx, IMG, 516, y + 12 + (1 - k) * 22, n.name, n.text, n.time, 412, n.avatar, n.logo);
    ctx.restore();
    y += hOf(n) * k;
  }
  ctx.restore();
  blit(ctx, im, 4, 476, 0, 476, 48, 476, sb);
  // the chat header's two icons move left of the status column
  ctx.fillStyle = PANEL; ctx.fillRect(876, sb + 12, 60, 24);
  blit(ctx, im, 4, 878, 14, 56, 20, 878 - DESK_STATUS.shift, sb + 14);
  blit(ctx, im, 4, 476, 640, 476, 72, 476, inputTop);
  const fx = 548, ftop = inputTop + 26;
  ctx.save(); ctx.beginPath(); ctx.rect(540, inputTop + 16, 316, 40); ctx.clip();
  const tw = st.input ? measure(ctx, st.input, ST.input) : 0;
  if (st.input) text(ctx, st.input, fx, ftop, ST.input);
  if (st.caretOn) caret(ctx, fx + tw + 1.5, ftop + 1.5, 17, st.t, st.lastKey ?? -9);
  ctx.restore();
  if (kbH > 0.5) wideKeyboard(ctx, 0, H - kbH, 952, st.kbState || {});
  // status: the iPhone Duo's corner column, top right — the time, then Wi‑Fi in a ring (nothing in the top left)
  const D = DESK_STATUS;
  text(ctx, '9:41', D.x, D.time - 13 * 0.684, { size: 13, lh: 13 * 1.36, weight: 600, fam: 'SF', color: '#fff', align: 'center' });
  ctx.textAlign = 'left';
  statusRing(ctx, D.x, D.ring, D.ringD);
  if (st.dim) { ctx.fillStyle = `rgba(0,0,0,${st.dim})`; ctx.fillRect(0, 0, 952, H); }
}
const DESK_STATUS = { x: 904, time: 20, ring: 49, ringD: 30, shift: 84 };

// ─────────────────────────────── the widget growing into the Duo's display (the MacBook → Duo morph) ──────────────
// e: 0 the MacBook's chat widget (592 × 528) → 1 the Duo's desk layout (952 × 670, with its 24 pt top inset). Units are
// desk pt from the chat's top-left; the list rows sit at the same x and y in both layouts, so each pane is drawn in two
// pieces — what is anchored left and the column anchored right — and the panes widen; the widget plate cross-fades
// into the desk plate on the way. At e = 1 it is drawDesk itself, so the real Duo can take over without a seam.
// The same messages in both plates: [widget row y, h (widget pt; null above the plate), desk layer, side]. Each one
// slides from its widget place to its desk place while its two versions cross-fade, so bubbles reflow, not ghost.
const M_PAIRS = [[null, 0, 'd-msg-0', 'in'], [null, 0, 'd-msg-1', 'in'], [46, 114, 'd-msg-2', 'in'], [160, 62, 'd-msg-3', 'out'],
  [222, 58, 'd-msg-4', 'out'], [280, 84, 'd-msg-5', 'out'], [364, 84, 'd-msg-6', 'out']];
export function morphChatSize(e) { return { W: lerp(592, 952, e), H: lerp(528, 646, e) + 24 * e, sb: 24 * e }; }
export function drawMorph(ctx, canvas, IMG, L, st) {
  const e = clamp(st.e);
  if (e >= 0.999) return drawDesk(ctx, canvas, IMG, L, st);
  const s = canvas.width / 952, dk = IMG['d-base'], wg = IMG['t-widget'];
  const { W, H, sb } = morphChatSize(e), WL = W / 2, WD = W - WL, inputTop = H - 72;
  // widget plate → desk plate: the list, the headers and the input bar early (their rows line up), the dialog's
  // bubbles late — until the pane is nearly full width the widget's bubbles just move apart (incoming stay left,
  // outgoing ride the right edge); the desk's wider ones only fade in once they fit
  const a = smooth((e - 0.2) / 0.25), am = smooth((e - 0.5) / 0.38);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  if (sb > 0.01) blit(ctx, dk, 4, 0, 0, 952, 1, 0, 0, W, sb);
  const layer = (alpha, fn) => { if (alpha < 0.002) return; ctx.save(); ctx.globalAlpha = alpha; fn(); ctx.restore(); };
  // list pane: rows at the same place in both plates; the right column (times, badges) rides the pane's edge
  const listH = H - sb;
  layer(1 - a, () => {
    blit(ctx, wg, 6, 0, 0, 224, 528, 0, sb);
    if (WL - 72 > 224) blit(ctx, wg, 6, 223, 0, 1, 528, 224, sb, WL - 72 - 224, 528);
    blit(ctx, wg, 6, 224, 0, 72, 528, WL - 72, sb);
  });
  layer(a, () => {
    blit(ctx, dk, 4, 0, 0, WL - 72, listH, 0, sb);
    blit(ctx, dk, 4, 404, 0, 72, listH, WL - 72, sb);
  });
  // dialog pane
  ctx.fillStyle = PANEL; ctx.fillRect(WL, sb + 48, WD, H);
  ctx.save(); ctx.beginPath(); ctx.rect(WL, sb + 48, WD, inputTop - sb - 48); ctx.clip();
  const dRow = Object.fromEntries(L.desk.chat.msgs.map(m => [m.layer, m.r]));
  for (const [yw, hw, lay, side] of M_PAIRS) {
    const [, yd, , hd] = dRow[lay], y0 = yd + inputTop - 640;
    const y = yw == null ? y0 : lerp(yw + inputTop - 456, y0, am);
    if (yw != null) layer(1 - am, () => blit(ctx, wg, 6, 296, yw, 296, hw, side === 'in' ? WL : W - 296, y));
    layer(am, () => blit(ctx, IMG[lay], 4, 0, 0, 476, hd, side === 'in' ? WL : W - 476, y));
  }
  ctx.restore();
  // dialog header and input bar: the left part stays with the pane's left edge, the last ~100 pt with its right edge
  layer(1 - a, () => {
    blit(ctx, wg, 6, 296, 0, Math.min(196, WD - 100), 48, WL, sb);
    if (WD - 100 > 196) blit(ctx, wg, 6, 296 + 195, 0, 1, 48, WL + 196, sb, WD - 100 - 196, 48);
    blit(ctx, wg, 6, 492, 0, 100, 48, W - 100, sb);
    blit(ctx, wg, 6, 296, 456, Math.min(186, WD - 110), 72, WL, inputTop);
    if (WD - 110 > 186) blit(ctx, wg, 6, 296 + 150, 456, 1, 72, WL + 186, inputTop, WD - 110 - 186, 72);
    blit(ctx, wg, 6, 482, 456, 110, 72, W - 110, inputTop);
  });
  layer(a, () => {
    blit(ctx, dk, 4, 476, 0, WD - 100, 48, WL, sb);
    blit(ctx, dk, 4, 852, 0, 100, 48, W - 100, sb);
    const k = DESK_STATUS.shift * smooth((e - 0.4) / 0.6);
    if (k > 0.05) { ctx.fillStyle = PANEL; ctx.fillRect(W - 76, sb + 12, 60, 24); blit(ctx, dk, 4, 878, 14, 56, 20, W - 74 - k, sb + 14); }
    blit(ctx, dk, 4, 476, 640, WD - 110, 72, WL, inputTop);
    blit(ctx, dk, 4, 842, 640, 110, 72, W - 110, inputTop);
  });
  // the caret, still blinking in the field
  if (st.caretOn) caret(ctx, WL + 72 + 1.5, inputTop + 26 + 1.5, 17, st.t, st.lastKey ?? -9);
  // the Duo's status column comes in at the top right
  const sk = smooth((e - 0.5) / 0.5);
  if (sk > 0.002) {
    ctx.save(); ctx.globalAlpha = sk;
    text(ctx, '9:41', W - 952 + DESK_STATUS.x, DESK_STATUS.time - 13 * 0.684, { size: 13, lh: 13 * 1.36, weight: 600, fam: 'SF', color: '#fff', align: 'center' });
    ctx.textAlign = 'left';
    statusRing(ctx, W - 952 + DESK_STATUS.x, DESK_STATUS.ring, DESK_STATUS.ringD);
    ctx.restore();
  }
  ctx.restore();
}

// ─────────────────────────────── the terminal's chat widget (592 × 528 pt), on the MacBook ──────────────────────
// st: { t, caretOn, lastKey, cursor: [x, y] (widget pt) | null, press, sent, reply }
export function drawWidget(ctx, canvas, IMG, L, st) {
  const s = canvas.width / 592;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.drawImage(IMG['t-widget'], 0, 0, 592, 528);
  rowLast(ctx, 296, 0, listRow('ofz', 296), st.ofzLast);
  rowLast(ctx, 296, 0, listRow('marcus', 296), st.marcusLast);
  const T = L.terminal.chat;
  // new messages scroll the conversation up: copy the dialog up by their height, then draw them at the bottom
  const news = [...(st.sent || []).map(m => ({ kind: 'out', ...m })), ...(st.incoming || []).map(m => ({ kind: 'in', ...m }))];
  const hOf = n => n.kind === 'out' ? 12 + outBubbleH(ctx, n.text, 248) : 12 + inBubbleH(ctx, n.name, n.text, 248);
  let extra = 0; for (const n of news) extra += hOf(n) * smooth(n.k);
  if (extra > 0.01) {
    const dx = 296, dy = 48, dw = 296, dh = 408;
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
    ctx.fillStyle = PANEL; ctx.fillRect(dx, dy, dw, dh);
    ctx.drawImage(IMG['t-widget'], dx * 6, dy * 6, dw * 6, dh * 6, dx, dy - extra, dw, dh);
    let y = dy + dh - extra;
    for (const n of news) {
      const k = smooth(n.k);
      ctx.globalAlpha = clamp(n.k * 1.6);
      if (n.kind === 'out') outBubble(ctx, IMG, 584, y + 12 + (1 - k) * 22, n.text, n.time, 248);
      else inBubble(ctx, IMG, 336, y + 12 + (1 - k) * 22, n.name, n.text, n.time, 248, n.avatar, n.logo);
      ctx.globalAlpha = 1;
      y += hOf(n) * k;
    }
    ctx.restore();
  }
  const fx = T.text[0] - 8, ftop = T.text[1] - 664;
  const tw = st.input ? measure(ctx, st.input, ST.input) : 0;
  if (st.input) text(ctx, st.input, fx, ftop, ST.input);           // the draft, synced from the Duo
  if (st.caretOn) caret(ctx, fx + tw + 1.5, ftop + 1.5, 17, st.t, st.lastKey ?? -9);
  if (st.cursor) cursor(ctx, st.cursor[0], st.cursor[1], 1, st.press || 0);
}
