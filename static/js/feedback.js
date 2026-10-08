/* Cabin feedback layer — built from src/feedback/ (2 feature file(s)) */
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
