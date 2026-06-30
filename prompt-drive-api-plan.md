# Prompt Drive — Integration API Plan

**Status:** Draft for review · **Author:** senior dev (AI/agents) · **Date:** 2026‑06‑30

This document proposes an API that lets external services configure and steer the
Prompt Drive simulation — both **static** setup (applied before/at world generation)
and **dynamic** runtime changes (applied live, without restarting the drive).

It is a *plan only*. Nothing here is implemented yet. Once reviewed and approved,
the phased implementation in §7 can begin.

---

## 1. Goals & non‑goals

**Goals**

- Let another service (an AI agent harness, an orchestrator, a test rig, a parent
  web app) **read** the full simulation configuration and **submit** two kinds of change:
  - **Config requests** — static setup chosen before the drive starts (seed, scene,
    topography, vehicle type, initial weather, lane layout, controls, graphics…).
  - **Dynamic config requests** — runtime changes that take effect without a restart
    (weather/light, day‑night cycle, lane changes, headlights, autodrive, drive mode,
    grip/speed, camera…), and a forward path for future ones (traffic participants).
- Expose a **telemetry + event stream** so the caller can observe the result of its
  changes and the ego vehicle's state.
- Reuse the project's existing extension pattern (IIFE bundle → `window.*` global →
  engine hooks injected by `scripts/build-main.js`) so the API is built and shipped
  exactly like `LaneRoads`, `DrivingMetrics`, and `InstrumentCluster`.

**Non‑goals (v1)**

- No multiplayer / multi‑instance coordination.
- No persistence backend beyond the existing `localStorage` substrate.
- No new physics or new vehicles (we expose what exists; new content is separate work).
- No authentication design beyond an origin allow‑list for the browser transports
  (a networked control server, §5.3, is an optional later phase with its own auth).

---

## 2. How the simulation is configured today (background)

Prompt Drive is a **static client‑side web app** (`index.html` + `static/`), no server.
The game bundle is the deobfuscated source in `src-extracted/deobfuscated.js`, patched at
build time by `scripts/build-main.js`. Three first‑party subsystems are layered on top as
separate IIFE bundles loaded by `<script>` tags and exposed as window globals:

| Subsystem | Source | Bundle | Global |
|---|---|---|---|
| Instrument cluster | `src/cluster/` | `static/js/cluster.js` | `InstrumentCluster` |
| Driving metrics | `src/metrics/` | `static/js/metrics.js` | `DrivingMetrics` |
| Dynamic lanes | `src/lanes/` | `static/js/lanes.js` | `window.LaneRoads` |

The engine reaches these via hooks injected by `build-main.js` (e.g. the controller
constructs `new DrivingMetrics(r)` and calls `.sample(dt, state)` each physics frame).
**`window.LaneRoads` is the reference design for this API:** a facade owns *user intent* +
persistence + UI, the engine *polls/reads* it during generation, and live state is published
back onto the facade (`_resolved`, `_applied`, `_driving`).

### 2.1 Configuration stores

Two engine‑internal stores (both extend a tiny observable base class `p`/`l` with
`set(key,val)`, `addListener(key,fn)`, `onChanged`) hold config and persist each field to
`localStorage`:

- **VehicleConfig** (`We`, aliased `Fe`) — `deobfuscated.js:2695`. Keys `config-vehicle-*`.
  Descriptors in `Be` (`:2603`), key→storage map `Pe` (`:2571`), defaults `Ge` (`:2587`).
  **No reload guard** — fields apply live.
- **SceneConfig** (`Nh`, aliased `jh`) — `:13096`. Keys `config-scene-*`, `seed`, render/LOD/FOV.
  Descriptors `kh` (`:13067`), key→storage map `Dh` (`:13043`), defaults `Ch` (`:13055`).
  **Has a guard** (`:13168`, `if (i || !d.value)`) that blocks unforced changes while the
  flag `d` is set during generation; scene‑shape fields are effectively *baked at generation*.

Additional standalone observables / controllers:

