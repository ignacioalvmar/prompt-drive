/**
 * Feature: ambient light (luz ambiental).
 *
 * Field: ambient_light  (OFF, RED, GREEN, BLUE, YELLOW, WHITE, PINK, ORANGE,
 *                        PURPLE, CYAN)
 *
 * What the driver perceives: a thin LED line across the face of the
 * dashboard, like the ambient strips of current production cars. It is part
 * of the 3D model, so it stays on the dashboard from any camera, seat side,
 * distance or FOV, and the steering wheel and the instrument cluster hide it
 * where they stand in front of it.
 *  - On a change: the line cross-fades to the new color in 600 ms and a soft
 *    bloom swells around it for ~2 s, easy to catch with peripheral vision
 *    while looking at the road; then only the thin line stays.
 *  - OFF: the line fades out.
 *  - Initial state (onChange after init / reset / reload): current color, no
 *    bloom, no transition.
 *  - No sound: the assistant already confirms by voice, and the light is the
 *    confirmation itself.
 *
 * Implementation: three ribbons that follow the dashboard face (core line,
 * narrow halo, wide bloom), unlit (MeshBasicMaterial) so the LED glows the
 * same by day and by night, added next to the cabin meshes. They are created
 * lazily (ctx.handles() is null until the sim starts) and re-attached if a
 * vehicle change rebuilds the car. A requestAnimationFrame loop runs only
 * during a transition and stops when it ends.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const COLORS = {
    RED: [255, 59, 48],
    GREEN: [52, 199, 89],
    BLUE: [47, 107, 255],
    YELLOW: [255, 214, 10],
    WHITE: [236, 240, 255],
    PINK: [255, 95, 162],
    ORANGE: [255, 140, 26],
    PURPLE: [155, 92, 255],
    CYAN: [50, 224, 224],
  };
  const COLOR_MS = 600;         // cross-fade between colors
  const ON_MS = 500;            // fade in from OFF
  const OFF_MS = 800;           // fade out to OFF
  const BLOOM_UP_MS = 350;      // bloom swell, hold and decay on a change
  const BLOOM_HOLD_MS = 1500;
  const BLOOM_DOWN_MS = 1200;

  const INTERIOR_MESH = 'z_interior_Cube.008';

  // Dashboard face in the car frame (x forward, y up, z across; symmetric in
  // z), measured from the interior mesh: its top edge under the windshield and
  // its bottom edge above the knees, from the center line out to the doors.
  const FACE_TOP = [[1.924, 0.867, 0], [1.924, 0.867, 0.191], [1.929, 0.867, 0.442], [1.953, 0.864, 0.672]];
  const FACE_BOTTOM = [[1.805, 0.688, 0], [1.805, 0.688, 0.105], [1.825, 0.688, 0.629]];
  const LINE_AT = 0.22;         // position on the face, 0 = top edge, 1 = bottom edge
  const HALF_SPAN = 0.62;       // m each side of the center line
  const LIFT = 0.004;           // m off the surface, toward the cabin
  const SEGMENTS = 48;

  // Ribbons: height across the line (m), opacity scale. Drawn core last.
  const RIBBONS = {
    bloom: { height: 0.07, alpha: 0.65, order: 4 },
    halo: { height: 0.024, alpha: 1, order: 5 },
    core: { height: 0.0055, alpha: 1, order: 6 },
  };

  let strip = null;             // { root, meshes: {bloom, halo, core}, materials: {...} }
  let current = null;           // last ambient_light value seen
  let initial = true;
  let pollTimer = null;
  let rafId = 0;
  // Rendered state, so a transition starts from what is on screen.
  const shown = { rgb: [1, 1, 1], level: 0, bloom: 0 };

  // --- geometry ---------------------------------------------------------------------
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

  // A ribbon on the dashboard face, centered on the line, `height` m tall.
  // UVs: u along the line (0..1), v across it (0 bottom .. 1 top).
  function buildRibbon(GeoCtor, AttrCtor, height) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const z = -HALF_SPAN + (2 * HALF_SPAN * i) / SEGMENTS;
      const top = alongEdge(FACE_TOP, z);
      const bot = alongEdge(FACE_BOTTOM, z);
      // Direction down the face, normalized, to step across the line.
      const d = [bot[0] - top[0], bot[1] - top[1], bot[2] - top[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const c = [top[0] + d[0] * LINE_AT, top[1] + d[1] * LINE_AT, top[2] + d[2] * LINE_AT];
      for (const side of [1, -1]) {             // upper edge, lower edge
        const k = (-side * height) / 2 / len;
        pos.push(c[0] + d[0] * k - LIFT, c[1] + d[1] * k, c[2] + d[2] * k);
        uv.push(i / SEGMENTS, side > 0 ? 1 : 0);
      }
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new GeoCtor();
    geo.setAttribute('position', new AttrCtor(new Float32Array(pos), 3));
    geo.setAttribute('uv', new AttrCtor(new Float32Array(uv), 2));
    geo.setIndex(idx);
    return geo;
  }

  // White alpha texture: soft profile across the line, fading at both ends.
  function ribbonTexture(TexCtor, falloff) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const g = c.getContext('2d');
    const across = g.createLinearGradient(0, 0, 0, c.height);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5 - falloff, 'rgba(255,255,255,0.35)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(0.5 + falloff, 'rgba(255,255,255,0.35)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    const along = g.createLinearGradient(0, 0, c.width, 0);
    along.addColorStop(0, 'rgba(0,0,0,0)');
    along.addColorStop(0.06, 'rgba(0,0,0,1)');
    along.addColorStop(0.94, 'rgba(0,0,0,1)');
    along.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = along;
    g.fillRect(0, 0, c.width, c.height);
    const tex = new TexCtor(c);
    tex.image = c;
    tex.needsUpdate = true;
    return tex;
  }

  function findInterior(root) {
    let interior = null;
    root.traverse((o) => { if (o && o.isMesh && o.name === INTERIOR_MESH) interior = o; });
    return interior && interior.parent ? interior : null;
  }

  // The face was measured on this interior; another vehicle model gets no strip.
  function interiorMatches(interior) {
    const p = interior.geometry && interior.geometry.attributes && interior.geometry.attributes.position;
    if (!p) return false;
    const [x, y, z] = FACE_TOP[1];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i) - x) < 0.005 && Math.abs(p.getY(i) - y) < 0.005 && Math.abs(p.getZ(i) - z) < 0.005) return true;
    }
    return false;
  }

  function removeStrip() {
    if (!strip) return;
    try {
      for (const key of Object.keys(strip.meshes)) {
        const m = strip.meshes[key];
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        if (m.material.map) m.material.map.dispose();
        m.material.dispose();
      }
    } catch (_e) {}
    strip = null;
  }

  // Build the strip on first use, and again if a vehicle change rebuilt the car.
  function ensureStrip(ctx) {
    const h = ctx.handles();
    const root = h && h.ego && h.ego.geo;
    if (!root || !h.THREE) return false;
    if (strip && strip.root === root && strip.meshes.core.parent) return true;
    removeStrip();
    try {
      const interior = findInterior(root);
      if (!interior || !interiorMatches(interior)) return false;
      const T = h.THREE;
      const BasicMaterial = T.MeshBasicMaterial || T.C;
      let bodyTex = null;
      root.traverse((o) => { if (!bodyTex && o.isMesh && o.material && o.material.map) bodyTex = o.material.map; });
      if (!BasicMaterial || !bodyTex) return false;
      const GeoCtor = interior.geometry.constructor;
      const AttrCtor = interior.geometry.attributes.position.constructor;
      const meshes = {};
      for (const key of Object.keys(RIBBONS)) {
        const spec = RIBBONS[key];
        const material = new BasicMaterial({
          map: ribbonTexture(bodyTex.constructor, key === 'core' ? 0.2 : 0.12),
          transparent: true,
          depthWrite: false,
          side: 2,                                 // THREE.DoubleSide
          toneMapped: false,
          opacity: 0,
        });
        const mesh = new interior.constructor(buildRibbon(GeoCtor, AttrCtor, spec.height), material);
        mesh.name = 'feedback_ambient_' + key;
        mesh.renderOrder = spec.order;
        mesh.visible = false;
        interior.parent.add(mesh);
        meshes[key] = mesh;
      }
      strip = { root, meshes };
      apply();
      return true;
    } catch (err) {
      ctx.log('could not build the ambient strip', err);
      removeStrip();
      return false;
    }
  }

  // --- rendering --------------------------------------------------------------------
  function apply() {
    if (!strip) return;
    const [r, g, b] = shown.rgb;
    for (const key of Object.keys(strip.meshes)) {
      const m = strip.meshes[key];
      const a = RIBBONS[key].alpha * shown.level * (key === 'bloom' ? shown.bloom : 1);
      m.material.color.setRGB(r, g, b);
      m.material.opacity = a;
      m.visible = a > 0.001;
    }
  }

  function stopAnimation() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  const ease = (t) => t * t * (3 - 2 * t);

  function render(value, animate) {
    stopAnimation();
    const rgb = COLORS[value] ? COLORS[value].map((n) => n / 255) : null;   // null = OFF
    if (!animate) {
      if (rgb) shown.rgb = rgb;
      shown.level = rgb ? 1 : 0;
      shown.bloom = 0;
      apply();
      return;
    }
    const from = { rgb: shown.rgb.slice(), level: shown.level, bloom: shown.bloom };
    // From OFF there is nothing to cross-fade: start from the new color.
    if (rgb && from.level < 0.01) from.rgb = rgb;
    const toRgb = rgb || from.rgb;
    const toLevel = rgb ? 1 : 0;
    const levelMs = rgb ? ON_MS : OFF_MS;
    const total = rgb ? BLOOM_UP_MS + BLOOM_HOLD_MS + BLOOM_DOWN_MS : OFF_MS;
    const t0 = performance.now();
    const step = (now) => {
      const t = now - t0;
      const k = ease(Math.min(1, t / COLOR_MS));
      shown.rgb = from.rgb.map((c, i) => c + (toRgb[i] - c) * k);
      shown.level = from.level + (toLevel - from.level) * ease(Math.min(1, t / levelMs));
      if (rgb) {
        if (t < BLOOM_UP_MS) shown.bloom = Math.max(from.bloom, t / BLOOM_UP_MS);
        else if (t < BLOOM_UP_MS + BLOOM_HOLD_MS) shown.bloom = 1;
        else shown.bloom = Math.max(0, 1 - (t - BLOOM_UP_MS - BLOOM_HOLD_MS) / BLOOM_DOWN_MS);
      } else {
        shown.bloom = from.bloom * (1 - Math.min(1, t / OFF_MS));
      }
      apply();
      if (t < total) rafId = requestAnimationFrame(step);
      else rafId = 0;
    };
    rafId = requestAnimationFrame(step);
  }

  CabinFeedback.register({
    id: 'ambient_light',
    title: 'Luz ambiental',
    fields: ['ambient_light'],

    init(ctx) {
      initial = true;
      // The car exists only after begin, and a vehicle change rebuilds it: keep
      // the strip attached (cheap check, once per second).
      pollTimer = setInterval(() => ensureStrip(ctx), 1000);
    },

    onChange(changed, _snapshot, ctx) {
      if (!('ambient_light' in changed)) return;
      const value = String(changed.ambient_light || 'OFF').toUpperCase();
      const prev = current;
      current = value;
      if (prev === value) return;                 // reset() re-sends unchanged values
      const animate = !initial && prev !== null;
      initial = false;
      ensureStrip(ctx);
      render(value, animate && !!strip);
    },

    dispose() {
      if (pollTimer) clearInterval(pollTimer);
      stopAnimation();
      removeStrip();
    },
  });
})();
