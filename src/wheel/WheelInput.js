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
