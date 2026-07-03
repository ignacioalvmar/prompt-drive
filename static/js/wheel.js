/* Steering-wheel & pedal controls — built from src/wheel/ */
(function () {
/* --- config.js --- */
/**
 * Steering-wheel configuration store (Logitech G923-class rigs).
 *
 * Holds the user's *intent* only — whether wheel input is enabled, which
 * device/axes to read, the calibrated ranges and the button→action bindings.
 * WheelInput resolves this against the live Gamepad API state each frame and
 * owns all transient state (edge detection, auto-ranging, capture flows).
 *
 * Dynamic class: changes apply live (the engine polls the facade per frame).
 * Selection persists in localStorage and is published on
 * `window.WheelControls`.
 *
 * The axis model differs from the engine's stock gamepad map on purpose:
 * wheel pedals rest at an extreme (G923: +1 released → −1 pressed), so every
 * analog function is a calibrated *range* (rest→full / min→max), never a
 * sign/max half-axis.
 */

const WHEEL_STORAGE_KEY = 'pd-wheel-config';

// localStorage key of the engine's input-mode observable (0 kb, 1 mouse, 2 pad)
const WHEEL_INPUT_MODE_KEY = 'config-vehicle-input';

// Device ids that identify a racing wheel for auto-selection / profile seeding.
const WHEEL_ID_PATTERN = /G923|G29|G920|G27|G25|Driving Force|Fanatec|Thrustmaster|T[0-9]{3}|wheel/i;

const WHEEL_DEFAULTS = {
  enabled: false, // off by default — zero impact on existing setups
  deviceId: null, // substring of gamepad.id; null = auto (prefer wheel-like ids)
  axes: {
    // steer: symmetric range around center. min/max/center refine via calibration.
    steer: { index: 0, min: -1, max: 1, center: 0 },
    // pedals: rest→full ranges. null rest/full = auto-range from live input.
    throttle: { index: 1, rest: null, full: null },
    brake: { index: 2, rest: null, full: null },
    clutch: { index: 3, rest: null, full: null },
  },
  steering: {
    rangeDeg: 540, // physical degrees for full in-game lock
    wheelDeg: 900, // device's total rotation (G923 default profile: 900°)
    deadzone: 0.01, // centre deadzone, fraction of full lock
    compensateLinearity: true, // invert the engine's thumbstick linearity curve
  },
  pedals: {
    deadzone: 0.05, // rest deadzone so a resting rig emits exactly 0
  },
  // buttonIndex (string) -> actionId. All rebindable in the panel / API.
  bindings: {
    0: 'cameraNext',
    1: 'weatherNext',
    2: 'headlights',
    3: 'autodrive',
    4: 'cruiseDown',
    5: 'cruiseUp',
    6: 'handbrake',
    7: 'boost',
    8: 'mute',
    9: 'pause',
  },
};

const WHEEL_LIMITS = {
  rangeDeg: { min: 90, max: 1080 },
  wheelDeg: { min: 180, max: 1080 },
  steerDeadzone: { min: 0, max: 0.2 },
  pedalDeadzone: { min: 0, max: 0.3 },
};

/**
 * Bindable actions. `kind`:
 *   'held'  — level-triggered, active while the button is down
 *   'tap'   — edge-triggered once per press
 * `via`:
 *   'signal' — engine input control (set Y.signal / fire Y.on, mirroring the
 *              stock getGamepadValue behaviour); `control` names it and
 *              `setSignal` says whether the engine consumes the signal too
 *              (the stock `W` map) vs. listeners only.
 *   'api'    — dispatched through window.PromptDrive.
 */
const WHEEL_ACTIONS = [
  { id: 'pause', label: 'Pause game', kind: 'tap', via: 'signal', control: 'Pause', setSignal: true },
  { id: 'cameraNext', label: 'Next camera view', kind: 'tap', via: 'signal', control: 'CameraMode', setSignal: true },
  { id: 'weatherNext', label: 'Next weather', kind: 'tap', via: 'api', api: 'weatherNext' },
  { id: 'weatherPrev', label: 'Previous weather', kind: 'tap', via: 'api', api: 'weatherPrev' },
  { id: 'skinNext', label: 'Next season/skin', kind: 'tap', via: 'signal', control: 'NextScene', setSignal: true },
  { id: 'skinPrev', label: 'Previous season/skin', kind: 'tap', via: 'signal', control: 'PrevScene', setSignal: true },
  { id: 'headlights', label: 'Toggle headlights', kind: 'tap', via: 'signal', control: 'Headlights', setSignal: true },
  { id: 'autodrive', label: 'Toggle autodrive', kind: 'tap', via: 'signal', control: 'Autodrive', setSignal: true },
  { id: 'cruiseToggle', label: 'Cruise control on/off', kind: 'tap', via: 'signal', control: 'ToggleSpeedControl', setSignal: true },
  { id: 'cruiseUp', label: 'Cruise speed +', kind: 'tap', via: 'signal', control: 'IncSpeedControl', setSignal: false },
  { id: 'cruiseDown', label: 'Cruise speed −', kind: 'tap', via: 'signal', control: 'DecSpeedControl', setSignal: false },
  { id: 'handbrakeToggle', label: 'Handbrake toggle', kind: 'tap', via: 'signal', control: 'ToggleHandbrake', setSignal: true, silent: true },
  { id: 'reset', label: 'Reset vehicle', kind: 'tap', via: 'signal', control: 'Reset', setSignal: true, silent: true },
  { id: 'mute', label: 'Mute audio', kind: 'tap', via: 'signal', control: 'Mute', setSignal: false },
  { id: 'toggleUI', label: 'Toggle HUD', kind: 'tap', via: 'signal', control: 'ToggleUI', setSignal: false },
  { id: 'handbrake', label: 'Handbrake (hold)', kind: 'held', via: 'signal', control: 'Handbrake' },
  { id: 'boost', label: 'Boost (hold)', kind: 'held', via: 'signal', control: 'Boost' },
  { id: 'reverse', label: 'Reverse / brake (hold)', kind: 'held', via: 'signal', control: 'Backward' },
];

const WHEEL_ACTION_BY_ID = {};
for (const a of WHEEL_ACTIONS) WHEEL_ACTION_BY_ID[a.id] = a;

function wheelClampNum(v, lo, hi, fallback) {
  v = Number(v);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function wheelSanitiseAxis(axis, fallback, symmetric) {
  const src = axis && typeof axis === 'object' ? axis : {};
  const out = {};
  out.index = src.index == null ? fallback.index : Math.max(0, Math.round(Number(src.index)) || 0);
  if (src.index === null) out.index = null; // explicitly unassigned
  if (symmetric) {
    out.min = Number.isFinite(Number(src.min)) ? Number(src.min) : fallback.min;
    out.max = Number.isFinite(Number(src.max)) ? Number(src.max) : fallback.max;
    out.center = Number.isFinite(Number(src.center)) ? Number(src.center) : fallback.center;
    if (out.max <= out.min) { out.min = fallback.min; out.max = fallback.max; out.center = fallback.center; }
  } else {
    out.rest = src.rest == null ? null : Number(src.rest);
    out.full = src.full == null ? null : Number(src.full);
    if (out.rest != null && !Number.isFinite(out.rest)) out.rest = null;
    if (out.full != null && !Number.isFinite(out.full)) out.full = null;
    if (out.rest != null && out.full != null && out.rest === out.full) { out.rest = null; out.full = null; }
  }
  return out;
}

/** Coerce an arbitrary partial config into a valid, normalised config. */
function wheelSanitise(cfg) {
  cfg = cfg || {};
  const d = WHEEL_DEFAULTS;
  const axes = cfg.axes || {};
  const steering = cfg.steering || {};
  const pedals = cfg.pedals || {};
  const out = {
    enabled: !!cfg.enabled,
    deviceId: cfg.deviceId == null ? null : String(cfg.deviceId),
    axes: {
      steer: wheelSanitiseAxis(axes.steer, d.axes.steer, true),
      throttle: wheelSanitiseAxis(axes.throttle, d.axes.throttle, false),
      brake: wheelSanitiseAxis(axes.brake, d.axes.brake, false),
      clutch: wheelSanitiseAxis(axes.clutch, d.axes.clutch, false),
    },
    steering: {
      rangeDeg: wheelClampNum(steering.rangeDeg, WHEEL_LIMITS.rangeDeg.min, WHEEL_LIMITS.rangeDeg.max, d.steering.rangeDeg),
      wheelDeg: wheelClampNum(steering.wheelDeg, WHEEL_LIMITS.wheelDeg.min, WHEEL_LIMITS.wheelDeg.max, d.steering.wheelDeg),
      deadzone: wheelClampNum(steering.deadzone, WHEEL_LIMITS.steerDeadzone.min, WHEEL_LIMITS.steerDeadzone.max, d.steering.deadzone),
      compensateLinearity: steering.compensateLinearity == null ? d.steering.compensateLinearity : !!steering.compensateLinearity,
    },
    pedals: {
      deadzone: wheelClampNum(pedals.deadzone, WHEEL_LIMITS.pedalDeadzone.min, WHEEL_LIMITS.pedalDeadzone.max, d.pedals.deadzone),
    },
    bindings: {},
  };
  const rawBindings = cfg.bindings && typeof cfg.bindings === 'object' ? cfg.bindings : d.bindings;
  for (const k in rawBindings) {
    const btn = Math.round(Number(k));
    const action = rawBindings[k];
    if (!Number.isFinite(btn) || btn < 0 || btn > 63) continue;
    if (action == null) continue;
    if (!WHEEL_ACTION_BY_ID[action]) continue;
    out.bindings[btn] = String(action);
  }
  return out;
}

/** Tiny observable store: get / set (merge) / subscribe, with persistence. */
class WheelStore {
  constructor() {
    this._listeners = new Set();
    this._cfg = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(WHEEL_STORAGE_KEY);
      if (raw) return wheelSanitise(wheelDeepMerge(wheelDeepCopy(WHEEL_DEFAULTS), JSON.parse(raw)));
    } catch (_e) {
      /* ignore corrupt storage */
    }
    return wheelDeepCopy(WHEEL_DEFAULTS);
  }

  _save() {
    try {
      localStorage.setItem(WHEEL_STORAGE_KEY, JSON.stringify(this._cfg));
    } catch (_e) {
      /* storage may be unavailable */
    }
  }

  /** Current configuration (a deep copy — callers must not mutate it). */
  get() {
    return wheelDeepCopy(this._cfg);
  }

  /** Deep-merge a partial config, validate, persist, and notify subscribers. */
  set(partial) {
    const next = wheelSanitise(wheelDeepMerge(this.get(), partial || {}));
    const changed = JSON.stringify(next) !== JSON.stringify(this._cfg);
    this._cfg = next;
    if (changed) {
      this._save();
      this._emit();
    }
    return this.get();
  }

  /** Replace the bindings map wholesale (set() merges, which can't unbind). */
  setBindings(bindings) {
    const next = this.get();
    next.bindings = bindings || {};
    const clean = wheelSanitise(next);
    const changed = JSON.stringify(clean) !== JSON.stringify(this._cfg);
    this._cfg = clean;
    if (changed) {
      this._save();
      this._emit();
    }
    return this.get();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snap = this.get();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch (_e) {
        /* a bad listener must not break the others */
      }
    }
  }
}

function wheelDeepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

// Plain-object deep merge (arrays and scalars replace).
function wheelDeepMerge(base, patch) {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  for (const k in patch) {
    out[k] = wheelDeepMerge(out[k], patch[k]);
  }
  return out;
}


/* --- WheelInput.js --- */
/**
 * Wheel input engine: resolves the persisted config against the live Gamepad
 * API each frame and computes the engine-facing signals.
 *
 * Called by the patched engine from inside `Y.updateGamepad()` (input mode 2)
 * via `WheelControls._engineApply(Y)`, so wheel input rides the engine's own
 * analog path: `controllerSignal.Left/Right` feed `smoothControllerSteer`,
 * `controllerSignal.Forward/Backward` are blended into the per-frame signals,
 * and every downstream behaviour (autodrive cancel, cruise, boost, handbrake
 * toggling) is unchanged. The engine keeps calling `Y.update()` at 10 Hz while
 * paused (ticker.tickPaused), so a pause binding can also unpause.
 *
 * Owns all transient state: device selection, pedal auto-ranging, button edge
 * detection, and the guided calibration / button-capture flows.
 */

class WheelInput {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit || function () {}; // (event, payload) -> API event bus
    this.cfg = store.get();
    this._unsub = store.subscribe((cfg) => {
      // Rebuild runtime pedal ranges when the axis config changes externally
      // (API set / calibration / panel), so stale ranges never shadow it.
      if (JSON.stringify(cfg.axes) !== JSON.stringify(this.cfg.axes)) this._range = {};
      this.cfg = cfg;
    });

    this.padIndex = null; // resolved gamepad index, re-scanned on (dis)connect
    this._didPress = {}; // buttonIndex -> bool, edge detection
    this._range = {}; // role -> live auto-range { rest, full } (runtime copy)
    this._rangeDirty = 0; // last persist time for auto-range refinements
    this.signals = { steer: 0, throttle: 0, brake: 0, clutch: 0 }; // last computed
    this.active = false; // a device was applied on the last engine frame

    this.capture = null; // live calibration / button-capture state

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        this.padIndex = null;
        try { this.emit('wheelConnected', { id: e.gamepad ? e.gamepad.id : null }); } catch (_e) {}
      });
      window.addEventListener('gamepaddisconnected', () => {
        this.padIndex = null;
        this.active = false;
        try { this.emit('wheelDisconnected', {}); } catch (_e) {}
      });
    }
  }

  // --- device selection ------------------------------------------------------

  _pads() {
    try {
      if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
      return Array.prototype.slice.call(navigator.getGamepads() || []);
    } catch (_e) {
      return [];
    }
  }

  devices() {
    return this._pads()
      .filter((p) => p && p.connected !== false)
      .map((p) => ({ index: p.index, id: p.id, axes: p.axes.length, buttons: p.buttons.length }));
  }

  /** The selected pad: explicit id substring > wheel-like id > pad 0. */
  selectPad() {
    const pads = this._pads();
    if (this.padIndex != null) {
      const cached = pads[this.padIndex];
      if (cached && cached.connected !== false) return cached;
      this.padIndex = null;
    }
    let pick = null;
    const want = this.cfg.deviceId;
    for (const p of pads) {
      if (!p || p.connected === false) continue;
      if (want) {
        if (p.id && p.id.toLowerCase().indexOf(want.toLowerCase()) >= 0) { pick = p; break; }
      } else if (p.id && WHEEL_ID_PATTERN.test(p.id)) {
        pick = p;
        break;
      } else if (!pick) {
        pick = p; // fallback: first connected pad
      }
    }
    if (pick) this.padIndex = pick.index;
    return pick || null;
  }

  // --- axis mapping ----------------------------------------------------------

  /** Steering: calibrated symmetric range → [-1, 1] with rotation scaling. */
  _steerValue(pad) {
    const a = this.cfg.axes.steer;
    if (a.index == null || pad.axes[a.index] == null) return 0;
    const v = pad.axes[a.index];
    const half = Math.max(1e-6, (a.max - a.min) / 2);
    let s = (v - a.center) / half;
    // Map physical rotation to full lock: a 900° wheel with a 540° range
    // reaches full steer at ±270°.
    const st = this.cfg.steering;
    s *= st.wheelDeg / Math.max(1, st.rangeDeg);
    s = Math.max(-1, Math.min(1, s));
    if (Math.abs(s) < st.deadzone) return 0;
    // Re-normalise past the deadzone so full lock is still reachable.
    s = Math.sign(s) * ((Math.abs(s) - st.deadzone) / (1 - st.deadzone));
    if (st.compensateLinearity) s = this._inverseLinearity(s);
    return s;
  }

  /**
   * The engine's gamepad steer curve (smoothControllerSteer) applies
   * e = c·lin + c²(1−lin), tuned for thumbsticks. Pre-distort with the inverse
   * so wheel angle → steer stays linear whatever `P.linearity` is set to.
   * P is read live off the bridge (registered by build-main.js).
   */
  _inverseLinearity(s) {
    let lin = 0.25; // engine default (deobfuscated.js:782)
    try {
      const b = typeof window !== 'undefined' ? window.PromptDriveBridge : null;
      const P = b && b.handles && b.handles.gamepadSettings;
      if (P && typeof P.linearity === 'number') lin = P.linearity;
    } catch (_e) {}
    if (lin >= 0.999) return s;
    const t = Math.abs(s);
    const k = 1 - lin;
    // Solve t = c·lin + c²·k for c ∈ [0,1].
    const c = (-lin + Math.sqrt(lin * lin + 4 * k * t)) / (2 * k);
    return Math.sign(s) * Math.min(1, c);
  }

  /**
   * Pedals: calibrated rest→full range → [0, 1]. Ranges may start null
   * (auto-range): the first read snapshots `rest`; the observed extreme beyond
   * a movement threshold becomes — and keeps extending — `full`. Refinements
   * are persisted (throttled) so the rig stays calibrated across reloads.
   */
  _pedalValue(pad, role) {
    const a = this.cfg.axes[role];
    if (!a || a.index == null || pad.axes[a.index] == null) return 0;
    const v = pad.axes[a.index];
    let r = this._range[role];
    if (!r) {
      r = this._range[role] = {
        rest: a.rest != null ? a.rest : v,
        full: a.full,
        lastV: v,
      };
    }
    // Chrome/DirectInput quirk: an axis reports exactly 0 until the device
    // sends its first input report, then jumps to the true released position
    // in a single frame. Re-baseline that jump instead of reading it as pedal
    // travel (which would declare the wrong pressed direction).
    if (r.full == null && r.rest === 0 && Math.abs(v - r.lastV) > 0.5) {
      r.rest = v;
      r.lastV = v;
      return 0;
    }
    r.lastV = v;
    if (r.full == null) {
      // Pressed direction unknown yet: real travel ≥ 0.25 declares it.
      if (Math.abs(v - r.rest) >= 0.25) r.full = v > r.rest ? 1 : -1;
      else return 0;
    }
    // Rest drift (springs settle slightly past the captured rest): follow only
    // on the far side of rest, away from the pressed direction — never while
    // the pedal is in its working range.
    if ((r.full > r.rest && v < r.rest) || (r.full < r.rest && v > r.rest)) r.rest = v;
    // Extend the range if the pedal travels past the recorded extreme.
    if (r.full > r.rest && v > r.full) r.full = Math.min(1, v);
    if (r.full < r.rest && v < r.full) r.full = Math.max(-1, v);
    this._persistRange(role, r);
    const span = r.full - r.rest;
    if (Math.abs(span) < 0.3) return 0; // uncalibrated / degenerate range
    let s = (v - r.rest) / span;
    s = Math.max(0, Math.min(1, s));
    const dz = this.cfg.pedals.deadzone;
    if (s < dz) return 0;
    return (s - dz) / (1 - dz);
  }

  _persistRange(role, r) {
    if (r.full == null) return;
    const a = this.cfg.axes[role];
    const drift = a.rest == null || a.full == null ||
      Math.abs(a.rest - r.rest) > 0.05 || Math.abs(a.full - r.full) > 0.05;
    const now = Date.now();
    if (drift && now - this._rangeDirty > 2000) {
      this._rangeDirty = now;
      const patch = { axes: {} };
      patch.axes[role] = { index: a.index, rest: r.rest, full: r.full };
      this.store.set(patch);
    }
  }

  // --- per-frame engine seam ---------------------------------------------------

  /**
   * Called from inside the patched Y.updateGamepad(). `Y` is the engine input
   * singleton. Returns true when a device was found and signals were written
   * (the stock gamepad mapping is skipped); false falls back to stock.
   */
  apply(Y) {
    const pad = this.selectPad();
    if (!pad) {
      this.active = false;
      return false;
    }
    this.active = true;

    // A capture flow owns the device while it runs (mirrors the engine's own
    // remap mode, which also suspends normal input).
    if (this.capture) {
      this._updateCapture(pad);
      Y.controllerSignal.Forward = 0;
      Y.controllerSignal.Backward = 0;
      Y.controllerSignal.Left = 0;
      Y.controllerSignal.Right = 0;
      return true;
    }

    const steer = this._steerValue(pad);
    const throttle = this._pedalValue(pad, 'throttle');
    const brake = this._pedalValue(pad, 'brake');
    const clutch = this._pedalValue(pad, 'clutch');
    this.signals = { steer, throttle, brake, clutch };

    // Analog driving signals. Steering: negative = left (axis convention).
    Y.controllerSignal.Left = Math.max(0, -steer);
    Y.controllerSignal.Right = Math.max(0, steer);
    Y.controllerSignal.Forward = throttle;
    Y.controllerSignal.Backward = brake;

    // Button bindings: held actions level-trigger a signal; tap actions fire
    // once per rising edge, mirroring the stock getGamepadValue behaviour.
    const bindings = this.cfg.bindings;
    for (const btnKey in bindings) {
      const idx = +btnKey;
      const b = pad.buttons[idx];
      if (!b) continue;
      const pressed = b.pressed || b.value > 0.5;
      const action = WHEEL_ACTION_BY_ID[bindings[btnKey]];
      if (!action) continue;
      if (action.kind === 'held') {
        if (pressed) {
          if (action.control === 'Backward') Y.controllerSignal.Backward = 1;
          else Y.signal[action.control] = 1;
        }
      } else if (pressed) {
        if (!this._didPress[idx]) {
          this._didPress[idx] = true;
          this._dispatchTap(Y, action);
        }
      }
      if (!pressed) this._didPress[idx] = false;
    }
    return true;
  }

  _dispatchTap(Y, action) {
    try { this.emit('wheelAction', { action: action.id }); } catch (_e) {}
    if (action.via === 'signal') {
      // Mirror the engine's own event-control handling: one-frame signal for
      // controls the engine consumes (stock `W` map) and a listener event for
      // the ones wired via Y.on (Pause → ticker toggle, Mute, skins, cruise …).
      if (action.setSignal) Y.signal[action.control] = 1;
      if (!action.silent) {
        try { Y.on(action.control, 1); } catch (_e) {}
      }
      return;
    }
    if (action.via === 'api') {
      if (action.api === 'weatherNext') this._cycleWeather(1);
      else if (action.api === 'weatherPrev') this._cycleWeather(-1);
    }
  }

  _cycleWeather(dir) {
    try {
      const PD = typeof window !== 'undefined' ? window.PromptDrive : null;
      if (!PD) return;
      const list = PD.weathers();
      if (!Array.isArray(list) || !list.length) return;
      const cur = Number(PD.get('scene.weatherIndex')) || 0;
      const next = ((cur + dir) % list.length + list.length) % list.length;
      PD.dynamic.weather(next);
    } catch (_e) {
      /* sim not live yet */
    }
  }

  // --- guided calibration ------------------------------------------------------

  /**
   * Start a capture flow. `target` is 'steer' | 'throttle' | 'brake' |
   * 'clutch' (axis calibration) or { button: actionId } (bind next pressed
   * button). Runs its own rAF loop so it works before the sim starts and
   * while paused; when the engine is live, apply() forwards pad state too.
   * Result is persisted and announced on the event bus.
   */
  startCapture(target, opts) {
    const pad = this.selectPad();
    if (!pad) return { ok: false, error: 'unavailable', message: 'no gamepad detected' };
    this.cancelCapture();
    const durationMs = (opts && opts.durationMs) || 4000;
    this.capture = {
      target,
      until: Date.now() + durationMs,
      initAxes: pad.axes.slice(),
      minAxes: pad.axes.slice(),
      maxAxes: pad.axes.slice(),
      initButtons: pad.buttons.map((b) => b.pressed || b.value > 0.5),
      done: false,
    };
    const loop = () => {
      if (!this.capture || this.capture.done) return;
      const p = this.selectPad();
      if (p) this._updateCapture(p);
      if (this.capture && !this.capture.done) requestAnimationFrame(loop);
    };
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(loop);
    return { ok: true, value: { capturing: typeof target === 'string' ? target : 'button', durationMs } };
  }

  cancelCapture() {
    if (this.capture) this.capture.done = true;
    this.capture = null;
  }

  _updateCapture(pad) {
    const cap = this.capture;
    if (!cap || cap.done) return;

    if (typeof cap.target === 'object' && cap.target && cap.target.button) {
      // Button capture: first rising edge wins.
      for (let i = 0; i < pad.buttons.length; i++) {
        const pressed = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
        if (pressed && !cap.initButtons[i]) {
          const actionId = cap.target.button;
          const bindings = this.store.get().bindings;
          // One action per button: drop any previous binding of this button.
          bindings[i] = actionId;
          this.store.setBindings(bindings);
          this._finishCapture({ kind: 'button', button: i, action: actionId });
          return;
        }
        if (!pressed) cap.initButtons[i] = false;
      }
    } else {
      // Axis capture: track per-axis min/max while the user actuates.
      for (let i = 0; i < pad.axes.length; i++) {
        if (pad.axes[i] < cap.minAxes[i]) cap.minAxes[i] = pad.axes[i];
        if (pad.axes[i] > cap.maxAxes[i]) cap.maxAxes[i] = pad.axes[i];
      }
      if (Date.now() >= cap.until) this._resolveAxisCapture(cap);
    }
    if (cap.until && Date.now() >= cap.until && !cap.done) {
      this._finishCapture({ kind: typeof cap.target === 'string' ? cap.target : 'button', timedOut: true });
    }
  }

  _resolveAxisCapture(cap) {
    let best = -1;
    let bestRange = 0.3; // require real travel — ignores noise/drift
    for (let i = 0; i < cap.initAxes.length; i++) {
      const range = cap.maxAxes[i] - cap.minAxes[i];
      if (range > bestRange) { bestRange = range; best = i; }
    }
    if (best < 0) {
      this._finishCapture({ kind: cap.target, error: 'no_axis_moved' });
      return;
    }
    const patch = { axes: {} };
    if (cap.target === 'steer') {
      patch.axes.steer = {
        index: best,
        min: cap.minAxes[best],
        max: cap.maxAxes[best],
        center: cap.initAxes[best],
      };
    } else {
      const rest = cap.initAxes[best];
      // The pressed extreme is whichever end travelled further from rest.
      const full = (cap.maxAxes[best] - rest) >= (rest - cap.minAxes[best])
        ? cap.maxAxes[best] : cap.minAxes[best];
      patch.axes[cap.target] = { index: best, rest, full };
      delete this._range[cap.target]; // rebuild runtime range from the new calibration
    }
    this.store.set(patch);
    this._finishCapture({ kind: cap.target, axis: best, config: patch.axes[cap.target] });
  }

  _finishCapture(result) {
    if (this.capture) this.capture.done = true;
    this.capture = null;
    try { this.emit('wheelCalibrated', result); } catch (_e) {}
    if (result && result.kind === 'button' && result.action) {
      try { this.emit('wheelBinding', result); } catch (_e) {}
    }
  }

  // --- introspection ------------------------------------------------------------

  state() {
    const pad = this.selectPad();
    return {
      supported: typeof navigator !== 'undefined' && !!navigator.getGamepads,
      connected: !!pad,
      device: pad ? { index: pad.index, id: pad.id, axes: pad.axes.length, buttons: pad.buttons.length } : null,
      axes: pad ? pad.axes.slice() : [],
      buttons: pad ? pad.buttons.map((b) => ({ pressed: b.pressed, value: Math.round(b.value * 100) / 100 })) : [],
      signals: Object.assign({}, this.signals),
      active: this.active,
      capturing: this.capture ? (typeof this.capture.target === 'string' ? this.capture.target : 'button') : null,
    };
  }
}


