// The three devices, in millimetres, from Apple's published specs:
//   iPhone Duo  open 164.6 × 117.8 × 5.2, closed 84.1 × 117.8 × 11.3; inner 2670 × 1878 @ 430 ppi, outer 1398 × 2034 @ 460 ppi
//   iPhone 16  71.6 × 147.6 × 7.8; 1179 × 2556 @ 460 ppi (393 × 852 pt, the Figma frame), Dynamic Island
//   MacBook Pro 16 — the CC-BY model shipped with rigged-macbook-3d (jackbaeten, rigged by William Laverty)
// The Duo is laid out like Apple's: the outer display on the back of the left half (closed and seen from it, the hinge
// is on the left, the camera hole top right), the cameras on the back of the right half.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { outline, sweep, cap, strip, flatStrip, sector, bandProfile } from './geo.js';
import { displayMaterial } from './look.js';
import { lerp, clamp } from './time.js';

const PPI_MM = ppi => 25.4 / ppi;

export const SPEC = {
  duo: {
    // corners as in Apple's photos: 13 mm continuous (superellipse n 2.5), the displays concentric inside them
    half: { w: 82.3, h: 117.8, t: 5.2 }, gap: 0.9, r: 13, n: 2.5,
    inner: { w: 2670 * PPI_MM(430), h: 1878 * PPI_MM(430), r: 8.5, pt: [952, 670] },     // 157.7 × 110.9 mm
    // 77.2 × 112.3 mm; tight corners by the hinge, round ones on the free edge; the camera hole in the top right
    // corner (Apple's photos: 6 mm, 7.9 mm in from the edge, 7.7 mm down)
    outer: { w: 1398 * PPI_MM(460), h: 2034 * PPI_MM(460), r: [2.0, 8.5, 8.5, 2.0], pt: [466, 678], hole: { dx: 7.9, dy: 7.7, r: 3.0 } },
  },
  iphone: {
    w: 71.6, h: 147.6, t: 7.8, r: 11.4,
    disp: { w: 1179 * PPI_MM(460), h: 2556 * PPI_MM(460), r: 9.1, pt: [393, 852] },     // 65.1 × 141.1 mm, 55 pt corners
    island: { w: 20.8, h: 6.1, top: 1.85 },                                             // 125.6 × 36.7 pt at 11 pt
  },
};
// the Duo's outer display hole in the display's own coordinates (centre origin, y up)
export function outerHole() {
  const O = SPEC.duo.outer;
  return [O.w / 2 - O.hole.dx, O.h / 2 - O.hole.dy, O.hole.r, O.hole.r, O.hole.r];
}

function mesh(g, m, parent, order = 0) {
  const x = new THREE.Mesh(g, m);
  x.renderOrder = order;
  parent.add(x);
  return x;
}