- **Autodrive** — `ce` (`:1709`), `ce.set(bool)`; persists `has-autodrive`.
- **Vehicle controller / ego** — `Ae` (`:2064`): headlights (`setHeadlights`, `setHeadlightIntensity`,
  `:2029`), live ego state (speed, steer, accel, position, heading, onRoad), an event system.
- **Scene+weather controller** (the `Yo`/`Ah` scene objects, reached via `…scene` and the
  module global used at `:20470` `…nextSkin()`): `setWeatherIndex` (`:11031`), `nextWeather`,
  `setWeather` (`:11064`, mutates live weather + blends), `setSkin`/`nextSkin` (`:10849`),
  `setTopography` (`:10853`, writes localStorage → needs rebuild).
- **Day‑night cycle** — `Ks` (`:5492`) with lengths `qs = [0,180,480,900]` s.
- **Camera** — modes per vehicle (`ke`, `:2071`), cycled live via the `CameraMode` input
  signal (`:16603`), persisted to `config-camera-mode`.
- **Speed control / cruise** — `Vl` from `speed-control_*` localStorage (`:17026`), applied at `:19927`.
- **Units / general** — `ie` (MPH/KPH, MI/KM), audio config `en`.

### 2.2 Settings UI registry

The settings panel is built from a registry `_c` (`:21870`) mapping sections
(`General`/`Graphics`/`Vehicle`/`Audio`) to `{ state, meta }`, where `meta` is a descriptor
object (`readable`, `desc`, `type∈u`, `min/max/precision`, `labels`, `onSet`). Types enum `u`
(`:222`): `Boolean, Enum, Integer, Float, IntegerRange, FloatRange`. The lanes/metrics panels
inject themselves into this sidebar via `MutationObserver`. **An API can drive the exact same
`onSet`/`set` paths the UI uses** — the API and the panel stay in sync for free.

### 2.3 Existing inputs the engine already accepts

- **URL query params** (parsed at load): `seed`, `node` (start node), `topo` (`:13111`, `:2737`).
  This is today's only "static config from outside" channel.
- **`localStorage`** — the durable substrate for every config field; restored on load.
- **Keyboard/mouse/gamepad** signals → `Y.signal.*` (Forward/Backward/Left/Right/Boost/
  Handbrake/Headlights/Autodrive/CameraMode) consumed each frame.

### 2.4 Existing outbound event taxonomy (`el`)

`el` (`:13311`) is an analytics client built around a socket.io‑style `socket.emit(event, payload)`.
**Its `initialiseConnection()` is currently empty, so it's a no‑op** — but it already enumerates
the events worth re‑exposing as our event stream:
`paused, vehicleChange, driveModeChange, inputModeChange, weatherChange, skinChange,
cameraChange, renderScale, sceneConfigChange, resetCount, wrongWay, achievment,
vehicleController (periodic), stats, loadTimes`. We will reuse this seam (§5.3, §6.4).

---

## 3. Full configuration inventory

Legend — **Access**: how it's reached in the engine today. **Class**:
**S** = static (baked at world generation; needs rebuild/reload), **D** = dynamic (live setter
mutates the running sim), **S+D** = settable both before start *and* live.

### 3.1 World & scene

| Setting | Access (engine) | Type / values | Default | Class | Notes |
|---|---|---|---|---|---|
| Seed | `localStorage "seed"`, `?seed=`, setter `Ve` (`:2770`) | string | random hex | **S** | Drives all procedural generation; change ⇒ `location.reload()`. |
| Start node | `localStorage "start-node"`, `?node=` | int | 0 | **S** | Where along the route the drive begins. |
| Scene | `SceneConfig.sceneName` (`config-scene-name`) | enum: `Hills`, `Planet` | `Hills` | **S** | Whole world swap; baked at generation. |
| Topography | `SceneConfig.topography` / `?topo=` / `setTopography` | enum: `straight, casual, easy, normal, hard` (+`flat` via QS) | `normal` | **S** | Per‑scene height/road‑width profile; baked into terrain. |
| Skin (season/planet) | `setSkin`/`nextSkin` (`:10849`); `config-scene-skin` | Hills: `spring, summer(default), autumn, winter`; Planet: `mars, venus, moon` | `summer` | **S+D** | Initial value is config; `setSkin` also works live (palette/weather list swap). |
| Initial weather | `SceneConfig.weatherIndex` (`config-scene-weather-index`) | int index into skin's weather list | `2` | **S+D** | Initial index is static config; also live via `setWeatherIndex`. |
| Day‑night cycle length | `Ks.set(idx)` (`:5492`) | enum idx → `[0,180,480,900]` s (0 = off) | `0` | **S+D** | Hills skins define cycle arrays; Planet has none. |
| Lane layout | `window.LaneRoads.get/set` | `{forward 1–5, backward 0–5, width 2.4–3.75|auto}` | `1+1 auto` | **S+D** | Full range as *initial* config; **live changes clamped to ±1/direction** (existing rule). |

