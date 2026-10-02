// From desk to pocket — the chat promo. 1600×1200, 24 bars of Mixkit #190 at 119.983 BPM (48.0 s).
// seek(t) is a pure function of t: the renderer asks for any (sub)frame in any order.
import * as THREE from 'three';
import { studioEnv, materials, canvasTexture, macMaterial, morphMaterial, imageTexture } from './look.js';
import { Duo, Slab, SPEC, iphoneParams, duoClosedParams, mixParams, slabMount, loadMacbook } from './devices.js';
import { drawMobile, drawDesk, drawWidget, drawMorph, morphChatSize, BELL_SWING_AT, rewritePlates } from './screens.js';
import { cursor } from './ui.js';
import { BEAT, AUDIO_START, B, SP, spring, step, track, clamp, lerp, smooth, smoother, CUES, cue } from './time.js';

const Q = new URLSearchParams(location.search);
const RENDER = Q.has('render');
const ASSETS = JSON.parse(document.getElementById('assets').textContent);
const W = 1600, H = 1200;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

async function loadImages(map) {
  const out = {};
  await Promise.all(Object.entries(map).map(async ([k, url]) => { const im = new Image(); im.src = url; await im.decode(); out[k] = im; }));
  return out;
}

// ─────────────────────────────── typing: key events on the grid → text and keyboard state ─────────────────────
// seq: [[beat, key]] — key is a character, or 'shift' | '123' | 'abc'. Starts with shift on (sentence start) unless told.
function typing(seq, { base = '', shift = true, layer = 'abc' } = {}) {
  const ev = []; let txt = base, sh = shift, ly = layer;
  for (const [b, key] of seq) {
    const t = B(b);
    let ch = null;
    if (key === 'shift') sh = !sh;
    else if (key === '123') ly = '123';
    else if (key === 'abc') ly = 'abc';
    else {
      ch = /[a-z]/.test(key) && sh ? key.toUpperCase() : key;
      txt += ch;
      if (/[a-z]/i.test(key)) sh = false;
      if (key === ' ' && ly === '123') ly = 'abc';     // iOS drops back to letters after a space
    }
    ev.push({ t, key, ch, txt, sh, ly });
    cue(t, 'key', { k: key === ' ' ? 'space' : key.length > 1 ? 'mod' : 'char' });
  }
  const at = t => {
    let st = { txt: base, sh: shift, ly: layer, last: -99, down: null, downK: 0 };
    for (const e of ev) { if (e.t > t) break; st = { txt: e.txt, sh: e.sh, ly: e.ly, last: e.t, key: e.key }; }
    const dt = t - st.last;
    if (dt >= 0 && dt < 0.16) { st.down = st.key; st.downK = dt < 0.075 ? 1 : 1 - (dt - 0.075) / 0.085; }
    return st;
  };
  return { ev, at, end: ev.length ? ev[ev.length - 1].t : 0 };
}
function suggest(txt) {
  const w = txt.split(' ').pop();
  if (!w || !/[a-z0-9]/i.test(w)) return /\d/.test(txt) ? ['bid', 'offer', 'done'] : ['I', 'The', 'I’m'];
  if (/^\d/.test(w)) return [`“${w}”`, w.length < 3 ? '26' : w, w + 'M'];
  if (/^of/i.test(w)) return [`“${w}”`, 'Offer', 'Offers'];
  if (/^\d+m$/i.test(w)) return [`“${w}”`, w, w.replace(/m$/i, ' M')];
  return [`“${w}”`, w, w + 's'];
}

async function uiTest(IMG) {
  const L = ASSETS.layout, kind = Q.get('ui');
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const wrap = document.getElementById('frame'); wrap.innerHTML = ''; wrap.style.background = '#333';
  const add = (c, x, y, h) => { c.style.cssText = `position:absolute;left:${x}px;top:${y}px;height:${h}px`; wrap.appendChild(c); };
  if (kind === 'mobile') {
    const a = mk(393 * 4, 852 * 4);
    drawMobile(a.getContext('2d'), a, IMG, L, { t: 10, push: 1, kb: 1, kbState: { layer: 'abc', down: 'o', downK: 1 }, input: 'Offer 26238 100M @ 10.40', caretOn: true, lastKey: 9.9 });
    add(a, 0, 0, 1200);
  }
  window.seek = () => {}; window.READY = true;
}

