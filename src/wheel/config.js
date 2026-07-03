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
