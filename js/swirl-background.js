// SwirlBackground — a grainy, blurred monochrome shape that breathes with noise and ripples under the cursor
// (the henriheymans.com intro look). three.js, ES module. Not loaded by nodesign.html at the moment — kept for later.
//
//   import { SwirlBackground } from './js/swirl-background.js';
//   new SwirlBackground(el, { image: 'images/AD.png', scale: 0.85, blur: 0.02 });   // a picture as the shape
//   new SwirlBackground(el);                                                         // or the procedural ribbon loop
//
// `el` gets an absolutely positioned canvas covering it (give `el` position: relative/fixed).
// Tokens read from `el`: --fx-bg (ground), --fx-swirl (the light), --fx-swirl-intensity (0..1), --fx-grain (0..1),
// and the dot grid --fx-dot / --fx-dot-size / --fx-dot-gap (leave --fx-dot-size at 0 for no dots).
//
// Opened straight from disk (file://) the page can neither import this module nor hand a file:// picture to WebGL:
// inline the module into the page and pass the picture as a data: URL (a 1200 px luminance PNG is ~55 KB).
//
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';


const NOISE = /* glsl */`
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {                       // 2D simplex noise (Ashima), −1..1
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {                       // 3D simplex noise (Ashima), −1..1 — the third axis is time
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x), p1 = vec3(a0.zw, h.y), p2 = vec3(a1.xy, h.z), p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }`;

/* pass 1 — the ribbon loop, as luminance in .r */
const SHAPE_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime, uAspect, uScale;
  varying vec2 vUv;
  ${NOISE}
  float gauss(float d, float w) { return exp(-(d * d) / (w * w)); }
  void main() {
    // centred coords, short axis −1..1, blob size via uScale
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0 / uScale;
    float t = uTime;

    // slow domain warp: makes the loop organic and lets it breathe
    vec2 warp = vec2(snoise(p * 0.55 + vec2(t * 0.35, 0.0)), snoise(p * 0.55 + vec2(0.0, -t * 0.3) + 7.3));
    vec2 q = p + 0.12 * warp;
    q.x -= 0.03;

    // the loop is an ellipse, tilted a little
    float c = cos(0.35), s = sin(0.35);
    vec2 qe = mat2(c, -s, s, c) * q;
    qe.x *= 0.92;
    float r = length(qe);
    float ang = atan(qe.y, qe.x) + t * 0.12;      // the ribbon slowly turns

    // the band: thick and bright on the right, thin and dim on the top-left (the ribbon "goes behind")
    float side = 0.5 + 0.5 * cos(ang - 0.2);
    float width = 0.04 + 0.14 * pow(side, 1.2);
    float d = r - (0.66 + 0.035 * cos(3.0 * ang + 1.0));                        // not a perfect ellipse
    float band = d < 0.0 ? gauss(d, width * 0.85) : gauss(d, width * 1.5);   // crisper inside, softer outside
    float light = 0.12 + 1.1 * pow(side, 0.9)
                + 0.6 * pow(0.5 + 0.5 * cos(ang - 2.55), 3.0);                  // a second lobe bottom-left
    float lum = band * light;

    // inside the loop: a bright crescent (the ribbon's inner twist) around a dark eye
    float inner = smoothstep(0.70, 0.40, r);
    vec2 qi = qe - vec2(0.08, 0.0);
    float eye = 1.0 - smoothstep(0.24, 0.36, length(qi * vec2(1.3, 0.9)));
    float crescent = inner * pow(0.5 + 0.5 * cos(ang - 3.0), 2.2) * (1.0 - eye);
    lum += 1.0 * crescent;

    // faint halo so the loop sits in the dark instead of being cut out of it
    lum += 0.05 * exp(-r * r * 1.4) * (1.0 - eye * 0.6);

    gl_FragColor = vec4(clamp(lum, 0.0, 1.0), 0.0, 0.0, 1.0);
  }`;

/* pass 3 — wobble + ripple displacement, grain, colour */
const DISPLAY_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tShape, tRipple;
  uniform vec3 uBg, uInk, uDot;
  uniform float uIntensity, uGrain, uGrainSize, uWobble, uWobbleScale, uWobbleTime, uRipple, uAspect;
  uniform float uDotPitch, uDotRadius;       // the dot grid, in device px (radius 0 = no dots)
  uniform vec2 uResolution, uDotOffset;
  varying vec2 vUv;
  ${NOISE}
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    // the reference jitters its plane's vertices with 3D perlin noise running on the clock (≈1 unit/s):
    // a slow jelly-like wobble that never stops — here the same thing as a uv displacement
    vec2 sp = vUv * vec2(uAspect, 1.0) * uWobbleScale;
    vec2 wob = vec2(snoise(vec3(sp, uWobbleTime)), snoise(vec3(sp + 17.3, uWobbleTime + 5.1))) * uWobble;
    // ripple: theta = r · 1.3 · π · 0.4, uv += (sin θ, cos θ) · r · 0.07  — verbatim from the reference shader
    float rip = texture2D(tRipple, vUv).r;
    rip = 1.0 - 2.0 / (exp(2.0 * rip) + 1.0);          // tanh: stamps pile up, the sum saturates softly instead of clamping
    float theta = rip * 1.3 * 3.14159265 * 0.4;
    vec2 ripple = vec2(sin(theta), cos(theta)) * rip * uRipple;
    vec2 uv = vUv + wob + ripple;

    // the ground: the theme's dot grid, rippling under the cursor (but not wobbling — a rigid grid should not jiggle)
    vec3 ground = uBg;
    if (uDotRadius > 0.0) {
      vec2 q = mod((vUv + ripple) * uResolution - uDotOffset + uDotPitch * 0.5, uDotPitch) - uDotPitch * 0.5;
      ground = mix(uBg, uDot, 1.0 - smoothstep(uDotRadius - 0.7, uDotRadius + 0.7, length(q)));
    }

    float l = texture2D(tShape, uv).r * uIntensity;
    // film grain in cells of uGrainSize device px, riding on the displaced picture (as baked-in grain would), strongest in the midtones
    float g = hash(floor(uv * uResolution / uGrainSize)) - 0.5;
    l += g * uGrain * (0.25 + 1.5 * l * (1.0 - l));
    l = clamp(l, 0.0, 1.0);
    gl_FragColor = vec4(mix(ground, uInk, l), 1.0);
  }`;