async function boot() {
  await Promise.all(['400', '500', '600', '700'].map(w => document.fonts.load(`${w} 14px Inter`)));
  const IMG = await loadImages(ASSETS.layers);
  if (Q.get('ui')) return uiTest(IMG);
  const L = ASSETS.layout;
  // Emily Walsh's avatar and the Sber mark, cut from her message layer (Figma exports them only inside it)
  const crop = (src, x, y, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(IMG[src], x, y, w, h, 0, 0, w, h); return c; };
  IMG['g-emily'] = crop('m-msg-2', 32, 288, 96, 96); IMG['g-sber'] = crop('m-msg-2', 872, 80, 64, 64);
  IMG['g-marcus'] = crop('m-bmsg-0', 32, 224, 96, 96);           // Marcus Chen, from his message in the bell chat
  rewritePlates(IMG, L);                                            // his row says what his chat says, in every list

  // ───────────── renderer, look
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Number(Q.get('pr') || (RENDER ? 2 : 1)));
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  const env = studioEnv(renderer);
  const M = materials(env); M.env = env;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, W / H, 4, 30000);

  // ───────────── screens
  const S = SPEC;
  const scr = {
    widget: canvasTexture(592 * 6, 528 * 6, renderer),
    inner: canvasTexture(S.duo.inner.pt[0] * 4, S.duo.inner.pt[1] * 4, renderer),
    // the iPhone's 393 × 852 pt; the Duo's outer display shows the top of it (same width, its own aspect)
    phone: canvasTexture(S.iphone.disp.pt[0] * 4, S.iphone.disp.pt[1] * 4, renderer),
    innerB: canvasTexture(S.duo.inner.pt[0] * 3, S.duo.inner.pt[1] * 3, renderer),
    grow: canvasTexture(S.duo.inner.pt[0] * 6, S.duo.inner.pt[1] * 6, renderer),   // the widget growing into the Duo (6×, like the widget)
  };
  const termTex = imageTexture(IMG['terminal'], renderer);
  const TW = L.terminal.widget;                                   // [8, 664, 592, 528] in terminal pt
  // the macOS pointer as a sprite on the MacBook's screen (20 × 26 pt, the tip 2 pt in), so it can come from off frame
  const CUR = { w: 20, h: 26, k: 6 };
  const curTex = canvasTexture(CUR.w * CUR.k, CUR.h * CUR.k, renderer);
  curTex.ctx.setTransform(CUR.k, 0, 0, CUR.k, 0, 0); cursor(curTex.ctx, 2, 2, 1, 0); curTex.tex.needsUpdate = true;
  const macMat = macMaterial(termTex, scr.widget.tex, [TW[0] / 1920, TW[1] / 1200, TW[2] / 1920, TW[3] / 1200], curTex.tex);

  // ───────────── devices
  const mac = await loadMacbook(ASSETS.glb, M, macMat);
  scene.add(mac.group);
  const duo = new Duo(M, scr.inner, scr.phone);                  // the story's Duo: it folds and becomes the iPhone
  scene.add(duo.group);
  const slab = new Slab(M, scr.phone);
  const mount = slabMount();
  const holder = new THREE.Group(); holder.position.set(mount.x, 0, mount.z); holder.rotation.y = mount.rotY;
  holder.add(slab.group); duo.group.add(holder);
  const duoB = new Duo(M, scr.innerB, scr.phone);               // the second, open Duo of the final line-up
  scene.add(duoB.group);
  const growMat = morphMaterial(termTex, scr.grow.tex);
  const grower = new Slab(M, null, { dispMat: growMat });          // the MacBook's screen becoming the open Duo
  grower.front.material = M.glass.clone();                         // its glass: the MacBook's dull bezel → the Duo's
  grower.refl.material = M.reflectMatte.clone();                   // and the display's sheen comes in with the Duo
  scene.add(grower.group);
  const P_DUO = duoClosedParams(), P_IPH = iphoneParams();
  // the phone canvas is drawn as tall as the display showing it (393 pt wide), and only that part is sampled
  const PH = S.iphone.disp.pt;
  const fracOf = d => Math.min(1, PH[0] * d.h / d.w / PH[1]);
  const F_OUT = fracOf(S.duo.outer);
  for (const d of [duo, duoB]) d.outerMat.uniforms.uvRect.value.set(0, 1 - F_OUT, 1, F_OUT);

  // ───────────── headlines (screen space, TR/Display/L at 2× like the DS film: word by word, rising out of a blur)
  const hlBox = document.getElementById('headline');
  const mkLine = (words, y) => {
    const els = words.map(w => { const e = document.createElement('div'); e.className = 'w'; e.textContent = w; hlBox.appendChild(e); return e; });
    const ctx = document.createElement('canvas').getContext('2d'); ctx.font = '700 68px Inter';
    const ws = words.map(w => ctx.measureText(w).width * 0.98), sp = ctx.measureText(' ').width;
    // a closing full stop hangs past the centre line: centred with it, a line looks pushed left of the one under it
    const last = words[words.length - 1], hang = /[.,:;!?]$/.test(last) ? ctx.measureText(last.slice(-1)).width * 0.98 : 0;
    let x = W / 2 - (ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1) - hang) / 2;
    const xs = ws.map(w => { const o = x; x += w + sp; return o; });
    return { els, xs, y };
  };
  // two lines, the claim and the product's name, in the same style and the same word-by-word rise; the pair sits where
  // the single line sat (its middle 80 px above the frame's)
  const PRODUCT = ['Trade', 'Radar', '–', 'Chats'];
  const HL1 = mkLine(['From', 'desk', 'to', 'pocket.'], 520), HL1b = mkLine(PRODUCT, 600);
  const HL2 = mkLine(['One', 'chat.', 'Every', 'screen.'], 520), HL2b = mkLine(PRODUCT, 600);

  // ─────────────────────────────── the timeline (beats; bar n starts at beat 4(n−1)) ──────────────────────────
  const TL = {
    hl1In: [0.5, 1.0, 1.5, 2.0], hl1bIn: [2.5, 3.0, 3.5, 4.0], hl1Out: 6.0,   // the claim, then the product's name
    macIn: 4.5,                      // the MacBook comes up out of the dark as the words leave
    toChat: 8.0,                     // …and the camera goes straight for the chat widget, all of it in frame
    cursorIn: 14.5, cursorAt: 16.5, click: 17.0,   // the pointer comes in from beyond the frame's right edge
    grow: 18.5, grown: 21.0,         // the MacBook's screen draws in to the Duo around the widget, the chat widens
    duoKb: 21.5, duoKbDown: 28.5, foldSet: 29.0,  // the keyboard goes, the camera squares up for the fold
    fold: 32.0, closed: 35.5,        // the drop … the clap: 1¾ s (the track's bar 10 is cut, see MUSIC_CUTS)
    approach: 35.75, turn: 36.75,    // edge first at us, then round to the outer display: the same chat, the draft in it
    pop: 38.75, swap: 39.1, morph: 39.5,   // back to the list (the draft in its row), then the iPhone 16
    bell: 41.0,                      // Marcus Chen bells you: two rings of the bell's 2 s loop, swings on 42 and 46
    tapRow: 47.25, push: 47.75, kbUp: 48.25, send: 52.0, typing: 53.0, reply: 56.0, kbDown: 57.0,   // his chat
    pop2: 58.5, tapDraft: 59.5, push2: 60.0,   // back to the list, into the group where the Duo's draft waits
    kbUp2: 60.25, send2: 66.0, kbDown2: 66.5,  // the offer finished on the iPhone and sent: it lands on every screen
    lineup: 66.5, emily: 70.0, hl2In: [73.5, 74.0, 74.5, 75.0], hl2bIn: [75.5, 76.0, 76.5, 77.0], fadeOut: 79.5,
  };
  const END = B(82);                 // the film ends on beat 82 (41 s): the picture and the track fade out together
  // The fold takes 3½ beats instead of 7½, so one bar of the track goes with it: bar 10 (beats 36–40) is cut from the
  // music (sounds.py, a 4 ms crossfade before the downbeat). After the fold every event sits on the same music as before
  const MUSIC_CUTS = [[36, 40]];
  cue(B(TL.click), 'click');
  cue(B(TL.grow), 'whoosh', { len: 1.1 });
  cue(B(TL.closed), 'clack');
  cue(B(TL.approach), 'whoosh', { len: 0.8 });
  cue(B(TL.pop), 'tap');
  cue(B(TL.morph), 'morph');
  // the bell's loop is phased so it swings on beats 46 and 50 (2 s = 4 beats apart); it strikes as it swings
  const BELL_T0 = B(TL.bell + 1) - BELL_SWING_AT;
  cue(B(TL.bell + 1) + 0.04, 'bell'); cue(B(TL.bell + 5) + 0.04, 'bell', { second: 1 });
  cue(B(TL.tapRow), 'tap'); cue(B(TL.pop2), 'tap'); cue(B(TL.tapDraft), 'tap');
  cue(B(TL.send), 'send');
  cue(B(TL.reply), 'receive');
  cue(B(TL.send2), 'send');
  cue(B(TL.emily), 'receive', { all: 1 });
  cue(B(TL.lineup), 'whoosh', { len: 1.6 });

  // typing on the Duo: "Offer 26238" on 16ths, a breath before the number, the layer switch on its own 16th
  const typeDuo = typing([
    [22.5, 'o'], [23.0, 'f'], [23.25, 'f'], [23.5, 'e'], [24.0, 'r'], [24.5, ' '],
    [25.25, '123'], [25.75, '2'], [26.25, '6'], [26.5, '2'], [27.0, '3'], [27.5, '8'],
  ]);
  const DRAFT = typeDuo.ev[typeDuo.ev.length - 1].txt;            // "Offer 26238": typed on the Duo, waiting in the group
  // Marcus Chen's chat (a personal one: no sender lines). He asks for an offer and bells; the reply is typed on the iPhone
  const MARCUS = [
    { kind: 'in', text: 'Thanks again for the 26240 print', time: '17:42', avatar: 'g-marcus' },
    { kind: 'out', text: 'Anytime. Same size tomorrow if needed', time: '17:44' },
    { kind: 'date', text: 'Today' },
    { kind: 'in', text: 'Morning! Are you showing OFZ today?', time: '09:05', avatar: 'g-marcus' },
    { kind: 'out', text: 'Yes, from 10:00', time: '09:06' },
    { kind: 'in', text: 'Perfect. Any color on 26238?', time: '09:41', avatar: 'g-marcus' },
    { kind: 'out', text: 'Bid around 10.45, paper is thin', time: '09:43' },
    { kind: 'in', text: 'Client needs 100M. Can you offer him?', time: '10:29', avatar: 'g-marcus' },
    { kind: 'sys' },                                               // "Marcus Chen bells you", the plate's own line
  ];
  const typePh = typing([[49.0, 'o'], [49.5, 'n'], [50.0, ' '], [50.5, 'i'], [51.0, 't']]);
  const MSG = typePh.ev[typePh.ev.length - 1].txt;               // "On it"
  const REPLY = { name: null, text: 'Great, watching the desk chat', time: '10:31', avatar: 'g-marcus' };
  // the group (OFZ Rates Desk): the Duo's draft finished on the iPhone — " 100M @ 10.40" on 16ths — and sent; it lands on
  // the MacBook and the Duo at once, and Emily (Sber CIB, Marcus's desk) lifts it, on all three screens together
  const typeGrp = typing([
    [60.75, ' '], [61.0, '123'], [61.25, '1'], [61.5, '0'], [61.75, '0'], [62.0, 'abc'], [62.25, 'shift'], [62.5, 'm'],
    [62.75, ' '], [63.0, '123'], [63.25, '@'], [63.5, ' '], [63.75, '123'], [64.0, '1'], [64.25, '0'], [64.5, '.'], [64.75, '4'], [65.0, '0'],
  ], { base: DRAFT, shift: false });
  const OFFER = typeGrp.ev[typeGrp.ev.length - 1].txt;           // "Offer 26238 100M @ 10.40"
  const EMILY = { name: 'Emily Walsh - Sberbank CIB', text: 'Done. 100M @ 10.40, thanks', time: '10:32', avatar: 'g-emily', logo: 'g-sber' };

  // ───────────── camera: target, yaw, pitch, size (the frame's height at the target, mm), fov, roll — springs.
  // Size rather than distance: when the lens changes, the subject keeps growing one way (no breathing mid dolly-zoom)
  const cam = { tgt: track([0, 0, 0]), yaw: track(0), pitch: track(0), size: track(400), fov: track(22), roll: track(0) };
  const deg = d => d * Math.PI / 180;
  const sizeAt = (dist, fov = 22) => 2 * dist * Math.tan(deg(fov) / 2);
  const camTo = (b, c, sp = SP.cam) => {
    const t = B(b);
    if (c.tgt) cam.tgt.to(t, Array.isArray(c.tgt) ? c.tgt : c.tgt.toArray(), sp);
    if (c.dist != null) cam.size.to(t, sizeAt(c.dist, c.fov ?? 22), sp);
    for (const k of ['yaw', 'pitch', 'size', 'fov', 'roll']) if (c[k] != null) cam[k].to(t, c[k], sp);
  };
  const angles = n => ({ yaw: Math.atan2(n.x, n.z), pitch: Math.asin(clamp(n.y, -1, 1)) });
  // the roll that lines the orbit camera's up with a screen's own up (so a screen seen head-on sits level)
  function rollFor(tgt, yaw, pitch, dist, up) {
    const c = new THREE.PerspectiveCamera();
    c.position.set(tgt.x + dist * Math.sin(yaw) * Math.cos(pitch), tgt.y + dist * Math.sin(pitch), tgt.z + dist * Math.cos(yaw) * Math.cos(pitch));
    c.up.set(0, 1, 0); c.lookAt(tgt); c.updateMatrixWorld(true);
    const u = up.clone().transformDirection(c.matrixWorldInverse);
    return Math.atan2(-u.x, u.y);
  }

  // Duo: the story device's pose (position + orientation as quaternion keys, slerped by springs)
  const qFrom = (x, y, z, order = 'XYZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(x), deg(y), deg(z), order));
  const devRot = [];                                               // [t, quat, spring]
  const rotTo = (b, q, sp = SP.dev) => devRot.push({ t: B(b), q, sp });
  const devQuat = t => {
    const q = devRot[0].q.clone();
    for (const k of devRot.slice(1)) { const s = step(t - k.t, k.sp); if (s > 0) q.slerp(k.q, Math.min(1, Math.max(0, s))); }
    return q;
  };
  const fold = track(0);                                           // 0 open → 1 closed
  const morph = track(0);                                          // slab: closed Duo → iPhone 16

  // ── the stage. The MacBook stands as in scene 1 (its turn is kept: the opening shot's reflections depend on it). The
  // open Duo lies in the plane of its screen, its display's top-left (above the 24 pt top inset) where the chat
  // widget's top-left is, so the screen can draw in to the Duo while the camera only pulls straight back.
  const qOld = qFrom(6, -24, 0), aOld = angles(V3(0, 0, 1).applyQuaternion(qOld));
  mac.group.position.set(0, 0, 0); mac.group.rotation.set(0, 0, 0); mac.group.updateMatrixWorld(true);
  const macOff = mac.at(0.5, 0.5);                                 // screen centre from the MacBook's origin (line-up)
  const n0 = mac.normal();
  const MAC_YAW = aOld.yaw - deg(6) - Math.atan2(n0.x, n0.z);
  mac.group.rotation.set(0, MAC_YAW, 0); mac.group.updateMatrixWorld(true);
  const SX = mac.at(1, 0).sub(mac.at(0, 0)).normalize(), SY = mac.at(0, 0).sub(mac.at(0, 1)).normalize();
  const SZ = SX.clone().cross(SY).normalize();                     // the screen's axes: right, up, out of it
  const qOpen = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(SX, SY, SZ));
  const nOpen = SZ.clone(), aOpen = angles(nOpen);
  rotTo(0, qOpen);
  // UI points: desk pt from the widget's top-left, y down. GA is that corner in the Duo's frame (the Duo at the origin)
  // mm per pt: the MacBook's screen is not quite 16:10, so its pt are 3.6 % taller than wide; the Duo's are square
  const MX0 = mac.at(0, 0).distanceTo(mac.at(1, 0)) / 1920, MY0 = mac.at(0, 0).distanceTo(mac.at(0, 1)) / 1200, MM1 = S.duo.inner.w / 952;
  const GA = { x: -S.duo.inner.w / 2, y: S.duo.inner.h / 2 - 24 * MM1 };
  const MAC_POS = V3(GA.x, GA.y, 0).applyQuaternion(qOpen).sub(mac.at(TW[0] / 1920, TW[1] / 1200));
  mac.group.position.copy(MAC_POS); mac.group.updateMatrixWorld(true);
  const macPt = (x, y) => mac.at(x / 1920, y / 1200);
  const macN = mac.normal(), macA = angles(macN);
  const macScreenC = macPt(960, 600);
  const macWidgetC = macPt(TW[0] + TW[2] / 2, TW[1] + TW[3] / 2);
  const mmPerPtMac = MX0;
  const macUp = V3(0, 1, 0).transformDirection(mac.screenMesh.matrixWorld).normalize();
  const macRoll = rollFor(macWidgetC, macA.yaw, macA.pitch, 300, macUp);
  window.DBG = { mmPerPtMac, MAC_POS: MAC_POS.toArray(), MAC_YAW, macA, macRoll };

  // the outline that draws in: the MacBook's lid around its screen → the open Duo; edges in the Duo's frame (mm), the
  // left and bottom barely move. Measured on the model: the screen mesh shows its texture from 1 % to 99 % (the rest is
  // under the bezel), the lid reaches 6.7 / 6.8 / 6.3 mm past it left / right / top, the chin 8 mm down to the hinge.
  const vis0 = { l: GA.x + (0.01 * 1920 - TW[0]) * MX0, r: GA.x + (0.99 * 1920 - TW[0]) * MX0, t: GA.y + (TW[1] - 0.01 * 1200) * MY0, b: GA.y - (0.99 * 1200 - TW[1]) * MY0 };
  const GROW0 = { body: { l: vis0.l - 6.7, r: vis0.r + 6.8, t: vis0.t + 6.3, b: vis0.b - 8.0 }, disp: vis0,
    r: [11, 11, 3, 3], dr: [0, 0, 0, 0], th: 4.6, n: 2.8 };
  const Hd = S.duo.half, Id = S.duo.inner;
  const GROW1 = { body: { l: -Hd.w, r: Hd.w, t: Hd.h / 2, b: -Hd.h / 2 }, disp: { l: -Id.w / 2, r: Id.w / 2, t: Id.h / 2, b: -Id.h / 2 },
    r: [S.duo.r, S.duo.r, S.duo.r, S.duo.r], dr: [Id.r, Id.r, Id.r, Id.r], th: Hd.t, n: S.duo.n };
  const growE = t => smoother((t - B(TL.grow)) / (B(TL.grown) - B(TL.grow)));
  // what the open Duo's band shows from the front: the hinge gap top and bottom, the antenna lines of both halves
  const growBands = k => [['T', 0, k], ['B', 0, k], ['T', -67.3, k], ['T', 67.3, k], ['B', -67.3, k], ['B', 67.3, k],
    ['L', 44.9, k], ['L', -44.9, k], ['R', 44.9, k], ['R', -44.9, k]];
  const growPose = new THREE.Vector3();
  function growUpdate(e) {
    const ed = k => ({ l: lerp(GROW0[k].l, GROW1[k].l, e), r: lerp(GROW0[k].r, GROW1[k].r, e), t: lerp(GROW0[k].t, GROW1[k].t, e), b: lerp(GROW0[k].b, GROW1[k].b, e) });
    const bo = ed('body'), di = ed('disp'), th = lerp(GROW0.th, GROW1.th, e);
    const cx = (bo.l + bo.r) / 2, cy = (bo.t + bo.b) / 2;
    grower.update({
      w: bo.r - bo.l, h: bo.t - bo.b, t: th, r: GROW0.r.map((v, i) => lerp(v, GROW1.r[i], e)), n: lerp(GROW0.n, GROW1.n, e),
      disp: { w: di.r - di.l, h: di.t - di.b, r: GROW0.dr.map((v, i) => lerp(v, GROW1.dr[i], e)), cx: (di.l + di.r) / 2 - cx, cy: (di.t + di.b) / 2 - cy },
      cut: [0, 0, 0, 0, 0], cutOn: 0, frame: 1 - e, cam: 0, feat: {}, bands: growBands(smooth((e - 0.6) / 0.4)),
      prof: { rf: 0.95, rb: 0.95, lipF: 0.5, lipB: 0.5, bulge: 0.12 },               // the Duo's band, as its halves'
    });
    grower.front.material.envMapIntensity = lerp(0.12, M.glass.envMapIntensity, smooth((e - 0.3) / 0.7));
    grower.front.material.clearcoat = lerp(0.15, M.glass.clearcoat, smooth((e - 0.3) / 0.7));
    grower.refl.material.envMapIntensity = M.reflectMatte.envMapIntensity * smooth((e - 0.5) / 0.5);
    grower.group.quaternion.copy(qOpen);
    grower.group.position.copy(growPose.set(cx, cy, -th).applyQuaternion(qOpen));
    // the display in UI pt (the scale goes from the MacBook's pt to the Duo's), the chat rect, the terminal fading out
    const sx = lerp(MX0, MM1, e), sy = lerp(MY0, MM1, e), u = growMat.uniforms, c = morphChatSize(e);
    u.disp.value.set((di.l - GA.x) / sx, (GA.y - di.t) / sy, (di.r - GA.x) / sx, (GA.y - di.b) / sy);
    u.chatR.value.set(0, -c.sb, c.W, c.H - c.sb);
    u.termK.value = 1 - smooth(e / 0.45);
  }

  // ── Act 1: the MacBook. Up out of the dark in three-quarter, then straight into the chat widget — all of it in frame
  const macAx = (x, y, z) => V3(x, y, z).applyAxisAngle(V3(0, 1, 0), MAC_YAW);     // an offset in the MacBook's frame
  const macBody = macScreenC.clone().add(macAx(0, -55, 40));
  camTo(0, { tgt: macBody, yaw: macA.yaw + deg(-36), pitch: deg(17), dist: 1080, fov: 22 }, SP.snap);
  camTo(4.5, { tgt: macBody, yaw: macA.yaw + deg(-22), pitch: deg(11), dist: 930 }, spring(2.4, 1));
  const WIDGET = TW[3] * MY0 * 1.17;                               // the widget's height and a margin
  camTo(TL.toChat, { tgt: macWidgetC, yaw: macA.yaw, pitch: macA.pitch, size: WIDGET }, spring(2.5, 1));
  cam.roll.to(B(TL.toChat), macRoll, spring(2.5, 1));
  camTo(12.5, { size: WIDGET * 0.97 }, spring(6, 1));               // a slow lean while the cursor comes in
  camTo(TL.click - 0.5, { size: WIDGET * 0.94 }, spring(1.6, 1));   // a touch closer for the click
  // the MacBook's screen becomes the Duo: no turn, the camera only pulls straight back as the outline draws in
  camTo(TL.grow, { tgt: [0, 0, 0], size: 170 }, { fn: tau => growE(B(TL.grow) + tau) });

  // ── Act 2: the Duo, open: the keyboard, the typing
  camTo(25.5, { tgt: [0, -4, 0], yaw: aOpen.yaw + deg(5), pitch: aOpen.pitch + deg(6), dist: 405 }, spring(2.6, 1));
  // ── the fold, toward us: the camera square on the screens and a little above; on the drop a hand closes it — the
  // halves swing at the camera and both screens frost over (the iPhone Duo's own animation: the bent panel blurs to
  // milky glass and clears when it is flat). The hinge's friction slows it near the end and the magnets take the last
  // 12°: the halves meet on the clap at beat 39½ (C1 at the hand-off, full speed at contact)
  const FOLD = { a: 4.2, J: 0.93, F: 0.93 };
  fold.at = t => {
    const T = B(TL.closed) - B(TL.fold), u = (t - B(TL.fold)) / T;
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const { a, J, F } = FOLD, s = x => 1 - Math.exp(-a * x) * (1 + a * x), s1 = s(1);
    if (u < J) return F * s(u / J) / s1;
    const v0 = F * a * a * Math.exp(-a) / s1 / (J * T), tau = (u - J) * T, Ts = (1 - J) * T;
    const acc = 2 * (1 - F - v0 * Ts) / (Ts * Ts);
    return F + v0 * tau + 0.5 * acc * tau * tau;
  };
  {                                                                // the hinge's friction follows its speed
    const t0 = B(TL.fold), t1 = B(TL.closed), n = Math.round((t1 - t0) * 100), v = [];
    for (let i = 0; i < n; i++) v.push((fold.at(t0 + (i + 1) / 100) - fold.at(t0 + i / 100)) * 100);
    const m = Math.max(...v);
    cue(t0, 'hinge', { len: t1 - t0, env: v.map(x => +(x / m).toFixed(3)) });
  }
  // per half the angle is 90°·f: the cover half is fully blurred by ~12° and darkest by ~35° (as in Apple's demo)
  const blurAt = f => smooth(f * 90 / 12), darkAt = f => 0.82 * smooth((f * 90 - 2) / 32);
  const Hd2 = S.duo.half, cLocal = V3(0, 0, mount.z);              // the closed body's centre in the Duo's frame
  const C_CLOSED = cLocal.clone().applyQuaternion(qOpen);           // …in the world, where it closes
  camTo(TL.foldSet, { tgt: [0, 0, 0], yaw: aOpen.yaw, pitch: aOpen.pitch + deg(14), dist: 455 }, spring(2.2, 1));
  // the camera rides the fold: its aim moves to the closing body, a touch closer and flatter
  camTo(TL.fold, { tgt: C_CLOSED, pitch: aOpen.pitch + deg(9), dist: 410 }, { fn: tau => clamp(fold.at(B(TL.fold) + tau)) });

  // ── closed, its free edges toward us: it comes at us edge first, then turns — to the outer display, upright (the
  // hinge on its left, as on Apple's), so close that only the screen's upper part is in frame; about its own centre
  const QTURN = new THREE.Quaternion().setFromAxisAngle(SY, deg(90)).multiply(qOpen);
  const Q3 = qFrom(0, 90, 0);                                      // the iPhone upright, its display to the camera
  const EDGE = cLocal.clone().setZ(Hd2.w + S.duo.gap / 2).applyQuaternion(qOpen);   // the free edges' face
  camTo(TL.approach, { tgt: EDGE, yaw: aOpen.yaw, pitch: aOpen.pitch, size: 92 }, spring(1.15, 1));
  rotTo(TL.turn, QTURN, spring(1.0, 0.96));
  // after the turn the outer display faces the camera at C + n·5.65; aim at its upper half (the hole and the status)
  const OUTER = C_CLOSED.clone().addScaledVector(SZ, 5.65).addScaledVector(SX, 2.825 + 7).addScaledVector(SY, 24);
  camTo(TL.turn, { tgt: OUTER, size: 72 }, spring(1.0, 1));
  camTo(TL.turn + 1.25, { tgt: OUTER.clone().addScaledVector(SY, 2), size: 68 }, spring(3, 1));   // drifts while it holds
  // the slab takes over out of shot, becomes the iPhone 16 and drives back
  rotTo(TL.morph, Q3, spring(1.2, 0.95));
  morph.to(B(TL.morph), 1, SP.morph);
  const center = track(C_CLOSED.toArray());
  center.to(B(TL.morph), [0, 0, 0], spring(1.3, 1));
  // …slowly: it is still the upper half of the phone in frame when Marcus Chen's row starts to bell
  const PHONE_Z = 2.2, PT = 141.1 / 852;                           // the display's face (mm), mm per pt
  const rowY = (852 / 2 - (L.mobile.list.rows0 + L.mobile.list.rowH / 2)) * PT;   // Marcus's row, from the centre
  camTo(TL.morph, { tgt: [0, rowY - 12, PHONE_Z], yaw: deg(-10), pitch: deg(4), size: 104, fov: 22, roll: 0 }, spring(2.8, 1));

  // ── Act 3: the iPhone. The bell, close: the row, the ring, the swinging bell; the tap; into Marcus's chat
  // the whole row for the first ring, then in on the avatar for the second (the bell large), back to the row for the tap
  const AV_X = (L.mobile.blist.avatar[0] - 393 / 2) * PT;
  camTo(TL.bell, { tgt: [0, rowY - 2, PHONE_Z], yaw: deg(-6), pitch: deg(3), size: 56 }, spring(2.4, 1));
  camTo(TL.bell + 2.25, { tgt: [AV_X + 9, rowY - 0.5, PHONE_Z], yaw: deg(-4), pitch: deg(2), size: 30 }, spring(2.4, 1));
  camTo(TL.tapRow - 0.5, { tgt: [0, rowY - 2, PHONE_Z], yaw: deg(-6), pitch: deg(3), size: 56 }, spring(1.2, 1));
  camTo(TL.push, { tgt: [0, -30, 0], yaw: deg(-14), pitch: deg(10), dist: 320 }, spring(1.7, 1));
  camTo(51.5, { tgt: [0, -6, 0], yaw: deg(-10), pitch: deg(6), dist: 380 }, spring(1.1, 1));
  camTo(55.0, { tgt: [0, 8, 0], yaw: deg(-6), pitch: deg(4), dist: 430 }, SP.cam);
  camTo(TL.push2, { tgt: [0, -30, 0], yaw: deg(-12), pitch: deg(10), dist: 320 }, spring(1.5, 1));

  // ── Act 4: the line-up. One pull-back from the iPhone; the MacBook and the open Duo rise out of the dark where they
  // stand (a fade up with a short lift, so the frame is never empty while the camera travels)
  // Every screen faces the viewer: each device is turned so its display looks at the camera of the final shot (the one
  // the headline sits on) — the Duo on the left and the iPhone on the right turn in toward the centre, the MacBook squares up
  // (framed on the group's middle: facing the camera, the open Duo reads wider than it did turned away)
  const LINE_CAM = { tgt: V3(-226, 22, -130), yaw: deg(4), pitch: deg(8), dist: 1300 };
  const EYE = LINE_CAM.tgt.clone().add(V3(Math.sin(LINE_CAM.yaw) * Math.cos(LINE_CAM.pitch), Math.sin(LINE_CAM.pitch),
    Math.cos(LINE_CAM.yaw) * Math.cos(LINE_CAM.pitch)).multiplyScalar(LINE_CAM.dist));
  const facing = pos => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(EYE, pos, V3(0, 1, 0)));   // +z → the eye
  const duoHome = [-395, 10, -40];
  const Q_DUOB = facing(V3(...duoHome));
  // the MacBook: only turned about its vertical axis (its lid sets the tilt); its screen centre stays where it was
  const MAC_SCREEN = V3(-185, 88, -390);
  const MAC_LINE_YAW = Math.atan2(EYE.x - MAC_SCREEN.x, EYE.z - MAC_SCREEN.z) - Math.atan2(n0.x, n0.z);
  const macHome = MAC_SCREEN.clone().sub(macOff.clone().applyAxisAngle(V3(0, 1, 0), MAC_LINE_YAW)).toArray();
  // the iPhone: turned in by the same angle as the Duo, mirrored (equal turns to the centre). The slab sits in the Duo's
  // frame turned −90° about y, so the Duo's pose is the slab's times its inverse
  const dDuo = EYE.clone().sub(V3(...duoHome)).normalize(), yawB = Math.atan2(dDuo.x, dDuo.z), pitchB = Math.asin(dDuo.y);
  const dPhone = V3(-Math.sin(yawB) * Math.cos(pitchB), Math.sin(pitchB), Math.cos(yawB) * Math.cos(pitchB));
  const Q_PHONE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(dPhone, V3(0, 0, 0), V3(0, 1, 0)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -mount.rotY));
  window.DBG.turns = { duo: +(yawB * 180 / Math.PI).toFixed(2), phone: +(-yawB * 180 / Math.PI).toFixed(2) };
  rotTo(TL.lineup, Q_PHONE, spring(2.4, 1));
  const LIFT = spring(2.6, 1);
  const duoBPos = track([duoHome[0], duoHome[1] - 45, duoHome[2]]).to(B(TL.lineup + 0.5), duoHome, LIFT);
  const macPos = track([macHome[0], macHome[1] - 70, macHome[2]]).to(B(TL.lineup), macHome, LIFT);
  const reveal = t => clamp((t - B(TL.lineup + 0.25)) / B(3.5));   // renderPass eases it
  camTo(TL.lineup, { tgt: [-232, 20, -130], yaw: deg(-5), pitch: deg(7), dist: 1350, fov: 22 }, spring(2.8, 1));
  camTo(70, { tgt: LINE_CAM.tgt, yaw: LINE_CAM.yaw, pitch: LINE_CAM.pitch, dist: LINE_CAM.dist }, spring(6, 1));

  // ───────────── which devices are on stage
  const inAct = t => ({
    mac: t < B(TL.grow) || t >= B(TL.lineup),
    grow: t >= B(TL.grow) && t < B(TL.grown),
    duo: t >= B(TL.grown),
    duoB: t >= B(TL.lineup),
  });
  // the pointer: in from beyond the frame's right edge, a slight arc, settling on the field; gone after the click
  const CUR0 = [790, 1000], CUR1 = [TW[0] + 394, TW[1] + 494];
  const pointer = t => {
    const u = clamp((t - B(TL.cursorIn)) / (B(TL.cursorAt) - B(TL.cursorIn))), k = 1 - Math.pow(1 - u, 3);
    const bow = 20 * Math.sin(Math.PI * k);
    return { x: lerp(CUR0[0], CUR1[0], k) - 0.38 * bow, y: lerp(CUR0[1], CUR1[1], k) - 0.93 * bow,
      on: t < B(TL.cursorIn) ? 0 : 1 - smooth((t - B(TL.click + 0.75)) / B(0.5)),
      press: t >= B(TL.click) && t < B(TL.click) + 0.14 ? 1 : 0 };
  };

  // ─────────────────────────────── seek ─────────────────────────────────────────────────────────────────────────
  // debug: ?cam=yawDeg,pitchDeg,dist,tx,ty,tz[,fov] replaces the timeline camera (inspect the models from anywhere)
  const CAM = Q.get('cam') ? Q.get('cam').split(',').map(Number) : null;
  function place(t) {
    if (CAM) {
      const [yw, pt, dist, tx = 0, ty = 0, tz = 0, fov = 22] = CAM, yaw = deg(yw), pitch = deg(pt);
      camera.fov = fov; camera.up.set(0, 1, 0);
      camera.position.set(tx + dist * Math.sin(yaw) * Math.cos(pitch), ty + dist * Math.sin(pitch), tz + dist * Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(tx, ty, tz); camera.near = 2; camera.updateProjectionMatrix();
      return;
    }
    const g = cam.tgt.at(t), yaw = cam.yaw.at(t), pitch = cam.pitch.at(t), fov = cam.fov.at(t);
    const dist = cam.size.at(t) / 2 / Math.tan(deg(fov) / 2);
    camera.fov = fov;
    camera.position.set(g[0] + dist * Math.sin(yaw) * Math.cos(pitch), g[1] + dist * Math.sin(pitch), g[2] + dist * Math.cos(yaw) * Math.cos(pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(g[0], g[1], g[2]);
    camera.rotateZ(cam.roll.at(t));
    camera.near = Math.max(2, dist * 0.05);
    camera.updateProjectionMatrix();
  }
  function seek(t) {
    t = clamp(t, 0, END - 1e-4);
    const on = inAct(t);
    // devices
    const f = clamp(fold.at(t), 0, 1);
    duo.setFold(f * Math.PI);
    const q = devQuat(t);
    duo.group.quaternion.copy(q);
    if (t >= B(TL.closed)) {                                   // closed: keep the body's centre where the track says
      const c = center.at(t), off = cLocal.clone().applyQuaternion(q);
      duo.group.position.set(c[0] - off.x, c[1] - off.y, c[2] - off.z);
    } else duo.group.position.set(0, 0, 0);
    const swapped = t >= B(TL.swap);
    { const u = duo.innerMat.uniforms; u.frost.value = blurAt(f); u.dark.value = darkAt(f); u.sweep.value = 1; }
    // the outer display wakes as it turns to us, as on the device: from dark and blurred, the light first, then focus
    const od = t < B(TL.turn + 0.1) ? 1 : 1 - smooth((t - B(TL.turn + 0.1)) / B(0.65));
    const ob = t < B(TL.turn + 0.25) ? 1 : 1 - smooth((t - B(TL.turn + 0.25)) / B(0.9));
    for (const m of [duo.outerMat, slab.dispMat]) { m.uniforms.frost.value = ob; m.uniforms.dark.value = od; m.uniforms.sweep.value = 0; }
    if (!swapped) { slab.dispMat.uniforms.frost.value = 0; slab.dispMat.uniforms.dark.value = 0; }
    for (const h of duo.halves) h.pivot.visible = !swapped;
    duo.spine.visible = !swapped && f > 0.002; duo.inner.visible = duo.innerRefl.visible = !swapped;
    slab.group.visible = swapped;
    const mk = clamp(morph.at(t), 0, 1.02);
    const P = swapped ? mixParams(P_DUO, P_IPH, mk) : null;
    if (P) {
      slab.update(P);
      const fr = fracOf(P.disp); slab.dispMat.uniforms.uvRect.value.set(0, 1 - fr, 1, fr);
    }
    duo.group.visible = on.duo;
    duoB.group.visible = on.duoB;
    duoB.group.position.set(...duoBPos.at(t)); duoB.group.quaternion.copy(Q_DUOB); duoB.setFold(0.06);
    mac.group.visible = on.mac;
    if (t >= B(TL.lineup)) { mac.group.position.set(...macPos.at(t)); mac.group.rotation.set(0, MAC_LINE_YAW, 0); }
    else { mac.group.position.copy(MAC_POS); mac.group.rotation.set(0, MAC_YAW, 0); }
    grower.group.visible = on.grow;
    if (on.grow) growUpdate(growE(t));

    // screens — only what is on stage gets redrawn
    const tb = t / BEAT;
    // Marcus's chat: our reply and his; the group: Emily's bid, on every screen in the line-up
    const sent = t >= B(TL.send) ? [{ text: MSG, time: '10:30', k: step(t - B(TL.send), SP.bubble) }] : [];
    const incoming = t >= B(TL.reply) ? [{ ...REPLY, k: step(t - B(TL.reply), SP.bubble) }] : [];
    const sentGroup = t >= B(TL.send2) ? [{ text: OFFER, time: '10:31', k: step(t - B(TL.send2), SP.bubble) }] : [];
    const incomingGroup = t >= B(TL.emily) ? [{ ...EMILY, k: step(t - B(TL.emily), SP.bubble) }] : [];
    // the group's row in the MacBook's and the Duo's lists follows its last message
    const ofzLast = t >= B(TL.emily) ? { who: 'Emily Walsh', text: EMILY.text, time: EMILY.time, ticks: false }
      : t >= B(TL.send2) ? { who: 'You', text: OFFER, time: '10:31', ticks: true } : null;
    const marcusLast = t >= B(TL.reply) ? { text: REPLY.text, time: REPLY.time } : null;   // his reply, once it is in
    const typingK = t >= B(TL.typing) && t < B(TL.reply) ? Math.min(step(t - B(TL.typing), SP.ui), 1 - step(t - B(TL.reply) + 0.12, SP.fast)) : 0;
    if (on.mac) {
      drawWidget(scr.widget.ctx, scr.widget.canvas, IMG, L, {
        t, caretOn: t >= B(TL.click), lastKey: B(TL.click), cursor: null,
        sent: t >= B(TL.lineup) ? sentGroup : [], incoming: t >= B(TL.lineup) ? incomingGroup : [], ofzLast, marcusLast,
      });
      scr.widget.tex.needsUpdate = true;
      const p = pointer(t), sc = 1 - 0.08 * p.press, u = macMat.uniforms;
      u.cursorOn.value = t < B(TL.lineup) ? p.on : 0;
      u.cursorRect.value.set((p.x - 2 * sc) / 1920, (p.y - 2 * sc) / 1200, CUR.w * sc / 1920, CUR.h * sc / 1200);
    }
    if (on.grow) {
      drawMorph(scr.grow.ctx, scr.grow.canvas, IMG, L, { e: growE(t), t, caretOn: true, lastKey: B(TL.click), kb: 0, input: '' });
      scr.grow.tex.needsUpdate = true;
    }
    if (on.duo && !swapped) {
      const ty = typeDuo.at(t);
      const kb = step(t - B(TL.duoKb), SP.ui) - step(t - B(TL.duoKbDown), SP.ui);
      drawDesk(scr.inner.ctx, scr.inner.canvas, IMG, L, {
        t, kb, kbState: { layer: ty.ly, shift: ty.sh, down: ty.down, downK: ty.downK, words: suggest(ty.txt) },
        // frosted while it folds (the shader), dark only once the halves face each other
        input: ty.txt, lastKey: Math.max(ty.last, B(TL.click)), caretOn: true, dim: 0.9 * smooth((f - 0.8) / 0.2),
      });
      scr.inner.tex.needsUpdate = true;
    }
    const phoneVisible = on.duo && (f > 0.5 || swapped);
    if (phoneVisible) {
      const marcus = t >= B(TL.bell) && t < B(TL.tapDraft);
      const ty = marcus ? typePh.at(t) : typeGrp.at(t);
      // the group (open on the Duo) → back to the list → Marcus bells → his chat → back → the group again
      const pushAt = (a, b) => step(t - B(b), SP.push) - step(t - B(a) - 0.08, SP.push);
      const push = 1 + pushAt(TL.pop, TL.push) + pushAt(TL.pop2, TL.push2);
      const press = b => clamp(step(t - B(b) + 0.05, SP.tap) - step(t - B(b) - 0.1, SP.fast));
      const kb = step(t - B(TL.kbUp), SP.ui) - step(t - B(TL.kbDown), SP.ui) + step(t - B(TL.kbUp2), SP.ui) - step(t - B(TL.kbDown2), SP.ui);
      const pressed = b => t >= B(b) && t < B(b) + 0.18 ? 1 : 0;
      drawMobile(scr.phone.ctx, scr.phone.canvas, IMG, L, {
        t, push, backPress: press(TL.pop) + press(TL.pop2),
        tapRow: clamp(step(t - B(TL.tapRow), SP.tap) - step(t - B(TL.push) - 0.25, SP.fast)),
        tapDraft: clamp(step(t - B(TL.tapDraft), SP.tap) - step(t - B(TL.push2) - 0.25, SP.fast)),
        chat: marcus ? 'marcus' : 'ofz', history: MARCUS, draft: DRAFT,
        bellT: t - B(TL.bell), bellLoopT: t - BELL_T0, bellOn: t < B(TL.push) + 0.4, chatBellT: t - B(TL.push) - 0.1,
        marcusLast,
        kb, kbState: { layer: ty.ly, shift: ty.sh, down: ty.down, downK: ty.downK, words: suggest(ty.txt) },
        input: t >= B(marcus ? TL.send : TL.send2) ? '' : ty.txt, lastKey: Math.max(ty.last, B(marcus ? TL.kbUp : TL.kbUp2)),
        caretOn: marcus ? t >= B(TL.kbUp) && t < B(TL.kbDown) + 0.2 : t >= B(TL.kbUp2) && t < B(TL.kbDown2) + 0.2,
        sent: marcus ? sent : sentGroup, typing: marcus ? typingK : 0, typingPh: tb, incoming: marcus ? incoming : incomingGroup,
        sendPress: pressed(TL.send) + pressed(TL.send2),
        H: PH[1] * (P ? fracOf(P.disp) : F_OUT), iphone: P ? clamp((mk - 0.1) / 0.75) : 0,
      });
      scr.phone.tex.needsUpdate = true;
    }
    if (on.duoB) {
      drawDesk(scr.innerB.ctx, scr.innerB.canvas, IMG, L, { t, input: '', caretOn: false, sent: sentGroup, incoming: incomingGroup, ofzLast, marcusLast });
      scr.innerB.tex.needsUpdate = true;
    }

    // camera + render
    place(t);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    if (on.duoB && reveal(t) < 0.999) {
      // the line-up rising out of the dark: the MacBook and the open Duo through the fade, then the iPhone over them
      const vis = [mac.group.visible, duo.group.visible, duoB.group.visible];
      duo.group.visible = false;
      if (reveal(t) > 0.001) renderPass(reveal(t), camera);
      mac.group.visible = duoB.group.visible = false; duo.group.visible = vis[1];
      renderer.clearDepth(); renderer.render(scene, camera);
      [mac.group.visible, duo.group.visible, duoB.group.visible] = vis;
    } else {
      renderer.render(scene, camera);
    }

    // global fade (in from black at the start, out at the end) and the headlines
    const fadeIn = smooth((t - B(TL.macIn)) / B(3)), fadeOut = 1 - smooth((t - B(TL.fadeOut)) / B(2.5));
    const dimEnd = 1 - 0.72 * smooth((t - B(TL.hl2In[0] - 1)) / B(2));
    canvas.style.opacity = (Math.min(fadeIn, fadeOut) * dimEnd).toFixed(4);
    headline(HL1, t, TL.hl1In, TL.hl1Out);
    headline(HL1b, t, TL.hl1bIn, TL.hl1Out);
    headline(HL2, t, TL.hl2In, TL.fadeOut + 1.5);
    headline(HL2b, t, TL.hl2bIn, TL.fadeOut + 1.5);
  }

  // B pass: render the scene into a target and draw it over the frame with opacity k
  const rt = new THREE.WebGLRenderTarget(W * renderer.getPixelRatio(), H * renderer.getPixelRatio(), { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsMat = new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, opacity: 1, depthTest: false, toneMapped: false });
  fsScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fsMat));
  function renderPass(k, c) {
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(scene, c);
    renderer.setRenderTarget(null);
    fsMat.opacity = smooth(k);
    renderer.render(fsScene, fsCam);
  }

  function headline(HL, t, ins, outB) {
    HL.els.forEach((e, k) => {
      const tin = B(ins[k]), tout = B(outB) + 0.006 * k;
      const a = step(t - tin, SP.hlIn) - step(t - tout, SP.hlOut);
      const dy = 18 * (1 - step(t - tin, SP.hlRise)) - 30 * step(t - tout, SP.hlOut);
      if (a < 0.004) { e.style.display = 'none'; return; }
      e.style.display = '';
      e.style.opacity = Math.min(1, a).toFixed(3);
      const blur = (1 - Math.min(1, a)) * 10;
      e.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
      e.style.transform = `translate(${HL.xs[k].toFixed(2)}px, ${(HL.y - 80 + dy).toFixed(2)}px)`;
    });
  }

  window.seek = seek;
  window.LENGTH = END; window.BEAT = BEAT; window.CUES = CUES; window.AUDIO_START = AUDIO_START;
  window.FADE = [B(TL.fadeOut), END];
  window.MUSIC_CUTS = MUSIC_CUTS;
  window.READY = true;
  seek(Number(Q.get('t') || 0));

  // preview transport (not in renders): space plays, the slider scrubs
  if (!RENDER) {
    const bar = document.getElementById('bar'); bar.hidden = false;
    const scrub = document.getElementById('scrub'), clock = document.getElementById('clock'), btn = document.getElementById('play');
    // the mix (music + UI sounds) plays along; the picture follows the audio clock when it is running
    const audio = document.getElementById('audio'); audio.src = 'renders/chat-promo-audio.m4a';
    let playing = false, t0 = 0, from = 0, cur = Number(Q.get('t') || 0);
    const frame = () => {
      if (!playing) return;
      cur = audio.readyState >= 2 && !audio.paused ? audio.currentTime : from + (performance.now() - t0) / 1000;
      if (cur >= END) { cur = 0; from = 0; t0 = performance.now(); audio.currentTime = 0; }
      seek(cur); scrub.value = cur / END; clock.value = cur.toFixed(2);
      requestAnimationFrame(frame);
    };
    const toggle = () => {
      playing = !playing; btn.textContent = playing ? 'Pause' : 'Play';
      if (playing) { from = cur; t0 = performance.now(); audio.currentTime = cur; audio.play().catch(() => {}); requestAnimationFrame(frame); }
      else audio.pause();
    };
    btn.onclick = toggle;
    addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
    scrub.oninput = () => { cur = Number(scrub.value) * END; from = cur; t0 = performance.now(); audio.currentTime = cur; seek(cur); clock.value = cur.toFixed(2); };
  }
}
boot().catch(e => { console.error(e); document.title = 'ERROR ' + e.message; });
