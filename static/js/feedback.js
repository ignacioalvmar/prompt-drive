/* Cabin feedback layer — built from src/feedback/ (3 feature file(s)) */
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

    // Facade for the transports: PromptDrive.feedback.agent(...) / state() / list() / enable() / enabled()
    const pd = window.PromptDrive;
    if (pd && !pd.feedback) {
      pd.feedback = {
        agent: (state, detail) => this.agent(state, detail),
        state: () => ({ ok: true, value: this._agentState }),
        list: () => ({ ok: true, value: this.list() }),
        enable: (on) => ({ ok: true, value: this.enable(on) }),
        enabled: () => ({ ok: true, value: this._enabled }),
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


/* --- features/ivi_request.js --- */
/**
 * IVI request cards: when an agent changes an in-vehicle function through the
 * API, a short-lived card on the center console says what changed
 * ("Temp · Driver  20 → 22 °C"), then fades out. When the change belongs to a
 * console app (Comfort, Audio, Nav), that app is put in the 1/3 pane of the
 * split view as the card disappears, so the function stays visible without
 * displacing what the driver had open (e.g. navigation keeps the 2/3 pane).
 *
 * Sources (API only; driver taps and reads never produce a card):
 *   vehicleState  — PromptDrive.vehicle.set (CAR-bench store); diffed against
 *                   the last snapshot this feature saw. vehicle.reset is task
 *                   initialisation, not a request, so it only re-baselines.
 *   iviRequest    — PromptDrive.console.audio.* / console.comfort.* mutators,
 *                   emitted by the API with before/after app state.
 * Phone calls are left out: the Phone app already brings itself up on ring/call.
 *
 * Requests that arrive within MERGE_MS of each other merge into one card (an
 * agent turn often fires several tool calls in a row). Failed requests never
 * reach here (the API only emits on success). Drawn over the app panes through
 * CenterConsole.registerOverlay({ layer: 'content' }), so nothing is reflowed.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const MERGE_MS = 750;   // gap that still counts as the same burst
  const HOLD_MS = 4000;   // card stays this long after the last request
  const FADE_MS = 250;
  const MAX_LINES = 4;    // more changes collapse into "+N more"
  const C = {
    card: 'rgba(20,23,28,0.96)', edge: 'rgba(64,224,208,0.55)', text: '#f4f6f8',
    muted: 'rgba(188,193,200,0.85)', faint: 'rgba(188,193,200,0.45)', accent: '#40E0D0',
  };
  const FONT = "'ShareTech', 'Share Tech', system-ui, sans-serif";

  // --- vehicle-state field presentation --------------------------------------
  const SIDE = { driver: 'Driver', passenger: 'Passenger', driver_rear: 'Rear left', passenger_rear: 'Rear right' };
  const pct = (v) => `${v}%`;
  const onOff = (v) => (v ? 'On' : 'Off');
  const level = (v) => (v ? `${v}/3` : 'Off');
  const words = (v) => String(v).toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' + ');
  const FIELDS = {
    sunroof_position: { label: 'Sunroof', fmt: pct },
    sunshade_position: { label: 'Sunshade', fmt: pct },
    trunk_door_position: { label: 'Trunk', fmt: (v) => words(v) },
    fog_lights: { label: 'Fog lights', fmt: onOff },
    head_lights_low_beams: { label: 'Low beams', fmt: onOff },
    head_lights_high_beams: { label: 'High beams', fmt: onOff },
    ambient_light: { label: 'Ambient light', fmt: words },
    steering_wheel_heating: { label: 'Wheel heating', fmt: level },
    fan_speed: { label: 'Fan', fmt: (v) => (v ? String(v) : 'Off'), app: 'comfort' },
    window_front_defrost: { label: 'Front defrost', fmt: onOff },
    window_rear_defrost: { label: 'Rear defrost', fmt: onOff },
    fan_airflow_direction: { label: 'Airflow', fmt: words },
    air_conditioning: { label: 'A/C', fmt: onOff },
    air_circulation: { label: 'Air circulation', fmt: (v) => ({ AUTO: 'Auto', FRESH_AIR: 'Fresh air', RECIRCULATION: 'Recirculation' }[v] || words(v)) },
    navigation_active: { label: 'Navigation', fmt: onOff, app: 'nav' },
    waypoints_id: { label: 'Waypoints', fmt: () => 'Updated', app: 'nav', noDelta: true },
    routes_to_final_destination_id: { label: 'Route', fmt: () => 'Updated', app: 'nav', noDelta: true },
    // email_addresses_sent_mail_to / phone_numbers_called are call logs, not functions: no card.
  };
  for (const s of ['driver', 'passenger', 'driver_rear', 'passenger_rear']) {
    FIELDS[`window_${s}_position`] = { label: `Window · ${SIDE[s]}`, fmt: pct };
    FIELDS[`reading_light_${s}`] = { label: `Reading light · ${SIDE[s]}`, fmt: onOff };
  }
  for (const s of ['driver', 'passenger']) {
    FIELDS[`climate_temperature_${s}`] = { label: `Temp · ${SIDE[s]}`, fmt: (v) => `${v} °C`, app: 'comfort' };
    FIELDS[`seat_heating_${s}`] = { label: `Seat heat · ${SIDE[s]}`, fmt: level, app: 'comfort' };
  }

  // --- state -------------------------------------------------------------------
  let card = null;        // { lines: Map key -> { label, from, to }, app, shownAt, lastAt, hideAt }
  let baseline = {};      // last VehicleState snapshot seen
  let unregister = null;
  let pollTimer = null;
  let hideTimer = null;
  const offs = [];

  function now() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }

  function consoleInstance(ctx) {
    const h = ctx.handles();
    if (h && h.centerConsole) return h.centerConsole;
    const K = window.CenterConsole;
    return (K && K.lastInstance) || null;
  }

  function consoleOn(inst) {
    try { return !!inst && (typeof inst.enabled !== 'function' || inst.enabled()); } catch (_e) { return false; }
  }

  // --- card lifecycle ------------------------------------------------------------
  function push(ctx, lines, app) {
    const inst = consoleInstance(ctx);
    if (!consoleOn(inst) || !lines.length) return;
    const t = now();
    if (card && t - card.lastAt > MERGE_MS) finish(ctx); // previous burst is over
    if (!card) card = { lines: new Map(), app: null, shownAt: t, lastAt: t, hideAt: 0 };
    for (const l of lines) {
      const prev = card.lines.get(l.key);
      // Same function touched twice in a burst: keep the original "from".
      card.lines.set(l.key, prev ? Object.assign({}, l, { from: prev.from }) : l);
    }
    if (app) card.app = app;
    card.lastAt = t;
    card.hideAt = t + HOLD_MS;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => finish(ctx), HOLD_MS + FADE_MS);
    if (typeof inst._requestDraw === 'function') inst._requestDraw();
  }

  /** Card gone: put its function in the 1/3 pane unless it is already on screen. */
  function finish(ctx) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const done = card;
    card = null;
    if (!done) return;
    const inst = consoleInstance(ctx);
    if (!consoleOn(inst)) return;
    if (done.app) {
      const L = inst.layout || {};
      const visible = L.primary === done.app || (L.mode === 'split' && L.secondary === done.app);
      if (!visible && typeof inst.split === 'function') {
        try { inst.split(L.primary, done.app); } catch (_e) {}
      }
    }
    if (typeof inst._requestDraw === 'function') inst._requestDraw();
  }

  // --- sources --------------------------------------------------------------------
  function onVehicleState(ctx, payload) {
    const changed = (payload && payload.changed) || {};
    const lines = [];
    let app = null;
    for (const key of Object.keys(changed)) {
      const f = FIELDS[key];
      if (!f) continue;
      const to = changed[key];
      const from = baseline[key];
      const same = JSON.stringify(from) === JSON.stringify(to);
      lines.push({ key, label: f.label, from: (same || f.noDelta || from === undefined) ? null : f.fmt(from), to: f.fmt(to) });
      if (f.app) app = f.app;
    }
    if (payload && payload.snapshot) baseline = payload.snapshot;
    push(ctx, lines, app);
  }

  const ZONE = { driver: 'Driver', passenger: 'Passenger', rear: 'Rear' };
  function comfortLines(before, after) {
    const out = [];
    if (!after) return out;
    for (const z of Object.keys(ZONE)) {
      const b = (before && before[z]) || {}, a = after[z] || {};
      if (a.tempC !== b.tempC) out.push({ key: `cf.${z}.temp`, label: `Temp · ${ZONE[z]}`, from: b.tempC != null ? `${b.tempC} °C` : null, to: `${a.tempC} °C` });
      if (a.fan !== b.fan) out.push({ key: `cf.${z}.fan`, label: `Fan · ${ZONE[z]}`, from: b.fan != null ? (b.fan ? String(b.fan) : 'Off') : null, to: a.fan ? String(a.fan) : 'Off' });
      if (a.seatHeat !== b.seatHeat) out.push({ key: `cf.${z}.seat`, label: `Seat heat · ${ZONE[z]}`, from: b.seatHeat != null ? level(b.seatHeat) : null, to: level(a.seatHeat) });
    }
    if (before && !!after.auto !== !!before.auto) out.push({ key: 'cf.auto', label: 'Climate auto', from: onOff(before.auto), to: onOff(after.auto) });
    if (before && !!after.sync !== !!before.sync) out.push({ key: 'cf.sync', label: 'Climate sync', from: onOff(before.sync), to: onOff(after.sync) });
    return out;
  }

  function audioLines(action, before, after) {
    const out = [];
    if (!after) return out;
    const title = (s) => (s && s.track ? s.track.title : '');
    if (!before || title(before) !== title(after)) out.push({ key: 'au.track', label: 'Track', from: null, to: title(after) });
    if (!before || before.playing !== after.playing || action === 'play' || action === 'pause') {
      out.push({ key: 'au.play', label: 'Audio', from: null, to: after.playing ? 'Playing' : 'Paused' });
    }
    if (before && before.volume !== after.volume) {
      out.push({ key: 'au.vol', label: 'Volume', from: pct(Math.round(before.volume * 100)), to: pct(Math.round(after.volume * 100)) });
    }
    return out;
  }

  function onIviRequest(ctx, p) {
    if (!p) return;
    let lines = [];
    if (p.app === 'comfort') lines = comfortLines(p.before, p.after);
    else if (p.app === 'audio') lines = audioLines(p.action, p.before, p.after);
    if (!lines.length) return; // a request that changed nothing (already at that value)
    push(ctx, lines, p.app);
  }

  // --- drawing ---------------------------------------------------------------------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function fit(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function draw(c, rect, t) {
    if (!card) return;
    const fadeIn = Math.min(1, (t - card.shownAt) / FADE_MS);
    const fadeOut = Math.max(0, Math.min(1, (card.hideAt + FADE_MS - t) / FADE_MS));
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0) return;

    // Right third of the content area: the split view's secondary column.
    const margin = 14;
    const x = rect.x + Math.round(rect.w * 2 / 3) + margin;
    const w = rect.x + rect.w - margin - x;
    const all = Array.from(card.lines.values());
    const lines = all.length > MAX_LINES ? all.slice(0, MAX_LINES - 1) : all;
    const more = all.length - lines.length;
    const headH = 40, rowH = 52, pad = 16;
    const h = headH + (lines.length + (more ? 1 : 0)) * rowH + pad;
    const y = rect.y + margin - (1 - fadeIn) * 12;

    c.save();
    c.globalAlpha = alpha;
    roundRect(c, x, y, w, h, 14);
    c.fillStyle = C.card;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = C.edge;
    c.stroke();

    // Header: agent badge.
    c.fillStyle = C.accent;
    c.beginPath();
    c.arc(x + pad + 6, y + headH / 2 + 4, 6, 0, Math.PI * 2);
    c.fill();
    c.font = `600 15px ${FONT}`;
    c.textBaseline = 'middle';
    c.fillStyle = C.accent;
    c.fillText('AGENT', x + pad + 20, y + headH / 2 + 4);

    let ry = y + headH;
    for (const l of lines) {
      const cy = ry + rowH / 2;
      c.font = `400 17px ${FONT}`;
      c.fillStyle = C.muted;
      c.textAlign = 'left';
      c.fillText(fit(c, l.label, w - pad * 2), x + pad, cy - 11);
      c.font = `600 22px ${FONT}`;
      c.fillStyle = C.text;
      const value = l.from != null ? `${l.from}  →  ${l.to}` : l.to;
      c.fillText(fit(c, value, w - pad * 2), x + pad, cy + 12);
      ry += rowH;
    }
    if (more) {
      c.font = `400 17px ${FONT}`;
      c.fillStyle = C.faint;
      c.fillText(`+${more} more`, x + pad, ry + rowH / 2);
    }
    c.restore();
  }

  // --- registration -------------------------------------------------------------------
  function attach(ctx) {
    const inst = consoleInstance(ctx);
    if (!inst || typeof inst.registerOverlay !== 'function') return false;
    unregister = inst.registerOverlay({ id: 'ivi_request', layer: 'content', draw: (c, rect, t) => draw(c, rect, t) });
    return true;
  }

  CabinFeedback.register({
    id: 'ivi_request',
    title: 'IVI request cards (consola)',
    fields: [],

    init(ctx) {
      baseline = ctx.snapshot() || {};
      const b = window.PromptDriveBridge;
      if (b && typeof b.on === 'function') {
        offs.push(b.on('vehicleState', (p) => onVehicleState(ctx, p)));
        offs.push(b.on('vehicleReset', (p) => { if (p && p.snapshot && p.snapshot.dynamic) baseline = p.snapshot.dynamic; }));
        offs.push(b.on('iviRequest', (p) => onIviRequest(ctx, p)));
      }
      // The console exists only once the sim has started; keep (re)attaching.
      const tick = () => {
        const inst = consoleInstance(ctx);
        if (inst && (!unregister || (inst._overlays && !inst._overlays.some((o) => o.id === 'ivi_request')))) attach(ctx);
      };
      tick();
      pollTimer = setInterval(tick, 1000);
    },

    dispose() {
      if (pollTimer) clearInterval(pollTimer);
      if (hideTimer) clearTimeout(hideTimer);
      for (const off of offs) { try { off(); } catch (_e) {} }
      if (unregister) unregister();
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