**Weather options** (selected by index within the active skin; each defines ambient/
directional/hemisphere light, fog near/far, sky/water colors, optional `sunPos`, `headlights`,
`dynamicFog`, `particles`): Hills — `clear/clearSpring/clearAutumn/clearSnow, sunrise(+seasonal),
sunset(+seasonal), twilight, rain(+seasonal), snow, night, nightSnow`; Planet — `mars, marsRise,
marsNight, venus, venusSet, moon`. (`deobfuscated.js:4823+`, `:11638+`.)

### 3.2 Vehicle

| Setting | Access (`Fe`/`We`) | Type / values | Default | Class | Notes |
|---|---|---|---|---|---|
| Vehicle type | `Fe.set("type", name)` ⇒ `changeVehicle`/`initVehicle` (`:18694`) | enum: `Roadster`, `Coach` (bus); `Bike`, `Rover` exist but `enabled:false` | `Roadster` | **S+D\*** | Hot‑swaps via full vehicle rebuild (no page reload), but heavy; treat as start‑time by default, allow live with a rebuild. |
| Drive mode | `Fe.set("mode", 0|1|2)` | enum: AWD / FWD / RWD | `0` AWD | **S+D** | Affects power distribution next tick. |
| Grip factor | `Fe.set("gripFactor", f)` | float 0.25–3.0 | `1` | **S+D** | Tyre slip scaling. |
| Speed factor | `Fe.set("speedFactor", f)` | float 0.5–2.0 | `1` | **S+D** | Motor power / top speed scaling. |
| Steering wheel range | `steerRotationIndex`→`steerRotation` | enum `[270,360,450,720,900]°` | `270` | **S+D** | Visual only. |
| Show steering wheel | `showWheel` | bool | `true` | **S+D** | Mesh visibility. |
| Driver side | `side` | bool 0=right / 1=left | `0` | **S+D** | Repositions interior. |
| Seat (driver/passenger) | `seat` | bool | `0` | **S+D** | Interior camera anchor. |
| Seat adjustment | `seatAdjustment` | float −0.25…0.25 | `0` | **S+D** | First‑person camera fwd/back. |
| Seat height | `seatHeight` | float −0.05…0.05 | `0` | **S+D** | First‑person camera up/down. |

\* Vehicle type change calls `initVehicle()` which reconstructs the vehicle in place — it does
*not* reload the page, but it is the heaviest "dynamic" op. Recommend exposing it as **static by
default**, with an explicit `allowLiveRebuild` flag for runtime swaps.

### 3.3 Controls, autopilot & lights

| Setting | Access | Type / values | Default | Class | Notes |
|---|---|---|---|---|---|
| Input mode | `Fe.set("input", 0|1|2)` | enum: keyboard / mouse / gamepad | `0` | **S+D** | Selects which signal source drives the car. |
| Drive inputs (live) | `Y.signal.*` per frame | Forward/Backward/Left/Right/Boost/Handbrake (0/1) | — | **D** | No public setter today; §5.4 proposes a programmatic input hook. |
| Autodrive (autopilot) | `ce.set(bool)` (`:1709`); `has-autodrive` | bool | off (unless `?autodrive=1`) | **S+D** | Follows the road/lane line. |
| Autodrive lane side | `autodriveSideIndex`→`autodriveSide` | enum: Left / None / Right (−1/0/1) | None | **S+D** | Which lane the autopilot tracks. |
| Speed control / cruise | `speed-control_enabled/_speed/_control` (`Vl`, `:17026`) | bool + target speed + mode | off | **S+D** | Cruise/limit; applied when not autodriving. |
| Headlights | `Ae.setHeadlights(on, manual)` (`:2029`) | on/off (+auto at night) | auto | **D** | Manual flag overrides automatic dusk behavior. |
| Camera mode | `CameraMode` signal / cycle (`:16603`); `config-camera-mode` | per‑vehicle: `Chase, ChaseFar, FirstPerson` (+ Roadster `Bonnet, Hood`) | `Chase` | **S+D** | Initial via config, cycles live. |