// ─────────────────────────────── details: keys, Camera Control, the port, grilles, antenna lines ─────────────────
// Features sit on an edge of a slab-shaped body (w × h × t, back at z = 0, front at z = t): edge 'L' | 'R' | 'T' | 'B',
// `a` mm along the edge from its centre (L/R: +a is up, T/B: +a is right), at depth z. `vis` 0..1 grows a feature
// out of the band (the morph adds the iPhone's keys and takes the Duo's away).
//   key { len, hh, p }   a pill key standing p mm proud of the outline
//   cc  { len, hh }      Camera Control: a flush sapphire pill in a chamfered recess
//   port { len, hh }     USB-C: a dark opening with a bright chamfer and the tongue inside
//   holes { n, pitch, d }, screw { d }
// Closed Duo (as one slab, seen from its outer display): the left half is the front (z 5.65…11.3), the right half the
// back (0…5.65); the hinge is the slab's left edge, both free edges its right edge. Keys that the iPhone keeps on the
// same edge share an id and slide there in the morph (the Duo's upper free-edge key becomes the side button).
const DUO_FEATURES = {
  side: { kind: 'key', edge: 'R', a: 36.9, z: 8.7, len: 10, hh: 2.2, p: 0.62, vis: 1 },      // volume up
  volDnD: { kind: 'key', edge: 'R', a: 24.9, z: 8.7, len: 10, hh: 2.2, p: 0.62, vis: 1 },    // volume down
  power: { kind: 'key', edge: 'T', a: 18, z: 2.6, len: 16, hh: 2.3, p: 0.4, vis: 1 },        // Touch ID, top of the camera half
  action: { kind: 'key', edge: 'L', a: 43.3, z: 8.7, len: 7.5, hh: 2.2, p: 0.62, vis: 0 },
  volUp: { kind: 'key', edge: 'L', a: 29.0, z: 8.7, len: 10, hh: 2.2, p: 0.62, vis: 0 },
  volDn: { kind: 'key', edge: 'L', a: 16.2, z: 8.7, len: 10, hh: 2.2, p: 0.62, vis: 0 },
  cc: { kind: 'cc', edge: 'R', a: -25.6, z: 5.65, len: 19, hh: 3.4, vis: 0 },
  port: { kind: 'port', edge: 'B', a: 2.825, z: 8.7, len: 8.6, hh: 2.7, vis: 1 },
  mic: { kind: 'holes', edge: 'B', a: 27.8, z: 8.7, n: 5, pitch: 1.8, d: 1.0, vis: 1 },
  spk: { kind: 'holes', edge: 'B', a: 27.8, z: 2.6, n: 5, pitch: 1.8, d: 1.0, vis: 1 },
  spkTop: { kind: 'holes', edge: 'T', a: 24, z: 8.7, n: 5, pitch: 1.8, d: 1.0, vis: 1 },   // the grille on the outer half's top
  screwL: { kind: 'screw', edge: 'B', a: -6.9, z: 5.65, d: 1.3, vis: 0 },
  screwR: { kind: 'screw', edge: 'B', a: 6.9, z: 5.65, d: 1.3, vis: 0 },
};
// iPhone 16, seen from the front: Action button and volume on the left, side button and Camera Control on the right
const IPHONE_FEATURES = {
  side: { kind: 'key', edge: 'R', a: 28.5, z: 3.9, len: 17, hh: 2.6, p: 0.75, vis: 1 },
  volDnD: { kind: 'key', edge: 'R', a: 24.9, z: 3.9, len: 10, hh: 2.6, p: 0.75, vis: 0 },
  power: { kind: 'key', edge: 'T', a: 18, z: 3.9, len: 16, hh: 2.3, p: 0.4, vis: 0 },
  action: { kind: 'key', edge: 'L', a: 43.3, z: 3.9, len: 7.5, hh: 2.6, p: 0.75, vis: 1 },
  volUp: { kind: 'key', edge: 'L', a: 29.0, z: 3.9, len: 11, hh: 2.6, p: 0.75, vis: 1 },
  volDn: { kind: 'key', edge: 'L', a: 16.2, z: 3.9, len: 11, hh: 2.6, p: 0.75, vis: 1 },
  cc: { kind: 'cc', edge: 'R', a: -25.6, z: 3.9, len: 19, hh: 3.4, vis: 1 },
  port: { kind: 'port', edge: 'B', a: 0, z: 3.9, len: 9.0, hh: 3.3, vis: 1 },
  mic: { kind: 'holes', edge: 'B', a: 14.75, z: 3.9, n: 6, pitch: 1.9, d: 1.15, vis: 1 },
  spk: { kind: 'holes', edge: 'B', a: -14.75, z: 3.9, n: 6, pitch: 1.9, d: 1.15, vis: 1 },
  spkTop: { kind: 'holes', edge: 'T', a: 24, z: 3.9, n: 5, pitch: 1.8, d: 1.0, vis: 0 },
  screwL: { kind: 'screw', edge: 'B', a: -6.9, z: 3.9, d: 1.3, vis: 1 },
  screwR: { kind: 'screw', edge: 'B', a: 6.9, z: 3.9, d: 1.3, vis: 1 },
};
// antenna lines: [edge, a, vis], paired by index with the iPhone's (same edge, so they slide in the morph)
const DUO_BANDS = [['L', 50, 0], ['L', -50, 0], ['T', 28.98, 1], ['B', 28.98, 1], ['R', 44.9, 1], ['R', -44.9, 1]];
const IPHONE_BANDS = [['L', 58, 1], ['L', -58, 1], ['T', -20, 1], ['B', -24, 1], ['R', 58, 1], ['R', -58, 1]];

