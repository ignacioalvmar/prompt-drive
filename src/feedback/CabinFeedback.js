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
