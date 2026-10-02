// Materials, the studio environment and the display shader.
import * as THREE from 'three';

// A dark studio: softboxes and strip lights on black. Only reflections light the metal, so the strips are what
// draws the frames' long highlights (the look of Apple's product films).
export function studioEnv(renderer, o = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  // softboxes carry a gradient (bright core, soft falloff), so metal gets long graded highlights, not flat patches
  const grad = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d'), lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, '#000'); lg.addColorStop(0.18, '#555'); lg.addColorStop(0.5, '#fff'); lg.addColorStop(0.82, '#555'); lg.addColorStop(1, '#000');
    g.fillStyle = lg; g.fillRect(0, 0, 64, 256);
    const h = g.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, 'rgba(0,0,0,0.55)'); h.addColorStop(0.3, 'rgba(0,0,0,0)'); h.addColorStop(0.7, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = h; g.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const panel = (w, h, pos, look, k, { tint = 0xffffff, soft = true, rot = 0 } = {}) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(k), side: THREE.DoubleSide, map: soft ? grad : null });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos); m.lookAt(...look); m.rotateZ(rot); scene.add(m);
  };
  const K = o.k ?? 1;
  panel(9, 20, [-10, 2, 3], [0, 0, 0], 3.2 * K);                       // key softbox, left, tall
  panel(7, 20, [10, 1, -3], [0, 0, 0], 2.2 * K);                       // rim softbox, right
  panel(8, 18, [-8, 1, -8], [0, 0, 0], 2.0 * K);                       // back left: what a band facing away reflects
  panel(8, 18, [9, 0, 7], [0, 0, 0], 1.5 * K);                         // front right
  panel(10, 3, [0, -8, -6], [0, 0, 0], 0.7 * K);                       // low back: the bottom edges
  panel(18, 9, [0, 12, 0], [0, 0, 0], 1.3 * K, { rot: Math.PI / 2 });  // overhead
  panel(0.5, 18, [-7, 1, 8], [0, 0, 0], 6 * K, { soft: false });       // crisp strip, front left: the line on the band
  panel(0.35, 16, [8, 3, 7], [0, 0, 0], 4 * K, { soft: false });       // crisp strip, front right
  panel(16, 10, [0, -1, 13], [0, 0, 0], 0.6 * K);                      // soft front: a sheen on the glass, edges facing us
  panel(26, 26, [0, -12, 0], [0, 0, 0], 0.05 * K, { soft: false });    // dim floor
  panel(14, 6, [0, 3, -13], [0, 0, 0], 0.16 * K, { tint: 0xdfe4f4 });  // cool back wall (a hint of blue, not a colour)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.0, 0.1, 100).texture;
  pmrem.dispose();
  return tex;
}

