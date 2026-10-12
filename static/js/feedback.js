/* Cabin feedback layer — built from src/feedback/ (5 feature file(s)) */
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
 * Ambient lighting: a quiet, persistent glow along the lower cabin edges.
 * Reads VehicleState only; CSS handles the transition without a frame loop.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const COLORS = {
    RED: '#ff4545', GREEN: '#42d77d', BLUE: '#4285ff',
    YELLOW: '#ffe066', WHITE: '#f2f5ff', PINK: '#ff89c8',
    ORANGE: '#ff9a45', PURPLE: '#ad78ff', CYAN: '#40e0d0',
  };

  let glow = null;
  let strips = [];
  let current = null;

  CabinFeedback.register({
    id: 'ambient_light',
    title: 'Luz ambiental',
    fields: ['ambient_light'],

    init(ctx) {
      current = null;
      strips = [];
      glow = document.createElement('div');
      glow.setAttribute('aria-hidden', 'true');
      Object.assign(glow.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0',
      });

      const regions = [
        { left: '0', right: '0', bottom: '0', height: '13%',
          maskImage: 'linear-gradient(to top, #000, transparent)' },
        { left: '0', bottom: '0', width: '5%', height: '44%',
          maskImage: 'linear-gradient(to right, #000, transparent), linear-gradient(to top, #000 25%, transparent)',
          maskComposite: 'intersect' },
        { right: '0', bottom: '0', width: '5%', height: '44%',
          maskImage: 'linear-gradient(to left, #000, transparent), linear-gradient(to top, #000 25%, transparent)',
          maskComposite: 'intersect' },
      ];
      for (const region of regions) {
        const strip = document.createElement('div');
        Object.assign(strip.style, { position: 'absolute' }, region);
        glow.appendChild(strip);
        strips.push(strip);
      }
      ctx.layer.appendChild(glow);
    },

    onChange(changed, snapshot) {
      if (!glow) return;
      const color = Object.prototype.hasOwnProperty.call(COLORS, snapshot.ambient_light)
        ? snapshot.ambient_light : 'OFF';
      if (color === current) return;

      // Render the initial snapshot immediately. Respect reduced motion on
      // later changes, including preferences changed while the page is open.
      const reduced = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const animate = current !== null && !reduced;
      glow.style.transition = animate ? 'opacity 400ms ease' : 'none';
      for (const strip of strips) {
        strip.style.transition = animate ? 'background-color 400ms ease' : 'none';
        // Keep the previous tint when switching OFF so it fades to darkness.
        if (color !== 'OFF') strip.style.backgroundColor = COLORS[color];
      }
      glow.style.opacity = color === 'OFF' ? '0' : '0.32';
      glow.dataset.color = color;
      current = color;
    },

    dispose() {
      if (glow) glow.remove();
      glow = null;
      strips = [];
      current = null;
    },
  });
})();