const EDGE = {
  L: { n: [-1, 0], p: (w, h, a) => [-w / 2, a] }, R: { n: [1, 0], p: (w, h, a) => [w / 2, a] },
  T: { n: [0, 1], p: (w, h, a) => [a, h / 2] }, B: { n: [0, -1], p: (w, h, a) => [a, -h / 2] },
};
// the frame of a feature: origin on the outline at (edge, a, z); z out of the band, y across it (toward the front)
function edgeFrame(edge, a, z, w, h) {
  const E = EDGE[edge], [x, y] = E.p(w, h, a);
  const ez = new THREE.Vector3(E.n[0], E.n[1], 0), ey = new THREE.Vector3(0, 0, 1), ex = ey.clone().cross(ez);
  return new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(x, y, z);
}
// a flat pill (stadium) in the xy-plane, facing +z; with `inner` a ring whose normals lean into the hole (a chamfer)
function pillGeo(len, hh, z = 0, inner = null, lean = 0.9) {
  const seg = 18, ring = [];
  const r = hh / 2, cx = len / 2 - r;
  for (const [sx, a0] of [[1, -Math.PI / 2], [-1, Math.PI / 2]])
    for (let i = 0; i <= seg; i++) { const a = a0 + Math.PI * i / seg; ring.push([sx * cx + r * Math.cos(a), r * Math.sin(a)]); }
  const pos = [], nor = [], idx = [];
  if (!inner) {
    pos.push(0, 0, z); nor.push(0, 0, 1);
    for (const [x, y] of ring) { pos.push(x, y, z); nor.push(0, 0, 1); }
    for (let i = 0; i < ring.length; i++) idx.push(0, 1 + i, 1 + (i + 1) % ring.length);
  } else {
    const k = inner;                                  // inner pill = outer scaled toward the centre line
    for (const [x, y] of ring) {
      pos.push(x, y, z); nor.push(0, 0, 1);
      const ix = Math.sign(x) * Math.max(0, Math.abs(x) - cx) * k + Math.sign(x) * Math.min(Math.abs(x), cx), iy = y * k;
      const dx = x - ix, dy = y - iy, l = Math.hypot(dx, dy) || 1;
      pos.push(ix, iy, z - 0.02); const n = new THREE.Vector3(-dx / l * lean, -dy / l * lean, 1).normalize(); nor.push(n.x, n.y, n.z);
    }
    const n = ring.length;
    for (let i = 0; i < n; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return withUv(g);
}
function keyGeo(len, hh, p) {
  const pts = outline(len, hh, [hh / 2, hh / 2, hh / 2, hh / 2], { n: 2, seg: 14 });
  const r = Math.min(p * 0.8, hh * 0.3), P = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 * i / 6; P.push({ d: r - r * Math.sin(a), z: p - r + r * Math.cos(a), nd: Math.sin(a), nz: Math.cos(a) }); }
  P.push({ d: 0, z: -0.7, nd: 1, nz: 0 });
  return merge2(sweep(pts, P), cap(pts, r, p, 1));
}
function merge2(a, b) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const A = a.getAttribute(name).array, Bv = b.getAttribute(name).array, C = new Float32Array(A.length + Bv.length);
    C.set(A); C.set(Bv, A.length); out.setAttribute(name, new THREE.BufferAttribute(C, 3));
  }
  const na = a.getAttribute('position').count, ia = Array.from(a.getIndex().array), ib = Array.from(b.getIndex().array).map(i => i + na);
  out.setIndex(ia.concat(ib));
  return withUv(out);
}
// features never sit on an antenna line: a constant uv keeps the band's maps white under them
function withUv(g) { g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2).fill(0.0005), 2)); return g; }

export function detailMaterials(M) {
  return {
    hole: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    port: new THREE.MeshBasicMaterial({ color: 0x020202 }),
    tongue: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.3, roughness: 0.5, envMap: M.env || null }),
    sapphire: M.lens,
    screw: new THREE.MeshPhysicalMaterial({ color: 0x8d8c8a, metalness: 1, roughness: 0.35, envMap: M.titanium.envMap }),
  };
}

// builds the features of one body; `frame` is the band's material (keys and chamfers share it, so they morph with it)
export class Details {
  constructor(D, frame) { this.D = D; this.frame = frame; this.group = new THREE.Group(); this.sig = ''; }
  // dims: { w, h, bulge } of the band the features sit on; filter(f) picks what this body carries
  update(feats, dims, filter = () => true) {
    const list = Object.values(feats).filter(f => f.vis > 0.004 && filter(f));
    const sig = JSON.stringify([dims.w, dims.h, list.map(f => [f.a, f.z, f.len, f.hh, f.vis].map(v => +(v ?? 0).toFixed(3)))]);
    if (sig === this.sig) return;
    this.sig = sig;
    for (const c of this.group.children.slice()) { this.group.remove(c); c.geometry.dispose(); }
    const D = this.D, out = (dims.bulge ?? 0.18) + 0.025;
    const add = (g, m, mat) => { const x = new THREE.Mesh(g, m); x.matrixAutoUpdate = false; x.matrix.copy(mat); this.group.add(x); return x; };
    for (const f of list) {
      const v = f.vis, F = edgeFrame(f.edge, f.a, f.z, dims.w, dims.h);
      if (f.kind === 'key') add(keyGeo(f.len * (0.6 + 0.4 * v), f.hh * (0.7 + 0.3 * v), f.p * v + (out - 0.02) * (1 - v)), this.frame, F);
      else if (f.kind === 'cc') {
        const L = f.len * v, Hh = f.hh * v, s = Hh * (1 - 0.72);
        add(pillGeo(L, Hh, out, 0.72), this.frame, F);
        add(pillGeo(L - s + 0.04, Hh - s + 0.04, out - 0.012), D.sapphire, F);
      } else if (f.kind === 'port') {
        const L = f.len * v + 0.8, Hh = f.hh * v + 0.8, s = Hh * (1 - 0.78);
        add(pillGeo(L, Hh, out, 0.78, 1.4), this.frame, F);
        add(pillGeo(L - s + 0.04, Hh - s + 0.04, out - 0.012), D.port, F);
        add(pillGeo(f.len * v * 0.64, 0.66 * v, out - 0.004), D.tongue, F);
      } else if (f.kind === 'holes') {
        const r = f.d / 2 * v;
        for (let i = 0; i < f.n; i++) {
          const x = (i - (f.n - 1) / 2) * f.pitch;
          add(pillGeo(2 * r, 2 * r, out), D.hole, F.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, 0)));
        }
      } else if (f.kind === 'screw') {
        add(pillGeo(f.d * v, f.d * v, out, 0.45, 0.6), D.screw, F);
        add(pillGeo(f.d * v * 0.4, f.d * v * 0.4, out + 0.004), D.hole, F);
      }
    }
  }
}
export function mixFeatures(A, B, k) {
  const o = {};
  for (const id of Object.keys(A)) {
    const a = A[id], b = B[id], f = { ...a };
    for (const q of Object.keys(a)) if (typeof a[q] === 'number') f[q] = lerp(a[q], b[q], k);
    // a feature one side lacks grows in / shrinks away over the middle of the morph
    if (a.vis !== b.vis) f.vis = lerp(a.vis, b.vis, clamp((k - 0.25) / 0.5));
    o[id] = f;
  }
  return o;
}

