// Parametric device geometry, in millimetres. Local axes: x right, y up, z out of the front face.
// A body is an outline (rounded rectangle with continuous, superellipse corners) swept by a cross-section profile,
// plus flat caps front and back. Everything is cheap enough to rebuild every frame while a shape morphs.
import * as THREE from 'three';

const EPS = 1e-4;

// Closed CCW outline from the middle of the right edge. rad = [tl, tr, br, bl]; a zero radius is a hard corner
// (the point is emitted twice, once per edge normal, so the sweep keeps a crisp edge there).
export function outline(w, h, rad, { n = 2.8, seg = 28 } = {}) {
  const hw = w / 2, hh = h / 2;
  const [tl, tr, br, bl] = rad.map(r => Math.min(r, hw, hh));
  const corners = [
    { cx: hw - tr, cy: hh - tr, r: tr, a0: 0, nin: [1, 0], nout: [0, 1] },
    { cx: -hw + tl, cy: hh - tl, r: tl, a0: 90, nin: [0, 1], nout: [-1, 0] },
    { cx: -hw + bl, cy: -hh + bl, r: bl, a0: 180, nin: [-1, 0], nout: [0, -1] },
    { cx: hw - br, cy: -hh + br, r: br, a0: 270, nin: [0, -1], nout: [1, 0] },
  ];
  const pts = [];
  pts.push({ x: hw, y: 0, nx: 1, ny: 0 });
  for (const c of corners) {
    if (c.r < EPS) {
      pts.push({ x: c.cx, y: c.cy, nx: c.nin[0], ny: c.nin[1] });
      pts.push({ x: c.cx, y: c.cy, nx: c.nout[0], ny: c.nout[1] });
    } else {
      for (let i = 0; i <= seg; i++) {
        const a = (c.a0 + 90 * i / seg) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        const ex = Math.sign(ca) * Math.abs(ca) ** (2 / n), ey = Math.sign(sa) * Math.abs(sa) ** (2 / n);
        let gx = Math.sign(ex) * Math.abs(ex) ** (n - 1), gy = Math.sign(ey) * Math.abs(ey) ** (n - 1);
        const gl = Math.hypot(gx, gy) || 1;
        pts.push({ x: c.cx + c.r * ex, y: c.cy + c.r * ey, nx: gx / gl, ny: gy / gl });
      }
    }
    if (c.a0 === 90) pts.push({ x: -hw, y: 0, nx: -1, ny: 0 });     // mid-left, so long edges get a middle vertex
    if (c.a0 === 0) pts.push({ x: 0, y: hh, nx: 0, ny: 1 });
    if (c.a0 === 180) pts.push({ x: 0, y: -hh, nx: 0, ny: -1 });
  }
  // arc length (u) for antenna bands and anything else that runs around the frame
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    pts[i].s = s;
  }
  pts.total = s + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return pts;
}

// Sweep: profile = [{ d, z, nd, nz, v }] (d = inset from the outline, nd/nz = the profile normal: outward and +z).
// Returns a BufferGeometry with position, normal, uv (u = arc length / total, v = profile param).
export function sweep(pts, profile, into) {
  const nP = pts.length + 1, nQ = profile.length;       // repeat the first outline point to close the loop
  const pos = new Float32Array(nP * nQ * 3), nor = new Float32Array(nP * nQ * 3), uv = new Float32Array(nP * nQ * 2);
  for (let i = 0; i < nP; i++) {
    const p = pts[i % pts.length], u = i === pts.length ? 1 : p.s / pts.total;
    for (let j = 0; j < nQ; j++) {
      const q = profile[j], k = i * nQ + j;
      pos[k * 3] = p.x - p.nx * q.d; pos[k * 3 + 1] = p.y - p.ny * q.d; pos[k * 3 + 2] = q.z;
      let nx = p.nx * q.nd, ny = p.ny * q.nd, nz = q.nz; const l = Math.hypot(nx, ny, nz) || 1;
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      uv[k * 2] = u; uv[k * 2 + 1] = q.v ?? j / (nQ - 1);
    }
  }
  const idx = [];
  for (let i = 0; i < nP - 1; i++) for (let j = 0; j < nQ - 1; j++) {
    const a = i * nQ + j, b = (i + 1) * nQ + j;
    if (profile[j].break) continue;                       // a hard crease: the next profile point starts fresh
    idx.push(a, a + 1, b, b, a + 1, b + 1);               // outward-facing for a CCW outline and a front → back profile
  }
  return fill(into, pos, nor, uv, idx);
}

// Flat cap: the outline inset by d, at height z, facing +z (dir = 1) or −z (dir = −1). A fan from the centre.
export function cap(pts, d, z, dir, into, w = 1, h = 1) {
  const n = pts.length;
  const pos = new Float32Array((n + 1) * 3), nor = new Float32Array((n + 1) * 3), uv = new Float32Array((n + 1) * 2);
  pos[0] = 0; pos[1] = 0; pos[2] = z; nor[2] = dir; uv[0] = 0.5; uv[1] = 0.5;
  for (let i = 0; i < n; i++) {
    const p = pts[i], k = i + 1, x = p.x - p.nx * d, y = p.y - p.ny * d;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; nor[k * 3 + 2] = dir;
    uv[k * 2] = x / w + 0.5; uv[k * 2 + 1] = y / h + 0.5;
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i + 1, b = (i + 1) % n + 1;
    if (dir > 0) idx.push(0, a, b); else idx.push(0, b, a);
  }
  return fill(into, pos, nor, uv, idx);
}