/* picture mode, bake step 1 — the picture fitted to the viewport, as luminance × alpha in .r
   (so a white-on-transparent PNG and a white-on-black JPG read the same) */
const PICTURE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tImage;
  uniform float uImageAspect, uAspect, uFit, uScale;   // fit 0 = contain, 1 = cover
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    bool wide = uImageAspect >= uAspect;
    vec2 size = ((uFit < 0.5) == wide) ? vec2(uAspect, uAspect / uImageAspect) : vec2(uImageAspect, 1.0);
    vec2 iuv = p / (size * uScale) + 0.5;
    vec4 c = texture2D(tImage, iuv);
    float inside = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);
    gl_FragColor = vec4(dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a * inside, 0.0, 0.0, 1.0);
  }`;

/* picture mode, bake step 2 — one direction of a gaussian blur; uStep = texel × direction, uSigma in texels */
const BLUR_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tMap;
  uniform vec2 uStep;
  uniform float uSigma;
  varying vec2 vUv;
  void main() {
    float spacing = max(1.0, uSigma / 4.0);           // wide blurs take longer strides, the linear filter fills in
    float sum = 0.0, wsum = 0.0;
    for (int i = -12; i <= 12; i++) {
      float x = float(i) * spacing;
      float w = exp(-(x * x) / (2.0 * uSigma * uSigma));
      sum += texture2D(tMap, vUv + uStep * x).r * w; wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
  }`;

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;

/* a soft broken ring — the ripple brush (drawn once, on a 2D canvas) */
function makeBrush(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const cx = size / 2, R = size * 0.3;
  ctx.lineCap = 'round';
  // four arcs with gaps, each stroked soft and wide, then blurred — faint on purpose: stamps pile up
  // along the cursor's path and add together (the reference brush averages ~0.1 alpha)
  const arcs = [[0.1, 1.3], [1.7, 2.6], [3.0, 4.3], [4.7, 5.9]];
  ctx.filter = `blur(${size * 0.06}px)`;
  for (const [a, b] of arcs) {
    ctx.beginPath(); ctx.arc(cx, cx, R, a, b);
    ctx.lineWidth = size * 0.11; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    ctx.lineWidth = size * 0.05; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
  }
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}