/* --- features/climate_panel.js --- */
/** Read-only dual-zone climate fascia. Original canvas art; no manual inputs. */
(function () {
  if (typeof CabinFeedback === "undefined") return;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function roundRectPath(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function fillRoundRect(g, x, y, w, h, r, fill) { roundRectPath(g,x,y,w,h,r); g.fillStyle=fill; g.fill(); }
function strokeRoundRect(g,x,y,w,h,r,color,width=1) { roundRectPath(g,x,y,w,h,r); g.strokeStyle=color; g.lineWidth=width; g.stroke(); }
function drawText(g,text,x,y,{size=20,color='#e7e9eb',align='left',baseline='alphabetic'}={}) {
  g.font=`400 ${size}px ShareTech, Arial, sans-serif`; g.fillStyle=color; g.textAlign=align; g.textBaseline=baseline; g.fillText(text,x,y);
}
function glyphSetup(g,cx,cy,size,color) { g.save(); g.translate(cx,cy); g.scale(size/24,size/24); g.fillStyle=color; }
function iconFan(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * 2 * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(6.5, -9, 2.2, -10.5);
    ctx.quadraticCurveTo(-2.5, -11.5, -2.3, -5);
    ctx.quadraticCurveTo(-2.2, -2.8, 0, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const CLIMATE_SURFACE = { width: 0.22, height: 0.064166667 };
const CLIMATE_FIELDS = [
  'climate_temperature_driver', 'climate_temperature_passenger', 'fan_speed',
  'air_conditioning', 'air_circulation', 'fan_airflow_direction',
  'window_front_defrost', 'window_rear_defrost',
  'seat_heating_driver', 'seat_heating_passenger',
];
class ClimatePanel {
  constructor(readSnapshot, driverRight) {
    this.readSnapshot = readSnapshot;
    this.driverRight = driverRight;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1200;
    this.canvas.height = 350;
    this.ctx = this.canvas.getContext('2d');
    this.snapshot = null;
    this.from = {};
    this.changedAt = {};
    this.draw();
  }

  _read(now) {
    const next = this.readSnapshot();
    if (!next) return false;
    for (const key of CLIMATE_FIELDS) {
      if (this.snapshot && next[key] !== this.snapshot[key]) {
        this.from[key] = this._displayValue(key, now);
        this.changedAt[key] = now;
      }
    }
    this.snapshot = next;
    return true;
  }

  _reducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  _displayValue(key, now) {
    const value = this.snapshot && this.snapshot[key];
    if (typeof value !== 'number' || this._reducedMotion()) return value;
    const start = this.from[key];
    if (typeof start !== 'number') return value;
    const progress = clamp((now - (this.changedAt[key] || 0)) / 350, 0, 1);
    return start + (value - start) * (1 - Math.pow(1 - progress, 3));
  }

  _flash(key, now) {
    if (!this.changedAt[key] || this._reducedMotion()) return 0;
    return clamp(1 - (now - this.changedAt[key]) / 850, 0, 1);
  }

  _text(text, x, y, size = 22, color = '#e7e9eb') {
    drawText(this.ctx, text, x, y, { size, color, align: 'center', baseline: 'middle' });
  }

  _dial(cx, key, label, now) {
    const g = this.ctx, cy = 132, radius = 104;
    const metal = g.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    metal.addColorStop(0, '#f4f5f6'); metal.addColorStop(0.25, '#565c63');
    metal.addColorStop(0.52, '#b2b6bc'); metal.addColorStop(1, '#262a30');
    g.shadowColor = '#000'; g.shadowBlur = 18; g.shadowOffsetY = 7;
    g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.fillStyle = metal; g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = 2;
    for (let i = 0; i < 72; i++) {
      const a = i * Math.PI / 36;
      g.strokeStyle = i % 2 ? '#45494f' : '#bbc0c7';
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 97, cy + Math.sin(a) * 97);
      g.lineTo(cx + Math.cos(a) * 103, cy + Math.sin(a) * 103); g.stroke();
    }
    const face = g.createRadialGradient(cx - 25, cy - 40, 2, cx, cy, 92);
    face.addColorStop(0, '#24272b'); face.addColorStop(1, '#090b0d');
    g.beginPath(); g.arc(cx, cy, 91, 0, Math.PI * 2); g.fillStyle = face; g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#4c98d4'; g.beginPath(); g.arc(cx, cy, 83, Math.PI * 0.62, Math.PI * 1.35); g.stroke();
    g.strokeStyle = '#c85c53'; g.beginPath(); g.arc(cx, cy, 83, Math.PI * 1.65, Math.PI * 2.38); g.stroke();
    const value = this._displayValue(key, now);
    const angle = Math.PI * (0.75 + (value - 16) / 12 * 1.5);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + Math.cos(angle) * 72, cy + Math.sin(angle) * 72);
    g.lineTo(cx + Math.cos(angle) * 79, cy + Math.sin(angle) * 79); g.stroke();
    this._text(value.toFixed(1) + '°', cx, cy - 2, 49);
    this._text(label, cx, cy + 57, 13, '#aeb4bb');
    const flash = this._flash(key, now);
    if (flash > 0) {
      g.strokeStyle = `rgba(${this.snapshot[key] >= (this.from[key] || 20) ? '230,132,100' : '110,185,235'},${flash})`;
      g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 109, 0, Math.PI * 2); g.stroke();
    }
  }

  _button(id, x, label, active, key, now, glyph) {
    const g = this.ctx, y = 224, w = 102, h = 69;
    const metal = g.createLinearGradient(0, y, 0, y + h);
    metal.addColorStop(0, '#3c4249'); metal.addColorStop(0.60, '#15191e');
    metal.addColorStop(0.65, '#adb4bb'); metal.addColorStop(0.80, '#e4e8ec'); metal.addColorStop(1, '#535c65');
    fillRoundRect(g, x, y, w, h, 5, metal);
    strokeRoundRect(g, x, y, w, h, 5, '#4a5056', 1);
    const color = active ? '#fff1db' : '#d2d6da';
    if (glyph) glyph(x + w / 2, y + 23, color);
    else this._text(label, x + w / 2, y + 30, 22, color);
    if (glyph) this._text(label, x + w / 2, y + 51, 13, '#1c252d');
    fillRoundRect(g, x + 30, y + h - 8, 42, 3, 1, active ? '#edac63' : '#42484d');
    const flash = this._flash(key, now);
    if (flash) strokeRoundRect(g, x, y, w, h, 5, `rgba(255,210,160,${flash})`, 2);
  }

  _defrost(cx, cy, color, rear) {
    const g = this.ctx; g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath();
    if (rear) g.rect(cx - 21, cy - 11, 42, 25);
    else { g.moveTo(cx - 24, cy + 13); g.lineTo(cx - 17, cy - 9); g.quadraticCurveTo(cx, cy - 19, cx + 17, cy - 9); g.lineTo(cx + 24, cy + 13); g.closePath(); }
    g.stroke();
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * 11;
      g.beginPath(); g.moveTo(x, cy + 10); g.quadraticCurveTo(x + 5, cy + 3, x, cy - 4);
      g.lineTo(x, cy - 10); g.moveTo(x - 3, cy - 6); g.lineTo(x, cy - 10); g.lineTo(x + 3, cy - 6); g.stroke();
    }
  }

  _seat(cx, key, now) {
    const g = this.ctx, y = 286, level = this.snapshot[key];
    fillRoundRect(g, cx - 95, 255, 190, 72, 5, '#171b20');
    strokeRoundRect(g, cx - 95, 255, 190, 72, 5, '#4b5158', 1);
    g.strokeStyle = '#cfd4da'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 25, y - 14); g.lineTo(cx - 25, y + 13); g.quadraticCurveTo(cx - 23, y + 22, cx - 12, y + 22); g.lineTo(cx + 21, y + 22); g.stroke();
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = i < level ? '#edab65' : '#444a51';
      const x = cx - 5 + i * 12;
      const phase = this._reducedMotion() ? 0 : Math.sin(now / 350 + i) * this._flash(key, now) * 3;
      g.beginPath(); g.moveTo(x, y + 12); g.bezierCurveTo(x + 7, y + 4, x - 7, y - 4, x + phase, y - 13); g.stroke();
    }
  }

  draw(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const g = this.ctx;
    if (!this._read(now)) return;
    const s = this.snapshot;
    const reduced = this._reducedMotion();
    const signature = CLIMATE_FIELDS.map(key => s[key]).join('|') + '|' + reduced + '|' + this.driverRight();
    const moving = !reduced && (s.fan_speed > 0 || Object.values(this.changedAt).some(at => now - at < 850));
    if (signature === this._drawnSignature && !moving) return false;
    this._drawnSignature = signature;
    g.clearRect(0, 0, 1200, 350);
    const frame = g.createLinearGradient(0, 0, 0, 350);
    frame.addColorStop(0, '#bcc1c6'); frame.addColorStop(0.025, '#343a42');
    frame.addColorStop(0.065, '#191e24'); frame.addColorStop(0.93, '#12171d'); frame.addColorStop(1, '#8e979f');
    fillRoundRect(g, 0, 0, 1200, 350, 15, frame);
    strokeRoundRect(g, 3, 3, 1194, 344, 13, '#6c737b', 2);
    for (let y = 12; y < 340; y += 3) {
      g.strokeStyle = 'rgba(210,218,228,0.025)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(14, y); g.lineTo(1186, y); g.stroke();
    }
    // Follow the current vehicle seat side, including changes after startup.
    this._dial(147, this.driverRight() ? 'climate_temperature_passenger' : 'climate_temperature_driver', this.driverRight() ? 'ACOMPAÑANTE' : 'CONDUCTOR', now);
    this._dial(1053, this.driverRight() ? 'climate_temperature_driver' : 'climate_temperature_passenger', this.driverRight() ? 'CONDUCTOR' : 'ACOMPAÑANTE', now);
    fillRoundRect(g, 285, 43, 630, 152, 9, '#080b0e');
    strokeRoundRect(g, 285, 43, 630, 152, 9, '#4a5159', 2);
    this._text(s.air_conditioning ? 'A/C ON' : 'A/C OFF', 395, 67, 20, '#c9d0d7');
    this._text('2-ZONE', 815, 67, 20, '#c9d0d7');
    g.save(); g.translate(442, 111);
    if (s.fan_speed > 0 && !this._reducedMotion()) g.rotate(now / 1000 * s.fan_speed * 0.9);
    iconFan(g, 0, 0, 38, '#e3e8ed'); g.restore();
    for (let i = 0; i < 5; i++) fillRoundRect(g, 496 + i * 34, 103 - i * 3, 24, 20 + i * 3, 2, i < s.fan_speed ? '#edf2f7' : '#2a3139');
    this._text(String(s.fan_speed), 707, 112, 29);
    const dirs = [];
    if (s.fan_airflow_direction.includes('WINDSHIELD')) dirs.push('PARABRISAS');
    if (s.fan_airflow_direction.includes('HEAD')) dirs.push('CARA');
    if (s.fan_airflow_direction.includes('FEET')) dirs.push('PIES');
    this._text(dirs.join(' + '), 600, 165, 19, '#b9c7d4');
    // Small travelling airflow dots, confined to the climate display.
    if (s.fan_speed > 0) {
      const motion = this._reducedMotion() ? 0.5 : (now / (1600 / s.fan_speed)) % 1;
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `rgba(165,205,232,${0.15 + i * 0.16})`;
        g.beginPath(); g.arc(390 + motion * 30 + i * 9, 159, 2, 0, Math.PI * 2); g.fill();
      }
    }
    this._button('front', 287, 'DELANTERO', s.window_front_defrost, 'window_front_defrost', now, (x,y,c)=>this._defrost(x,y,c,false));
    this._button('rear', 391, 'TRASERO', s.window_rear_defrost, 'window_rear_defrost', now, (x,y,c)=>this._defrost(x,y,c,true));
    this._button('ac', 495, 'A/C', s.air_conditioning, 'air_conditioning', now);
    this._button('circulation', 599, s.air_circulation === 'AUTO' ? 'AUTO' : (s.air_circulation === 'RECIRCULATION' ? 'RECIRC.' : 'EXTERIOR'), s.air_circulation === 'RECIRCULATION', 'air_circulation', now);
    this._button('flow', 703, 'DIRECCIÓN', false, 'fan_airflow_direction', now, (x,y,c)=>{
      g.strokeStyle=c;g.lineWidth=2;g.beginPath();g.moveTo(x-20,y);g.lineTo(x+18,y);g.moveTo(x+9,y-8);g.lineTo(x+18,y);g.lineTo(x+9,y+8);g.stroke();
    });
    this._button('off', 807, 'OFF', s.fan_speed === 0 && !s.air_conditioning, 'fan_speed', now);
    this._seat(147, this.driverRight() ? 'seat_heating_passenger' : 'seat_heating_driver', now);
    this._seat(1053, this.driverRight() ? 'seat_heating_driver' : 'seat_heating_passenger', now);
    this._text('CLIMATE CONTROL', 600, 323, 14, '#8b949f');
    return true;
  }

}
/** Original Audi-inspired vent housings: recessed louvres and brushed trim. */