// antenna lines on the band: a colour map (dark insert) and a metalness map (the insert is not metal), along the
// outline's arc length (the sweep's u)
function arcAt(pts, edge, a, w, h) {
  const E = EDGE[edge], [px, py] = E.p(w, h, a), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if (Math.abs(p.nx - E.n[0]) > 1e-3 || Math.abs(p.ny - E.n[1]) > 1e-3 || Math.abs(q.nx - E.n[0]) > 1e-3 || Math.abs(q.ny - E.n[1]) > 1e-3) continue;
    const L = Math.hypot(q.x - p.x, q.y - p.y); if (L < 1e-6) continue;
    const k = ((px - p.x) * (q.x - p.x) + (py - p.y) * (q.y - p.y)) / (L * L);
    if (k >= -1e-6 && k <= 1 + 1e-6) return (p.s + k * L) / pts.total;
  }
  return null;
}
export class BandMaps {
  constructor() {
    const mk = (srgb) => {
      const c = document.createElement('canvas'); c.width = 4096; c.height = 4;
      const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
      return { c, g: c.getContext('2d'), t };
    };
    this.col = mk(true); this.met = mk(false); this.sig = '';
  }
  update(pts, bands, w, h, width = 0.85) {
    const sig = [w, h, ...bands.flat()].map(v => typeof v === 'number' ? v.toFixed(3) : v).join();
    if (sig === this.sig) return;
    this.sig = sig;
    const { col, met } = this, W = col.c.width;
    col.g.fillStyle = '#fff'; col.g.fillRect(0, 0, W, 4);
    met.g.fillStyle = '#fff'; met.g.fillRect(0, 0, W, 4);
    for (const [edge, a, vis] of bands) {
      if (vis < 0.004) continue;
      const u = arcAt(pts, edge, a, w, h); if (u == null) continue;
      const x = u * W, hw = width / pts.total * W / 2;
      const c = Math.round(255 - (255 - 58) * vis), m = Math.round(255 * (1 - vis));
      for (const [T, v] of [[col, `rgb(${c},${c},${c + 2})`], [met, `rgb(${m},${m},${m})`]]) {
        T.g.fillStyle = v; T.g.fillRect(x - hw, 0, 2 * hw, 4);
      }
    }
    col.t.needsUpdate = true; met.t.needsUpdate = true;
  }
  apply(mat) { mat.map = this.col.t; mat.metalnessMap = this.met.t; mat.needsUpdate = true; }
}

