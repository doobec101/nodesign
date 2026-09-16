/* =========================================================
   EntropyText — a word that falls apart the further the
   cursor is from it, and heals as the cursor comes back.

   Drop-in:
     <h1 data-entropy>Entropy</h1>
     <script src="./entropy-text.js">   ← auto-inits every [data-entropy]

   Manual:
     const et = new EntropyText(el, { radius: 600 });
     et.intensity   // 0 = clean … 1 = fully decayed
     et.distance    // px from the cursor to the word's edge (Infinity = no cursor)
     et.flow        // { x, y } eased direction of the cursor's motion, |flow| ≤ 1
     et.rest(ms)    // hold the word clean for ms, then let it decay again (e.g. right after it re-enters the page)
     et.text        // the original word
     et.destroy()
     EntropyText.get(el)   // instance behind an auto-inited element
   The element may be moved around the DOM (or detached and re-attached) freely — the instance follows it.

   Options — pass as `data-entropy-<name>` attributes or in the constructor:
     delay      ms before the word may start to decay after init   (333)
     radius     px from the word's edge where decay is total;
                0 = auto ≈ 2.4 × font-size, capped at 35% of the
                viewport's shorter side, never under 160px          (0)
     inner      px halo around the word that always stays clean     (16)
     liquid     em — how far the outline flows (displacement)       (0.4)
     goo        em — blur → alpha threshold; rounds & merges blobs  (0.045)
     thicken    em — strokes swell as the glyph liquefies           (0.035)
     melt       glyphs sag downward from their top at full decay    (0.4)
     shift      em — per-glyph drift at full decay                  (0.2)
     rotate     deg — per-glyph tilt at full decay                  (16)
     scale      ± per-glyph size change at full decay               (0.2)
     jitter     0..1 — how much the decayed state keeps breathing   (1)
     flicker    0..1 — re-roll the noise field now and then         (0.35)
     smoothing  ms — time constant of the ease between states       (240)
     seed       integer — same seed = same wreck on every load      (7)
   Direction — the cursor's motion drags the wreck along with it:
     speed      px/s of cursor motion at which the drag is total    (1200)
     drag       em — glyphs pulled along the motion                 (0.4)
     lean       deg — glyphs tilt into horizontal motion            (22)
     skew       deg — glyphs slant along the motion                 (26)
     stretch    glyphs elongate along the axis of motion            (0.35)
     smear      em — filter dilation along the motion (bolder edge) (0.08)
   ========================================================= */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var REDUCED_MOTION = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DEFAULTS = {
    delay: 333,
    radius: 0,
    inner: 16,
    liquid: 0.4,
    goo: 0.045,
    thicken: 0.035,
    melt: 0.4,
    shift: 0.2,
    rotate: 16,
    scale: 0.2,
    jitter: 1,
    flicker: 0.35,
    smoothing: 240,
    seed: 7,
    speed: 1200,
    drag: 0.4,
    lean: 22,
    skew: 26,
    stretch: 0.35,
    smear: 0.08,
    // noise frequency in cycles / em (x y) — low, so the outline flows in long slow waves instead of tearing
    frequency: [0.9, 1.4]
  };

  /* ---------- helpers ---------- */

  // mulberry32 — deterministic per-glyph randomness
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // random sign × magnitude in [0.45, 1] — every glyph visibly moves, none sits still
  function spread(r) { return (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.55); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function graphemes(text) {
    if (global.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function (s) { return s.segment; });
    }
    return Array.from(text);
  }
  function readDataset(el) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = el.dataset['entropy' + k.charAt(0).toUpperCase() + k.slice(1)];
      if (v == null) return;
      if (k === 'frequency') out[k] = v.split(/[\s,]+/).map(Number);
      else out[k] = Number(v);
    });
    return out;
  }

  /* ---------- shared pointer state (one set of listeners for every instance) ---------- */

  var pointer = null;        // { x, y, t } in viewport px, or null when the cursor is outside the window / unknown
  var vx = 0, vy = 0;        // cursor velocity, px/s, lightly smoothed across events
  var IDLE_MS = 90;          // no move event for this long = the cursor has stopped
  var instances = [];
  var listening = false;

  function wakeAll() { for (var i = 0; i < instances.length; i++) instances[i].wake(); }
  function invalidateAll() { for (var i = 0; i < instances.length; i++) instances[i].invalidate(); }
  function refitAll() { for (var i = 0; i < instances.length; i++) instances[i].refit(); }

  function listen() {
    if (listening) return;
    listening = true;
    var onMove = function (e) {
      var now = performance.now();
      if (pointer) {
        var dt = now - pointer.t;
        if (dt > 0 && dt < 200) {
          vx += ((e.clientX - pointer.x) / dt * 1000 - vx) * 0.5;
          vy += ((e.clientY - pointer.y) / dt * 1000 - vy) * 0.5;
        }
      }
      pointer = { x: e.clientX, y: e.clientY, t: now };
      wakeAll();
    };
    global.addEventListener('pointermove', onMove, { passive: true });
    global.addEventListener('pointerdown', onMove, { passive: true });
    // leaving the window counts as "far away"
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) { pointer = null; wakeAll(); } });
    global.addEventListener('resize', refitAll);
    global.addEventListener('scroll', invalidateAll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) wakeAll(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitAll);
  }

  var uid = 0;

  /* ---------- the component ---------- */

  function EntropyText(el, opts) {
    this.el = el;
    el.__entropy = this;        // EntropyText.get(el)
    this.o = Object.assign({}, DEFAULTS, readDataset(el), opts || {});
    this.i = 0;                 // current intensity, eased
    this.target = 0;
    this.fx = 0; this.fy = 0;   // flow: where the cursor is heading, |f| ≤ 1, eased
    this.lastSmear = '';
    this.armed = false;
    this.running = false;
    this.applied = false;
    this.fontSize = 0;
    this.lastLevel = -1;
    this.seedAt = 0;
    this.seedN = this.o.seed;
    this.tick = this.tick.bind(this);

    if (REDUCED_MOTION) { this.disabled = true; return; }   // respect the OS setting: the word simply stays clean

    this.build();
    this.buildFilter();
    this.refit();
    instances.push(this);
    listen();

    var self = this;
    this.timer = setTimeout(function () { self.armed = true; self.wake(); }, this.o.delay);
  }

  EntropyText.prototype.build = function () {
    var el = this.el;
    var text = el.textContent;
    this.text = text;
    el.textContent = '';
    el.classList.add('entropy');

    // a11y: the real word stays in the tree for screen readers; the glyph soup is hidden from them
    var sr = document.createElement('span');
    sr.className = 'entropy__sr';
    sr.textContent = text;
    sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';

    var live = document.createElement('span');
    live.className = 'entropy__live';
    live.setAttribute('aria-hidden', 'true');
    live.style.display = 'inline-block';

    var r = rng(this.o.seed);
    this.glyphs = graphemes(text).map(function (ch) {
      var s = document.createElement('span');
      s.className = 'entropy__glyph';
      s.textContent = ch;
      s.style.cssText = 'display:inline-block;white-space:pre;transform-origin:50% 10%';
      live.appendChild(s);
      return {
        el: s,
        ax: spread(r), ay: spread(r), ar: spread(r), as: spread(r),     // where this glyph wants to go when it decays
        ph: r() * Math.PI * 2, ph2: r() * Math.PI * 2, fq: 0.6 + r() * 0.9, // its own breathing rhythm
        mass: 0.6 + r() * 0.8                                            // how far the cursor's motion carries it
      };
    });

    el.appendChild(sr);
    el.appendChild(live);
    this.live = live;
  };

  EntropyText.prototype.buildFilter = function () {
    var id = 'entropy-warp-' + (++uid);
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    // generous region: glyphs drift, scale and get displaced well outside the word's own box
    svg.innerHTML =
      '<filter id="' + id + '" x="-40%" y="-80%" width="180%" height="260%" color-interpolation-filters="sRGB">' +
        // swell → flow → goo: dilate the strokes, push the outline around with smooth noise,
        // then blur and re-threshold the alpha so everything rounds off and nearby blobs merge
        '<feMorphology in="SourceGraphic" operator="dilate" radius="0 0" result="m"/>' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.01 0.015" numOctaves="2" seed="' + this.o.seed + '" result="n"/>' +
        '<feDisplacementMap in="m" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G" result="d"/>' +
        '<feGaussianBlur in="d" stdDeviation="0" result="b"/>' +
        '<feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/>' +
      '</filter>';
    (document.body || document.documentElement).appendChild(svg);
    this.svg = svg;
    this.turb = svg.querySelector('feTurbulence');
    this.disp = svg.querySelector('feDisplacementMap');
    this.morph = svg.querySelector('feMorphology');
    this.blur = svg.querySelector('feGaussianBlur');
    this.matrix = svg.querySelector('feColorMatrix');
    this.filterUrl = 'url(#' + id + ')';
  };

  // scrolled — make sure a frame runs so the distance is re-read
  EntropyText.prototype.invalidate = function () {
    this.wake();
  };

  // resized / fonts loaded — the word may have a new size, so the noise has to be re-scaled to it
  EntropyText.prototype.refit = function () {
    var fs = parseFloat(getComputedStyle(this.live).fontSize) || 16;
    if (fs && fs !== this.fontSize) {
      this.fontSize = fs;
      var f = this.o.frequency;
      this.bf = [f[0] / fs, f[1] / fs];
      this.turb.setAttribute('baseFrequency', this.bf[0].toFixed(5) + ' ' + this.bf[1].toFixed(5));
    }
    this.wake();
  };

  // px from the cursor to the nearest edge of the word (0 while hovering it)
  Object.defineProperty(EntropyText.prototype, 'distance', {
    get: function () {
      if (!pointer || this.disabled) return Infinity;
      var r = this.live.getBoundingClientRect();
      var dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
      var dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
      return Math.hypot(dx, dy);
    }
  });

  Object.defineProperty(EntropyText.prototype, 'intensity', {
    get: function () { return this.i; }
  });

  // { x, y } — eased direction of the cursor's motion, |flow| ≤ 1; 0,0 when it is still
  Object.defineProperty(EntropyText.prototype, 'flow', {
    get: function () { return { x: this.fx, y: this.fy }; }
  });

  EntropyText.prototype.computeTarget = function () {
    if (!pointer) return 1;                        // cursor unknown or outside the window → as far as it gets
    var radius = this.o.radius ||
      Math.max(160, Math.min(2.4 * this.fontSize, Math.min(global.innerWidth, global.innerHeight) * 0.35));
    var span = Math.max(radius - this.o.inner, 1);
    return smoothstep(clamp01((this.distance - this.o.inner) / span));
  };

  // hold the word clean for `ms` (default: the init delay), then let it decay again
  EntropyText.prototype.rest = function (ms) {
    if (this.disabled) return;
    clearTimeout(this.timer);
    this.armed = false;
    this.i = 0; this.target = 0; this.fx = 0; this.fy = 0;
    this.render(0);
    var self = this;
    this.timer = setTimeout(function () { self.armed = true; self.wake(); }, ms == null ? this.o.delay : ms);
  };

  EntropyText.prototype.wake = function () {
    if (this.disabled || !this.armed || this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  };

  EntropyText.prototype.tick = function (now) {
    if (this.destroyed) return;
    if (!this.el.isConnected) { this.running = false; return; }   // parked off-DOM: wait until it is back
    var dt = Math.min(now - this.last, 64);
    this.last = now;

    this.target = this.computeTarget();
    var k = 1 - Math.exp(-dt / this.o.smoothing);    // frame-rate independent ease
    this.i += (this.target - this.i) * k;
    if (Math.abs(this.target - this.i) < 0.0015) this.i = this.target;

    // flow: cursor velocity → unit-ish vector, quick to pick up, slower to let go once the cursor stops
    var moving = pointer && now - pointer.t < IDLE_MS;
    var tfx = 0, tfy = 0;
    if (moving) {
      var v = Math.hypot(vx, vy);
      var n = v ? Math.min(1, v / this.o.speed) / v : 0;
      tfx = vx * n; tfy = vy * n;
    }
    var kf = 1 - Math.exp(-dt / (moving ? 110 : 320));
    this.fx += (tfx - this.fx) * kf;
    this.fy += (tfy - this.fy) * kf;
    if (!moving && Math.abs(this.fx) + Math.abs(this.fy) < 0.002) { this.fx = 0; this.fy = 0; }

    this.render(now / 1000);

    // sleep once fully settled: clean, or decayed with nothing left to animate
    var still = this.fx === 0 && this.fy === 0;
    var settled = this.i === this.target && still && (this.i === 0 || (this.o.jitter === 0 && this.o.flicker === 0));
    if (settled || document.hidden) { this.running = false; return; }
    requestAnimationFrame(this.tick);
  };

  EntropyText.prototype.render = function (t) {
    var I = this.i, o = this.o, live = this.live, glyphs = this.glyphs;

    if (I <= 0.001) {
      if (this.applied) {
        live.style.filter = '';
        for (var j = 0; j < glyphs.length; j++) glyphs[j].el.style.transform = '';
        this.applied = false;
        this.lastLevel = -1;
        this.lastSmear = '';
      }
      return;
    }
    this.applied = true;

    // direction: the wreck follows the cursor's motion — kicks in earlier than the decay itself
    var Id = I * (2 - I);
    var fx = this.fx, fy = this.fy;

    var fs = this.fontSize;
    // liquid — flow amplitude, goo blur and the alpha threshold all ride on I; the threshold ramps from
    // identity (clean anti-aliasing) to a hard 0.5 cut so the transition never shows jagged edges
    var level = Math.round(I * 200);
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.disp.setAttribute('scale', (I * o.liquid * fs).toFixed(2));
      this.blur.setAttribute('stdDeviation', (I * o.goo * fs).toFixed(2));
      var k = 1 + I * 18;
      this.matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ' + k.toFixed(2) + ' ' + (-(k - 1) / 2).toFixed(2));
      if (!live.style.filter) live.style.filter = this.filterUrl;
    }
    // the noise field itself slowly breathes, so the outline keeps flowing even when nothing else moves
    if (o.jitter > 0 && this.bf) {
      var bx = this.bf[0] * (1 + 0.12 * o.jitter * Math.sin(t * 0.9));
      var by = this.bf[1] * (1 + 0.12 * o.jitter * Math.cos(t * 0.65));
      this.turb.setAttribute('baseFrequency', bx.toFixed(5) + ' ' + by.toFixed(5));
    }
    // swell: strokes thicken as they liquefy, plus extra along the axis the cursor moves on
    var smear = ((I * o.thicken + Math.abs(fx) * Id * o.smear) * fs).toFixed(1) + ' ' +
                ((I * o.thicken + Math.abs(fy) * Id * o.smear) * fs).toFixed(1);
    if (smear !== this.lastSmear) {
      this.morph.setAttribute('radius', smear);
      this.lastSmear = smear;
    }
    // deep into decay the noise field re-rolls now and then — a quiet glitch tick
    if (o.flicker > 0 && I > 0.6 && t - this.seedAt > (1.4 - I) / o.flicker) {
      this.seedAt = t;
      this.seedN = (this.seedN + 1) % 1000;
      this.turb.setAttribute('seed', String(this.seedN));
    }

    // per-glyph drift · tilt · size, with a slow breathing on top so the wreck never freezes
    var wob = o.jitter * 0.28;
    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      var w1 = Math.sin(t * g.fq * 1.7 + g.ph) * wob;
      var w2 = Math.cos(t * g.fq * 1.3 + g.ph2) * wob;
      var tx = (g.ax + w1) * I * o.shift + fx * Id * o.drag * g.mass;     // base drift + carried along the motion
      var ty = (g.ay + w2) * I * o.shift * 0.55 + fy * Id * o.drag * g.mass;
      var rot = (g.ar + w1 * 0.6) * I * o.rotate + fx * Id * o.lean;      // leans into horizontal motion
      var skx = -fx * Id * o.skew;                                        // slants along the motion
      var sky = fy * Id * o.skew * 0.4;
      var sc = 1 + (g.as + w2 * 0.5) * I * o.scale;
      var sag = I * o.melt * g.mass * (1 + w2 * 0.3);                      // hangs from the top and sags downward
      var sx = sc * (1 + sag * 0.25) * (1 + Math.abs(fx) * Id * o.stretch); // elongates along the axis of motion
      var sy = sc * (1 + sag) * (1 + Math.abs(fy) * Id * o.stretch);
      g.el.style.transform =
        'translate(' + tx.toFixed(3) + 'em,' + ty.toFixed(3) + 'em) rotate(' + rot.toFixed(2) + 'deg) ' +
        'skew(' + skx.toFixed(2) + 'deg,' + sky.toFixed(2) + 'deg) scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')';
    }
  };

  EntropyText.prototype.destroy = function () {
    this.destroyed = true;
    clearTimeout(this.timer);
    var idx = instances.indexOf(this);
    if (idx > -1) instances.splice(idx, 1);
    if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    if (this.live) {
      var text = this.live.textContent;
      this.el.textContent = text;
      this.el.classList.remove('entropy');
    }
    delete this.el.__entropy;
  };

  EntropyText.get = function (el) { return el.__entropy || null; };

  EntropyText.init = function (root) {
    var nodes = (root || document).querySelectorAll('[data-entropy]:not(.entropy)');
    return Array.prototype.map.call(nodes, function (el) { return new EntropyText(el); });
  };

  global.EntropyText = EntropyText;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { EntropyText.init(); });
  else EntropyText.init();
})(window);
