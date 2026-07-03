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