const AIR_VENTS_SURFACE = { width: 0.25, height: 0.036 };
const SIDE_VENT_SURFACE = { width: 0.098, height: 0.052 };
const VENT_FASCIA_SURFACE = { width: 0.266, height: 0.112 };

function ventGradient(g, x1, y1, x2, y2, stops) {
  const gradient = g.createLinearGradient(x1, y1, x2, y2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function housingPath(g, w, h, side) {
  g.beginPath();
  if (side) {
    // The side outlet tapers toward the door, like the reference's trapezoid.
    g.moveTo(27, 5); g.lineTo(w - 70, 5);
    g.quadraticCurveTo(w - 48, 5, w - 38, 28);
    g.lineTo(w - 5, h - 33); g.quadraticCurveTo(w + 1, h - 5, w - 25, h - 5);
    g.lineTo(25, h - 5); g.quadraticCurveTo(5, h - 5, 5, h - 25);
    g.lineTo(5, 28); g.quadraticCurveTo(5, 5, 27, 5);
  } else {
    g.moveTo(26, 5); g.lineTo(w - 26, 5);
    g.quadraticCurveTo(w - 4, 5, w - 4, 26);
    g.lineTo(w - 12, h - 31); g.quadraticCurveTo(w - 13, h - 5, w - 36, h - 5);
    g.lineTo(36, h - 5); g.quadraticCurveTo(13, h - 5, 12, h - 31);
    g.lineTo(4, 26); g.quadraticCurveTo(4, 5, 26, 5);
  }
  g.closePath();
}

function drawVentBank(g, x, y, w, h, { wheel = false, slats = 4 } = {}) {
  // Bevel, then a deep unlit cavity. The grid stays behind horizontal blades.
  fillRoundRect(g, x - 5, y - 5, w + 10, h + 10, 8,
    ventGradient(g, 0, y - 5, 0, y + h + 5, [[0, '#4e565f'], [0.1, '#242b32'], [0.85, '#10151b'], [1, '#68717a']]));
  fillRoundRect(g, x, y, w, h, 5, '#040608');
  const bankW = w - (wheel ? 48 : 0);
  g.save(); g.beginPath(); g.rect(x + 3, y + 3, bankW - 6, h - 6); g.clip();
  for (let i = 1; i < 6; i++) fillRoundRect(g, x + i * bankW / 6, y + 4, 5, h - 8, 1, '#141a20');
  const pitch = (h - 14) / slats;
  for (let i = 0; i < slats; i++) {
    const by = y + 6 + i * pitch, bh = pitch * 0.53;
    g.shadowColor = 'rgba(0,0,0,0.95)'; g.shadowBlur = 8; g.shadowOffsetY = 7;
    fillRoundRect(g, x + 1, by, bankW - 2, bh, 2,
      ventGradient(g, 0, by, 0, by + bh, [[0, '#59636e'], [0.08, '#444d57'], [0.35, '#303943'], [0.8, '#171e26'], [1, '#080d13']]));
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.fillStyle = 'rgba(164,176,189,0.35)'; g.fillRect(x + 5, by, bankW - 10, 1.5);
    g.fillStyle = '#070b10'; g.fillRect(x + 2, by + bh - 2, bankW - 4, 2);
  }
  // Sculpted adjustment paddle, with a chrome lower lip and cast shadow.
  const tw = Math.min(114, bankW * 0.22), tx = x + bankW * 0.52 - tw / 2;
  const ty = y + h * 0.48, th = Math.min(30, pitch * 0.86);
  g.shadowColor = '#000'; g.shadowBlur = 9; g.shadowOffsetY = 8;
  fillRoundRect(g, tx - 5, ty - 3, tw + 10, th + 8, 7, '#0a1016');
  fillRoundRect(g, tx, ty, tw, th, 6,
    ventGradient(g, 0, ty, 0, ty + th, [[0, '#6c747e'], [0.2, '#3b444d'], [0.6, '#1c252f'], [0.76, '#a6afb9'], [0.9, '#e1e6ec'], [1, '#586574']]));
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  strokeRoundRect(g, tx, ty, tw, th, 6, '#111921', 1.5);
  g.restore();
  if (wheel) {
    const wx = x + w - 34;
    fillRoundRect(g, wx - 5, y + 5, 31, h - 10, 9, '#080d12');
    fillRoundRect(g, wx, y + 9, 20, h - 18, 5,
      ventGradient(g, wx, 0, wx + 20, 0, [[0, '#19212a'], [0.5, '#6b7580'], [1, '#131b24']]));
    for (let by = y + 15; by < y + h - 13; by += 8) {
      g.fillStyle = '#151e27'; g.fillRect(wx + 1, by, 18, 3);
      g.fillStyle = '#8d99a5'; g.fillRect(wx + 2, by, 16, 1);
    }
    fillRoundRect(g, wx + 3, y + h * 0.37, 14, 5, 2, '#e1e8ee');
  }
}

function createAirVentsCanvas(side = false) {
  const canvas = document.createElement('canvas');
  canvas.width = side ? 720 : 1600;
  canvas.height = side ? 382 : 230;
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  // Moulded graphite surround, fine upper bevel and brushed aluminium below.
  housingPath(g, w, h, side);
  g.fillStyle = ventGradient(g, 0, 0, 0, h, [[0, '#484e56'], [0.08, '#262c33'], [0.7, '#151b22'], [1, '#080f16']]);
  g.fill(); g.save(); g.clip();
  for (let y = 8; y < h - 16; y += 3) {
    g.strokeStyle = y % 2 ? 'rgba(208,216,224,0.023)' : 'rgba(0,0,0,0.15)';
    g.lineWidth = 1; g.beginPath(); g.moveTo(9, y); g.lineTo(w - 9, y); g.stroke();
  }
  const metalY = side ? h - 42 : h - 36;
  g.fillStyle = ventGradient(g, 0, metalY, 0, h, [[0, '#b9c0c8'], [0.05, '#e3e7ec'], [0.18, '#8d98a4'], [0.5, '#a7b1bc'], [1, '#49535f']]);
  g.fillRect(0, metalY, w, h - metalY);
  for (let y = metalY + 4; y < h; y += 2) {
    g.fillStyle = 'rgba(235,241,247,0.15)'; g.fillRect(0, y, w, 0.6);
  }
  if (side) {
    g.strokeStyle = '#c0c8d1'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(27, h - 54); g.lineTo(27, 42);
    g.quadraticCurveTo(27, 23, 46, 23); g.lineTo(w - 86, 23);
    g.lineTo(w - 33, h - 58); g.stroke();
    drawVentBank(g, 48, 47, w - 135, h - 113, { wheel: true, slats: 5 });
  } else {
    drawVentBank(g, 29, 32, 707, 149);
    drawVentBank(g, 864, 32, 707, 149, { wheel: true });
    fillRoundRect(g, 757, 23, 86, 168, 7,
      ventGradient(g, 757, 0, 843, 0, [[0, '#535d68'], [0.08, '#303944'], [0.35, '#1b232d'], [0.82, '#242d38'], [1, '#515c68']]));
    strokeRoundRect(g, 767, 34, 66, 147, 4, '#0b121a', 2);
    fillRoundRect(g, 777, 45, 46, 125, 3, '#252e39');
  }
  g.restore();
  housingPath(g, w, h, side); g.strokeStyle = '#0b1118'; g.lineWidth = 5; g.stroke();
  return canvas;
}

function ventFasciaPath(g, w, h) {
  g.beginPath(); g.moveTo(21, 4); g.lineTo(w - 21, 4);
  g.quadraticCurveTo(w - 3, 4, w - 5, 24);
  g.lineTo(w - 43, h - 27); g.quadraticCurveTo(w - 45, h - 4, w - 67, h - 4);
  g.lineTo(67, h - 4); g.quadraticCurveTo(45, h - 4, 43, h - 27);
  g.lineTo(5, 24); g.quadraticCurveTo(3, 4, 21, 4); g.closePath();
}

/** Continuous brushed insert surrounding the central vents and climate unit. */
function createVentFasciaCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 674;
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ventFasciaPath(g, w, h);
  g.fillStyle = ventGradient(g, 0, 0, 0, h, [[0, '#424c57'], [0.32, '#28333e'], [0.36, '#bfc6cd'], [0.42, '#8e99a5'], [0.75, '#74818e'], [1, '#374450']]);
  g.fill(); g.save(); g.clip();
  // Fine diagonal brushed grain, subtle enough to avoid a grille-like pattern.
  for (let x = -h; x < w; x += 5) {
    g.strokeStyle = 'rgba(231,237,244,0.07)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke();
  }
  g.restore(); ventFasciaPath(g, w, h);
  g.strokeStyle = '#161f28'; g.lineWidth = 5; g.stroke();
  return canvas;
}

  let ctx = null, snapshot = null, panel = null, surfaces = [], frame = null, lastDraw = 0;
  function driverRight() {
    const side = ctx.handles()?.vehicleConfig?.value?.side;
    return side == null ? ctx.config.side === 'right' : Number(side) === 0;
  }
  function surface(console, name, canvas, size, x, y, z) {
    const mesh = new console.screenMesh.constructor(new console.screenMesh.geometry.constructor(size.width, size.height), console.material.clone());
    // Texture.clone() shares its Source; assigning image would replace the
    // original console texture as well. Construct an independent source.
    const texture = new console.texture.constructor(canvas); texture.needsUpdate = true;
    texture.generateMipmaps = false;
    texture.minFilter = console.texture.minFilter; texture.magFilter = console.texture.magFilter;
    mesh.material.map = texture; mesh.material.transparent = true; mesh.material.depthWrite = false;
    mesh.name = name; mesh.rotation.order = 'YXZ'; mesh.rotation.set(-0.12, -Math.PI / 2, 0);
    mesh.position.set(x,y,z); mesh.renderOrder = name === 'climate_fascia_feedback' ? 1 : 2; mesh.frustumCulled = false;
    console.screenMesh.parent.add(mesh);
    const result = {mesh, texture, canvas}; surfaces.push(result); return result;
  }
  function release() {
    for (const s of surfaces) { s.mesh.parent?.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.texture.dispose(); }
    surfaces = [];
  }
  CabinFeedback.register({
    id: 'climate_panel', title: 'Climatizador de dos zonas', fields: CLIMATE_FIELDS,
    init(context) {
      ctx = context; snapshot = ctx.snapshot(); panel = new ClimatePanel(() => snapshot, driverRight);
      const tick = now => {
        const console = ctx.handles()?.centerConsole;
        if (console?.screenMesh?.parent) {
          if (surfaces.length && surfaces[0].mesh.parent !== console.screenMesh.parent) release();
          if (!surfaces.length) {
            const z = console.screenMesh.position.z;
            surface(console, 'climate_feedback_panel', panel.canvas, CLIMATE_SURFACE, 1.79, .832, z);
            surface(console, 'climate_feedback_vents', createAirVentsCanvas(), AIR_VENTS_SURFACE, 1.79, .889, z);
            surface(console, 'climate_feedback_side_vent', createAirVentsCanvas(true), SIDE_VENT_SURFACE, 1.79, .86, z + .57);
            surface(console, 'climate_fascia_feedback', createVentFasciaCanvas(), VENT_FASCIA_SURFACE, 1.801, .85, z);
          }
          const visible = CabinFeedback._enabled && console.screenMesh.visible;
          for (const s of surfaces) s.mesh.visible = visible;
          if (visible && now - lastDraw >= 33) {
            lastDraw = now;
            if (panel.draw(now)) surfaces[0].texture.needsUpdate = true;
          }
        } else if (surfaces.length) release();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    onChange(changed, state) { snapshot = state; },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      release(); ctx = snapshot = panel = frame = null; lastDraw = 0;
    },
  });
})();