// A grid strip (cols × 2) for displays: positions are written by the caller (bending); uv spans 0..1.
export function strip(cols, into) {
  const pos = new Float32Array(cols * 2 * 3), nor = new Float32Array(cols * 2 * 3), uv = new Float32Array(cols * 2 * 2);
  for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
    const k = i * 2 + j; uv[k * 2] = i / (cols - 1); uv[k * 2 + 1] = j; nor[k * 3 + 2] = 1;
  }
  const idx = [];
  for (let i = 0; i < cols - 1; i++) { const a = i * 2, b = (i + 1) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return fill(into, pos, nor, uv, idx);
}
// flat rectangle strip [x0, x1] × [y0, y1] at z
export function flatStrip(x0, x1, y0, y1, z, into) {
  const g = strip(2, into), p = g.attributes.position.array;
  p.set([x0, y0, z, x0, y1, z, x1, y0, z, x1, y1, z]);
  g.attributes.position.needsUpdate = true;
  g.computeBoundingSphere();                              // strip() measured the zeros; without this it gets culled
  return g;
}

// Cylinder sector along y (length L, centred), radius r around (cx, cz), angles a0 → a1 (radians, in the xz-plane
// measured from +x toward +z), with pie end caps. Used for the Duo's hinge spine.
export function sector(r, L, cx, cz, a0, a1, into, seg = 48) {
  const n = Math.max(2, Math.ceil(seg * Math.abs(a1 - a0) / Math.PI) + 1);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * i / (n - 1), c = Math.cos(a), s = Math.sin(a);
    for (const y of [-L / 2, L / 2]) { pos.push(cx + r * c, y, cz + r * s); nor.push(c, 0, s); uv.push(i / (n - 1), y > 0 ? 1 : 0); }
  }
  const flip = a1 < a0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 2;
    if (!flip) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  for (const [y, ny] of [[L / 2, 1], [-L / 2, -1]]) {         // end caps
    const base = pos.length / 3;
    pos.push(cx, y, cz); nor.push(0, ny, 0); uv.push(0.5, 0.5);
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * i / (n - 1);
      pos.push(cx + r * Math.cos(a), y, cz + r * Math.sin(a)); nor.push(0, ny, 0); uv.push(0, 0);
    }
    for (let i = 0; i < n - 1; i++) {
      const fwd = (ny > 0) !== flip;
      if (fwd) idx.push(base, base + 2 + i, base + 1 + i); else idx.push(base, base + 1 + i, base + 2 + i);
    }
  }
  return fill(into, new Float32Array(pos), new Float32Array(nor), new Float32Array(uv), idx);
}

function fill(into, pos, nor, uv, idx) {
  const g = into || new THREE.BufferGeometry();
  const set = (name, arr, size) => {
    const a = g.getAttribute(name);
    if (a && a.array.length === arr.length) { a.array.set(arr); a.needsUpdate = true; }
    else g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  set('position', pos, 3); set('normal', nor, 3); set('uv', uv, 2);
  const ia = g.getIndex();
  if (ia && ia.array.length === idx.length) { ia.array.set(idx); ia.needsUpdate = true; }
  else g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Cross-section profiles (d inset, z height). A band with rounded edges between a front lip and a back lip.
//   T thickness, rf / rb edge radii front/back, lipF / lipB how far the glass sits inside the band.
export function bandProfile(T, { rf = 1.0, rb = 1.0, lipF = 0.55, lipB = 0.55, zf = 0.05, zb = 0.05, seg = 7, bulge = 0 } = {}) {
  const P = [];
  // front lip: flat ring from the glass edge outward, facing +z
  P.push({ d: lipF + 0.02, z: T - zf, nd: 0, nz: 1 });
  // front rounded edge: quarter circle from (d = rf, z = T) to (d = 0, z = T − rf)
  for (let i = 0; i <= seg; i++) {
    const a = (Math.PI / 2) * i / seg;                        // 0 → facing +z, π/2 → facing outward
    P.push({ d: rf - rf * Math.sin(a), z: T - rf + rf * Math.cos(a) - zf * (1 - i / seg), nd: Math.sin(a), nz: Math.cos(a) });
  }
  // the side: a straight band, or a slight barrel (bulge > 0) for a softer highlight
  const mid = 6;
  for (let i = 1; i < mid; i++) {
    const k = i / mid, z = lerp(T - rf, rb, k), b = bulge * Math.sin(Math.PI * k);
    const slope = bulge * Math.PI * Math.cos(Math.PI * k) / (T - rf - rb || 1);
    P.push({ d: -b, z, nd: 1, nz: slope });
  }
  for (let i = 0; i <= seg; i++) {
    const a = (Math.PI / 2) * (1 - i / seg);
    P.push({ d: rb - rb * Math.sin(a), z: rb - rb * Math.cos(a) + zb * (i / seg), nd: Math.sin(a), nz: -Math.cos(a) });
  }
  P.push({ d: lipB + 0.02, z: zb, nd: 0, nz: -1 });
  let L = 0;                                                   // v = normalised profile length
  for (let i = 0; i < P.length; i++) { if (i) L += Math.hypot(P[i].d - P[i - 1].d, P[i].z - P[i - 1].z); P[i].v = L; }
  for (const p of P) p.v /= L;
  return P;
}
const lerp = (a, b, k) => a + (b - a) * k;