// ─────────────────────────────── a single slab: iPhone 16, or the closed Duo while it becomes one ───────────────
export class Slab {
  constructor(M, screen, opts = {}) {
    this.M = M;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); this.group.add(this.body);
    this.frameMat = M.frame.clone();
    this.frame = mesh(new THREE.BufferGeometry(), this.frameMat, this.body);
    this.bands = new BandMaps(); this.bands.apply(this.frameMat);
    M.detail = M.detail || detailMaterials(M);
    this.details = new Details(M.detail, this.frameMat); this.body.add(this.details.group);
    this.front = mesh(new THREE.BufferGeometry(), M.glass, this.body);
    this.backMat = M.back.clone();
    this.back = mesh(new THREE.BufferGeometry(), this.backMat, this.body);
    this.dispMat = opts.dispMat || displayMaterial(screen.tex);
    this.disp = mesh(strip(2), this.dispMat, this.body, 1);
    this.refl = mesh(strip(2), M.reflect, this.body, 2);
    // iPhone 16 camera: a raised glass capsule, top left of the back, two lenses one above the other, the flash beside
    this.cam = new THREE.Group(); this.body.add(this.cam);
    const CW = 15.6, CH = 31.2, cpts = outline(CW, CH, [CW / 2, CW / 2, CW / 2, CW / 2], { n: 2 });
    mesh(sweep(cpts, bandProfile(1.25, { rf: 0.75, rb: 0.01, lipF: 0.3, lipB: 0.01 })), this.backMat, this.cam);
    mesh(cap(cpts, 0.3, 1.22, 1), M.glass, this.cam);
    for (const y of [7.6, -7.6]) {
      const ring = mesh(new THREE.CylinderGeometry(6.1, 6.1, 0.9, 64), M.lensRing, this.cam);
      ring.rotation.x = Math.PI / 2; ring.position.set(0, y, 1.22 + 0.45);
      const gl = mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.2, 64), M.lens, this.cam);
      gl.rotation.x = Math.PI / 2; gl.position.set(0, y, 1.22 + 0.92);
    }
    const flash = mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.35, metalness: 0 }), this.cam);
    flash.rotation.x = Math.PI / 2; flash.position.set(CW / 2 + 4.2, 0, 0.15);
    this.cam.rotation.y = Math.PI;                        // on the back (−z); seen from behind it sits top left
    this.key = '';
  }
  // p: { w, h, t, r: [tl, tr, br, bl], disp: { w, h, r: [tl, tr, br, bl], cx, cy }, cut: [cx, cy, hw, hh, r], cutOn,
  //      frame: 0 titanium → 1 aluminium, cam: the iPhone's camera, feat, bands }
  update(p) {
    const k = [p.w, p.h, p.t, p.n ?? 2.8, ...p.r, p.disp.w, p.disp.h, p.disp.cx, p.disp.cy].map(v => v.toFixed(3)).join();
    if (k !== this.key) {
      this.key = k;
      const pts = this.pts = outline(p.w, p.h, p.r, { n: p.n ?? 2.8 });
      const prof = bandProfile(p.t, p.prof || { rf: 1.05, rb: 1.05, lipF: 0.62, lipB: 0.62, bulge: 0.18 });
      sweep(pts, prof, this.frame.geometry);
      cap(pts, 0.6, p.t - 0.04, 1, this.front.geometry, p.w, p.h);
      cap(pts, 0.6, 0.04, -1, this.back.geometry, p.w, p.h);
      const d = p.disp, z = p.t - 0.02;
      flatStrip(d.cx - d.w / 2, d.cx + d.w / 2, d.cy - d.h / 2, d.cy + d.h / 2, z, this.disp.geometry);
      cap(outline(d.w, d.h, Array.isArray(d.r) ? d.r : [d.r, d.r, d.r, d.r], { n: 2, seg: 16 }), 0, z + 0.03, 1, this.refl.geometry);
      this.refl.position.set(d.cx, d.cy, 0);
      this.dispMat.uniforms.size.value.set(d.w, d.h);
      setRadii(this.dispMat, d.r);
      this.cam.position.set(p.w / 2 - 12.0, p.h / 2 - 20.2, 0);
    }
    this.cam.visible = p.cam > 0.5;
    if (p.bands) this.bands.update(this.pts, p.bands, p.w, p.h);
    if (p.feat) this.details.update(p.feat, { w: p.w, h: p.h, bulge: 0.18 });
    const u = this.dispMat.uniforms;
    u.cut.value.set(p.cut[0], p.cut[1], p.cut[2], p.cut[3]); u.cutR.value = p.cut[4]; u.cutOn.value = p.cutOn;
    u.bright.value = p.bright ?? 1;
    // the band: polished titanium → satin aluminium
    const f = clamp(p.frame);
    this.frameMat.color.copy(this.M.titanium.color).lerp(this.M.aluminum.color, f);
    this.frameMat.roughness = lerp(this.M.titanium.roughness, this.M.aluminum.roughness, f);
  }
}
export function setRadii(mat, r) {
  const v = Array.isArray(r) ? r : [r, r, r, r];
  mat.uniforms.radii.value.set(v[0], v[1], v[2], v[3]);
}

