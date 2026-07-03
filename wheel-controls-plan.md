# Steering-wheel & pedal controls — design plan

Enable driving Prompt Drive with a physical steering-wheel + pedal rig
(reference hardware: **Logitech G923**, but any Gamepad-API wheel works), and
let wheel **buttons be bound to game actions** (pause, camera view, weather,
headlights, autodrive, cruise, …). Configuration lives in **both** the in-game
settings panel and the **integration API / API test console**.

## 1. What the engine already has (and where it falls short)

The upstream engine ships a complete *gamepad* input mode:

| Piece | Where | Notes |
| --- | --- | --- |
| Input mode observable `D` (`config-controller-index`) | `deobfuscated.js:617` | `0` keyboard, `1` mouse, `2` gamepad — already exposed via the API as `controls.input`. |
| Default gamepad map `L` + persisted map `T` (`controls_gamepad`) | `:684`, `:777` | Per-control `{type: button|axis, index, sign, max}`. |
| Gamepad settings `P` (`controls_gamepad_settings`) | `:778` | `steerSmoothing`, `steerRange`, `linearity`, `deadzone`, `autoBoost`. |
| Per-frame polling `Y.updateGamepad()` | `:1163` | Runs when `D.value == 2`; writes analog `controllerSignal.*`. |
| Analog steering path `smoothControllerSteer()` | `:20265` | `controllerSignal.Left − Right` → smoothed/limited steer. |
| Debounced action events | `:1267` (`getGamepadValue`) | Buttons fire `Y.on(action)`: `Pause` toggles the ticker (`:1517`), `Mute` (`:20552`), `NextScene`/`PrevScene` cycle skins (`:20556`), `CameraMode`/`Headlights`/`Autodrive`/`Reset` via signals, cruise `ToggleSpeedControl`/`Inc`/`DecSpeedControl` (`:17105`). |

**Why a G923 doesn't work with the stock path:**

1. **Pedals rest at an extreme.** The engine's axis model is
   `signal = max(0, (v·sign − deadzone)/…)/max` — it assumes axes rest at 0
   (a thumbstick). G923 pedals report **+1 released → −1 pressed**, so the
   stock remap captures the wrong sign and a released pedal reads as full
   throttle. There is no *offset/rest* concept.
2. **Only `gamepads[0]` is read** (`getGP()`, `:896`). A rig may enumerate
   multiple HID devices.
3. **No wheel-rotation range mapping.** A 900° wheel mapped 1:1 onto the axis
   feels sluggish; there is no "degrees of rotation for full lock" setting.
4. **Bindable actions are limited to the engine's control list** — no weather
   binding, and the remap UI (settings sidebar → gamepad → controls) inherits
   problem 1 for any axis-based control.

## 2. Approach

A new first-party subsystem following the repo's extension pattern
(`AGENTS.md`): **`src/wheel/` → `static/js/wheel.js` → `window.WheelControls`**.

- The **facade owns intent**: config + validation + persistence
  (`localStorage['pd-wheel-config']`) + its own settings-panel section.
- The **engine polls it per frame** via one anchored patch in
  `Y.updateGamepad()`: when the wheel subsystem is enabled and a device is
  present, it computes the signals itself and the stock mapping is skipped.
  Wheel input therefore uses the engine's own **input mode 2 (gamepad)** —
  steering runs through `smoothControllerSteer` exactly like a stock gamepad,
  and every downstream behaviour (autodrive cancel on pedal input, cruise,
  boost, handbrake toggling) is unchanged.
- **Live state is published back** on the facade (`state()`: device, raw
  axes/buttons, computed signals) for the panel, the API and the test console.

### 2.1 Axis model (the actual fix)

Every analog function is a calibrated range, not a sign/max half-axis:

```
steer:    { index, min, max, center }   // norm = (v − center)/(half-range) ∈ [−1, 1]
throttle: { index, rest, full }         // signal = clamp((v − rest)/(full − rest), 0, 1)
brake:    { index, rest, full }
clutch:   { index, rest, full }         // read + published, not used for driving
```

