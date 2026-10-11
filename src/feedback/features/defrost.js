/**
 * Feature: window defrost (desempañador delantero y trasero).
 *
 * Fields: window_front_defrost, window_rear_defrost
 *
 * What the driver perceives:
 *  - Front, false -> true: a faint film of condensation on the windshield,
 *    which clears from the bottom edge (where the vents are) up to the roof
 *    line in ~14 s and then goes away for good. It is never opaque: the road
 *    stays visible throughout.
 *  - A soft fan whoosh (synthesized filtered noise, no files) that swells in
 *    when the defrost starts and dies out as the glass finishes clearing. Its
 *    level follows fan_speed (read-only, from the snapshot).
 *  - Telltales: the ISO 7000-0635 (front) and ISO 7000-0636 (rear) defrost
 *    symbols in amber, small, in the lower left corner, lit while active.
 *    The rear glass is not visible from the cabin camera, so the rear defrost
 *    only shows its telltale (plus a short relay click).
 *  - Initial state (onChange after init / reset / reload): telltales match the
 *    state and the windshield is clear, no animation, no sound.
 *  - true -> false: the telltale fades out; condensation never comes back.
 *
 * The mist is part of the 3D model, not a screen overlay: a curved mesh that
 * fills the windshield opening of the car body, added next to the cabin
 * meshes (like the instrument cluster). The roof and the dashboard occlude it
 * through the depth buffer, so it fits the frame from any camera, seat side,
 * distance or FOV, and it shares the cabin material, so it is lit like the
 * cabin by day and by night. Its texture is a canvas (noise drawn once); a
 * requestAnimationFrame loop redraws only the clearing mask and stops when
 * the glass is clear. The top of the center screen pokes through the glass in
 * the model, so while the mist shows, a copy of the screen is drawn after it.
 * The telltales stay a DOM layer, shown only in the first-person camera. Everything is created
 * lazily: ctx.handles() is null until the sim starts.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const CLEAR_MS = 14000;        // time for the windshield to clear completely
  const FADE_IN_MS = 400;        // mist appearing before it starts to clear
  const AMBER = '#f5a623';       // console palette amber (telltale color)

  const BODY_MESH = 'z_map_body.004';
  const INTERIOR_MESH = 'z_interior_Cube.008';
  // The top of the center screen pokes through the windshield in the model,
  // so the mist would be drawn over it. These meshes get a copy drawn after
  // the mist while it is visible (bezel, then display).
  const ABOVE_MIST = ['center_console_rim', 'center_console_screen'];
  const OVERLAY_NAME = 'feedback_defrost_above_mist';
  const MIST_ORDER = 3;

  // Windshield opening of the car body, in the car frame (x forward, y up,
  // z across; the car is symmetric in z). Measured from the body mesh: the
  // roof's front edge and the cowl, from the center line out to the A-pillar.
  const GLASS_TOP = [[1.497, 1.195, 0], [1.484, 1.193, 0.268], [1.434, 1.189, 0.519], [1.376, 1.151, 0.575]];
  const GLASS_BOTTOM = [[2.283, 0.901, 0], [2.240, 0.890, 0.357], [2.140, 0.886, 0.638]];
  const INSET = 0.012;           // m toward the cabin, so the body never cuts the mist
  const COLS = 24;               // mesh resolution across the curved glass
  const ROWS = 8;

  const TEX_W = 512;
  const TEX_H = 256;

  // ISO 7000-0635 / 0636 style symbols: glass outline with three wavy arrows up.
  const ARROWS =
    '<path d="M8 17 q-1.3-1.3 0-2.6 q1.3-1.3 0-2.6 V9.5 M6.4 11 L8 9.2 L9.6 11"/>' +
    '<path d="M12 17 q-1.3-1.3 0-2.6 q1.3-1.3 0-2.6 V9.5 M10.4 11 L12 9.2 L13.6 11"/>' +
    '<path d="M16 17 q-1.3-1.3 0-2.6 q1.3-1.3 0-2.6 V9.5 M14.4 11 L16 9.2 L17.6 11"/>';
  const ICONS = {
    window_front_defrost: '<path d="M5 5.5 Q12 3.6 19 5.5 L21.6 19.5 Q12 17.6 2.4 19.5 Z"/>' + ARROWS,
    window_rear_defrost: '<rect x="2.6" y="4.6" width="18.8" height="15" rx="1.6"/>' + ARROWS,
  };

  const state = { window_front_defrost: null, window_rear_defrost: null };
  const icons = {};
  let mist = null;               // { mesh, root, canvas, ctx2d, texture, material }
  let noise = null;              // canvas with the condensation pattern
  let rafId = 0;
  let fan = null;                // { src, gain, ac } while the whoosh is playing
  let noiseBuffer = null;
  let initial = true;
  let pollTimer = null;

  // --- visibility of the telltales: first-person camera, after begin --------------
  function syncVisibility(ctx) {
    const h = ctx.handles();
    const fp = h && h.firstPerson;
    const show = !!h && (!fp || fp.value !== false);
    ctx.layer.style.visibility = show ? 'visible' : 'hidden';
    return h;
  }

  function watchCamera(ctx) {
    const tick = () => {
      const h = syncVisibility(ctx);
      if (!h) return;
      if (h.firstPerson && typeof h.firstPerson.addListener === 'function') {
        h.firstPerson.addListener(() => syncVisibility(ctx));
      }
      clearInterval(pollTimer);
      pollTimer = null;
    };
    pollTimer = setInterval(tick, 500);
    tick();
  }

  // --- fan whoosh: brown noise through a band-pass, WebAudio only -------------
  function audioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!CabinFeedback._audioCtx) CabinFeedback._audioCtx = new AC();
    const ac = CabinFeedback._audioCtx;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function fanVolume(snapshot) {
    const speed = Number(snapshot && snapshot.fan_speed) || 0;
    return Math.min(0.25, 0.12 + 0.025 * speed);
  }

  function startFan(volume) {
    stopFan();
    try {
      const ac = audioContext();
      if (!ac) return;
      if (!noiseBuffer) {
        noiseBuffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          data[i] = last * 3.5;
        }
      }
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 520;
      band.Q.value = 0.6;
      const gain = ac.createGain();
      const t0 = ac.currentTime;
      const end = t0 + CLEAR_MS / 1000;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 1.5);
      gain.gain.setValueAtTime(volume, end - 3);
      gain.gain.linearRampToValueAtTime(0.0001, end);
      src.connect(band).connect(gain).connect(ac.destination);
      src.start(t0);
      src.stop(end + 0.1);
      fan = { src, gain, ac };
      src.onended = () => { if (fan && fan.src === src) fan = null; };
    } catch (_e) { /* audio is best effort */ }
  }

  function stopFan() {
    if (!fan) return;
    try {
      const t = fan.ac.currentTime;
      fan.gain.gain.cancelScheduledValues(t);
      fan.gain.gain.setTargetAtTime(0.0001, t, 0.15);
      fan.src.stop(t + 0.6);
    } catch (_e) {}
    fan = null;
  }

  // --- condensation texture ---------------------------------------------------------
  // Smooth value noise, a few octaves, drawn once into a canvas: uneven,
  // cloudy droplets of mist. Deterministic so the pattern is the same each run.
  function makeNoise() {
    const c = document.createElement('canvas');
    c.width = TEX_W;
    c.height = TEX_H;
    const g = c.getContext('2d');
    const img = g.createImageData(TEX_W, TEX_H);
    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const smooth = (t) => t * t * (3 - 2 * t);
    const value = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = smooth(x - xi), yf = smooth(y - yi);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a + (b - a) * xf + (c2 - a) * yf + (a - b - c2 + d) * xf * yf;
    };
    for (let y = 0; y < TEX_H; y++) {
      for (let x = 0; x < TEX_W; x++) {
        let n = 0, amp = 0.5, f = 1 / 48;
        for (let o = 0; o < 4; o++) { n += amp * value(x * f, y * f); amp *= 0.5; f *= 2; }
        const i = (y * TEX_W + x) * 4;
        img.data[i] = 226; img.data[i + 1] = 231; img.data[i + 2] = 236;
        img.data[i + 3] = Math.round(255 * (0.55 + 0.38 * n));   // alpha ~0.55..0.93, never opaque
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Draw the mist with the clearing edge at `edge` (0 = bottom of the glass,
  // 1 = top). Below the edge the glass is clear; above it the mist fades in.
  function drawMist(edge) {
    const g = mist.ctx2d;
    g.globalCompositeOperation = 'copy';
    g.drawImage(noise, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    const grad = g.createLinearGradient(0, TEX_H, 0, 0);    // bottom -> top
    const feather = 0.25;
    const alphaAt = (v) => Math.min(1, Math.max(0, (v - edge) / feather));
    const stops = [0, edge, edge + feather, 1].filter((v) => v >= 0 && v <= 1).sort((m, n) => m - n);
    for (const v of stops) grad.addColorStop(v, `rgba(0,0,0,${alphaAt(v)})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.globalCompositeOperation = 'source-over';
    mist.texture.needsUpdate = true;
  }

  // --- the 3D mesh ----------------------------------------------------------------------
  // Point on a half-outline (center -> pillar) at lateral position z.
  function alongEdge(edge, z) {
    const az = Math.abs(z);
    for (let i = 1; i < edge.length; i++) {
      const p = edge[i - 1], q = edge[i];
      if (az <= q[2] || i === edge.length - 1) {
        const t = Math.min(1, (az - p[2]) / (q[2] - p[2]));
        return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, Math.sign(z) * az];
      }
    }
    return edge[0];
  }

  function buildGeometry(GeoCtor, AttrCtor) {
    const pos = [];
    const uv = [];
    const idx = [];
    const topZ = GLASS_TOP[GLASS_TOP.length - 1][2];
    const botZ = GLASS_BOTTOM[GLASS_BOTTOM.length - 1][2];
    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS;                        // 0 bottom, 1 top
      for (let c = 0; c <= COLS; c++) {
        const s = (c / COLS) * 2 - 1;            // -1 .. 1 across
        const top = alongEdge(GLASS_TOP, s * topZ);
        const bot = alongEdge(GLASS_BOTTOM, s * botZ);
        pos.push(
          bot[0] + (top[0] - bot[0]) * v - INSET,
          bot[1] + (top[1] - bot[1]) * v,
          bot[2] + (top[2] - bot[2]) * v,
        );
        uv.push(c / COLS, v);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c, b = a + 1, d = a + COLS + 1, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new GeoCtor();
    geo.setAttribute('position', new AttrCtor(new Float32Array(pos), 3));
    geo.setAttribute('uv', new AttrCtor(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function findCarMeshes(root) {
    let body = null, interior = null;
    if (root && typeof root.traverse === 'function') {
      root.traverse((o) => {
        if (!o || !o.isMesh) return;
        if (o.name === BODY_MESH) body = o;
        if (o.name === INTERIOR_MESH) interior = o;
      });
    }
    return body && interior && interior.parent ? { body, interior } : null;
  }

  // The outline was measured on this body; another vehicle model gets no mist.
  function bodyMatches(body) {
    const p = body.geometry && body.geometry.attributes && body.geometry.attributes.position;
    if (!p) return false;
    const [x, y, z] = GLASS_TOP[0];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i) - x) < 0.005 && Math.abs(p.getY(i) - y) < 0.005 && Math.abs(p.getZ(i) - z) < 0.005) return true;
    }
    return false;
  }

  // Redraw of the center screen (bezel first, then the display) after the
  // mist, as children of the originals so they follow them. Shown only while
  // the mist is. Re-checked on every activation: the console may be rebuilt on
  // vehicle changes.
  function ensureOverlays(root) {
    const found = [];
    root.traverse((o) => {
      if (!o || !o.isMesh || ABOVE_MIST.indexOf(o.name) < 0) return;
      let copy = o.children.find((c) => c.name === OVERLAY_NAME);
      if (!copy) {
        const material = o.material.clone();     // shares the screen's live texture
        material.transparent = true;
        copy = new o.constructor(o.geometry, material);
        copy.name = OVERLAY_NAME;
        copy.renderOrder = MIST_ORDER + 1 + ABOVE_MIST.indexOf(o.name);
        copy.frustumCulled = false;
        copy.visible = false;
        o.add(copy);
      }
      found.push(copy);
    });
    return found;
  }

  function setOverlays(visible) {
    if (!mist) return;
    for (const o of mist.overlays) o.visible = visible;
  }

  function removeMist() {
    if (!mist) return;
    try {
      if (mist.mesh.parent) mist.mesh.parent.remove(mist.mesh);
      mist.mesh.geometry.dispose();
      mist.material.dispose();
      mist.texture.dispose();
      for (const o of mist.overlays) {
        if (o.parent) o.parent.remove(o);
        o.material.dispose();
      }
    } catch (_e) {}
    mist = null;
  }

  // Create the mesh on first use, and again if a vehicle change rebuilt the car.
  function ensureMist(ctx) {
    const h = ctx.handles();
    const root = h && h.ego && h.ego.geo;
    if (!root) return false;
    if (mist && mist.root === root && mist.mesh.parent) {
      try { mist.overlays = ensureOverlays(root); } catch (_e) { mist.overlays = []; }
      return true;
    }
    removeMist();
    try {
      const car = findCarMeshes(root);
      if (!car || !bodyMatches(car.body)) return false;
      const bodyTex = car.body.material && car.body.material.map;
      if (!bodyTex) return false;
      if (!noise) noise = makeNoise();
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const texture = new bodyTex.constructor(canvas);
      texture.image = canvas;
      texture.generateMipmaps = false;
      if (h.THREE && h.THREE.LinearFilter !== undefined) {
        texture.minFilter = h.THREE.LinearFilter;
        texture.magFilter = h.THREE.LinearFilter;
      }
      // Same material class as the cabin (Phong), so the scene lights it.
      const material = new car.interior.material.constructor({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: 2,                                   // THREE.DoubleSide
        opacity: 0,
      });
      if (material.shininess !== undefined) material.shininess = 4;
      // A little light of its own: condensation scatters light, so it reads
      // pale against the scene instead of as a grey tint.
      if (material.emissive) material.emissive.setRGB(0.32, 0.34, 0.36);
      const geo = buildGeometry(car.body.geometry.constructor, car.body.geometry.attributes.position.constructor);
      const mesh = new car.interior.constructor(geo, material);
      mesh.name = 'feedback_defrost_mist';
      mesh.visible = false;
      mesh.renderOrder = MIST_ORDER;
      car.interior.parent.add(mesh);
      mist = { mesh, root, canvas, ctx2d: canvas.getContext('2d'), texture, material, overlays: [] };
      try { mist.overlays = ensureOverlays(root); } catch (_e) { /* the mist still works without it */ }
      return true;
    } catch (err) {
      ctx.log('could not build the mist mesh', err);
      removeMist();
      return false;
    }
  }

  // --- windshield animation ---------------------------------------------------------
  function stopAnimation() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function hideMist() {
    stopAnimation();
    if (mist) { mist.mesh.visible = false; mist.material.opacity = 0; setOverlays(false); }
  }

  function clearWindshield(ctx, snapshot) {
    startFan(fanVolume(snapshot));
    stopAnimation();
    if (!ensureMist(ctx)) return;
    const t0 = performance.now();
    mist.mesh.visible = true;
    setOverlays(true);
    const step = (now) => {
      const t = now - t0;
      const fadeIn = Math.min(1, t / FADE_IN_MS);
      const p = Math.min(1, Math.max(0, (t - FADE_IN_MS) / CLEAR_MS));
      const eased = p * p * (3 - 2 * p);
      mist.material.opacity = fadeIn;
      // Edge from just below the glass (soft bottom) to past the top.
      drawMist(-0.12 + eased * 1.4);
      if (p >= 1) { hideMist(); return; }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  // --- telltales --------------------------------------------------------------------
  function setIcon(key, on, animate) {
    const el = icons[key];
    el.style.transition = animate ? (on ? 'opacity 250ms ease' : 'opacity 700ms ease') : 'none';
    el.style.opacity = on ? '1' : '0';
  }

  CabinFeedback.register({
    id: 'defrost',
    title: 'Desempañador',
    fields: ['window_front_defrost', 'window_rear_defrost'],

    init(ctx) {
      initial = true;
      const tray = document.createElement('div');
      Object.assign(tray.style, {
        position: 'absolute', left: '2vw', bottom: '9vh', display: 'flex', gap: '1.2vh',
      });
      for (const key of Object.keys(ICONS)) {
        const el = document.createElement('div');
        el.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="' + AMBER +
          '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[key] + '</svg>';
        Object.assign(el.style, {
          width: '5vh', height: '5vh', opacity: '0',
          filter: 'drop-shadow(0 0 0.5vh rgba(245,166,35,0.65))',
        });
        tray.appendChild(el);
        icons[key] = el;
      }
      ctx.layer.appendChild(tray);
      watchCamera(ctx);
    },

    onChange(changed, snapshot, ctx) {
      for (const key of Object.keys(changed)) {
        if (!(key in state)) continue;
        const on = !!changed[key];
        const prev = state[key];
        state[key] = on;
        if (prev === on) continue;                // reset() re-sends unchanged values
        const animate = !initial && prev !== null;
        setIcon(key, on, animate);
        if (key === 'window_front_defrost') {
          if (on && animate) clearWindshield(ctx, snapshot);
          else if (!on) { hideMist(); stopFan(); }
        } else if (animate) {
          // Rear: relay click only, its glass is out of view.
          ctx.audio.tone({ freq: on ? 1100 : 800, freqEnd: on ? 800 : 550, ms: 60, type: 'triangle', volume: 0.1 });
        }
      }
      initial = false;
    },

    dispose() {
      if (pollTimer) clearInterval(pollTimer);
      stopAnimation();
      stopFan();
      removeMist();
    },
  });
})();