// iPhone 16 parameters for the slab (display centred, island at the top)
export function iphoneParams() {
  const S = SPEC.iphone;
  return {
    w: S.w, h: S.h, t: S.t, r: [S.r, S.r, S.r, S.r], n: 2.8,
    disp: { w: S.disp.w, h: S.disp.h, r: [S.disp.r, S.disp.r, S.disp.r, S.disp.r], cx: 0, cy: 0 },
    cut: [0, S.disp.h / 2 - S.island.top - S.island.h / 2, S.island.w / 2, S.island.h / 2, S.island.h / 2], cutOn: 1,
    frame: 1, cam: 1, feat: IPHONE_FEATURES, bands: IPHONE_BANDS,
  };
}
// the closed Duo as one slab, seen from its outer display (the hinge on the left, as in Apple's photos). The slab sits
// in the Duo's frame at (T + g/2, 0, centre) turned −90° about y, so its front is the outer display on the left half.
export function duoClosedParams() {
  const S = SPEC.duo, g = S.gap, T = S.half.t, R = T + g / 2;
  const w = S.half.w + R, cx = w / 2 - S.half.w / 2;
  return {
    w, h: S.half.h, t: 2 * T + g, r: [1.2, S.r, S.r, 1.2], n: S.n,
    disp: { w: S.outer.w, h: S.outer.h, r: S.outer.r.slice(), cx, cy: 0 },
    cut: outerHole(), cutOn: 1,                                               // the outer display's camera hole
    frame: 0, cam: 0, feat: DUO_FEATURES, bands: DUO_BANDS,
  };
}
export function slabMount() {                                               // where the slab sits in the Duo's frame
  const S = SPEC.duo, g = S.gap, T = S.half.t, R = T + g / 2;
  return { x: R, z: (g / 2 - R + g / 2 + S.half.w) / 2, rotY: -Math.PI / 2 };
}
export function mixParams(a, b, k) {
  const m = (x, y) => Array.isArray(x) ? x.map((v, i) => m(v, y[i])) : (typeof x === 'object' ? Object.fromEntries(Object.keys(x).map(q => [q, m(x[q], y[q])])) : lerp(x, y, k));
  const { feat: fa, bands: ba, ...A } = a, { feat: fb, bands: bb, ...Bp } = b;
  const o = m(A, Bp);
  o.cam = k < 0.5 ? a.cam : b.cam;
  o.feat = mixFeatures(fa, fb, clamp(k));
  const kv = clamp((k - 0.25) / 0.5);
  o.bands = ba.map((x, i) => [x[0], lerp(x[1], bb[i][1], clamp(k)), lerp(x[2], bb[i][2], x[2] === bb[i][2] ? 0 : kv)]);
  return o;
}