export function materials(env) {
  const phys = o => new THREE.MeshPhysicalMaterial(Object.assign({ envMap: env }, o));
  return {
    titanium: phys({ color: 0xc9c6c1, metalness: 1, roughness: 0.14, envMapIntensity: 1.25 }),        // Duo, Star White
    aluminum: phys({ color: 0xd9d9dc, metalness: 1, roughness: 0.3, envMapIntensity: 1.15 }),          // iPhone 16, White
    frame: phys({ color: 0xc9c6c1, metalness: 1, roughness: 0.14, envMapIntensity: 1.25 }),            // morphs between the two
    // black glass: a quiet sheen only — at full strength the key softbox laid a bright, square-edged patch on the bezels
    glass: phys({ color: 0x020203, metalness: 0, roughness: 0.1, clearcoat: 0.3, clearcoatRoughness: 0.06, envMapIntensity: 0.16 }),
    back: phys({ color: 0xe8e6e1, metalness: 0, roughness: 0.55, clearcoat: 0.9, clearcoatRoughness: 0.4, envMapIntensity: 0.9 }),
    hinge: phys({ color: 0xb9b6b1, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 }),
    lens: phys({ color: 0x07080a, metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }),
    lensRing: phys({ color: 0xbfbcb7, metalness: 1, roughness: 0.2 }),
    // glass reflections added over a display (its own colour is black: only the specular term survives)
    reflect: new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.1, envMap: env, envMapIntensity: 0.25,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    reflectMatte: new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.42, envMap: env, envMapIntensity: 0.55,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
}

// The panel: the canvas texture, clipped to the display's rounded rectangle and to an optional cutout (the Duo's
// camera hole that morphs into the Dynamic Island). Unlit and not tone-mapped: the UI keeps its Figma colours.
export function displayMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, size: { value: new THREE.Vector2(60, 120) }, radii: { value: new THREE.Vector4(8, 8, 8, 8) }, bright: { value: 1 },
      cut: { value: new THREE.Vector4(0, 0, 0, 0) }, cutR: { value: 0 }, cutOn: { value: 0 },
      uvRect: { value: new THREE.Vector4(0, 0, 1, 1) }, flipU: { value: 0 }, frost: { value: 0 }, dark: { value: 0 }, sweep: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec2 size; uniform vec4 radii; uniform float bright;
      uniform vec4 cut; uniform float cutR; uniform float cutOn; uniform vec4 uvRect; uniform float flipU; uniform float frost;
      uniform float dark; uniform float sweep;
      varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      // a wide, smooth blur that keeps the picture's colours as soft blobs: golden-angle taps on a mip level as coarse
      // as their spacing (an explicit level, not a bias — in a close-up the panel is magnified and a bias lands too
      // fine). In the fold it is wider than tall: the content smears sideways, toward the hinge
      vec3 frosted(vec2 t, float k) {
        float R = mix(0.06, 0.09, sweep) * pow(k, 0.8), lod = log2(max(1.0, 0.45 * R * float(textureSize(map, 0).x)));
        vec2 an = mix(vec2(1.0), vec2(1.15, 0.9), sweep);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 32; i++) {
          float a = float(i) * 2.39996, r = R * sqrt((float(i) + 0.5) / 32.0);
          vec2 o = vec2(cos(a) * an.x, sin(a) * an.y * size.x / size.y) * r;
          acc += textureLod(map, vec2(t.x + o.x, 1.0 - t.y - o.y), lod).rgb;
        }
        return acc / 32.0;
      }
      // per-corner radii (tl, tr, br, bl): the Duo's outer display is tight by the hinge, round on the free edge
      float sdRound4(vec2 p, vec2 b, vec4 r) {
        float rr = p.x > 0.0 ? (p.y > 0.0 ? r.y : r.z) : (p.y > 0.0 ? r.x : r.w);
        return sdRound(p, b, rr);
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, flipU), vUv.y);
        vec2 p = (uv - 0.5) * size;
        float d = sdRound4(p, size * 0.5, radii);
        float m = 1.0 - smoothstep(-fwidth(d), fwidth(d), d);
        vec2 tuv = uvRect.xy + uv * uvRect.zw;
        // the iPhone Duo folding (filmed hands-on, and Apple's own demo): the cover half — the left one, the outer display
        // is on its back — blurs and goes dark toward its free edge (about a fifth of the brightness there, three
        // quarters at the hinge); blur and shade carry on across the hinge into the right half and fade out a quarter
        // of the way in, so there is no seam; beyond that it stays sharp and bright.
        // sweep 0: the whole panel at once (the outer display waking)
        // Across the band the blurred picture is faded over the sharp one rather than blurred less and less (a blur
        // radius that changes across the panel drags edges into spikes): the sharp content ghosts out, as on the device
        float mb = 1.0, kd = dark;
        if (sweep > 0.5) {
          float x = uv.x;
          mb = 1.0 - smoothstep(0.44, 0.66, x);
          kd = dark * (x < 0.5 ? mix(1.0, 0.3, smoothstep(0.0, 0.5, x)) : 0.3 * (1.0 - smoothstep(0.5, 0.64, x)));
        }
        vec3 c = texture2D(map, vec2(tuv.x, 1.0 - tuv.y)).rgb;
        if (frost * mb > 0.002) {
          vec3 b = frosted(tuv, frost);
          b = mix(vec3(dot(b, vec3(0.2126, 0.7152, 0.0722))), b, 1.0 + 0.4 * sweep);   // a material blur: colours a touch richer
          c = mix(c, b, mb);
        }
        c *= bright * (1.0 - kd);
        float dc = sdRound(p - cut.xy, cut.zw, cutR);
        float mc = smoothstep(-fwidth(dc), fwidth(dc), dc);
        c *= mix(1.0, mc, cutOn);
        if (m < 0.002) discard;
        gl_FragColor = vec4(c, m);                            // see-through past the rounded corners
        #include <colorspace_fragment>
      }`,
    toneMapped: false, transparent: true,
    extensions: { derivatives: true },
  });
}

// The MacBook's panel: the terminal (static, 2×) with the chat widget (live, 6×) inset where it sits, and the pointer
// (a small sprite anywhere on the screen, so it can come in from beyond the frame)
export function macMaterial(base, widget, rect, cursorTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: base }, map2: { value: widget }, rect: { value: new THREE.Vector4(...rect) }, bright: { value: 1 },
      cursorMap: { value: cursorTex }, cursorRect: { value: new THREE.Vector4(0, 0, 0.01, 0.01) }, cursorOn: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform sampler2D map2; uniform vec4 rect; uniform float bright;
      uniform sampler2D cursorMap; uniform vec4 cursorRect; uniform float cursorOn;
      varying vec2 vUv;
      void main() {
        vec2 c = vec2(vUv.x, 1.0 - vUv.y);                    // canvas coordinates, top-left origin
        vec2 w = (c - rect.xy) / rect.zw;
        vec3 col = (w.x >= 0.0 && w.x <= 1.0 && w.y >= 0.0 && w.y <= 1.0) ? texture2D(map2, w).rgb : texture2D(map, c).rgb;
        vec2 q = (c - cursorRect.xy) / cursorRect.zw;
        if (cursorOn > 0.001 && q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
          vec4 k = texture2D(cursorMap, q);
          col = mix(col, k.rgb, k.a * cursorOn);
        }
        gl_FragColor = vec4(col * bright, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}

// The MacBook's screen becoming the Duo's: the display's uv maps to "UI pt" (desk pt, origin at the chat widget's
// top-left, y down) through disp; the terminal plate sits fixed in that space (fading out), the chat canvas is drawn
// for the growing chat rect. Same uniforms as displayMaterial where the slab sets them (size, radii, cut, bright).
export function morphMaterial(term, chat) {
  return new THREE.ShaderMaterial({
    uniforms: {
      term: { value: term }, chat: { value: chat }, size: { value: new THREE.Vector2(60, 120) }, radii: { value: new THREE.Vector4(0, 0, 0, 0) },
      disp: { value: new THREE.Vector4(0, 0, 1, 1) }, termR: { value: new THREE.Vector4(-8, -664, 1912, 536) },
      chatR: { value: new THREE.Vector4(0, 0, 592, 528) }, chatPt: { value: new THREE.Vector2(952, 670) }, termK: { value: 1 },
      bright: { value: 1 }, cut: { value: new THREE.Vector4() }, cutR: { value: 0 }, cutOn: { value: 0 }, uvRect: { value: new THREE.Vector4(0, 0, 1, 1) }, flipU: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D term; uniform sampler2D chat; uniform vec2 size; uniform vec4 radii; uniform vec4 disp;
      uniform vec4 termR; uniform vec4 chatR; uniform vec2 chatPt; uniform float termK; uniform float bright;
      varying vec2 vUv;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      float sdRound4(vec2 p, vec2 b, vec4 r) {
        float rr = p.x > 0.0 ? (p.y > 0.0 ? r.y : r.z) : (p.y > 0.0 ? r.x : r.w);
        return sdRound(p, b, rr);
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = (vUv - 0.5) * size;
        float d = sdRound4(p, size * 0.5, radii);
        float m = 1.0 - smoothstep(-fwidth(d), fwidth(d), d);
        vec2 ui = vec2(mix(disp.x, disp.z, vUv.x), mix(disp.w, disp.y, vUv.y));      // vUv.y = 1 at the top
        vec3 c = vec3(0.0);
        vec2 tu = (ui - termR.xy) / (termR.zw - termR.xy);
        if (tu.x >= 0.0 && tu.x <= 1.0 && tu.y >= 0.0 && tu.y <= 1.0) c = texture2D(term, tu).rgb * termK;
        vec2 cu = ui - chatR.xy;
        if (cu.x >= 0.0 && cu.y >= 0.0 && ui.x <= chatR.z && ui.y <= chatR.w) c = texture2D(chat, cu / chatPt).rgb;
        if (m < 0.002) discard;
        gl_FragColor = vec4(c * bright, m);
        #include <colorspace_fragment>
      }`,
    toneMapped: false, transparent: true,
    extensions: { derivatives: true },
  });
}

export function imageTexture(im, renderer) {
  const t = new THREE.Texture(im);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function canvasTexture(w, h, renderer) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  return { canvas: c, ctx: c.getContext('2d'), tex: t };
}
