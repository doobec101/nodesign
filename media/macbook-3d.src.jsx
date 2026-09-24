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

/* Fitted against the stage camera (z 6, fov 32) and the plate's 16 / 10: the open device fills
   ~89% of the frame with room left for the tilt, and clears it at every lid angle. Re-fit both
   numbers if the plate ratio or the camera ever changes. */
const FIT = 0.84;
const SEAT = [0.42, 0.28];       // world y, shut → open: the device settles as the lid comes up

/* ---------- pointer: one listener for the whole page, read per frame ---------- */
const pointer = { x: 0, y: 0, seen: false };
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;          // a tap must not leave the device tilted
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true;
}, { passive: true });

/* the lid follows the plate up the screen: shut as it enters from below, open once it sits centred */
const scrollOpen = (el) => {
  const r = el.getBoundingClientRect();
  return clamp01((innerHeight - (r.top + r.height / 2)) / (innerHeight / 2));
};

const preset = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'studio-dark' : 'studio-light');

/* ---------- the device: every beat is per-frame, nothing re-renders React ---------- */
const Device = ({ host, screen, modelSrc, onLoad }) => {
  const group = useRef(null);
  const lid = useRef(0), lidVel = useRef(0);
  const tilt = useRef({ x: 0, y: 0 });
  const frame = useRef({ open: 0, brightness: 0 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);           // a backgrounded tab must not throw the lid open in one step
    const follow = 1 - Math.exp(-dt * 6);         // frame-rate independent ease for the tilt

    lid.current = smoothDamp(lid.current, scrollOpen(host), lidVel, 0.35, dt, 3);
    const open = easeInOut(lid.current);
    frame.current.open = open;
    frame.current.brightness = ramp(lid.current, 0.45, 0.95);   // the screen wakes behind the rising lid

    const g = group.current;
    if (!g) return;

    const r = host.getBoundingClientRect();
    const toward = (v, centre, span) => (pointer.seen ? Math.max(-1, Math.min(1, (v - centre) / span)) : 0);
    tilt.current.x = lerp(tilt.current.x, toward(pointer.x, r.left + r.width / 2, r.width * 0.9), follow);
    tilt.current.y = lerp(tilt.current.y, toward(pointer.y, r.top + r.height / 2, r.height * 0.9), follow);

    g.rotation.y = tilt.current.x * 0.10 + (1 - open) * 0.18;   // turned a little while shut, square once open
    g.rotation.x = tilt.current.y * 0.05;
    g.position.y = lerp(SEAT[0], SEAT[1], open);
    g.scale.setScalar(FIT * Math.min(1, state.viewport.aspect / 1.6));   // hold the fit if the plate is ever narrower
  });

  return (
    <group ref={group}>
      <Macbook screen={screen} modelSrc={modelSrc} frameDriver={() => frame.current} onLoad={onLoad} />
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