// ─────────────────────────────── iPhone Duo: two halves on a hinge, one folding display ───────────────────────
// Open frame: halves side by side, x ∈ [−82.3, 82.3], inner display on z = 0 facing +z. Each half turns about the
// hinge axis (y) at z = +gap/2; closed, the screens face each other gap apart and the spine rounds the hinge side.
export class Duo {
  constructor(M, inner, outer) {
    this.M = M;
    const S = SPEC.duo, H = S.half, T = H.t, g = S.gap;
    this.group = new THREE.Group();
    this.halves = [-1, 1].map(side => {
      const pivot = new THREE.Group(); pivot.position.set(0, 0, g / 2); this.group.add(pivot);
      const body = new THREE.Group(); body.position.set(side * H.w / 2, 0, -g / 2 - T); pivot.add(body);
      // outer corners rounded, the hinge-side corners square
      const r = side < 0 ? [S.r, 0, 0, S.r] : [0, S.r, S.r, 0];
      const pts = outline(H.w, H.h, r, { n: S.n });
      const prof = bandProfile(T, { rf: 0.95, rb: 0.95, lipF: 0.5, lipB: 0.5, bulge: 0.12 });
      const frameMat = M.titanium.clone();
      const bands = new BandMaps(); bands.apply(frameMat);
      const ox = side * (H.w / 2 - 15), oe = side < 0 ? 'L' : 'R';
      bands.update(pts, [[oe, 44.9, 1], [oe, -44.9, 1], ['T', ox, 1], ['B', ox, 1]], H.w, H.h);
      mesh(sweep(pts, prof), frameMat, body);
      // keys, the port, grilles: laid out on the closed Duo (one slab) and carried into this half's frame — the left
      // half is the slab's front (turned about y), the right half its back
      M.detail = M.detail || detailMaterials(M);
      const det = new Details(M.detail, frameMat);
      const Sd = duoClosedParams();
      det.update(DUO_FEATURES, { w: Sd.w, h: Sd.h, bulge: 0.12 }, f => side < 0 ? f.z > Sd.t / 2 : f.z < Sd.t / 2);
      det.group.matrixAutoUpdate = false;
      if (side < 0) det.group.matrix.makeRotationY(Math.PI).setPosition(Sd.w / 2 - H.w / 2, 0, Sd.t);
      else det.group.matrix.makeTranslation(-(Sd.w / 2 - H.w / 2), 0, 0);
      body.add(det.group);
      mesh(cap(pts, 0.5, T - 0.03, 1), M.glass, body);
      mesh(cap(pts, 0.5, 0.03, -1), side < 0 ? M.glass : M.back, body);
      return { side, pivot, body, pts };
    });
    // the outer display, on the back of the left half (facing −z in the half's frame); closed and seen from it, the
    // hinge is on its left and the camera hole in its top right corner
    const O = S.outer;
    this.outerMat = displayMaterial(outer.tex);
    this.outerMat.uniforms.size.value.set(O.w, O.h); setRadii(this.outerMat, O.r);
    this.outerMat.side = THREE.DoubleSide;
    const Lh = this.halves[0];
    this.outer = mesh(flatStrip(-O.w / 2, O.w / 2, -O.h / 2, O.h / 2, 0.01), this.outerMat, Lh.body, 1);
    this.outer.rotation.y = Math.PI;
    this.outerRefl = mesh(cap(outline(O.w, O.h, O.r, { n: 2, seg: 16 }), 0, 0.04, 1), M.reflect, Lh.body, 2);
    this.outerRefl.rotation.y = Math.PI;
    const hole = outerHole();
    this.outerMat.uniforms.cut.value.set(hole[0], hole[1], hole[2], hole[3]);
    this.outerMat.uniforms.cutR.value = hole[4]; this.outerMat.uniforms.cutOn.value = 1;
    // cameras on the back of the right half: a pill with two lenses across the top, nearer the hinge (Apple's photos)
    const Rh = this.halves[1];
    this.plat = new THREE.Group(); Rh.body.add(this.plat);
    const pw = 50, ph = 21.5;
    const ppts = outline(pw, ph, [ph / 2, ph / 2, ph / 2, ph / 2], { n: 2 });
    mesh(sweep(ppts, bandProfile(1.5, { rf: 0.7, rb: 0.01, lipF: 0.35, lipB: 0.01 })), M.back, this.plat);
    mesh(cap(ppts, 0.35, 1.47, 1), M.back, this.plat);
    for (const x of [-11.5, 11.5]) {
      const ring = mesh(new THREE.CylinderGeometry(7.4, 7.4, 1.4, 64), M.lensRing, this.plat);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, 0, 1.47 + 0.7);
      const gl = mesh(new THREE.CylinderGeometry(5.7, 5.7, 0.3, 64), M.lens, this.plat);
      gl.rotation.x = Math.PI / 2; gl.position.set(x, 0, 1.47 + 1.42);
    }
    this.plat.rotation.y = Math.PI;
    this.plat.position.set(-H.w / 2 + 37.5, H.h / 2 - ph / 2 - 4.8, 0);           // the right half's hinge is at −x
    // spine (hinge cover), rebuilt per angle
    this.spine = mesh(new THREE.BufferGeometry(), M.hinge, this.group);
    // open, the display's black border runs across the hinge above and below the panel, so the gap between the
    // halves' glass doesn't show its bright lips there (Apple's open Duo has a seamless bezel); hidden once it folds
    this.seams = [1, -1].map(sy => {
      const m = mesh(flatStrip(-1.6, 1.6, S.inner.h / 2 - 0.2, H.h / 2 - 0.45, -0.005), M.glass, this.group);
      m.scale.y = sy; return m;
    });
    // the inner display: one strip across both halves, bending through the hinge
    const I = S.inner;
    this.cols = 160;
    this.innerMat = displayMaterial(inner.tex);
    this.innerMat.uniforms.size.value.set(I.w, I.h); setRadii(this.innerMat, I.r);
    this.innerMat.side = THREE.DoubleSide;
    this.inner = mesh(strip(this.cols), this.innerMat, this.group, 1);
    this.innerRefl = mesh(strip(this.cols), M.reflectMatte, this.group, 2);
    this.theta = -1;
    this.setFold(0);
  }
  // theta: 0 open … π closed
  setFold(theta) {
    if (Math.abs(theta - this.theta) < 1e-6) return;
    this.theta = theta;
    const S = SPEC.duo, H = S.half, T = H.t, g = S.gap, I = S.inner;
    this.halves[0].pivot.rotation.y = theta / 2;
    this.halves[1].pivot.rotation.y = -theta / 2;
    // spine: the exposed wedge between the halves' back hinge corners, radius T + g/2 about the axis
    const Rs = T + g / 2, a0 = -Math.PI / 2 - theta / 2 * 0, span = theta;
    sector(Rs - 0.02, H.h - 0.9, 0, g / 2, -Math.PI / 2 - span / 2, -Math.PI / 2 + span / 2, this.spine.geometry);
    this.spine.visible = theta > 0.01;
    for (const m of this.seams) m.visible = theta < 0.02;
    // display columns: rigid on each half beyond the bend zone, a cubic between them
    const bz = 7.5, n = this.cols;
    const P = (x) => {                                   // a point of the open display (x on the sheet, z = 0) → folded
      const side = x < 0 ? -1 : 1, phi = side < 0 ? theta / 2 : -theta / 2;
      const rx = x, rz = -g / 2, c = Math.cos(phi), s = Math.sin(phi);
      return [rx * c + rz * s, -rx * s + rz * c + g / 2];
    };
    const Dir = (side) => { const phi = side < 0 ? theta / 2 : -theta / 2; return [Math.cos(phi), -Math.sin(phi)]; };
    const p0 = P(-bz), p3 = P(bz), d0 = Dir(-1), d3 = Dir(1);
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const Lc = Math.max(chord / 3, bz * 0.62 * Math.sin(theta / 2) + chord / 3);
    const p1 = [p0[0] + d0[0] * Lc, p0[1] + d0[1] * Lc], p2 = [p3[0] - d3[0] * Lc, p3[1] - d3[1] * Lc];
    const bez = (u) => {
      const v = 1 - u;
      return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
              v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]];
    };
    for (const [m, off] of [[this.inner, 0], [this.innerRefl, 0.04]]) {
      const pos = m.geometry.attributes.position.array, nor = m.geometry.attributes.normal.array;
      for (let i = 0; i < n; i++) {
        const x = -I.w / 2 + I.w * i / (n - 1);
        let q, dir;
        if (x <= -bz || x >= bz) { q = P(x); dir = Dir(x < 0 ? -1 : 1); }
        else {
          const u = (x + bz) / (2 * bz); q = bez(u);
          const e = 1e-3, qa = bez(Math.max(0, u - e)), qb = bez(Math.min(1, u + e));
          const dl = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]) || 1; dir = [(qb[0] - qa[0]) / dl, (qb[1] - qa[1]) / dl];
        }
        const nx = -dir[1], nz = dir[0];                  // the sheet's normal (its front)
        // the sheen's columns stop at the display's rounded corners (the panel itself is cut in its shader)
        const ex = Math.abs(x) - (I.w / 2 - I.r), yh = off && ex > 0 ? I.h / 2 - I.r + Math.sqrt(Math.max(0, I.r * I.r - ex * ex)) : I.h / 2;
        for (let j = 0; j < 2; j++) {
          const k = (i * 2 + j) * 3, y = j ? yh : -yh;
          pos[k] = q[0] + nx * off; pos[k + 1] = y; pos[k + 2] = q[1] + nz * off + 0.02;
          nor[k] = nx; nor[k + 1] = 0; nor[k + 2] = nz;
        }
      }
      m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.normal.needsUpdate = true;
      m.geometry.computeBoundingSphere();
    }
  }
}