export class SwirlBackground {
  constructor(el, options = {}) {
    this.el = el;
    this.o = Object.assign({
      animate: true,       // false → one static frame (reduced motion)
      image: null,         // a picture (URL or data: URL) to use as the shape instead of the procedural loop
      fit: 'contain',      // picture mode: 'contain' keeps the whole picture visible, 'cover' fills the viewport
      blur: 0.02,          // picture mode: gaussian sigma as a fraction of the viewport height (the reference is a pre-blurred picture)
      scale: 0.95,         // blob size relative to the short side of the viewport
      speed: 0.09,         // how fast the loop breathes / turns
      wobble: 0.006,       // uv jitter amplitude (the reference: 0.025 world units on a ~7-unit plane ≈ 0.4 %)
      wobbleScale: 3.5,    // noise periods per viewport height
      wobbleSpeed: 0.8,    // noise time, units per second (the reference runs its clock straight in: 1/s)
      ripple: 0.07,        // displacement per unit of ripple, same as the reference
      rippleSize: 0.58,    // stamp size in viewport units (height = 2)
      rippleFade: 0.8,     // opacity lost per second (0.013 per frame @60 in the reference)
      maxRipples: 100,
      grainSize: 2,        // device px per grain cell (whole pixels — a fractional size makes a periodic pattern)
      shapeSize: 480,      // shape resolution (short side) — small on purpose, the upscale is part of the blur
      rippleRes: 384,      // ripple buffer resolution (short side)
      dpr: 2
    }, options);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.o.dpr));
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(this.renderer.domElement);

    const quad = new THREE.PlaneGeometry(2, 2);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const rt = (opts) => new THREE.WebGLRenderTarget(1, 1, Object.assign({ format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false }, opts));
    this.shapeRT = rt({ type: THREE.HalfFloatType });
    this.blurRT = rt({ type: THREE.HalfFloatType });     // picture mode scratch
    this.rippleRT = rt({ type: THREE.HalfFloatType });

    /* pass 1 */
    this.shapeMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SHAPE_FRAG, depthTest: false, depthWrite: false, uniforms: {
      uTime: { value: 0 }, uAspect: { value: 1 }, uScale: { value: this.o.scale } } });
    this.shapeScene = new THREE.Scene(); this.shapeScene.add(new THREE.Mesh(quad, this.shapeMat));

    /* picture mode: fit + blur, baked into shapeRT once per load / resize */
    this.pictureMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: PICTURE_FRAG, depthTest: false, depthWrite: false, uniforms: {
      tImage: { value: null }, uImageAspect: { value: 1 }, uAspect: { value: 1 }, uFit: { value: this.o.fit === 'cover' ? 1 : 0 }, uScale: { value: this.o.scale } } });
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false, uniforms: {
      tMap: { value: null }, uStep: { value: new THREE.Vector2() }, uSigma: { value: 1 } } });
    this.bakeMesh = new THREE.Mesh(quad, this.pictureMat);
    this.bakeScene = new THREE.Scene(); this.bakeScene.add(this.bakeMesh);

    /* pass 2 — stamps live in a −aspect..aspect × −1..1 world */
    this.rippleCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10); this.rippleCam.position.z = 1;
    this.rippleScene = new THREE.Scene();
    this.brush = makeBrush();
    this.stamps = [];
    const stampGeo = new THREE.PlaneGeometry(this.o.rippleSize, this.o.rippleSize);
    for (let i = 0; i < this.o.maxRipples; i++) {
      const m = new THREE.Mesh(stampGeo, new THREE.MeshBasicMaterial({ map: this.brush, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, opacity: 0 }));
      m.visible = false; m.rotation.z = Math.random() * Math.PI * 2;
      this.rippleScene.add(m); this.stamps.push(m);
    }
    this.nextStamp = 0;

    /* pass 3 */
    this.displayMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DISPLAY_FRAG, depthTest: false, depthWrite: false, uniforms: {
      tShape: { value: this.shapeRT.texture }, tRipple: { value: this.rippleRT.texture },
      uBg: { value: new THREE.Color('#111111') }, uInk: { value: new THREE.Color('#f2f2f2') },
      uDot: { value: new THREE.Color('#333333') }, uDotPitch: { value: 1 }, uDotRadius: { value: 0 }, uDotOffset: { value: new THREE.Vector2() },
      uIntensity: { value: 1 }, uGrain: { value: 0.16 }, uGrainSize: { value: this.o.grainSize }, uAspect: { value: 1 }, uResolution: { value: new THREE.Vector2(1, 1) },
      uWobble: { value: this.o.animate ? this.o.wobble : 0 }, uWobbleScale: { value: this.o.wobbleScale }, uWobbleTime: { value: 0 }, uRipple: { value: this.o.ripple } } });
    this.scene = new THREE.Scene(); this.scene.add(new THREE.Mesh(quad, this.displayMat));

    this.mouse = new THREE.Vector2(NaN, NaN); this.lastStamp = new THREE.Vector2(NaN, NaN);
    this.t0 = performance.now(); this.last = this.t0; this.raf = null;

    this.resize = this.resize.bind(this); this.frame = this.frame.bind(this); this.onMove = this.onMove.bind(this);
    window.addEventListener('resize', this.resize);
    if (this.o.animate) {
      window.addEventListener('pointermove', this.onMove, { passive: true });
      window.addEventListener('pointerdown', this.onMove, { passive: true });
    }
    this.themeObserver = new MutationObserver(() => this.readTokens());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    this.readTokens();
    this.resize();
    if (this.o.image) this.setImage(this.o.image);
    if (this.o.animate) this.raf = requestAnimationFrame(this.frame); else this.render(0);
  }

  /* picture mode: until the picture arrives the ground is plain (shapeRT cleared), then it is baked in */
  async setImage(src) {
    this.image = new THREE.DataTexture(new Uint8Array(4), 1, 1); this.image.needsUpdate = true;   // transparent placeholder
    this.bakeShape();
    const tex = await new THREE.TextureLoader().loadAsync(src);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    this.image.dispose(); this.image = tex;
    this.bakeShape();
    if (!this.o.animate) this.render(0);
  }

  /* fit the picture to the viewport, blur it (H then V), leave the result in shapeRT */
  bakeShape() {
    if (!this.image) return;
    const pu = this.pictureMat.uniforms, bu = this.blurMat.uniforms;
    pu.tImage.value = this.image; pu.uImageAspect.value = this.image.image.width / this.image.image.height; pu.uAspect.value = this.aspect;
    this.bakeMesh.material = this.pictureMat;
    this.renderer.setRenderTarget(this.shapeRT); this.renderer.render(this.bakeScene, this.quadCam);
    const { width: w, height: h } = this.shapeRT;
    bu.uSigma.value = Math.max(0.01, this.o.blur * h);
    this.bakeMesh.material = this.blurMat;
    bu.tMap.value = this.shapeRT.texture; bu.uStep.value.set(1 / w, 0);
    this.renderer.setRenderTarget(this.blurRT); this.renderer.render(this.bakeScene, this.quadCam);
    bu.tMap.value = this.blurRT.texture; bu.uStep.value.set(0, 1 / h);
    this.renderer.setRenderTarget(this.shapeRT); this.renderer.render(this.bakeScene, this.quadCam);
    this.renderer.setRenderTarget(null);
  }

  get size() { const r = this.el.getBoundingClientRect(); return { w: Math.max(2, Math.round(r.width) || window.innerWidth), h: Math.max(2, Math.round(r.height) || window.innerHeight) }; }

  /* colours + strengths from the element's tokens (so the theme toggle just works) */
  readTokens() {
    const cs = getComputedStyle(this.el);
    const bg = cs.getPropertyValue('--fx-bg').trim() || cs.backgroundColor || '#111';
    const ink = cs.getPropertyValue('--fx-swirl').trim() || '#f2f2f2';
    const intensity = parseFloat(cs.getPropertyValue('--fx-swirl-intensity')); const grain = parseFloat(cs.getPropertyValue('--fx-grain'));
    const u = this.displayMat.uniforms;
    u.uBg.value.set(bg); u.uInk.value.set(ink);
    u.uIntensity.value = Number.isFinite(intensity) ? intensity : 1;
    u.uGrain.value = Number.isFinite(grain) ? grain : 0.16;
    // the dot grid: --fx-dot / --fx-dot-size / --fx-dot-gap (CSS px), centred in the viewport
    const dot = cs.getPropertyValue('--fx-dot').trim();
    const size = parseFloat(cs.getPropertyValue('--fx-dot-size')) || 0, gap = parseFloat(cs.getPropertyValue('--fx-dot-gap')) || 0;
    const { w, h } = this.size, dpr = this.renderer.getPixelRatio(), pitch = size + gap;
    const first = (n) => (n - (Math.floor((n + gap) / pitch) * pitch - gap)) / 2 + size / 2;   // first dot centre along an axis
    if (dot && size > 0 && pitch > 0) {
      u.uDot.value.set(dot); u.uDotRadius.value = size / 2 * dpr; u.uDotPitch.value = pitch * dpr;
      u.uDotOffset.value.set((first(w) % pitch) * dpr, (first(h) % pitch) * dpr);
    } else u.uDotRadius.value = 0;
    if (!this.o.animate) this.render(0);
  }

  resize() {
    const { w, h } = this.size; const aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.shapeMat.uniforms.uAspect.value = aspect;
    this.displayMat.uniforms.uAspect.value = aspect;
    this.renderer.getDrawingBufferSize(this.displayMat.uniforms.uResolution.value);
    const side = (n) => aspect >= 1 ? [Math.round(n * aspect), n] : [n, Math.round(n / aspect)];
    this.shapeRT.setSize(...side(this.o.shapeSize)); this.blurRT.setSize(...side(this.o.shapeSize));
    this.rippleRT.setSize(...side(this.o.rippleRes));
    this.rippleCam.left = -aspect; this.rippleCam.right = aspect; this.rippleCam.updateProjectionMatrix();
    this.aspect = aspect;
    this.readTokens();
    this.bakeShape();
    if (!this.o.animate) this.render(0);
  }

  onMove(e) {
    const r = this.el.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width * 2 - 1) * this.aspect, 1 - (e.clientY - r.top) / r.height * 2);
  }

  /* one stamp per frame the cursor has moved, round-robin through the pool — as the reference does */
  trackPointer() {
    if (Number.isNaN(this.mouse.x)) return;
    if (Math.abs(this.mouse.x - this.lastStamp.x) < 1e-4 && Math.abs(this.mouse.y - this.lastStamp.y) < 1e-4) return;
    const m = this.stamps[this.nextStamp]; this.nextStamp = (this.nextStamp + 1) % this.stamps.length;
    m.visible = true; m.position.set(this.mouse.x, this.mouse.y, 0); m.material.opacity = 1;
    this.lastStamp.copy(this.mouse);
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.trackPointer();
    for (const m of this.stamps) if (m.visible) { m.material.opacity -= this.o.rippleFade * dt; if (m.material.opacity < 0.02) m.visible = false; }
    const elapsed = (now - this.t0) / 1000;
    this.render(elapsed * this.o.speed, elapsed * this.o.wobbleSpeed);
    this.raf = requestAnimationFrame(this.frame);
  }

  render(t, wobbleTime = 0) {
    this.shapeMat.uniforms.uTime.value = t;
    this.displayMat.uniforms.uWobbleTime.value = wobbleTime;
    if (!this.image) { this.renderer.setRenderTarget(this.shapeRT); this.renderer.render(this.shapeScene, this.quadCam); }
    this.renderer.setRenderTarget(this.rippleRT); this.renderer.render(this.rippleScene, this.rippleCam);
    this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.quadCam);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerdown', this.onMove);
    this.themeObserver.disconnect();
    this.shapeRT.dispose(); this.blurRT.dispose(); this.rippleRT.dispose(); this.brush.dispose(); if (this.image) this.image.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