/* --- WheelPanel.js --- */
/**
 * Steering-wheel configuration UI, injected into the game's settings panel as
 * a collapsible "steering wheel" section (below the traffic section, which is
 * appended before this bundle loads).
 *
 * Mirrors TrafficPanel: the React-rendered settings list mounts/unmounts as
 * the user opens/closes it, so the section is (re)injected via a
 * MutationObserver and matches the native collapsible markup.
 *
 * All controls are live (dynamic class): enable, device, steering range,
 * per-axis calibration with live bars, and the button→action binding editor.
 */

const WP_STYLE_ID = 'pd-wheel-style';
const WP_SECTION_ID = 'pd-wheel-section';
const WP_CONTENT_ID = 'pd-wheel-content';

const WP_CSS = `
#${WP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${WP_SECTION_ID} .collapsible-cross{float:right}
#${WP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${WP_CONTENT_ID}.open{display:block}
#${WP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${WP_CONTENT_ID} .pd-wrow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${WP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${WP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${WP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${WP_CONTENT_ID} .pd-step .val{min-width:52px;text-align:center;color:#eafffb;font-weight:600}
#${WP_CONTENT_ID} .pd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#${WP_CONTENT_ID} .pd-actions button,#${WP_CONTENT_ID} .pd-cal{font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:6px 8px;cursor:pointer;letter-spacing:1px}
#${WP_CONTENT_ID} .pd-actions button{flex:1 1 auto}
#${WP_CONTENT_ID} .pd-actions button:hover,#${WP_CONTENT_ID} .pd-cal:hover{border-color:#3ec6b5}
#${WP_CONTENT_ID} .pd-actions button.on{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${WP_CONTENT_ID} .pd-cal{flex:0 0 auto;padding:3px 8px}
#${WP_CONTENT_ID} .pd-cal.capturing{background:#4a3413;border-color:#ffcf5c;color:#ffe9b0}
#${WP_CONTENT_ID} .pd-bar{position:relative;flex:1;height:10px;background:#111;
  border:1px solid #333;border-radius:5px;overflow:hidden;min-width:60px}
#${WP_CONTENT_ID} .pd-bar>i{position:absolute;top:0;bottom:0;background:#3ec6b5;border-radius:4px}
#${WP_CONTENT_ID} .pd-dev{font-size:11px;color:#8aa0a0;word-break:break-all}
#${WP_CONTENT_ID} .pd-dev b{color:#cfe9e6}
#${WP_CONTENT_ID} .pd-bind{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px}
#${WP_CONTENT_ID} .pd-bind .btn-id{flex:0 0 52px;color:#eafffb;font-weight:600}
#${WP_CONTENT_ID} .pd-bind select{flex:1;background:#111;color:#cfe9e6;border:1px solid #333;
  border-radius:5px;padding:3px;font:12px Jura,system-ui}
#${WP_CONTENT_ID} .pd-bind .rm{flex:0 0 auto;width:22px;height:22px;background:#2a2a2a;
  color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${WP_CONTENT_ID} .pd-bind .rm:hover{border-color:#c65a3e;color:#ffb8a6}
#${WP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${WP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

class WheelPanel {
  constructor(store, getFacade) {
    this.store = store;
    this.getFacade = getFacade;
    this.expanded = false;
    this._raf = null;
    this._injectStyle();
    this._buildSection();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._unsub = store.subscribe(() => this._render());
  }

  _injectStyle() {
    if (document.getElementById(WP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = WP_STYLE_ID;
    s.textContent = WP_CSS;
    document.head.appendChild(s);
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInject();
    });
  }

  _tryInject() {
    const list = document.querySelector('.settings-input-list');
    if (!list) return;
    if (list.contains(this.header) && list.contains(this.content)) return;
    list.appendChild(this.header);
    list.appendChild(this.content);
    this._render();
  }

  _buildSection() {
    this.header = wpEl('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = WP_SECTION_ID;
    this.title = wpEl('div', 'collapsible-title', 'steering wheel');
    this.cross = wpEl('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = wpEl('div');
    this.content.id = WP_CONTENT_ID;

    // --- enable + device ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'wheel & pedals'));
    const toggles = wpEl('div', 'pd-actions');
    this.enabledBtn = wpEl('button', null, 'Wheel off');
    this.enabledBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.getFacade().setEnabled(!this.store.get().enabled);
    });
    toggles.append(this.enabledBtn);
    this.content.appendChild(toggles);
    this.deviceRow = wpEl('div', 'pd-dev', 'no device detected');
    this.content.appendChild(this.deviceRow);

    // --- steering ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'steering'));
    this.steerBarRow = this._barRow('Steer', 'steer', true);
    this.content.appendChild(this.steerBarRow.row);
    this.rangeRow = this._stepperRow('Rotation for full lock', () => this._adjustRange(-90), () => this._adjustRange(90));
    this.content.appendChild(this.rangeRow.row);

    // --- pedals ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'pedals'));
    this.throttleRow = this._barRow('Throttle', 'throttle');
    this.brakeRow = this._barRow('Brake', 'brake');
    this.clutchRow = this._barRow('Clutch', 'clutch');
    this.content.append(this.throttleRow.row, this.brakeRow.row, this.clutchRow.row);

    // --- bindings ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'button bindings'));
    this.bindList = wpEl('div');
    this.content.appendChild(this.bindList);
    const addRow = wpEl('div', 'pd-actions');
    this.addBindBtn = wpEl('button', null, 'Add binding — press a button…');
    this.addSelect = document.createElement('select');
    this.addSelect.style.cssText = 'flex:1;background:#111;color:#cfe9e6;border:1px solid #333;border-radius:5px;padding:5px;font:12px Jura,system-ui';
    for (const a of WHEEL_ACTIONS) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.label;
      this.addSelect.appendChild(o);
    }
    this.addSelect.addEventListener('click', (e) => e.stopPropagation());
    this.addBindBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._captureButton(this.addSelect.value);
    });
    addRow.append(this.addSelect, this.addBindBtn);
    this.content.appendChild(addRow);

    this.note = wpEl('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _barRow(label, role, symmetric) {
    const row = wpEl('div', 'pd-wrow');
    row.appendChild(wpEl('span', null, label));
    const bar = wpEl('div', 'pd-bar');
    const fill = document.createElement('i');
    bar.appendChild(fill);
    const cal = wpEl('button', 'pd-cal', 'Calibrate');
    cal.addEventListener('click', (e) => {
      e.stopPropagation();
      this._calibrate(role, cal);
    });
    row.append(bar, cal);
    return { row, bar, fill, cal, role, symmetric };
  }

  _stepperRow(label, onMinus, onPlus) {
    const row = wpEl('div', 'pd-wrow');
    row.appendChild(wpEl('span', null, label));
    const step = wpEl('div', 'pd-step');
    const minus = wpEl('button', null, '−');
    const val = wpEl('span', 'val', '');
    const plus = wpEl('button', null, '+');
    const stop = (fn) => (e) => {
      e.stopPropagation();
      fn();
    };
    minus.addEventListener('click', stop(onMinus));
    plus.addEventListener('click', stop(onPlus));
    step.append(minus, val, plus);
    row.appendChild(step);
    return { row, val };
  }

  _adjustRange(delta) {
    const cfg = this.store.get();
    this.store.set({ steering: { rangeDeg: cfg.steering.rangeDeg + delta } });
  }

  _calibrate(role, btn) {
    const facade = this.getFacade();
    const hint = role === 'steer'
      ? 'turn the wheel fully left, then fully right'
      : 'press the pedal fully, then release';
    const r = facade.calibrate(role);
    if (!r.ok) {
      btn.textContent = 'No device';
      setTimeout(() => { btn.textContent = 'Calibrate'; }, 1500);
      return;
    }
    btn.classList.add('capturing');
    btn.textContent = hint;
    const done = () => {
      btn.classList.remove('capturing');
      btn.textContent = 'Calibrated ✓';
      setTimeout(() => { btn.textContent = 'Calibrate'; }, 1500);
      off();
    };
    const off = facade.onEvent
      ? facade.onEvent('wheelCalibrated', done)
      : (setTimeout(done, 4200), () => {});
  }

  _captureButton(actionId) {
    const facade = this.getFacade();
    const r = facade.captureButton(actionId);
    if (!r.ok) {
      this.addBindBtn.textContent = 'No device';
      setTimeout(() => { this.addBindBtn.textContent = 'Add binding — press a button…'; }, 1500);
      return;
    }
    this.addBindBtn.classList.add('capturing');
    this.addBindBtn.textContent = 'Press the wheel button now…';
    const done = () => {
      this.addBindBtn.classList.remove('capturing');
      this.addBindBtn.textContent = 'Add binding — press a button…';
      off();
    };
    const off = facade.onEvent
      ? facade.onEvent('wheelCalibrated', done)
      : (setTimeout(done, 4200), () => {});
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+';
    this.content.classList.toggle('open', this.expanded);
    if (this.expanded) this._startLive();
    else this._stopLive();
  }

  // Live bars: poll the pad via the facade while the section is open.
  _startLive() {
    if (this._raf) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._renderLive();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopLive() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _renderLive() {
    let st = null;
    try { st = this.getFacade().state(); } catch (_e) { return; }
    if (!st) return;
    this.deviceRow.innerHTML = st.connected
      ? `<b>${wpEsc(st.device.id)}</b> — ${st.device.axes} axes, ${st.device.buttons} buttons` +
        (st.active ? ' · <b>driving</b>' : '')
      : 'no device detected — press a wheel button or turn the wheel to wake it';
    const rows = [this.steerBarRow, this.throttleRow, this.brakeRow, this.clutchRow];
    for (const r of rows) {
      const v = st.signals ? st.signals[r.role] || 0 : 0;
      if (r.symmetric) {
        // centred bar: fill from the middle toward the deflection
        const half = Math.abs(v) * 50;
        r.fill.style.left = v < 0 ? 50 - half + '%' : '50%';
        r.fill.style.width = half + '%';
      } else {
        r.fill.style.left = '0';
        r.fill.style.width = Math.max(0, Math.min(1, v)) * 100 + '%';
      }
    }
  }

  _render() {
    if (!this.rangeRow) return;
    const cfg = this.store.get();
    this.enabledBtn.textContent = cfg.enabled ? 'Wheel on' : 'Wheel off';
    this.enabledBtn.classList.toggle('on', cfg.enabled);
    this.rangeRow.val.textContent = cfg.steering.rangeDeg + '°';

    // bindings list
    this.bindList.innerHTML = '';
    const btns = Object.keys(cfg.bindings).map(Number).sort((a, b) => a - b);
    for (const btn of btns) {
      const row = wpEl('div', 'pd-bind');
      row.appendChild(wpEl('span', 'btn-id', 'Btn ' + btn));
      const sel = document.createElement('select');
      for (const a of WHEEL_ACTIONS) {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = a.label;
        if (a.id === cfg.bindings[btn]) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        const bindings = this.store.get().bindings;
        bindings[btn] = sel.value;
        this.store.setBindings(bindings);
      });
      const rm = wpEl('button', 'rm', '×');
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        const bindings = this.store.get().bindings;
        delete bindings[btn];
        this.store.setBindings(bindings);
      });
      row.append(sel, rm);
      this.bindList.appendChild(row);
    }
    if (!btns.length) this.bindList.appendChild(wpEl('div', 'pd-dev', 'no buttons bound'));

    this.note.innerHTML =
      'Enabling the wheel switches the input mode to <b>gamepad</b>. ' +
      'Pedals self-calibrate after a full press; use <b>Calibrate</b> if an axis ' +
      'is mis-assigned. Steering reaches full lock at ±<b>' +
      Math.round(cfg.steering.rangeDeg / 2) + '°</b> of physical rotation.';
  }

  dispose() {
    this._stopLive();
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function wpEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function wpEsc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}


/* --- WheelControls.js --- */
/**
 * Public facade for steering-wheel & pedal input, exposed as
 * `window.WheelControls`. The engine polls it from inside the patched
 * `Y.updateGamepad()` (input mode 2 / gamepad); this module owns the user's
 * intent (config + persistence + settings UI) and WheelInput owns all live
 * device state.
 *
 * API (also surfaced as `PromptDrive.wheel.*`):
 *   WheelControls.get()                 -> config (see src/wheel/config.js)
 *   WheelControls.set(partial)          -> deep-merge, validate, persist, live
 *   WheelControls.setEnabled(bool)      -> enable + switch engine input mode
 *   WheelControls.state()               -> { supported, connected, device, axes,
 *                                            buttons, signals, active, capturing }
 *   WheelControls.devices()             -> connected gamepads
 *   WheelControls.actions()             -> bindable actions [{id,label,kind}]
 *   WheelControls.bind(button, action)  / unbind(button)
 *   WheelControls.calibrate(target)     -> guided capture ('steer'|'throttle'|
 *                                          'brake'|'clutch')
 *   WheelControls.captureButton(action) -> bind the next pressed button
 *   WheelControls.subscribe(fn)         -> fn(cfg) on config change
 *
 * Engine-facing seam (called by the patched main bundle, not by users):
 *   WheelControls.enabled()             cheap per-frame gate
 *   WheelControls._engineApply(Y)       per-frame signal computation; returns
 *                                       true when a device handled the frame
 */

function wheelEmit(event, payload) {
  try {
    if (typeof window !== 'undefined' && window.PromptDriveBridge) {
      window.PromptDriveBridge.emit(event, payload);
    }
  } catch (_e) {}
}

const wheelStore = new WheelStore();
const wheelInput = new WheelInput(wheelStore, wheelEmit);
const wheelPanel =
  typeof document !== 'undefined' && typeof WheelPanel !== 'undefined'
    ? new WheelPanel(wheelStore, () => WheelControls)
    : null;

// Switch the engine's input mode (0 keyboard, 2 gamepad): live through the
// bridge handle when the sim is running, and always persisted so the next
// load starts in the right mode.
function wheelSetInputMode(mode) {
  try {
    const b = typeof window !== 'undefined' ? window.PromptDriveBridge : null;
    const D = b && b.handles && b.handles.inputMode;
    if (D && typeof D.set === 'function' && D.value !== mode) D.set(mode);
  } catch (_e) {}
  try {
    localStorage.setItem('config-vehicle-input', JSON.stringify(mode));
  } catch (_e) {}
}

const WheelControls = {
  get: () => wheelStore.get(),
  set: (partial) => {
    const before = wheelStore.get().enabled;
    const cfg = wheelStore.set(partial);
    if (cfg.enabled !== before) wheelSetInputMode(cfg.enabled ? 2 : 0);
    return cfg;
  },
  setEnabled: (on) => WheelControls.set({ enabled: !!on }),
  subscribe: (fn) => wheelStore.subscribe(fn),
  defaults: wheelDeepCopy(WHEEL_DEFAULTS),
  limits: WHEEL_LIMITS,

  state: () => wheelInput.state(),
  devices: () => wheelInput.devices(),
  actions: () => WHEEL_ACTIONS.map((a) => ({ id: a.id, label: a.label, kind: a.kind })),

  bind: (button, actionId) => {
    const btn = Math.round(Number(button));
    if (!Number.isFinite(btn) || btn < 0) return { ok: false, error: 'bad_value', message: 'bad button index' };
    if (!WHEEL_ACTION_BY_ID[actionId]) {
      return { ok: false, error: 'bad_value', message: 'unknown action', options: WHEEL_ACTIONS.map((a) => a.id) };
    }
    const bindings = wheelStore.get().bindings;
    bindings[btn] = actionId;
    wheelStore.setBindings(bindings);
    wheelEmit('wheelBinding', { button: btn, action: actionId });
    return { ok: true, value: { button: btn, action: actionId } };
  },
  unbind: (button) => {
    const btn = Math.round(Number(button));
    const bindings = wheelStore.get().bindings;
    if (!(btn in bindings)) return { ok: false, error: 'bad_value', message: 'button not bound' };
    delete bindings[btn];
    wheelStore.setBindings(bindings);
    wheelEmit('wheelBinding', { button: btn, action: null });
    return { ok: true, value: { button: btn, action: null } };
  },

  calibrate: (target, opts) => {
    if (['steer', 'throttle', 'brake', 'clutch'].indexOf(target) < 0) {
      return { ok: false, error: 'bad_value', message: 'target must be steer|throttle|brake|clutch' };
    }
    return wheelInput.startCapture(target, opts);
  },
  captureButton: (actionId, opts) => {
    if (!WHEEL_ACTION_BY_ID[actionId]) {
      return { ok: false, error: 'bad_value', message: 'unknown action', options: WHEEL_ACTIONS.map((a) => a.id) };
    }
    return wheelInput.startCapture({ button: actionId }, opts);
  },
  cancelCapture: () => {
    wheelInput.cancelCapture();
    return { ok: true, value: null };
  },

  /** Discard learned/calibrated ranges for one axis role (or all of them). */
  resetCalibration: (target) => {
    const roles = target ? [target] : ['steer', 'throttle', 'brake', 'clutch'];
    const patch = { axes: {} };
    for (const role of roles) {
      if (!WHEEL_DEFAULTS.axes[role]) return { ok: false, error: 'bad_value', message: 'unknown axis role: ' + role };
      const cur = wheelStore.get().axes[role];
      patch.axes[role] = Object.assign({}, WHEEL_DEFAULTS.axes[role], { index: cur.index });
    }
    return { ok: true, value: WheelControls.set(patch) };
  },

  // Panel convenience: subscribe to bridge events with an unsubscribe fn.
  onEvent: (event, fn) => {
    try {
      if (typeof window !== 'undefined' && window.PromptDriveBridge) {
        return window.PromptDriveBridge.on(event, fn);
      }
    } catch (_e) {}
    return () => {};
  },

  // --- engine seam ---
  // Per-frame gate: read WheelInput's cached config, not a store deep-copy.
  enabled: () => !!wheelInput.cfg.enabled,
  _engineApply: (Y) => wheelInput.apply(Y),
  _input: wheelInput,
  _panel: wheelPanel,
};

if (typeof window !== 'undefined') {
  window.WheelControls = WheelControls;
}

})();