### 3.4 Graphics / render (config, not simulation per se)

| Setting | Access (`jh`/`Nh`) | Type / values | Default | Class | Notes |
|---|---|---|---|---|---|
| View distance LOD | `viewLodIndex` | enum Low…Ultra+ | `2` | **S+D** | Live‑settable but heavy. |
| Environment detail LOD | `detailLodIndex` | enum Low…Ultra | `1` | **S+D** | " |
| Render scale | `renderScale` | enum 50–200% | `2` (100%) | **S+D** | Emits `renderScale` event. |
| Antialias | `antialias` | bool | `true` | **S** | Renderer init; treat as static. |
| Vertical FOV | `verticalFov` | float 40–80 | `68` | **S+D** | Recomputes projection live (`:13169`). |

### 3.5 Metrics & telemetry (read / configure)

| Setting | Access | Type | Class | Notes |
|---|---|---|---|---|
| Metric selection | `window`‑exposed `DrivingMetrics` (panel) | per‑metric on/off | **S+D** | `loadSelection/saveSelection`; `localStorage`. |
| Run lifecycle | `DrivingMetrics.start/stop/resetRun` | actions | **D** | Auto‑starts when car moves. |
| Live telemetry | `MetricsCollector` channels | read | **D** | t, pos, speed, steer, throttle, brake, accel, lateralOffset, lane half‑widths, heading, nodeIndex, onRoad + events. |
| Report / logs export | `buildReport`, `downloadReport/Logs` | read | **D** | Markdown + JSON + CSV. |

### 3.6 Units & audio

| Setting | Access | Type | Class |
|---|---|---|---|
| Units | `ie.Units` | MPH/KPH, MI/KM | **S+D** |
| Audio volumes | `en` (ambient/wind/etc.) | floats | **S+D** |

---

## 4. Static vs dynamic — consolidated

**The rule.** A setting is **static** when its value is *consumed during world/vehicle
generation and baked into geometry or the renderer* (terrain heightmap, road spline, scene
swap, renderer flags). Changing it requires regenerating that artifact — either a
**rebuild‑ahead** (the lane model: stamp the change onto the road beyond the build frontier and
taper it in) or a **page reload** (seed/scene/topography). A setting is **dynamic** when a live
setter mutates running state that the render/physics loop reads every frame.

### Static‑only (apply before start; change ⇒ rebuild/reload)

`seed`, `start node`, `scene`, `topography`, `antialias`. *(Vehicle type is technically a live
rebuild but recommended static by default; see §3.2.)*

### Static **and** dynamic (settable at start *and* live)

`skin`, `weather index`, `day‑night cycle length`, `lane layout` (live = ±1/direction),
`drive mode`, `grip factor`, `speed factor`, steering‑wheel range, `showWheel`, `side`, `seat`,
`seatAdjustment`, `seatHeight`, `input mode`, `autodrive`, `autodrive side`, `speed control`,
`camera mode`, LOD/render‑scale/FOV, `units`, `audio`, `metric selection`.

### Dynamic‑only (no meaningful pre‑start value)

`headlights` (manual), live `drive inputs`, metrics run lifecycle, live telemetry read.

### Future dynamic (not yet in engine — design the API to accommodate)

Traffic participants (add/remove/configure), turning vehicle lights other than headlights
(indicators/brake/hazard), dynamic obstacles, road events. The metrics layer already reserves
`requiresTraffic` hooks (`setTrafficAvailable`) for this.