// ─────────────────────────────── MacBook Pro 16 ───────────────────────────────────────────────────────────────
export async function loadMacbook(b64, M, screenMat) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((res, rej) => loader.parse(bin.buffer, '', res, rej));
  const root = gltf.scene;
  root.scale.setScalar(10);                                 // the model is in centimetres
  let screenMesh = null;
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'Screen' || o.parent?.name === 'Screen') screenMesh = o;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.isMeshStandardMaterial) continue;
      m.envMap = M.env; m.envMapIntensity = 1.5;
      // the model ships in Space Black; Silver keeps it one family with the Duo and the iPhone on a black stage
      const c = m.color;
      if (c.r > 0.035 && c.r < 0.07 && Math.abs(c.r - c.b) < 0.02) { c.setRGB(0.62, 0.625, 0.64); m.metalness = 1; m.roughness = 0.34; }
      else if (c.r > 0.12 && c.r < 0.2 && !m.map) { c.setRGB(0.55, 0.555, 0.57); m.metalness = 1; }
      m.needsUpdate = true;
    }
  });
  if (screenMesh) screenMesh.material = screenMat;
  // screen-space mapping: uv → world. The panel is a flat quad but it is baked tilted with the lid, so fit the plane
  // itself: position = O + U·u + V·v (least squares over the vertices), in the mesh's local space.
  const uvA = screenMesh.geometry.attributes.uv, pA = screenMesh.geometry.attributes.position, n = pA.count;
  let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const row = [1, uvA.getX(i), uvA.getY(i)], p = [pA.getX(i), pA.getY(i), pA.getZ(i)];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { S[r][c] += row[r] * row[c]; R[r][c] += row[r] * p[c]; }
  }
  const inv = new THREE.Matrix3().set(...S.flat()).invert().elements;          // column-major
  const I = (r, c) => inv[c * 3 + r];
  const coef = [0, 1, 2].map(r => [0, 1, 2].map(c => I(r, 0) * R[0][c] + I(r, 1) * R[1][c] + I(r, 2) * R[2][c]));
  const O = new THREE.Vector3(...coef[0]), U = new THREE.Vector3(...coef[1]), V = new THREE.Vector3(...coef[2]);
  const at = (u, v, out = new THREE.Vector3()) => {       // u, v: canvas-style (0,0 top-left) → world point
    out.copy(O).addScaledVector(U, u).addScaledVector(V, 1 - v);
    root.updateMatrixWorld(true);
    return screenMesh.localToWorld(out);
  };
  const normal = () => {
    root.updateMatrixWorld(true);
    return U.clone().cross(V).normalize().transformDirection(screenMesh.matrixWorld).normalize();
  };
  return { group: root, screenMesh, at, normal, lid: root.getObjectByName('LidPivot'), fit: { O, U, V } };
}