- `rest`/`full` may start as `null` → **auto-ranging**: the first poll
  snapshots `rest`; the observed extreme (beyond a movement threshold) becomes
  and keeps extending `full`. A couple of pedal presses self-calibrate the rig
  even if the default axis guess for the browser/OS is right but the range is
  not. Explicit calibration (below) overrides.
- Steering maps physical degrees to lock: with the device turning `wheelDeg`
  (G923: 900°) and a configured `rangeDeg` (default 540°), the normalized axis
  is scaled by `wheelDeg/rangeDeg` and clamped — full in-game lock at ±270°.
- Deadzones: small centre deadzone for steer, rest deadzone for pedals (so a
  resting rig never emits `controllerSignal.Forward/Backward` > 0, which would
  cancel autodrive, `:19955`).
- The engine applies its gamepad steer *linearity* curve (`P.linearity`,
  default 0.25) which is tuned for thumbsticks. The wheel subsystem
  **pre-distorts with the inverse curve** (reading the live `P` handle off the
  bridge) so wheel angle → steer angle stays linear regardless of that setting
  (`steering.compensateLinearity`, default on).

### 2.2 Device selection & defaults

- `deviceId: null` = auto: prefer the first `navigator.getGamepads()` entry
  whose `id` matches `/G923|G29|G920|G27|G25|Driving Force|wheel/i`, else pad 0.
  A specific id substring can be persisted (panel dropdown / API).
