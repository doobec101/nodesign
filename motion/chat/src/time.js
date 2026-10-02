// Time is the only input. Every moving value is a closed-form sum of spring step responses keyed on the beat grid,
// so any frame can be rendered on its own, in any order (the renderer seeks subframes for motion blur).
const DATA = JSON.parse(document.getElementById('beats').textContent);

export const BEAT = DATA.period;               // 0.50007 s: Mixkit #190 "Electro Dreams" at 119.983 BPM
export const BAR = 4 * BEAT;
export const LENGTH = DATA.length;             // 24 bars
export const AUDIO_START = DATA.start;         // where the video's t = 0 sits in the track
export const B = n => n * BEAT;                // beats (0-based, fractional) → seconds
export const BARAT = (bar, beat = 1) => B((bar - 1) * 4 + (beat - 1));   // bar 1..24, beat 1..4(.x)
export const SIX = DATA.sixteenths;            // [kick, clap, hat] per 16th

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = k => (k = clamp(k), k * k * (3 - 2 * k));
export const smoother = k => (k = clamp(k), k * k * k * (k * (k * 6 - 15) + 10));
export const ease = (t, t0, t1, f = smoother) => f((t - t0) / (t1 - t0));

// a spring: response (s, the period of the undamped oscillation) and damping ratio; ζ ≥ .8 keeps overshoot small
export function spring(response, damping = 1) {
  const w0 = 2 * Math.PI / response;
  return { w0, z: damping, wd: damping < 1 ? w0 * Math.sqrt(1 - damping * damping) : 0 };
}
// unit step response, closed form. A key may bring its own shape instead of a spring: { fn: tau → 0…1 } (the fold
// camera follows the fold curve itself)
export function step(tau, s) {
  if (tau <= 0) return 0;
  if (s.fn) return s.fn(tau);
  const x = s.w0 * tau;
  if (x > 60) return 1;
  if (s.z >= 1) return 1 - Math.exp(-x) * (1 + x);
  const e = Math.exp(-s.z * x);
  return 1 - e * (Math.cos(s.wd * tau) + (s.z * s.w0 / s.wd) * Math.sin(s.wd * tau));
}
// time derivative of the unit step response (for velocity-aware effects)
export function stepVel(tau, s) {
  if (tau <= 0) return 0;
  if (s.fn) return (s.fn(tau + 5e-4) - s.fn(Math.max(0, tau - 5e-4))) / 1e-3;
  const x = s.w0 * tau;
  if (x > 60) return 0;
  if (s.z >= 1) return s.w0 * s.w0 * tau * Math.exp(-x);
  return Math.exp(-s.z * x) * (s.w0 * s.w0 / s.wd) * Math.sin(s.wd * tau);
}

export const SP = {
  snap: spring(0.001, 1), tap: spring(0.12, 1), fast: spring(0.22, 1), ui: spring(0.38, 0.9), push: spring(0.5, 1),
  in: spring(0.3, 1), out: spring(0.16, 1), soft: spring(0.6, 1), cam: spring(1.1, 1), camSlow: spring(1.8, 1),
  dev: spring(0.9, 0.95), fold: spring(1.4, 0.98), morph: spring(0.62, 0.86), key: spring(0.1, 1), pop: spring(0.26, 0.78),
  hlIn: spring(0.42, 1), hlRise: spring(0.55, 0.9), hlOut: spring(0.06, 1), bubble: spring(0.42, 0.82), scroll: spring(0.5, 0.95),
};

// A value that changes target many times: v0 + Σ Δk · S(t − tk). Numbers or arrays.
export class Track {
  constructor(v0) { this.v0 = v0; this.keys = []; this.d = []; this.dirty = false; }
  to(t, v, s = SP.ui) { this.keys.push({ t, v, s }); this.dirty = true; return this; }
  set(t, v) { return this.to(t, v, SP.snap); }
  prep() {
    this.keys.sort((a, b) => a.t - b.t);
    let prev = this.v0; const vec = Array.isArray(prev);
    this.d = this.keys.map(k => { const d = vec ? k.v.map((x, i) => x - prev[i]) : k.v - prev; prev = k.v; return { t: k.t, d, s: k.s }; });
    this.dirty = false;
  }
  at(t) {
    if (this.dirty) this.prep();
    if (Array.isArray(this.v0)) {
      const v = this.v0.slice();
      for (const k of this.d) { const s = step(t - k.t, k.s); if (s) for (let i = 0; i < v.length; i++) v[i] += k.d[i] * s; }
      return v;
    }
    let v = this.v0;
    for (const k of this.d) v += k.d * step(t - k.t, k.s);
    return v;
  }
  vel(t) {
    if (this.dirty) this.prep();
    let v = 0;
    for (const k of this.d) v += (Array.isArray(k.d) ? Math.hypot(...k.d) : k.d) * stepVel(t - k.t, k.s);
    return v;
  }
}
export const track = v0 => new Track(v0);

// sound cues the page announces; the mixer places each sound's measured peak on its time
export const CUES = [];
export const cue = (t, kind, extra) => CUES.push(Object.assign({ t: +t.toFixed(4), kind }, extra || {}));
