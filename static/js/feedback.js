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


/* --- features/autonomy_handover.js --- */
/**
 * Autonomy handover: a non-interactive perimeter cue for who is controlling
 * the car. It reads the engine observable and never changes it.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const NOTICE_MS = 3000;
  let frame = null;
  let label = null;
  let pollTimer = null;
  let noticeTimer = null;
  let observable = null;
  let listener = null;
  let hasInitialState = false;
  let currentValue = false;
  let disposed = false;

  function setVisible(visible) {
    if (!frame) return;
    frame.dataset.visible = visible ? 'true' : 'false';
    frame.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function clearNotice() {
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
  }

  function showState(active, initial) {
    if (!frame) return;
    currentValue = Boolean(active);
    clearNotice();
    if (initial) frame.style.transition = 'none';
    frame.dataset.active = currentValue ? 'true' : 'false';

    if (currentValue) {
      frame.setAttribute('aria-label', 'Control automático activo; el vehículo maneja');
      setVisible(true);
      if (initial) {
        frame.dataset.phase = 'active';
        label.textContent = '';
        frame.offsetHeight;
        frame.style.transition = '';
        return;
      }

      frame.dataset.phase = 'active-notice';
      label.textContent = 'Control automático activo · el vehículo maneja';
      noticeTimer = setTimeout(() => {
        if (currentValue && frame.dataset.phase === 'active-notice') {
          label.textContent = '';
          frame.dataset.phase = 'active';
        }
        noticeTimer = null;
      }, NOTICE_MS);
      return;
    }

    if (initial) {
      frame.dataset.phase = 'idle';
      frame.setAttribute('aria-label', 'Control manual; manejas tú');
      label.textContent = '';
      setVisible(false);
      frame.offsetHeight;
      frame.style.transition = '';
      return;
    }

    frame.dataset.phase = 'handover';
    frame.setAttribute('aria-label', 'Toma el control; manejas tú');
    label.textContent = 'Toma el control · manejas tú';
    setVisible(true);
    noticeTimer = setTimeout(() => {
      if (!currentValue && frame.dataset.phase === 'handover') {
        label.textContent = '';
        frame.dataset.phase = 'idle';
        setVisible(false);
      }
      noticeTimer = null;
    }, NOTICE_MS);
  }

  function readValue(source) {
    try { return Boolean(source && source.value); } catch (_error) { return false; }
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function attach(ctx, candidate) {
    if (!candidate || disposed) return false;
    observable = candidate;
    const initial = readValue(observable);
    if (!hasInitialState) {
      hasInitialState = true;
      showState(initial, true);
    }

    if (typeof observable.addListener === 'function' && typeof observable.removeListener === 'function') {
      listener = (value) => {
        const next = Boolean(value);
        if (next !== currentValue) showState(next, false);
      };
      try {
        observable.addListener(listener);
        stopPolling();
        return true;
      } catch (_error) {
        listener = null;
      }
    }

    // Compatibility fallback for observable-shaped handles without listeners.
    stopPolling();
    pollTimer = setInterval(() => {
      const next = readValue(observable);
      if (next !== currentValue) showState(next, false);
    }, 500);
    return true;
  }

  function findObservable(ctx) {
    try {
      const handles = ctx.handles();
      return handles && handles.autodrive ? handles.autodrive : null;
    } catch (_error) { return null; }
  }

  CabinFeedback.register({
    id: 'autonomy_handover',
    title: 'Transferencia de control',
    fields: [],

    init(ctx) {
      const style = document.createElement('style');
      style.textContent = [
        '.ah-frame {',
        'position: absolute; inset: 0.8vh 0.6vw; box-sizing: border-box;',
        'border: clamp(0.18vw, 0.28vw, 0.6vw) solid rgba(225, 236, 239, 0.24);',
        'border-radius: 1.2vw; opacity: 0; visibility: hidden;',
        'transition: opacity 220ms ease, border-color 220ms ease, visibility 220ms;',
        '}',
        '.ah-frame[data-visible="true"] { opacity: 1; visibility: visible; }',
        '.ah-frame[data-phase="handover"] {',
        'border-color: #e5a941; box-shadow: 0 0 0 0.12vw rgba(229,169,65,0.16);',
        '}',
        '.ah-label {',
        'position: absolute; top: 0.8vh; left: 50%; transform: translateX(-50%);',
        'max-width: 78%; box-sizing: border-box; padding: 0.65vh 1.2vw;',
        'border: 1px solid rgba(255,255,255,0.26); border-radius: 2vw;',
        'background: rgba(10,18,25,0.94); color: #f4f7f8;',
        'font: 700 clamp(0.8vw, 1vw, 1.2vw)/1.25 system-ui, -apple-system, sans-serif;',
        'text-align: center; white-space: normal;',
        'box-shadow: 0 0.8vh 1.6vw rgba(0,0,0,0.24);',
        '}',
        '.ah-frame[data-phase="handover"] .ah-label { color: #ffd18a; }',
        '.ah-frame[data-phase="active"] .ah-label, .ah-frame[data-phase="idle"] .ah-label { display: none; }',
        '@media (prefers-reduced-motion: reduce) { .ah-frame { transition: none; } }',
      ].join('\n');
      ctx.layer.appendChild(style);

      frame = document.createElement('div');
      frame.className = 'ah-frame';
      frame.dataset.visible = 'false';
      frame.dataset.active = 'false';
      frame.dataset.phase = 'idle';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('role', 'status');
      label = document.createElement('div');
      label.className = 'ah-label';
      frame.appendChild(label);
      ctx.layer.appendChild(frame);

      const tryAttach = () => {
        if (disposed || observable) return;
        const candidate = findObservable(ctx);
        if (candidate) attach(ctx, candidate);
      };
      tryAttach();
      if (!observable) pollTimer = setInterval(tryAttach, 1000);
    },

    dispose() {
      disposed = true;
      stopPolling();
      clearNotice();
      if (observable && listener && typeof observable.removeListener === 'function') {
        try { observable.removeListener(listener); } catch (_error) {}
      }
      listener = null;
      observable = null;
    },
  });
})();


/* --- features/cabin_openings.js --- */
/**
 * Cabin openings: spatial, read-only feedback for windows and the sunroof.
 * The car diagram mirrors for right-hand-drive layouts. A short detail view
 * confirms changed positions, then becomes a compact persistent reminder.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WINDOWS = [
    { key: 'window_driver_position', short: 'C', label: 'Conductor' },
    { key: 'window_passenger_position', short: 'CP', label: 'Copiloto' },
    { key: 'window_driver_rear_position', short: 'TC', label: 'Trasera conductor' },
    { key: 'window_passenger_rear_position', short: 'TP', label: 'Trasera copiloto' },
  ];
  const FIELDS = WINDOWS.map((item) => item.key).concat([
    'sunshade_position', 'sunroof_position', 'air_conditioning',
  ]);
  const OPENINGS = WINDOWS.map((item) => item.key).concat(['sunroof_position']);
  const DETAIL_MS = 2500;
  const BATCH_MS = 150;
  const values = Object.fromEntries(FIELDS.map((key) => [key, 0]));
  values.air_conditioning = false;
  let card = null;
  let diagram = null;
  let details = null;
  let compactText = null;
  let message = null;
  let shadeLayer = null;
  let roofOpening = null;
  let openShapes = {};
  let visual = Object.assign({}, values);
  let hasState = false;
  let detailTimer = null;
  let batchTimer = null;
  let roofTimer = null;
  let pendingKeys = new Set();
  let pendingRoof = null;
  let shadeMotionEnds = 0;
  let rain = false;
  let weatherOff = null;
  let readyOff = null;
  let reducedMotion = false;

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
  }

  function svgElement(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    return node;
  }

  function appendWindow(group, x, y, key) {
    group.appendChild(svgElement('rect', {
      x, y, width: 9, height: 34, rx: 2, class: 'co-window-frame',
    }));
    const opening = svgElement('rect', {
      x: x + 1, y: y + 1, width: 7, height: 32, rx: 1, class: 'co-window-open',
      'data-field': key,
    });
    opening.style.transformBox = 'fill-box';
    opening.style.transformOrigin = 'center bottom';
    opening.style.transform = 'scaleY(0)';
    openShapes[key] = opening;
    group.appendChild(opening);
  }

  function makeDiagram(ctx) {
    const svg = svgElement('svg', {
      class: 'co-car', viewBox: '0 0 100 190', role: 'img',
      'aria-label': 'Vista superior del carro y sus aperturas',
    });
    svg.dataset.mirrored = ctx.config.side === 'right' ? 'true' : 'false';

    svg.appendChild(svgElement('path', {
      d: 'M50 3 C34 3 26 8 22 19 L15 43 Q12 50 12 61 L12 137 Q12 148 16 159 L22 176 Q27 187 50 187 Q73 187 78 176 L84 159 Q88 148 88 137 L88 61 Q88 50 85 43 L78 19 C74 8 66 3 50 3 Z',
      class: 'co-body',
    }));
    svg.appendChild(svgElement('path', {
      d: 'M28 22 Q50 13 72 22 L77 43 L23 43 Z', class: 'co-windshield',
    }));
    svg.appendChild(svgElement('path', {
      d: 'M23 146 L77 146 L71 170 Q50 179 29 170 Z', class: 'co-rear-glass',
    }));
    svg.appendChild(svgElement('path', {
      d: 'M19 48 L81 48 L81 72 L19 72 Z M19 91 L81 91 L81 121 L19 121 Z',
      class: 'co-cabin-seams',
    }));

    const windows = svgElement('g', { class: 'co-windows' });
    appendWindow(windows, 13, 52, 'window_driver_position');
    appendWindow(windows, 78, 52, 'window_passenger_position');
    appendWindow(windows, 13, 94, 'window_driver_rear_position');
    appendWindow(windows, 78, 94, 'window_passenger_rear_position');
    svg.appendChild(windows);

    svg.appendChild(svgElement('rect', {
      x: 34, y: 72, width: 32, height: 48, rx: 4, class: 'co-roof-frame',
    }));
    roofOpening = svgElement('rect', {
      x: 38, y: 76, width: 24, height: 40, rx: 2, class: 'co-roof-open',
    });
    roofOpening.style.transformBox = 'fill-box';
    roofOpening.style.transformOrigin = 'center top';
    roofOpening.style.transform = 'scaleY(0)';
    svg.appendChild(roofOpening);
    shadeLayer = svgElement('rect', {
      x: 36, y: 74, width: 28, height: 44, rx: 2, class: 'co-shade',
    });
    shadeLayer.style.transformBox = 'fill-box';
    shadeLayer.style.transformOrigin = 'center top';
    shadeLayer.style.transform = 'scaleY(1)';
    svg.appendChild(shadeLayer);

    svg.appendChild(svgElement('path', {
      d: 'M50 5 L50 13 M46 10 L50 14 L54 10', class: 'co-front-mark',
    }));
    return svg;
  }

  function openKeys() {
    return OPENINGS.filter((key) => values[key] > 0);
  }

  function anyOpening() { return openKeys().length > 0; }

  function hasRisk() {
    const anyWindow = WINDOWS.some((item) => values[item.key] > 0);
    return (anyWindow && (Boolean(values.air_conditioning) || rain)) || (values.sunroof_position > 0 && rain);
  }

  function refreshCopy() {
    const lines = [];
    for (const item of WINDOWS) {
      const amount = values[item.key];
      if (amount > 0) lines.push(`${item.label}: ${amount}% abierta`);
    }
    if (values.sunroof_position > 0) lines.push(`Techo: ${values.sunroof_position}% abierto`);
    if (values.sunshade_position > 0) lines.push(`Cortinilla: ${values.sunshade_position}% retraída`);
    else if (values.sunroof_position > 0) lines.push('Cortinilla: cerrada');
    details.textContent = lines.length ? lines.join(' · ') : 'Todo cerrado';

    const compact = [];
    for (const item of WINDOWS) {
      const amount = values[item.key];
      if (amount > 0) compact.push(`${item.short} ${amount}%`);
    }
    if (values.sunroof_position > 0) compact.push(`Techo ${values.sunroof_position}%`);
    if (values.sunshade_position > 0 && values.sunroof_position > 0) compact.push(`Cort. ${values.sunshade_position}%`);
    else if (values.sunroof_position > 0) compact.push('Cort. cerrada');
    compactText.textContent = compact.join(' · ');
    card.dataset.empty = anyOpening() ? 'false' : 'true';
    card.dataset.roofObstructed = values.sunroof_position > 0 && values.sunshade_position < 100 ? 'true' : 'false';

    if (hasRisk()) {
      const reasons = [];
      if (values.air_conditioning && WINDOWS.some((item) => values[item.key] > 0)) reasons.push('ventana abierta con A/C');
      if (rain && (WINDOWS.some((item) => values[item.key] > 0) || values.sunroof_position > 0)) reasons.push('apertura con lluvia');
      message.textContent = `Atención: ${reasons.join(' · ')}`;
      card.dataset.risk = 'true';
    } else {
      message.textContent = '';
      card.dataset.risk = 'false';
    }
  }

  function setVisibility(visible) {
    card.dataset.visible = visible ? 'true' : 'false';
    card.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function setMode(mode) { card.dataset.mode = mode; }

  function displayDuration(from, to) {
    if (reducedMotion || from === to) return 0;
    return Math.max(300, Math.min(3000, Math.abs(to - from) * 30));
  }

  function applyPercent(key, node, next, transformFor) {
    const previous = Number(visual[key]) || 0;
    const duration = displayDuration(previous, next);
    node.style.transition = duration ? `transform ${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)` : 'none';
    node.style.transform = transformFor(next);
    visual[key] = next;
    return duration;
  }

  function finishPendingRoof() {
    if (pendingRoof == null) return;
    if (values.sunshade_position < 100) return;
    const target = pendingRoof;
    pendingRoof = null;
    if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
    const delay = Math.max(0, shadeMotionEnds - Date.now());
    if (delay > 0 && target > 0) {
      roofTimer = setTimeout(() => {
        roofTimer = null;
        applyPercent('sunroof_position', roofOpening, target, (n) => `scaleY(${n / 100})`);
      }, delay);
    } else {
      applyPercent('sunroof_position', roofOpening, target, (n) => `scaleY(${n / 100})`);
    }
  }

  function renderVisual(keys, animate, reset) {
    const changed = new Set(keys);
    for (const item of WINDOWS) {
      if (!animate || reset) {
        openShapes[item.key].style.transition = 'none';
        openShapes[item.key].style.transform = `scaleY(${values[item.key] / 100})`;
        visual[item.key] = values[item.key];
      } else if (changed.has(item.key)) {
        applyPercent(item.key, openShapes[item.key], values[item.key], (n) => `scaleY(${n / 100})`);
      }
    }

    if (!animate || reset) {
      shadeLayer.style.transition = 'none';
      roofOpening.style.transition = 'none';
      shadeLayer.style.transform = `scaleY(${(100 - values.sunshade_position) / 100})`;
      roofOpening.style.transform = `scaleY(${values.sunroof_position / 100})`;
      visual.sunshade_position = values.sunshade_position;
      visual.sunroof_position = values.sunroof_position;
      shadeMotionEnds = 0;
      pendingRoof = null;
      if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
      return;
    }

    if (changed.has('sunshade_position')) {
      const duration = applyPercent('sunshade_position', shadeLayer, values.sunshade_position,
        (n) => `scaleY(${(100 - n) / 100})`);
      shadeMotionEnds = Date.now() + duration;
      if (values.sunshade_position < 100) {
        pendingRoof = null;
        if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
        if (values.sunroof_position > 0) {
          applyPercent('sunroof_position', roofOpening, values.sunroof_position,
            (n) => 'scaleY(' + (n / 100) + ')');
        }
      } else if (pendingRoof != null) {
        finishPendingRoof();
      }
    }

    if (changed.has('sunroof_position')) {
      const target = values.sunroof_position;
      if (target > 0 && values.sunshade_position >= 100 && Date.now() < shadeMotionEnds) {
        pendingRoof = target;
        finishPendingRoof();
      } else {
        pendingRoof = null;
        if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
        applyPercent('sunroof_position', roofOpening, target, (n) => `scaleY(${n / 100})`);
      }
    }
  }

  function updateCard(animate, reset, changedKeys) {
    const staticRender = !animate || reset;
    const keys = Array.isArray(changedKeys) ? changedKeys : Array.from(pendingKeys);
    if (staticRender) card.style.transition = 'none';
    refreshCopy();
    renderVisual(keys, animate, reset);
    const active = anyOpening();
    const openingChanged = keys.some((key) => OPENINGS.includes(key) || key === 'sunshade_position');
    if (reset) {
      if (detailTimer) { clearTimeout(detailTimer); detailTimer = null; }
      setMode('compact');
      setVisibility(active);
      card.offsetHeight;
      card.style.transition = '';
      return;
    }

    // Context-only updates with no open window or roof do not create a false message.
    if (!active && !openingChanged) return;

    setVisibility(true);
    setMode('detail');
    if (detailTimer) clearTimeout(detailTimer);
    if (active) {
      detailTimer = setTimeout(() => {
        setMode('compact');
        detailTimer = null;
      }, DETAIL_MS);
    } else {
      // refreshCopy already shows the single neutral “Todo cerrado” confirmation.
      detailTimer = setTimeout(() => {
        setVisibility(false);
        detailTimer = null;
      }, DETAIL_MS);
    }
    if (staticRender) {
      card.offsetHeight;
      card.style.transition = '';
    }
  }

  function updateWeather(isRain) {
    rain = Boolean(isRain);
    if (card && hasState) refreshCopy();
  }

  function normalizeSide(side) {
    if (side === 'right' || side === 0 || side === '0') return 'right';
    if (side === 'left' || side === 1 || side === '1') return 'left';
    return null;
  }

  function applyDriverSide(side) {
    const normalized = normalizeSide(side);
    if (!normalized || !card || !diagram) return;
    card.dataset.side = normalized === 'right' ? 'left' : 'right';
    diagram.dataset.mirrored = normalized === 'right' ? 'true' : 'false';
  }

  function rainFromWeather(value, weatherList) {
    let candidate = value;
    if (candidate && typeof candidate === 'object') {
      candidate = candidate.name != null ? candidate.name : candidate.index;
    }
    if (typeof candidate === 'number' && Array.isArray(weatherList)) {
      const entry = weatherList.find((item) => item && Number(item.index) === candidate);
      candidate = entry && entry.name;
    }
    return typeof candidate === 'string' && /(rain|rainy|lluvia|lluvioso|storm|tormenta|drizzle|llovizna)/i.test(candidate);
  }

  function readInitialWeather() {
    try {
      const pd = window.PromptDrive;
      if (!pd || typeof pd.get !== 'function' || typeof pd.weathers !== 'function') return false;
      const index = pd.get('scene.weatherIndex');
      const list = pd.weathers();
      if (!Array.isArray(list) || list.length === 0) return false;
      return rainFromWeather(index, list);
    } catch (_error) { return false; }
  }

  CabinFeedback.register({
    id: 'cabin_openings',
    title: 'Aperturas de cabina',
    fields: FIELDS,

    init(ctx) {
      reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const style = document.createElement('style');
      style.textContent = `
        .co-card {
          position: absolute; top: max(1.6vh, env(safe-area-inset-top));
          width: clamp(14vw, 18vw, 23vw); max-width: 24vw; box-sizing: border-box;
          padding: clamp(0.65vh, 1vh, 1.4vh) clamp(0.65vw, 0.9vw, 1.2vw);
          border: 1px solid rgba(151, 205, 217, 0.48); border-radius: 1.1vw;
          background: rgba(10, 18, 25, 0.91); color: #f4f7f8;
          box-shadow: 0 1vh 2.3vw rgba(0, 0, 0, 0.28);
          font: 500 clamp(0.72vw, 0.9vw, 1.05vw)/1.28 system-ui, -apple-system, sans-serif;
          opacity: 0; visibility: hidden; transform: translateY(-0.7vh) scale(0.98);
          transition: opacity 220ms ease, transform 220ms ease, visibility 220ms;
          backdrop-filter: blur(0.5vw); overflow: hidden;
        }
        .co-card[data-side="left"] { left: max(1.3vw, env(safe-area-inset-left)); }
        .co-card[data-side="right"] { right: max(1.3vw, env(safe-area-inset-right)); }
        .co-card[data-visible="true"] { opacity: 1; visibility: visible; transform: none; }
        .co-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1vw; margin-bottom: 0.65vh; }
        .co-title { color: #bce9ef; font-size: 0.82em; font-weight: 750; letter-spacing: 0.1em; text-transform: uppercase; }
        .co-front-label { color: rgba(244,247,248,0.68); font-size: 0.78em; }
        .co-content { display: flex; align-items: center; gap: 0.65vw; }
        .co-car { display: block; flex: 0 0 31%; width: 31%; max-height: 25vh; overflow: visible; transition: transform 200ms ease; }
        .co-car[data-mirrored="true"] { transform: scaleX(-1); }
        .co-body { fill: #26343e; stroke: rgba(236,246,250,0.88); stroke-width: 1.5; }
        .co-windshield, .co-rear-glass { fill: #506a76; stroke: rgba(220,239,244,0.78); stroke-width: 1; }
        .co-cabin-seams { fill: none; stroke: rgba(220,239,244,0.5); stroke-width: 1; }
        .co-window-frame { fill: #101b22; stroke: rgba(220,239,244,0.85); stroke-width: 1; }
        .co-window-open { fill: #5ac6d4; opacity: 0.95; }
        .co-roof-frame { fill: #18242c; stroke: rgba(220,239,244,0.8); stroke-width: 1; }
        .co-roof-open { fill: #14212a; stroke: #8eced8; stroke-width: 1; }
        .co-shade { fill: #aab9be; stroke: #e6eff0; stroke-width: 1; }
        .co-front-mark { fill: none; stroke: #f4f7f8; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
        .co-copy { flex: 1 1 auto; min-width: 0; }
        .co-details { color: rgba(244,247,248,0.95); font-size: 0.95em; line-height: 1.55; overflow-wrap: anywhere; }
        .co-compact { display: none; color: rgba(244,247,248,0.95); font-variant-numeric: tabular-nums; line-height: 1.4; overflow-wrap: anywhere; }
        .co-message { min-height: 0; margin-top: 0.25vh; color: rgba(244,247,248,0.9); font-weight: 700; }
        .co-message:empty { display: none; }
        .co-card[data-risk="true"] { border-color: #f1b647; box-shadow: 0 0 0 0.16vw rgba(241,182,71,0.16), 0 1vh 2.3vw rgba(0,0,0,0.28); }
        .co-card[data-risk="true"] .co-message { color: #ffd18a; }
        .co-card[data-risk="true"] .co-window-open, .co-card[data-risk="true"] .co-roof-open { fill: #f1b647; stroke: #ffd18a; }
        .co-card[data-roof-obstructed="true"] .co-roof-open { fill: #f1b647; stroke: #ffd18a; }
        .co-card[data-roof-obstructed="true"] .co-shade { fill: rgba(241,182,71,0.34); stroke: #ffd18a; }
        .co-card[data-empty="true"] .co-details { color: rgba(244,247,248,0.8); }
        .co-card[data-mode="compact"] { width: clamp(9vw, 11vw, 15vw); max-width: 16vw; }
        .co-card[data-mode="compact"] .co-details, .co-card[data-mode="compact"] .co-front-label { display: none; }
        .co-card[data-mode="compact"] .co-compact { display: block; }
        .co-card[data-mode="compact"] .co-car { flex-basis: 26%; width: 26%; max-height: 12vh; }
        @media (prefers-reduced-motion: reduce) {
          .co-card, .co-car, .co-window-open, .co-roof-open, .co-shade { transition: none !important; }
        }
      `;
      ctx.layer.appendChild(style);

      card = document.createElement('section');
      card.className = 'co-card';
      card.dataset.visible = 'false';
      card.dataset.risk = 'false';
      card.dataset.mode = 'detail';
      card.setAttribute('aria-hidden', 'true');
      card.setAttribute('aria-label', 'Estado de las ventanas, techo y cortinilla');

      const heading = document.createElement('div');
      heading.className = 'co-heading';
      const title = document.createElement('span');
      title.className = 'co-title';
      title.textContent = 'Aperturas';
      const front = document.createElement('span');
      front.className = 'co-front-label';
      front.textContent = '↑ frente';
      heading.append(title, front);
      card.appendChild(heading);

      const content = document.createElement('div');
      content.className = 'co-content';
      diagram = makeDiagram(ctx);
      content.appendChild(diagram);
      const copy = document.createElement('div');
      copy.className = 'co-copy';
      details = document.createElement('div');
      details.className = 'co-details';
      details.setAttribute('aria-live', 'polite');
      compactText = document.createElement('div');
      compactText.className = 'co-compact';
      message = document.createElement('div');
      message.className = 'co-message';
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      copy.append(details, compactText);
      content.appendChild(copy);
      card.append(heading, content, message);
      ctx.layer.appendChild(card);

      applyDriverSide(ctx.config.side);

      rain = readInitialWeather();
      try {
        const pd = window.PromptDrive;
        if (pd && typeof pd.on === 'function') {
          weatherOff = pd.on('weatherChange', (payload) => {
            let list = [];
            try { list = typeof pd.weathers === 'function' ? pd.weathers() : []; } catch (_error) {}
            updateWeather(rainFromWeather(payload, list));
          });
          readyOff = pd.on('ready', () => {
            try { applyDriverSide(pd.get('vehicle.side')); } catch (_error) { applyDriverSide(ctx.config.side); }
            updateWeather(readInitialWeather());
          });
        }
      } catch (_error) { weatherOff = null; }
    },

    onChange(changed, snapshot) {
      const initial = !hasState;
      const reset = !initial && FIELDS.every((key) => Object.prototype.hasOwnProperty.call(changed, key));
      const source = snapshot || changed || {};
      for (const key of FIELDS) {
        if (Object.prototype.hasOwnProperty.call(changed || {}, key)) values[key] = key === 'air_conditioning'
          ? Boolean(changed[key]) : clampPercent(changed[key]);
        else if (Object.prototype.hasOwnProperty.call(source, key)) values[key] = key === 'air_conditioning'
          ? Boolean(source[key]) : clampPercent(source[key]);
      }
      hasState = true;
      for (const key of Object.keys(changed || {})) if (FIELDS.includes(key)) pendingKeys.add(key);

      if (initial || reset) {
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
        pendingKeys = new Set(FIELDS);
        updateCard(false, true);
        pendingKeys.clear();
        return;
      }

      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        batchTimer = null;
        const keys = Array.from(pendingKeys);
        updateCard(true, false, keys);
        pendingKeys.clear();
        // Rendering a new target must be followed by the ordinary detail timeout.
        if (keys.length === 0) setMode(anyOpening() ? 'compact' : 'detail');
      }, BATCH_MS);
    },

    dispose() {
      if (detailTimer) clearTimeout(detailTimer);
      if (batchTimer) clearTimeout(batchTimer);
      if (roofTimer) clearTimeout(roofTimer);
      if (typeof weatherOff === 'function') weatherOff();
      if (typeof readyOff === 'function') readyOff();
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