- When a Logitech G-series id is detected and axes are unassigned, a default
  profile is seeded: steer = axis 0, throttle = axis 1, brake = axis 2,
  clutch = axis 3, all pedals auto-ranging. (Axis order differs across
  browser/OS/firmware — that's what auto-ranging + calibration are for.)

### 2.3 Calibration (guided capture)

Implemented in `WheelInput`, driven from the panel and the API:

- `calibrate('steer')` — 4 s window: snapshot initial values (= centre), user
  sweeps the wheel lock-to-lock; the axis with the largest range wins;
  observed min/max stored.
- `calibrate('throttle'|'brake'|'clutch')` — snapshot rest, user presses the
  pedal; the axis with the largest delta wins; `rest` = initial, `full` =
  extreme reached.
- `captureButton(actionId)` — next rising button edge binds that button.
- Results are persisted immediately and announced on the API event bus
  (`wheelCalibrated`, `wheelBinding`) so remote callers (test console) can
  await them without long-poll ops.

### 2.4 Button → action bindings

`bindings: { "<buttonIndex>": "<actionId>" }`. Two kinds of action:

| Kind | Actions | Dispatch |
| --- | --- | --- |
| **held** (level) | `handbrake`, `boost`, `reverse` | set `Y.signal.*` / `controllerSignal.Backward` while held |
| **tap** (edge) | `pause`, `cameraNext`, `weatherNext`, `weatherPrev`, `skinNext`, `skinPrev`, `headlights`, `autodrive`, `cruiseToggle`, `cruiseUp`, `cruiseDown`, `handbrakeToggle`, `reset`, `mute`, `toggleUI` | engine controls mimic `getGamepadValue`: one-frame `Y.signal[Control] = 1` + `Y.on(Control)`; weather actions go through `window.PromptDrive.dynamic.weather()` cycling the active skin's list |

Default bindings (all rebindable): `0`→cameraNext, `1`→weatherNext,
`2`→headlights, `3`→autodrive, `4`→cruiseDown, `5`→cruiseUp,
`6`→handbrake (held), `7`→boost (held), `8`→mute, `9`→pause.

### 2.5 Enabling

`enabled` (default **off** — zero impact on existing studies). Enabling:
- live: sets the engine input mode to gamepad (`D.set(2)` via the bridge);
- always: persists `config-vehicle-input = 2` so the next load starts in
  gamepad mode.
Disabling restores keyboard (`0`). With the wheel enabled but no device
connected, `_engineApply` returns `false` and the stock gamepad path runs —
the game never breaks.

## 3. Engine integration map (build-main.js patches)

| Patch | Anchor | Change |
| --- | --- | --- |
| **Wheel input takeover** | `updateGamepad() { H = T.value; Q = this.getGP(); if (Q) {` (`:1163`) | Before the stock mapping: `if (WheelControls?.enabled() && WheelControls._engineApply(this)) return;` (guarded `try/catch`, `typeof` checks). |
| **Extra bridge handles** | existing `PromptDrive bridge attach` patch | add `gamepadSettings: P`, `inputMode: D`, `gamepadMap: T` (all module-scoped in the same closure — `smoothControllerSteer` at `:20278` proves `P`/`D` are in scope). |

Everything else rides on existing seams: the analytics event forwarding, the
`PromptDriveBridge` handle registry and the settings-panel MutationObserver
injection used by lanes/traffic/metrics.

## 4. Files

| Path | Purpose |
| --- | --- |
| `src/wheel/config.js` | Defaults, limits, action registry, sanitise, observable `WheelStore` (localStorage `pd-wheel-config`). |
| `src/wheel/WheelInput.js` | Device selection, per-frame signal computation, auto-ranging, calibration + button-capture flows, edge dispatch. |
| `src/wheel/WheelPanel.js` | Settings-panel section **steering wheel** (below *traffic*): enable, device, live bars, calibrate buttons, binding editor. |
| `src/wheel/WheelControls.js` | `window.WheelControls` facade + engine seam (`_engineApply`). |
| `scripts/build-wheel.js` | Bundle → `static/js/wheel.js` (IIFE, mirrors build-traffic). |
| `index.html` | `<script src="./static/js/wheel.js">` between `traffic.js` and `api.js`. |

## 5. API surface (`window.PromptDrive.wheel`)

```
wheel.get()                    // { ok, value: config }
wheel.set(partial)             // validate + persist + live effect (dynamic)
wheel.state()                  // { supported, connected, device, axes, buttons, signals, active }
wheel.devices()                // connected gamepads [{ index, id, axes, buttons }]
wheel.actions()                // bindable actions [{ id, label, kind }]
wheel.bind(button, actionId)   // set one binding      wheel.unbind(button)
wheel.calibrate(target)        // start guided capture ('steer'|'throttle'|'brake'|'clutch')
wheel.captureButton(actionId)  // bind next pressed button
```

- Schema: new `wheel` object field, class **dynamic** (config is persisted
  immediately and applied live; also commit-able through `config.set/apply`).
- `get()` snapshot gains a `wheel` domain.
- Events: `wheelConnected`, `wheelDisconnected`, `wheelCalibrated`,
  `wheelBinding`, `wheelAction`.
- Test console (`api-test.html`): a **Steering wheel** card on the dynamic tab
  — enable switch, device/state readout, calibration buttons, bindings editor
  (dropdown per action + capture), all over the BroadcastChannel ops; capture
  completion arrives via the event stream.

## 6. Out of scope

- **Force feedback**: browsers expose only rumble (`vibrationActuator`), not
  FFB torque — the G923's belt drive cannot be driven from the Gamepad API.
- **Multi-device rigs** (separate USB pedals): the model supports picking one
  device; blending two devices can be added later by giving each axis role an
  optional device id.
- Engine-sidebar remap UI for wheels: superseded by the wheel section while
  the subsystem is enabled (stock behaviour returns when disabled).

## 7. Validation

`npm run build` (anchored patches fail loudly), then in-browser:
panel injection, enable → input mode flips to gamepad, synthetic
`navigator.getGamepads` stub drives steer/throttle/brake through telemetry
(`steerRad`, `speed`), button edges fire `paused`/`cameraChange`/
`weatherChange` events, API ops respond over BroadcastChannel, and a fresh
load with cleared storage behaves stock.