---

## 5. API design proposal

### 5.1 Principles

1. **One canonical in‑page facade** (`window.PromptDrive`) is the single source of truth.
   Every transport (postMessage, WebSocket, query params) is a thin adapter over it.
2. **Mirror `LaneRoads`**: facade owns intent + validation + persistence + event publishing;
   the engine exposes live handles to it via `build-main.js` patches (same mechanism that
   attaches `drivingMetrics`/`instrumentCluster` to the controller).
3. **Same code path as the UI** — route changes through the existing `set()`/`onSet` setters
   so the settings panel and the API never diverge, and validation/clamping is reused.
4. **Static changes are explicit**: a static request is *staged* (written to the localStorage
   substrate / intent) and applied via either `apply({mode:'reload'})` or, where supported,
   `apply({mode:'ahead'})` (lane‑style rebuild). The caller is told which is required.
5. **Everything validated & clamped** server‑side of the facade (reject unknown keys, coerce
   ranges, enforce the lane ±1 live rule). Requests are JSON, responses are
   `{ ok, value | error }`.

### 5.2 Layer 1 — `window.PromptDrive` facade (the API)

```js
window.PromptDrive = {
  version: "1.0",
  ready: Promise,                       // resolves once engine handles are attached

  // ---- introspection ----
  schema(),                             // → full config descriptor (keys, types, ranges,
                                        //    class: 'static'|'dynamic'|'both', enum labels)
  get(),                                // → current resolved config snapshot (all domains)
  get(path),                            // → one value, e.g. get('vehicle.gripFactor')

  // ---- static config (staged; needs apply) ----
  config: {
    set(partial),                       // stage static fields (seed, scene, topography,
                                        //   initialWeather, laneLayout, vehicleType, …)
    pending(),                          // → staged-but-not-applied diff
    apply({ mode })                     // mode: 'reload' (default) | 'ahead' (lanes etc.)
  },

  // ---- dynamic config (live) ----
  dynamic: {
    set(partial),                       // weather, skin, cycle, driveMode, grip, speed,
                                        //   headlights, autodrive, autodriveSide, camera,
                                        //   cruise, lanes(±1), fov, units, audio…
    weather(indexOrName), skin(name), cycle(seconds),
    headlights(bool), autodrive(bool), driveMode('AWD'|'FWD'|'RWD'),
    camera(modeOrNext), lanes({forward,backward,width}),
    cruise({ enabled, speed }),
    input({ forward, backward, left, right, boost, handbrake })  // §5.4 live drive hook
  },

  // ---- telemetry & lifecycle ----
  telemetry: {
    state(),                            // instantaneous ego snapshot (speed, steer, pos,
                                        //   heading, onRoad, lane offset, …)
    metrics(),                          // current computed metrics (DrivingMetrics)
    report(),                           // structured run report (JSON)
  },
  run: { start(), stop(), reset() },    // metrics run lifecycle

  // ---- events ----
  on(event, fn), off(event, fn),        // subscribe to the event stream (see §6.4)
  subscribe(fn),                        // all events
};
```

`schema()` is the contract a caller introspects to discover everything in §3 programmatically
(so the API is self‑documenting and survives content additions). It is generated from the
existing descriptor objects (`Be`, `kh`, `ee`) plus an API‑owned table for the
controller‑level items (headlights, autodrive, weather, lanes).

### 5.3 Layer 2 — transports

The facade is useless to a *non‑page* service on its own; we offer three adapters, in priority
order:

