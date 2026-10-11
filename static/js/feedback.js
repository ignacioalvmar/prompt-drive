/* Cabin feedback layer — built from src/feedback/ (4 feature file(s)) */
(function () {
/* --- CabinFeedback.js --- */
/**
 * CabinFeedback - in-cabin feedback layer for agent actions (Cabina Abierta).
 *
 * Problem it solves: the vehicle-state store (`window.VehicleState`, 31
 * CAR-bench fields) accepts every tool call an AI agent makes, but only a few
 * fields are projected onto something the driver can see or hear (low beams,
 * the Comfort app numbers). Everything else - windows, sunroof, reading lights,
 * ambient light, fog/high beams, defrost, trunk, air circulation, autonomy
 * handovers, and the agent's own listening/thinking/speaking states - changes
 * silently. This module is the seam where that feedback lives.
 *
 * Design: a tiny registry of *features*. Each feature is one file in
 * `src/feedback/features/` and registers itself with
 *
 *   CabinFeedback.register({
 *     id: 'reading_light',                       // unique, kebab/snake case
 *     title: 'Luz de lectura',
 *     fields: ['reading_light_driver', ...],     // VehicleState keys it reacts to
 *     init(ctx) {},                              // once, when the layer is ready
 *     onChange(changed, snapshot, ctx) {},       // after vehicle.set / reset touching `fields`
 *     onAgent(state, detail, ctx) {},            // optional: listening|thinking|speaking|idle|confirm|error
 *     dispose() {},                              // optional
 *   });
 *
 * `ctx` gives each feature: `ctx.layer` (its own full-screen, pointer-events:none
 * <div> above the sim canvas), `ctx.audio` (play a file or a synthesized tone),
 * `ctx.snapshot()` (current VehicleState), `ctx.handles()` (live engine handles
 * from PromptDriveBridge: THREE, camera, ego, audioManager, centerConsole, …
 * - null before the sim starts), and `ctx.config` (vehicle side, units).
 *
 * Load order (index.html): after vehicle.js and api.js, before the main bundle.
 * Exposes `window.CabinFeedback` and `window.PromptDrive.feedback` (so the
 * postMessage / BroadcastChannel transports can call `feedback.agent(...)`).
 *
 * Rules every feature must respect (see CONTRIBUTING.md):
 *  - never write to VehicleState from a feature (feedback renders state; it does
 *    not change it - benchmark mode must stay literal);
 *  - never edit built bundles; keep everything inside src/feedback/;
 *  - be defensive: the engine may not be running yet (ctx.handles() === null).
 */

const CabinFeedback = {
  version: '1.0.0',
  _features: [],
  _ready: false,
  _root: null,
  _enabled: true,
  _audioCtx: null,
  _agentState: { state: 'idle', detail: null, at: 0 },

  // --- registration ----------------------------------------------------------
  register(feature) {
    if (!feature || typeof feature.id !== 'string' || !feature.id) {
      console.warn('[CabinFeedback] register: feature needs an id'); return null;
    }
    if (this._features.some((f) => f.id === feature.id)) {
      console.warn('[CabinFeedback] duplicate feature id', feature.id); return null;
    }
    const entry = { feature, ctx: null, inited: false };
    this._features.push(entry);
    if (this._ready) this._initOne(entry);
    return entry;
  },

  list() {
    return this._features.map((e) => ({ id: e.feature.id, title: e.feature.title || e.feature.id,
      fields: e.feature.fields || [], inited: e.inited }));
  },

  enable(on) {
    this._enabled = on !== false;
    if (this._root) this._root.style.display = this._enabled ? '' : 'none';
    try { localStorage.setItem('cabin-feedback-enabled', this._enabled ? '1' : '0'); } catch (_e) {}
    return this._enabled;
  },

  // --- DOM layer ------------------------------------------------------------
  root() {
    if (this._root && document.body.contains(this._root)) return this._root;
    const el = document.createElement('div');
    el.id = 'cabin-feedback';
    Object.assign(el.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '900', overflow: 'hidden',
    });
    document.body.appendChild(el);
    this._root = el;
    if (!this._enabled) el.style.display = 'none';
    return el;
  },

  layer(id) {
    const root = this.root();
    let el = root.querySelector(`[data-feature="${id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.feature = id;
      Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      root.appendChild(el);
    }
    return el;
  },

  // --- audio ---------------------------------------------------------------
  audio: {
    /** Play an audio file (mp3/wav/ogg). Returns the HTMLAudioElement or null. */
    play(url, opts) {
      try {
        const a = new Audio(url);
        a.volume = Math.max(0, Math.min(1, (opts && opts.volume != null) ? opts.volume : 0.6));
        if (opts && opts.loop) a.loop = true;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked until first gesture */ });
        return a;
      } catch (_e) { return null; }
    },
    /** Synthesized tone: { freq=880, ms=120, type='sine', volume=0.2, freqEnd } */
    tone(opts) {
      opts = opts || {};
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!CabinFeedback._audioCtx) CabinFeedback._audioCtx = new AC();
        const ctx = CabinFeedback._audioCtx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime;
        const ms = opts.ms || 120;
        osc.type = opts.type || 'sine';
        osc.frequency.setValueAtTime(opts.freq || 880, t0);
        if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + ms / 1000);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(opts.volume || 0.2, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + ms / 1000 + 0.02);
      } catch (_e) { /* audio is best effort */ }
    },
    /** Speak a short Spanish line with the browser's TTS (demo/debug aid). */
    say(text, opts) {
      try {
        if (!('speechSynthesis' in window)) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = (opts && opts.lang) || 'es-CO';
        u.rate = (opts && opts.rate) || 1.0;
        window.speechSynthesis.speak(u);
      } catch (_e) {}
    },
  },

  // --- agent interaction states ----------------------------------------------
  /**
   * Report what the voice agent is doing so features can render it.
   * state: 'listening' | 'thinking' | 'speaking' | 'idle' | 'confirm' | 'error' | 'action'
   * detail: free object, e.g. { text: 'Listo, 22 grados.' } or { tool: 'set_window_defrost' }
   */
  agent(state, detail) {
    this._agentState = { state: String(state || 'idle'), detail: detail || null, at: Date.now() };
    for (const e of this._features.slice()) {
      if (!e.inited || typeof e.feature.onAgent !== 'function') continue;
      try { e.feature.onAgent(this._agentState.state, this._agentState.detail, e.ctx); }
      catch (err) { console.warn('[CabinFeedback] onAgent failed in', e.feature.id, err); }
    }
    const b = window.PromptDriveBridge;
    if (b && typeof b.emit === 'function') { try { b.emit('agentState', this._agentState); } catch (_e) {} }
    return { ok: true, value: this._agentState };
  },

  agentState() { return this._agentState; },

  // --- internals -------------------------------------------------------------
  _snapshot() {
    const VS = window.VehicleState;
    try { return VS && typeof VS.get === 'function' ? VS.get() : {}; } catch (_e) { return {}; }
  },

  _handles() {
    const b = window.PromptDriveBridge;
    return (b && b.handles) || null;
  },

  _config() {
    const pd = window.PromptDrive;
    const out = { side: 'left', units: 'kmh' };
    try {
      if (pd && typeof pd.get === 'function') {
        const side = pd.get('vehicle.side');          // 0 right, 1 left (driver seat position)
        if (side === 0 || side === '0') out.side = 'right';
        const units = pd.get('units');
        if (units != null) out.units = units;
      }
    } catch (_e) {}
    return out;
  },

  _makeCtx(feature) {
    const self = this;
    return {
      layer: this.layer(feature.id),
      audio: this.audio,
      snapshot: () => self._snapshot(),
      handles: () => self._handles(),
      config: this._config(),
      agentState: () => self._agentState,
      log: (...args) => console.log(`[feedback:${feature.id}]`, ...args),
    };
  },

  _initOne(entry) {
    if (entry.inited) return;
    entry.ctx = this._makeCtx(entry.feature);
    try {
      if (typeof entry.feature.init === 'function') entry.feature.init(entry.ctx);
      entry.inited = true;
      // Render the current state once so a page reload shows the right picture.
      const snap = this._snapshot();
      const fields = entry.feature.fields || [];
      if (fields.length && typeof entry.feature.onChange === 'function') {
        const changed = {};
        for (const k of fields) if (k in snap) changed[k] = snap[k];
        entry.feature.onChange(changed, snap, entry.ctx);
      }
    } catch (err) {
      console.warn('[CabinFeedback] init failed in', entry.feature.id, err);
    }
  },

  _dispatch(keys, snap) {
    if (!keys || !keys.length) return;
    for (const e of this._features.slice()) {
      if (!e.inited || typeof e.feature.onChange !== 'function') continue;
      const fields = e.feature.fields || [];
      const hit = fields.length ? keys.filter((k) => fields.indexOf(k) >= 0) : keys.slice();
      if (!hit.length) continue;
      const changed = {};
      for (const k of hit) changed[k] = snap[k];
      try { e.feature.onChange(changed, snap, e.ctx); }
      catch (err) { console.warn('[CabinFeedback] onChange failed in', e.feature.id, err); }
    }
  },

  _boot() {
    if (this._ready) return;
    try { if (localStorage.getItem('cabin-feedback-enabled') === '0') this._enabled = false; } catch (_e) {}
    this.root();
    this._ready = true;
    for (const e of this._features.slice()) this._initOne(e);

    // VehicleState projector: fires after every set() with the changed keys and
    // after every reset() with all dynamic keys.
    const VS = window.VehicleState;
    if (VS && typeof VS.registerProjector === 'function') {
      VS.registerProjector((keys, snap) => this._dispatch(keys, snap));
    } else {
      console.warn('[CabinFeedback] VehicleState not found; load feedback.js after vehicle.js');
    }

    // Facade for the transports: PromptDrive.feedback.agent(...) / list() / enable()
    const pd = window.PromptDrive;
    if (pd && !pd.feedback) {
      pd.feedback = {
        agent: (state, detail) => this.agent(state, detail),
        state: () => ({ ok: true, value: this._agentState }),
        list: () => ({ ok: true, value: this.list() }),
        enable: (on) => ({ ok: true, value: this.enable(on) }),
      };
    }
  },
};

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CabinFeedback._boot());
  } else {
    CabinFeedback._boot();
  }
}


/* --- features/agent_indicator.js --- */
/**
 * Example feature: agent state indicator (indicador del asistente), drawn
 * across the full width of the center console's status strip. No text:
 * every state is a distinct color plus a distinct full-width motion, so it
 * reads at a glance even on the lowest render-scale setting.
 *
 *   off / idle   dark band, a faint short line in the middle (the system is there, nothing happening)
 *   listening    cyan: symmetric level bars across the whole width, breathing from the center outward
 *   thinking     amber: a light sweeping left to right and back
 *   speaking     white: fast, dense level bars across the whole width
 *   confirm      amber: the whole band blinks at about 1 Hz
 *   action       green: full-width flash with a thick check mark, fades in ~1.5 s
 *   error        red: full-width flash with a thick cross, fades in ~2 s
 *
 * The console reserves the strip through CenterConsole.registerOverlay
 * (see src/console/CenterConsole.js). Driven by CabinFeedback.agent(state,
 * detail), which WorlDrive or the demo harness call over the API as
 * `feedback.agent`. Needs the console to be visible (vehicle.showConsole).
 * Demonstrates onAgent() and the console overlay seam.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const STRIP_H = 64;
  const C = {
    bg: '#0b0d10', dim: 'rgba(188,193,200,0.18)', line: 'rgba(255,255,255,0.08)',
    cyan: '#40E0D0', white: '#f4f6f8', amber: '#f5a623', green: '#3ddc84', red: '#e5484d',
  };
  const HOLD_MS = { action: 1500, error: 2000, speaking: 6000 };

  let state = 'idle';
  let since = 0;
  let hideTimer = null;
  let unregister = null;
  let pollTimer = null;

  function consoleInstance(ctx) {
    const h = ctx.handles();
    if (h && h.centerConsole) return h.centerConsole;
    const K = window.CenterConsole;
    return (K && K.lastInstance) || null;
  }

  // Deterministic pseudo-random per bar so the pattern is lively but stable.
  function noise(i, t) {
    return 0.5 + 0.5 * Math.sin(i * 1.7 + t * 2.3) * Math.sin(i * 0.9 - t * 1.1);
  }

  function bars(ctx, rect, color, t, opts) {
    const n = opts.count, gap = 6;
    const bw = (rect.w - gap * (n + 1)) / n;
    const mid = rect.y + rect.h / 2;
    const maxH = rect.h - 16;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const centered = 1 - Math.abs((i - (n - 1) / 2) / ((n - 1) / 2)); // 1 at center, 0 at edges
      let amp;
      if (opts.mode === 'breathe') {
        // Slow swell from the center outward, like an open microphone.
        const phase = t * 2 * Math.PI / 1.8 - (1 - centered) * 1.6;
        amp = 0.25 + 0.75 * Math.max(0, Math.sin(phase)) * (0.35 + 0.65 * centered);
      } else {
        // Fast chatter, denser and brighter in the middle, like speech.
        amp = 0.15 + 0.85 * noise(i, t * 6) * (0.4 + 0.6 * centered);
      }
      const h = Math.max(4, maxH * amp);
      const x = rect.x + gap + i * (bw + gap);
      ctx.fillRect(x, mid - h / 2, bw, h);
    }
  }

  function draw(ctx, rect, now) {
    const t = (now - since) / 1000;
    ctx.fillStyle = C.bg;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const mid = rect.y + rect.h / 2;
    const cx = rect.x + rect.w / 2;

    if (state === 'listening') {
      bars(ctx, rect, C.cyan, t, { count: 40, mode: 'breathe' });
    } else if (state === 'speaking') {
      bars(ctx, rect, C.white, t, { count: 56, mode: 'chatter' });
    } else if (state === 'thinking') {
      // Scanner: a bright amber head with a fading tail, sweeping left-right-left.
      const period = 1.6;
      const u = (t % period) / period;
      const pos = u < 0.5 ? u * 2 : 2 - u * 2;              // 0..1..0
      const dir = u < 0.5 ? 1 : -1;
      const headX = rect.x + 24 + pos * (rect.w - 48);
      const tail = 220;
      const grad = ctx.createLinearGradient(headX - dir * tail, 0, headX, 0);
      grad.addColorStop(0, 'rgba(245,166,35,0)');
      grad.addColorStop(1, C.amber);
      ctx.fillStyle = grad;
      ctx.fillRect(Math.min(headX, headX - dir * tail), mid - 10, tail, 20);
      ctx.fillStyle = C.amber;
      ctx.fillRect(headX - 8, mid - 16, 16, 32);
    } else if (state === 'confirm') {
      // Whole band blinking amber at ~1 Hz, never fully off so it reads as "waiting".
      const on = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI));
      ctx.globalAlpha = on;
      ctx.fillStyle = C.amber;
      ctx.fillRect(rect.x, rect.y + 8, rect.w, rect.h - 16);
      ctx.globalAlpha = 1;
    } else if (state === 'action' || state === 'error') {
      const hold = HOLD_MS[state] / 1000;
      const fade = Math.max(0, 1 - Math.max(0, t - hold * 0.45) / (hold * 0.55));
      const color = state === 'action' ? C.green : C.red;
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y + 8, rect.w, rect.h - 16);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (state === 'action') {
        ctx.moveTo(cx - 24, mid); ctx.lineTo(cx - 6, mid + 14); ctx.lineTo(cx + 26, mid - 16);
      } else {
        ctx.moveTo(cx - 16, mid - 16); ctx.lineTo(cx + 16, mid + 16);
        ctx.moveTo(cx + 16, mid - 16); ctx.lineTo(cx - 16, mid + 16);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // Off / idle: a faint short line in the middle.
      ctx.fillStyle = C.dim;
      ctx.fillRect(cx - 40, mid - 2, 80, 4);
    }

    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.h - 0.5);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h - 0.5);
    ctx.stroke();
  }

  function attach(ctx) {
    const inst = consoleInstance(ctx);
    if (!inst || typeof inst.registerOverlay !== 'function') return false;
    unregister = inst.registerOverlay({ id: 'agent_indicator', height: STRIP_H, draw: (c, rect, now) => draw(c, rect, now) });
    return true;
  }

  CabinFeedback.register({
    id: 'agent_indicator',
    title: 'Indicador del asistente (consola)',
    fields: [],

    init(ctx) {
      since = performance.now();
      // The console instance exists only once the sim has started; keep
      // trying until it appears (and re-attach if a vehicle change recreates it).
      const tick = () => {
        const inst = consoleInstance(ctx);
        if (inst && (!unregister || (inst._overlays && !inst._overlays.some((o) => o.id === 'agent_indicator')))) attach(ctx);
      };
      tick();
      pollTimer = setInterval(tick, 1000);
    },

    onAgent(newState, _detail, ctx) {
      state = newState || 'idle';
      since = performance.now();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (HOLD_MS[state]) hideTimer = setTimeout(() => { state = 'idle'; since = performance.now(); }, HOLD_MS[state]);
      if (state === 'listening') ctx.audio.tone({ freq: 660, freqEnd: 990, ms: 140, volume: 0.1 });
      if (state === 'action') ctx.audio.tone({ freq: 1200, ms: 70, volume: 0.08 });
      if (state === 'error') ctx.audio.tone({ freq: 300, freqEnd: 180, ms: 220, type: 'square', volume: 0.08 });
      const inst = consoleInstance(ctx);
      if (inst && typeof inst._requestDraw === 'function') inst._requestDraw();
    },

    dispose() {
      if (pollTimer) clearInterval(pollTimer);
      if (unregister) unregister();
    },
  });
})();


/* --- features/ambient_light.js --- */
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


/* --- features/defrost.js --- */
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


/* --- features/reading_light.js --- */
/**
 * Example feature: reading lights (luz de lectura).
 *
 * Fields: reading_light_driver, reading_light_passenger,
 *         reading_light_driver_rear, reading_light_passenger_rear
 *
 * What the driver perceives: a warm glow fading in from the top corner of the
 * cabin on the side of the seat whose light is on (front seats at the top
 * edge, rear seats a little lower and dimmer because they are behind the
 * driver), plus a soft click when a light toggles. Nothing in the 3D scene is
 * touched: this is a DOM layer over the canvas, which keeps it safe in
 * benchmark mode and independent of the engine's render loop.
 *
 * This file is the template to copy for a new feature: one id, the fields it
 * listens to, init() to build the DOM once, onChange() to render the state.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const SEATS = [
    { key: 'reading_light_driver',          side: 'driver',    row: 'front' },
    { key: 'reading_light_passenger',       side: 'passenger', row: 'front' },
    { key: 'reading_light_driver_rear',     side: 'driver',    row: 'rear' },
    { key: 'reading_light_passenger_rear',  side: 'passenger', row: 'rear' },
  ];

  const glows = {};

  function sideToX(side, config) {
    // Driver sits left in a left-hand-drive car (config.side === 'left').
    const driverLeft = config.side !== 'right';
    return (side === 'driver') === driverLeft ? 'left' : 'right';
  }

  CabinFeedback.register({
    id: 'reading_light',
    title: 'Luz de lectura',
    fields: SEATS.map((s) => s.key),

    init(ctx) {
      for (const seat of SEATS) {
        const el = document.createElement('div');
        const x = sideToX(seat.side, ctx.config);
        const front = seat.row === 'front';
        Object.assign(el.style, {
          position: 'absolute',
          top: front ? '-12vh' : '8vh',
          [x]: front ? '-8vw' : '-14vw',
          width: front ? '38vw' : '28vw',
          height: front ? '38vh' : '26vh',
          borderRadius: '50%',
          background: front
            ? 'radial-gradient(closest-side, rgba(255, 214, 150, 0.75), rgba(255, 214, 150, 0.0))'
            : 'radial-gradient(closest-side, rgba(255, 214, 150, 0.4), rgba(255, 214, 150, 0.0))',
          opacity: '0',
          transition: 'opacity 350ms ease',
          willChange: 'opacity',
        });
        ctx.layer.appendChild(el);
        glows[seat.key] = el;
      }
    },

    onChange(changed, snapshot, ctx) {
      for (const key of Object.keys(changed)) {
        const el = glows[key];
        if (!el) continue;
        const on = !!changed[key];
        const wasOn = el.style.opacity === '1';
        el.style.opacity = on ? '1' : '0';
        if (on !== wasOn) {
          // Mechanical click: a short, high, quickly decaying tone.
          ctx.audio.tone({ freq: on ? 1400 : 900, freqEnd: on ? 900 : 600, ms: 60, type: 'triangle', volume: 0.12 });
        }
      }
    },
  });
})();

  if (typeof window !== 'undefined') {
    window.CabinFeedback = CabinFeedback;
  }
})();