/* --- features/fog_lights.js --- */
/** Low amber fog lights and an independent status mesh on the instrument panel. */
(function () {
  if (typeof CabinFeedback === 'undefined') return;
  let group = null, pairs = [], indicator = null, frame = null;
  let target = 0, level = 0, fromLevel = 0, transitionAt = 0, initial = true;

  function releaseLights() {
    group?.parent?.remove(group);
    for (const pair of pairs) pair.light.dispose?.();
    group = null; pairs = [];
  }

  function ensureLights(h) {
    const container = h.ego?.lightsContainer, source = h.ego?.lights;
    if (!container || !source?.left?.light || !source?.right?.light || !source.left.target) return false;
    if (group?.parent && group.parent !== container) releaseLights();
    if (group) { if (!group.parent) container.add(group); return true; }
    // These native constructors remain available even when THREE export names
    // are removed by the upstream engine's build.
    const SpotLight = source.left.light.constructor, Group = source.left.target.constructor;
    group = new Group(); group.name = 'fog_lights';
    for (const side of ['left', 'right']) {
      const light = new SpotLight(0xffce48, 0, 40, 0.22, 0.8, 1.2), aim = new Group();
      light.name = 'fog_light_' + side; aim.name = 'fog_light_target_' + side;
      light.castShadow = false; light.target = aim;
      group.add(light, aim); pairs.push({ side, light, aim });
    }
    container.add(group); return true;
  }

  function releaseIndicator() {
    if (!indicator) return;
    indicator.mesh.parent?.remove(indicator.mesh);
    indicator.mesh.geometry.dispose(); indicator.mesh.material.dispose(); indicator.texture.dispose();
    indicator = null;
  }

  function drawIndicator(on) {
    const g = indicator.canvas.getContext('2d');
    g.clearRect(0,0,240,46); g.beginPath(); g.roundRect(0,0,240,46,9);
    g.fillStyle = on ? '#534528' : '#282d32'; g.fill();
    const color = on ? '#ffda76' : '#7d8791', ix = 31, iy = 23;
    g.strokeStyle = color; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ix+4,iy-14); g.lineTo(ix+4,iy+14);
    g.bezierCurveTo(ix+29,iy+13,ix+29,iy-13,ix+4,iy-14); g.stroke();
    for (let i=-1;i<=1;i++) { g.beginPath(); g.moveTo(ix-27,iy+i*9+4); g.lineTo(ix-3,iy+i*9); g.stroke(); }
    g.beginPath(); g.moveTo(ix-16,iy-18); g.bezierCurveTo(ix-26,iy-5,ix-7,iy+3,ix-17,iy+18); g.stroke();
    g.font='26px ShareTech, Arial, sans-serif'; g.fillStyle=color; g.textAlign='left'; g.textBaseline='middle';
    g.fillText(on ? 'EXPL. ON' : 'EXPL. OFF',75,24);
    indicator.canvas.dataset.on = String(on); indicator.on = on; indicator.texture.needsUpdate = true;
  }

  function updateIndicator(h) {
    const cluster = h.controller?.instrumentCluster, overlay = cluster?.overlayMesh;
    if (!overlay?.parent) { releaseIndicator(); return; }
    if (indicator && indicator.mesh.parent !== overlay) releaseIndicator();
    if (!indicator) {
      const canvas = document.createElement('canvas'); canvas.width=240; canvas.height=46;
      canvas.dataset.feature='fog_lights';
      const texture = new cluster.texture.constructor(canvas);
      texture.generateMipmaps=false;
      texture.minFilter=cluster.texture.minFilter; texture.magFilter=cluster.texture.magFilter;
      const material = cluster.material.clone(); material.map=texture;
      material.transparent=true; material.depthWrite=false;
      const size = overlay.geometry.parameters;
      const mesh = new overlay.constructor(new overlay.geometry.constructor(size.width*240/1292,size.height*46/400),material);
      mesh.name='fog_lights_indicator'; mesh.position.set(-size.width*.275,-size.height*.34,.0003);
      mesh.renderOrder=3; mesh.frustumCulled=false; overlay.add(mesh);
      indicator={mesh,texture,canvas,on:null};
    }
    const on = target === 1;
    if (indicator.on !== on) drawIndicator(on);
    indicator.mesh.visible = CabinFeedback._enabled;
  }

  CabinFeedback.register({
    id: 'fog_lights', title: 'Exploradoras', fields: ['fog_lights'],
    init(ctx) {
      const tick = now => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const elapsed = Math.max(0,now-transitionAt)/1000;
        level = reduced ? target : target+(fromLevel-target)*Math.exp(-elapsed*10);
        if (Math.abs(target-level)<.001) level=target;
        const h=ctx.handles();
        if (h) {
          updateIndicator(h);
          if ((group || target) && ensureLights(h)) for (const pair of pairs) {
            pair.light.position.copy(h.ego.lights[pair.side].light.position);
            pair.light.position.y=Math.max(.22,pair.light.position.y-.35);
            pair.aim.position.copy(pair.light.position); pair.aim.position.z+=14; pair.aim.position.y-=1.7;
            pair.light.intensity=CabinFeedback._enabled ? level*7 : 0;
          }
        }
        frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
    },
    onChange(changed,snapshot) {
      fromLevel=level; transitionAt=performance.now();
      target=snapshot.fog_lights ? 1 : 0;
      if (initial) { level=fromLevel=target; initial=false; }
    },
    dispose() {
      if (frame!==null) cancelAnimationFrame(frame);
      releaseLights(); releaseIndicator(); frame=null; target=level=fromLevel=transitionAt=0; initial=true;
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