**(a) In‑page / driver context — direct.** An AI agent harness or test runner that controls the
page (Playwright/Puppeteer `page.evaluate`, an injected content script, or code running in the
same document) calls `window.PromptDrive.*` directly. **This is the primary, always‑available
path** and needs no extra transport. *(Today's `window.LaneRoads` is already used this way.)*

**(b) Iframe embedding — `postMessage` bridge.** When Prompt Drive is embedded by a parent web
app, a `postMessage` adapter exposes the same facade over the window boundary. Request/response
+ event envelopes (see §6.2). Guarded by an **origin allow‑list** (configurable; default
same‑origin). This is the recommended path for product integrations.

**(c) External / headless — WebSocket (socket.io) bridge (optional, later phase).** Reuse the
dormant `el` socket seam (`:13311`, `initialiseConnection()` is empty today). A small companion
server (or the caller's own socket.io endpoint) lets a backend orchestrator send commands and
receive the telemetry/event stream over the network. The browser remains a socket.io *client*;
the bridge maps inbound messages to `window.PromptDrive.*` and forwards `el`'s existing
`sendUpdate` events outbound. Auth/transport security is designed in this phase, not v1.

**(d) Static launch — query params.** For pure static setup of a fresh headless instance, extend
the existing `?seed=&node=&topo=` parsing with the full static set
(`?scene=&skin=&weather=&vehicle=&lanes=2+2&autodrive=1&…`). Equivalent to
`config.set(...)` + `apply({mode:'reload'})` but available before any script can run.

### 5.4 Live drive‑input hook (new engine seam)

There is no programmatic throttle/brake/steer today — inputs come only from
keyboard/mouse/gamepad signals (`Y.signal.*`). To let a service *drive* (not just configure),
`build-main.js` will add a small **virtual input source**: a patch that, after the existing
signal read, ORs in values from `window.PromptDrive.dynamic.input({...})`
(`forward/backward/left/right/boost/handbrake`, 0..1). This mirrors how `controllerSignal`
is already blended into steering (`:20179`). For most agent use‑cases **autodrive + cruise +
lane/weather control is enough**, so this hook is optional but recommended for full control.

### 5.5 Validation, clamping, errors

- Unknown keys → `{ ok:false, error:'unknown_key' }`. Out‑of‑range → coerced + a `clamped:true`
  note (reuse the stores' own clamping; lanes reuse `sanitise`/`clampLive`).
- Static field submitted via `dynamic.set` → `{ ok:false, error:'requires_apply', applyMode }`.
- Live lane change beyond ±1 → clamped to ±1 (existing behavior), reported.
- All responses carry the resulting value so the caller can confirm.

---

## 6. How another service uses it (examples)

### 6.1 AI agent via headless browser (primary)

```js
// Orchestrator drives a Playwright page
await page.goto('https://prompt.drive/?seed=demo7&scene=Hills&topo=normal&vehicle=Roadster');
await page.evaluate(() => window.PromptDrive.ready);

// Static (already applied via URL). Now run dynamically:
await page.evaluate(() => window.PromptDrive.dynamic.autodrive(true));
await page.evaluate(() => window.PromptDrive.dynamic.cruise({ enabled:true, speed:22 })); // m/s
await page.evaluate(() => window.PromptDrive.dynamic.weather('rain'));
await page.evaluate(() => window.PromptDrive.dynamic.lanes({ forward:2, backward:2 })); // ±1 steps live

const state = await page.evaluate(() => window.PromptDrive.telemetry.state());
// → { speed, steerRad, lateralOffset, onRoad, heading, nodeIndex, ... }
```

### 6.2 Parent web app via iframe (`postMessage`)

```js
const frame = document.querySelector('iframe#promptdrive').contentWindow;

// request/response
frame.postMessage({ ns:'promptdrive', id:42, op:'dynamic.set',
                    args:[{ headlights:true, weather:'night', driveMode:'RWD' }] }, ORIGIN);

window.addEventListener('message', (e) => {
  if (e.data?.ns !== 'promptdrive') return;
  if (e.data.id === 42) console.log('applied:', e.data.result); // { ok:true, value:{...} }
  if (e.data.event)      console.log('event:', e.data.event, e.data.payload); // stream
});
```

Envelope: request `{ns:'promptdrive', id, op, args}` → response `{ns, id, result}`;
events `{ns, event, payload}`.

### 6.3 Static config request, then apply

```js
window.PromptDrive.config.set({ seed:'abc', scene:'Planet', topography:'hard',
                                vehicleType:'Coach', laneLayout:{forward:3,backward:0,width:3.2} });
window.PromptDrive.config.pending();          // → diff awaiting apply
window.PromptDrive.config.apply({ mode:'reload' });   // reloads with the staged static setup
```

### 6.4 Event / telemetry stream

Re‑exposes `el`'s taxonomy plus per‑frame telemetry (throttled): `ready`, `applied`,
`vehicleChange`, `driveModeChange`, `inputModeChange`, `weatherChange`, `skinChange`,
`cameraChange`, `laneChange`, `headlights`, `autodrive`, `paused`, `collision`, `wrongWay`,
`offRoad`, `tick` (ego state at ~N Hz), `runStarted`/`runStopped`, `metrics`.

---

## 7. Implementation plan (phased)

**New module `src/api/`** (bundled by a new `scripts/build-api.js` → `static/js/api.js`,
script tag in `index.html`, after `lanes.js`):

- `config.js` — schema table + static/dynamic classification + validation/clamping.
- `PromptDriveApi.js` — the `window.PromptDrive` facade (Layer 1).
- `bridge.js` — engine‑handle registry (filled by `build-main.js` patches).
- `postmessage.js` — Layer 2(b) adapter + origin allow‑list.
- (later) `socket.js` — Layer 2(c) WebSocket adapter over the `el` seam.

**`scripts/build-main.js` patches** (anchored string replacements, like the existing ones) to
register live handles onto the bridge at controller init — vehicle controller `Ae`, configs
`Fe`/`jh`, autodrive `ce`, the scene/weather controller, camera controller, `Ks`, `Vl`,
`DrivingMetrics` instance — and to emit lifecycle/telemetry into the API event bus. Add the
virtual input source (§5.4).

**`scripts/build-api.js`** — mirror `build-lanes.js` (strip ES module syntax, concat in
dependency order inside one IIFE, expose `window.PromptDrive`). Add `build:api` to
`package.json` `build`.

**Phasing**

1. **P1 — Read + dynamic (in‑page).** `schema()`, `get()`, `telemetry.*`, `dynamic.*` for the
   already‑live setters (weather, skin, cycle, headlights, autodrive, drive mode, grip/speed,
   camera, lanes, cruise, FOV, units) + event stream. No engine‑behavior changes; pure exposure.
   *Highest value, lowest risk — covers most agent use‑cases.*
2. **P2 — Static config + apply.** `config.set/pending/apply({reload|ahead})`, extended query
   params, vehicle‑type swap (live‑rebuild flag).
3. **P3 — postMessage bridge** + origin allow‑list (iframe embedding).
4. **P4 — Live drive‑input hook** (§5.4) for full programmatic driving.
5. **P5 — WebSocket bridge** (optional) for external/headless orchestration + auth.
6. **P6 — Future dynamic content** (traffic participants, indicator/brake lights) as the engine
   gains them; the schema/event model already reserves space.

**Testing** — unit‑test `config.js` validation/clamping; integration via Playwright against the
dev server (`npm run dev`) asserting that each `dynamic.*` call changes `telemetry.state()` /
fires the matching event; verify static `apply({mode:'reload'})` round‑trips through query
params/localStorage. Keep `dynamic-lane-rendering-plan.md`‑style engine‑integration notes
alongside the code.

---

## 8. Open questions for review

1. **Primary transport for your use case** — headless browser (`page.evaluate`), iframe
   (`postMessage`), or a networked WebSocket server? This sets the P3/P5 priority.
2. **Do you need programmatic *driving*** (throttle/brake/steer via §5.4), or is
   **autodrive + cruise + config control** sufficient? (Most AI‑agent scenarios are the latter.)
3. **Vehicle‑type change at runtime** — acceptable as a live in‑place rebuild, or keep it
   strictly static (reload)?
4. **Static apply UX** — prefer reload (simple, deterministic) or invest in lane‑style
   rebuild‑ahead for more static fields (seamless but more engine work)?
5. **Security scope** — is an origin allow‑list enough for v1, or do you need token auth now
   (implies the WebSocket/server phase sooner)?
6. **Naming** — `window.PromptDrive` as the global, `prompt-drive` as the `postMessage`
   namespace — OK?
```
