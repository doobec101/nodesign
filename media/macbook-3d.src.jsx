/**
 * media/macbook-3d.js is built from this file — `npm run build:macbook`.
 *
 * A React island for a page that is otherwise plain HTML: every [data-macbook] box gets a
 * transparent WebGL stage with the rigged MacBook (rigged-macbook-3d), its lid tied to where
 * the plate sits on screen and the case shot on the display. The page imports the built bundle
 * one screen ahead, and only when the client can take it — see the work-stage block in
 * nodesign.html. Until then, and for good on a client without WebGL2 or with reduced motion
 * asked for, the flat screenshot under the stage is the case.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame } from '@react-three/fiber';
import { Macbook, MacbookStage, clamp01, easeInOut, lerp, ramp, smoothDamp, useCapabilityGate } from 'rigged-macbook-3d';

/* Each pair is shut → open, and the lid opening plays the whole move: the device arrives whole
   in frame, then the camera dives in until the terminal nearly fills the plate. Fitted against the
   stage camera (z 6, fov 32) and the plate's 16 / 10 — re-fit them if either ever changes. */
const FIT = [0.84, 1.60];        // scale
const SEAT = [0.42, -0.18];      // world y: the screen's middle ends up on the frame's middle
const TILT = [0.05, 0.012];      // pointer nod, radians — dived in, there is no room for the full swing


/* One anodised grey for the whole body. The model paints its parts from a baked 128 x 4 palette
   and a couple of flat swatch maps, which is what reads as a different colour per part — so a map
   that is a swatch counts as paint, not art, and the colour takes over. Printed parts (keycap
   legends, ports, grilles) keep their maps; the rubber feet and the glossy trim keep their finish. */
const BODY = '#c9cad1';

/* a palette strip, or a map that carries no structure, is a colour rather than artwork: the model's
   swatch maps land near 0-35 on this scale and its real art (keycap legends, grilles) well above 150 */
const isSwatch = (map) => {
  const img = map.image;
  if (!img || !img.width) return false;
  if (Math.min(img.width, img.height) <= 8) return true;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 8, 8);
    const px = ctx.getImageData(0, 0, 8, 8).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo < 60;
  } catch (e) { return false; }            // an undecoded or tainted image: leave the material alone
};

const paintBody = (root) => {
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh || o.name === 'Screen') return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (!m || done.has(m)) return;
      done.add(m);
      if (m.map ? !isSwatch(m.map) : (m.metalness < 0.9 || m.roughness < 0.4)) return;
      m.map = null;
      m.color.set(BODY);
      /* the model's body is full metal, which mirrors the room and turns black on the dark stage;
         half-metal at this roughness keeps the sheen and holds the same grey under either preset */
      m.metalness = 0.55; m.roughness = 0.42; m.envMapIntensity = 1;
      m.needsUpdate = true;
    });
  });
};

/* ---------- pointer: one listener for the whole page, read per frame ---------- */
const pointer = { x: 0, y: 0, seen: false };
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;          // a tap must not leave the device tilted
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true;
}, { passive: true });

/* The lid follows the plate up the screen: shut as it enters from below, fully open by the time the
   plate's middle is two thirds of the way up. It finishes early on purpose — wherever the reader
   stops, the case is square to the camera rather than caught mid-swing. */
const scrollOpen = (el) => {
  const r = el.getBoundingClientRect();
  return clamp01((innerHeight - (r.top + r.height / 2)) / (innerHeight * 0.34));
};

const preset = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'studio-dark' : 'studio-light');

/* ---------- the device: every beat is per-frame, nothing re-renders React ---------- */
const Device = ({ host, screen, modelSrc, onLoad }) => {
  const group = useRef(null);
  const device = useRef(null);
  const lid = useRef(0), lidVel = useRef(0);
  const tilt = useRef(0);
  const frame = useRef({ open: 0, brightness: 0 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);           // a backgrounded tab must not throw the lid open in one step
    const follow = 1 - Math.exp(-dt * 6);         // frame-rate independent ease for the tilt

    lid.current = smoothDamp(lid.current, scrollOpen(host), lidVel, 0.28, dt, 3);   // lands square rather than drifting in
    const open = easeInOut(lid.current);
    frame.current.open = open;
    frame.current.brightness = ramp(lid.current, 0.45, 0.95);   // the screen wakes behind the rising lid

    const g = group.current;
    if (!g) return;

    const r = host.getBoundingClientRect();
    const centre = r.top + r.height / 2;
    const near = pointer.seen ? Math.max(-1, Math.min(1, (pointer.y - centre) / (r.height * 0.9))) : 0;
    tilt.current = lerp(tilt.current, near, follow);

    g.rotation.x = tilt.current * lerp(TILT[0], TILT[1], open);   // it nods with the cursor and never turns:
    g.position.y = lerp(SEAT[0], SEAT[1], open);                  // the case stays square to the camera

    g.scale.setScalar(lerp(FIT[0], FIT[1], open) * Math.min(1, state.viewport.aspect / 1.6));   // hold the fit if the plate is ever narrower
  });

  return (
    <group ref={group}>
      <Macbook
        ref={device}
        screen={screen}
        modelSrc={modelSrc}
        frameDriver={() => frame.current}
        onLoad={() => { paintBody(device.current); onLoad(); }}
      />
    </group>
  );
};

/* ---------- one stage: gated on the client, lit by the page's theme ---------- */
const Stage = ({ host, plate, screen, modelSrc }) => {
  const able = useCapabilityGate();               // WebGL2 + motion allowed; null on the first render
  const [lighting, setLighting] = useState(preset);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const mo = new MutationObserver(() => setLighting(preset()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  /* the flat shot holds the plate until the device is really there, and takes it back on a downgrade */
  useEffect(() => { plate.classList.toggle('is-live', Boolean(able) && loaded); }, [able, loaded, plate]);

  if (!able) return null;
  return (
    <MacbookStage lighting={lighting}>
      <Device host={host} screen={screen} modelSrc={modelSrc} onLoad={() => setLoaded(true)} />
    </MacbookStage>
  );
};

/* ---------- mount every stage on the page: importing this module is the whole API ---------- */
document.querySelectorAll('[data-macbook]:not([data-macbook-mounted])').forEach((host) => {
  host.setAttribute('data-macbook-mounted', '');
  createRoot(host).render(
    <Stage
      host={host}
      plate={host.parentElement}
      screen={{ src: host.dataset.macbook, type: 'image' }}
      modelSrc={host.dataset.macbookModel}
    />
  );
});
