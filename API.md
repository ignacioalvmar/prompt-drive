# Prompt Drive — Integration API

The integration API lets an external service **read** the full simulation
configuration and **submit** two kinds of change:

- **Static config** — setup baked at world/vehicle generation (seed, scene,
  topography, vehicle type, initial weather/lanes, antialias). Applying it
  reloads the sim so the engine regenerates the world.
- **Dynamic config** — live changes a running sim applies without a restart
  (weather, skin, day-night, lanes ±1, drive mode, grip/speed, autodrive,
  headlights, camera, cruise, FOV, units) plus programmatic **drive inputs**.

It also exposes a **telemetry + event stream** so the caller can observe the
result of its changes and the ego vehicle's state.

The design follows the project's extension pattern (an IIFE bundle exposed as a
`window.*` global, wired to the engine by `scripts/build-main.js`) — the same
mechanism as `LaneRoads`, `DrivingMetrics`, and `InstrumentCluster`.

> **Design plan:** the rationale, full configuration inventory, and phased
> roadmap live in [`prompt-drive-api-plan.md`](prompt-drive-api-plan.md). This
> document is the reference for what is **implemented**.

---

## Contents

- [Where it lives / how it loads](#where-it-lives--how-it-loads)
- [Quick start](#quick-start)
- [The `window.PromptDrive` facade](#the-windowpromptdrive-facade)
  - [Introspection — `schema()`, `get()`](#introspection)
  - [Dynamic config — `dynamic.*`](#dynamic-config--dynamic)
  - [Static config — `config.*`](#static-config--config)
  - [Telemetry — `telemetry.*`](#telemetry--telemetry)
  - [Metrics run & export — `run.*`](#metrics-run--export--run)
  - [Metric selection — `metrics.*`](#metric-selection--metrics)
  - [Ending the simulation — `end()`](#ending-the-simulation--end)
  - [Events — `on` / `off` / `subscribe`](#events)
- [Configuration field reference](#configuration-field-reference)
- [Transports](#transports)
  - [In-page (direct)](#in-page-direct)
  - [Iframe (`postMessage`)](#iframe-postmessage)
  - [Cross-tab (`BroadcastChannel`)](#cross-tab-broadcastchannel)
  - [Auto-start (bypass the “begin” splash)](#auto-start-bypass-the-begin-splash)
- [Validation & error codes](#validation--error-codes)
- [The test console (`api-test.html`)](#the-test-console-api-testhtml)
- [Source & build](#source--build)

---

## Where it lives / how it loads

The API is a standalone bundle, `static/js/api.js`, loaded by a `<script>` tag
in `index.html` **after** `lanes.js` and **before** the main game bundle:

```html
<script src="./static/js/lanes.js"></script>
<script src="./static/js/api.js"></script>   <!-- window.PromptDrive + window.PromptDriveBridge -->
<script src="./static/js/main.ca6b3355.chunk.js"></script>
```

Loading it defines two globals:

| Global | Role |
| --- | --- |
| `window.PromptDrive` | The public facade (everything below). Available immediately; live features resolve once the sim starts. |
| `window.PromptDriveBridge` | Internal engine-handle registry + event bus. Filled by the patched engine at controller init; you normally use `PromptDrive`, not this. |

The facade exists as soon as the script runs, but the engine handles it needs
for live reads/writes are only attached once the simulation actually starts
(after the **begin** splash — see [auto-start](#auto-start-bypass-the-begin-splash)).
Await `PromptDrive.ready` before calling live methods.

---

## Quick start

```js
// 1. Wait until the engine handles are attached (sim is running).
await window.PromptDrive.ready;

// 2. Read the resolved config and live state.
const cfg = PromptDrive.get();                 // full snapshot
const grip = PromptDrive.get('vehicle.gripFactor');

// 3. Change things live.
PromptDrive.dynamic.autodrive(true);
PromptDrive.dynamic.cruise({ enabled: true, speed: 22 }); // m/s
PromptDrive.dynamic.weather('rain');           // by name or index
PromptDrive.dynamic.lanes({ forward: 2, backward: 2 });   // ±1/direction live

// 4. Observe.
PromptDrive.on('tick', (s) => console.log(s.speed, s.onRoad));
const state = PromptDrive.telemetry.state();
```

---

## The `window.PromptDrive` facade

```
version                       // "1.0"
ready                         // Promise, resolves with the facade once handles attach

schema()                      // full config descriptor (self-documenting)
get(path?)                    // resolved snapshot, or one value by dot-path

config.set(partial)           // stage static fields
config.pending()              // staged-but-not-applied diff
config.apply({ mode })        // 'reload' (default) | 'ahead'
config.autostart(bool)        // bypass the "begin" splash on next load

dynamic.set(partial)          // apply many live fields at once
dynamic.weather(idxOrName)    dynamic.skin(name)     dynamic.cycle(idx)
dynamic.headlights(bool)      dynamic.autodrive(bool) dynamic.driveMode(m)
dynamic.camera(mode)          dynamic.lanes(cfg)     dynamic.cruise(cfg)
dynamic.grip(f)   dynamic.speed(f)   dynamic.fov(f)   dynamic.units(u)
dynamic.input(signals)        // live drive: forward/backward/left/right/boost/handbrake

telemetry.state()             // instantaneous ego snapshot
telemetry.metrics()           // computed driving-performance report
telemetry.report()            // alias of metrics()

metrics.families()            // metric families (lane keeping, speed, …) + member ids
metrics.selection()           // which metric ids are currently on
metrics.select(id, on)        // toggle one metric
metrics.selectFamily(fam, on) // toggle a whole family

cameraModes()                 // the current vehicle's camera modes (key + label)
weathers()                    // active skin's weather options as { index, name }

run.start()  run.stop()  run.reset()  run.status()
run.downloadReport()          // Markdown report download
run.downloadLogs()            // JSON + CSV logs download
run.end()                     // alias of end()

end({ download })             // finalize run, auto-export report + logs, halt sim

on(event, fn)   off(event, fn)   subscribe(fn)   // event stream
```

Every mutating call returns a **result object**: `{ ok: true, value }` on
success (with `clamped: true` if a value was coerced into range), or
`{ ok: false, error, … }` on failure. `dynamic.set` returns a map of
per-path results.

### Introspection

**`schema()`** → the self-documenting contract. Generated from the engine's own
descriptors plus the API field table, so it survives content additions.

```js
{
  version: "1.0",
  fields: {
    "vehicle.gripFactor": { type:"float", class:"both", min:0.25, max:3, step:0.01, desc:"…" },
    "scene.sceneName":     { type:"enum",  class:"static", values:["Hills","Planet"], desc:"…" },
    …
  },
  // runtime-discovered, when the sim is live:
  scenes: {
    Hills:  { topography:[…], skins:[…], skinWeathers:{ summer:[…], winter:[…] } },
    Planet: { … }
  }
}
```

`class` is `"static"`, `"dynamic"`, or `"both"`. Use `schema().scenes` to
discover the valid skins and per-skin weather lists for the loaded content.

**`get(path?)`** → the resolved config snapshot across every domain. With no
argument you get the whole tree; with a dot-path you get one value.

```js
PromptDrive.get();                    // { scene:{…}, lanes:{…}, vehicle:{…}, controls:{…}, graphics:{…}, units:0 }
PromptDrive.get('controls.autodrive') // true
PromptDrive.get('scene.weatherIndex') // 2
```

### Dynamic config — `dynamic.*`

Live setters that mutate the running sim through the engine's own setter paths
(the same ones the settings panel uses, so the API and UI never diverge). They
require a **live simulation** — called before the sim starts they return
`{ ok:false, error:"engine_rejected", message:"engine not ready …" }`.

`dynamic.set(partial)` takes a map of `path → value` and returns a per-path
result map:

```js
PromptDrive.dynamic.set({
  'vehicle.mode': 'RWD',        // or 2
  'vehicle.gripFactor': 1.5,
  'scene.weatherIndex': 4,
  'lanes': { forward: 2, backward: 2 },
  'controls.cruise': { enabled: true, speed: 18 },
  'graphics.verticalFov': 75,
});
// → {
//   'vehicle.mode':       { ok:true, value:2 },
//   'vehicle.gripFactor': { ok:true, value:1.5 },
//   'scene.weatherIndex': { ok:true, value:4 },
//   'lanes':              { ok:true, value:{forward:2,backward:2,width:null} },
//   'controls.cruise':    { ok:true, value:{enabled:true,speed:18} },
//   'graphics.verticalFov': { ok:true, value:75 }
// }
```

Convenience wrappers each call `dynamic.set` for one field:

| Method | Field | Notes |
| --- | --- | --- |
| `weather(idxOrName)` | `scene.weatherIndex` | An index, or a weather name (`"rain"`, `"night"`, …) resolved against the active skin. Use `weathers()` for the labeled list. |
| `skin(name)` | `scene.skin` | e.g. `"summer"`, `"winter"`, `"mars"` — see `schema().scenes`. |
| `cycle(idx)` | `scene.dayNightCycle` | `0` off, `1`=180 s, `2`=480 s, `3`=900 s. |
| `driveMode(m)` | `vehicle.mode` | `"AWD"`/`"FWD"`/`"RWD"` or `0`/`1`/`2`. |
| `grip(f)` | `vehicle.gripFactor` | `0.25`–`3`. |
| `speed(f)` | `vehicle.speedFactor` | `0.5`–`2`. |
| `autodrive(bool)` | `controls.autodrive` | Autopilot follows the ego lane. |
| `headlights(bool)` | `controls.headlights` | Manual override of auto-dusk behaviour. |
| `camera(mode)` | `controls.camera` | `"next"` cycles; or a mode key/label from `cameraModes()` — the engine steps toward it. `cameraModes()` returns the current vehicle's full set (e.g. Near/Far Chase, First Person in-cabin, Bonnet, Hood). |
| `lanes(cfg)` | `lanes` | `{forward, backward, width}`. **Live changes clamp to ±1/direction.** |
| `cruise(cfg)` | `controls.cruise` | `{ enabled, speed, unit }`. `speed` is m/s by default; pass `unit:'display'` to give it in the current display units (MPH/KPH) — the autopilot's target speed. Returns `{ enabled, speedMs, speedDisplay, unit }`. |
| `fov(f)` | `graphics.verticalFov` | `40`–`80`. |
| `units(u)` | `units` | `0` MPH/MI, `1` KPH/KM. |

**Live drive inputs** — `dynamic.input(signals)` feeds a virtual input source
that is OR'd into the per-frame controls, letting a service *drive* the car:

```js
PromptDrive.dynamic.autodrive(false);                 // take manual control
PromptDrive.dynamic.input({ forward: 1, right: 0.5 });// values 0..1
// … later …
PromptDrive.dynamic.input({ forward: 0, right: 0 });  // release
```

Accepted keys: `forward`, `backward`, `left`, `right`, `boost`, `handbrake`
(each `0`–`1`). For most agent use-cases, autodrive + cruise + lane/weather
control is enough and this hook is optional.

### Static config — `config.*`

Static fields are consumed during world/vehicle generation, so they are
**staged** and then applied. Applying commits them to the `localStorage`
substrate the engine reads on load and reloads the sim.

```js
PromptDrive.config.set({
  'scene.seed': 'demo7',
  'scene.sceneName': 'Planet',
  'scene.topography': 'hard',
  'vehicle.type': 'Coach',
  'lanes': { forward: 3, backward: 0 },   // initial layout (full range, not ±1)
});
PromptDrive.config.pending();             // → the staged diff
PromptDrive.config.apply({ mode: 'reload' }); // commit + reload
```

- `config.set(partial)` validates and stages; returns per-path
  `{ ok, value, staged:true }`. Nothing is written or reloaded yet.
- `config.pending()` returns the staged-but-not-applied diff.
- `config.apply({ mode })`:
  - `'reload'` (default) — writes staged fields to `localStorage` and reloads.
    String fields (`seed`, `sceneName`, `topography`, vehicle `type`) are written
    raw; the rest as JSON, matching exactly how the engine reads them back.
  - `'ahead'` — for `lanes` only: stamps the new layout onto the road ahead
    (the `LaneRoads` rebuild-ahead model) without a reload.
- `config.autostart(bool)` — see [auto-start](#auto-start-bypass-the-begin-splash).

You can stage `both`-class fields via `config.set` too; on `apply({reload})`
they are applied live before the reload so they also persist.

### Telemetry — `telemetry.*`

**`telemetry.state()`** — an instantaneous ego snapshot:

```js
{
  t,            // seconds (performance clock)
  speed,        // m/s
  steerRad,     // steering angle, radians
  heading,      // radians
  posX, posY, posZ,
  onRoad,       // bool
  wrongWay,     // bool
  headlights,   // bool
  autodrive,    // bool
  driveMode,    // "AWD" | "FWD" | "RWD"
  units,        // 0 | 1
  lane          // { forward, backward } under the car, when multi-lane roads are active
}
```

**`telemetry.metrics()`** / **`telemetry.report()`** — the structured
driving-performance report from the metrics subsystem (SDLP, lateral position,
lane departures, speed/SDS, steering reversals/entropy, TTLC, throttle/brake/jerk,
collisions), or `null` if metrics are unavailable.

### Metrics run & export — `run.*`

Controls the driving-metrics run lifecycle and downloads. Recording auto-starts
when the car first moves; these let a caller drive it explicitly.

```js
PromptDrive.run.start();          // { ok:true, value:true }
PromptDrive.run.status();         // { ok:true, value:{ recording, durationSec, samples } }
PromptDrive.run.stop();
PromptDrive.run.reset();
PromptDrive.run.downloadReport(); // saves a Markdown report (from the sim's document)
PromptDrive.run.downloadLogs();   // saves JSON + CSV of raw telemetry
```

If the metrics subsystem is not present, these return
`{ ok:false, error:"no_metrics" }`.

### Metric selection — `metrics.*`

Choose which driving-performance metrics are computed. Metrics are grouped into
**families** (lane keeping, speed, steering control, safety margin, events).
Selection works **live** and **pre-launch** — before the sim starts it is staged
to `localStorage` (`promptdrive.metrics.selected`), which the metrics subsystem
reads on load, so you can configure it as part of a static setup.

```js
PromptDrive.metrics.families();
// → [ { id:'lane', label:'Lane keeping', metrics:['sdlp','meanLP','laneDepartures'] },
//     { id:'longitudinal', label:'Speed', metrics:['meanSpeed','sds'] }, … ]

PromptDrive.metrics.selection();               // { sdlp:true, meanLP:true, swrr:false, … }
PromptDrive.metrics.select('sdlp', false);     // toggle one metric
PromptDrive.metrics.selectFamily('steering', false); // toggle a whole family
```

### Ending the simulation — `end()`

Finalize a session in one call. `end()` stops the metrics run, **automatically
downloads the driver-performance report (Markdown) and logs (JSON + CSV)**,
halts the simulation (pauses the ticker), and emits an `ended` event. The
result also carries the structured report so a programmatic caller gets it
without parsing the download.

```js
const r = PromptDrive.end();
// → { ok:true, value:{ ended:true, downloaded:true, report:{ meta, run, results, … } } }

PromptDrive.end({ download: false }); // finalize + report in the result, but no file downloads
```

`run.end()` is an alias. Pass `{ download:false }` to skip the file downloads
(e.g. when you only want the report object back over a transport).

### Events

Subscribe to the event stream. Two API-level events plus the engine's own
taxonomy (re-exposed from the dormant analytics seam) are delivered.

```js
const off = PromptDrive.on('weatherChange', (payload) => { … });
off(); // unsubscribe (on() also returns an unsubscribe fn)

PromptDrive.subscribe((event, payload) => { … }); // every event
```

| Event | Payload | Source |
| --- | --- | --- |
| `ready` | `{ version }` | API — fired once handles attach. |
| `applied` | `{ path, value }` | API — fired for each successful dynamic change. |
| `ended` | `{ report, downloaded }` | API — fired by `end()` when the sim is finalized. |
| `tick` | ego `state()` | API — ~10 Hz while there is a listener (the “live feed”). |
| `weatherChange` | weather name/index | Engine |
| `skinChange` | skin name | Engine |
| `cameraChange` | camera mode | Engine |
| `driveModeChange` | mode | Engine |
| `inputModeChange` | input mode | Engine |
| `paused` | bool | Engine |
| `wrongWay` | — | Engine |
| `resetCount` | count | Engine |
| `vehicleController` | `{ distance, speed, … }` | Engine (periodic) |
| `stats` | `{ fps, drawCalls, playTime }` | Engine (periodic) |
| `loadTimes` | timings | Engine |

`tick` is what makes the feed “live”: it only flows while the simulation is
running, so its presence is a reliable signal that dynamic calls will work.

---

## Configuration field reference

Every field addressable via `get`/`set`, with its class. **S** = static (needs
`config.apply`), **D** = dynamic (live), **S+D** = settable both ways.

### World & scene

| Path | Type | Class | Values / range |
| --- | --- | --- | --- |
| `scene.seed` | string | **S** | any seed string; change reloads |
| `scene.startNode` | integer | **S** | ≥ 0 |
| `scene.sceneName` | enum | **S** | `Hills`, `Planet` |
| `scene.topography` | enum | **S** | `straight`, `casual`, `easy`, `normal`, `hard` |
| `scene.skin` | string | **S+D** | per-scene (e.g. `summer`, `winter`, `mars`) — see `schema().scenes` |
| `scene.weatherIndex` | integer | **S+D** | index into the active skin's weather list |
| `scene.dayNightCycle` | enum | **S+D** | `0` off, `1`=180 s, `2`=480 s, `3`=900 s |
| `scene.antialias` | boolean | **S** | renderer init flag |
| `lanes` | object | **S+D** | `{ forward 1–5, backward 0–5, width 2.4–3.75|null }`; live ±1/direction |

### Vehicle

| Path | Type | Class | Values / range |
| --- | --- | --- | --- |
| `vehicle.type` | enum | **S** | `Roadster`, `Coach` |
| `vehicle.mode` | enum | **S+D** | `0` AWD, `1` FWD, `2` RWD |
| `vehicle.gripFactor` | float | **S+D** | `0.25`–`3` |
| `vehicle.speedFactor` | float | **S+D** | `0.5`–`2` |
| `vehicle.steerRotationIndex` | enum | **S+D** | `0`–`4` → 270/360/450/720/900° |
| `vehicle.showWheel` | boolean | **S+D** | — |
| `vehicle.side` | enum | **S+D** | `0` right, `1` left |
| `vehicle.seat` | enum | **S+D** | `0` driver, `1` passenger |
| `vehicle.seatAdjustment` | float | **S+D** | `-0.25`–`0.25` |
| `vehicle.seatHeight` | float | **S+D** | `-0.05`–`0.05` |

### Controls, autopilot & lights

| Path | Type | Class | Values / range |
| --- | --- | --- | --- |
| `controls.input` | enum | **S+D** | `0` keyboard, `1` mouse, `2` gamepad |
| `controls.autodrive` | boolean | **S+D** | — |
| `controls.autodriveSideIndex` | enum | **S+D** | `0` Left, `1` None, `2` Right |
| `controls.cruise` | object | **S+D** | `{ enabled, speed }` |
| `controls.headlights` | boolean | **D** | manual override |
| `controls.camera` | string | **D** | live camera switch; `"next"` cycles |
| `controls.cameraMode` | integer | **S** | initial camera index (see `cameraModes()`) |

### Graphics & units

| Path | Type | Class | Values / range |
| --- | --- | --- | --- |
| `graphics.viewLodIndex` | enum | **S+D** | `0`–`4` (Low…Ultra+) |
| `graphics.detailLodIndex` | enum | **S+D** | `0`–`3` (Low…Ultra) |
| `graphics.renderScale` | enum | **S+D** | `0`–`4` (50%…200%) |
| `graphics.verticalFov` | float | **S+D** | `40`–`80` |
| `units` | enum | **S+D** | `0` MPH/MI, `1` KPH/KM |
| `general.showWorm` | enum | **S+D** | `0` Always, `1` Manual drive only, `2` Never |
| `general.barriers` | boolean | **S+D** | walls & roadside barriers (regenerated on reload) |

Out-of-range numeric values are clamped (result carries `clamped: true`);
enum values outside the declared set are rejected as `bad_value`.

---

## Transports

The facade is the single source of truth; each transport is a thin adapter.

### In-page (direct)

Code running in the same document — an injected content script, a Playwright /
Puppeteer `page.evaluate`, or the parent of a **same-origin** iframe — calls
`window.PromptDrive.*` directly. This is the primary, always-available path.

```js
// Playwright
await page.goto('http://localhost:3000/?autostart=1');
await page.evaluate(() => window.PromptDrive.ready);
await page.evaluate(() => window.PromptDrive.dynamic.autodrive(true));
const state = await page.evaluate(() => window.PromptDrive.telemetry.state());
```

### Iframe (`postMessage`)

When Prompt Drive is embedded, a `postMessage` adapter exposes the same facade
across the window boundary. It activates automatically when the page is framed.

**Envelopes**

```
request   { ns:'promptdrive', id, op, args }
response  { ns:'promptdrive', id, result }
event     { ns:'promptdrive', event, payload }
```

`op` is a dot-path into the facade (`'get'`, `'schema'`, `'dynamic.set'`,
`'config.apply'`, `'telemetry.state'`, `'run.downloadReport'`, …); `args` is the
argument array. `result` is whatever the facade method returns.

```js
const frame = document.querySelector('iframe#promptdrive').contentWindow;

frame.postMessage({ ns:'promptdrive', id:42, op:'dynamic.set',
  args:[{ 'controls.headlights':true, 'scene.weatherIndex':9, 'vehicle.mode':'RWD' }] }, ORIGIN);

window.addEventListener('message', (e) => {
  if (e.data?.ns !== 'promptdrive') return;
  if (e.data.id === 42) console.log('result:', e.data.result);
  if (e.data.event)     console.log('event:', e.data.event, e.data.payload);
});
```

**Origin allow-list.** Requests are accepted only from allowed origins
(default: same-origin). Extend it either by setting
`window.PROMPTDRIVE_ALLOWED_ORIGINS = ['https://parent.example']` before the
bundle loads, or by posting an `init` op:

```js
frame.postMessage({ ns:'promptdrive', id:1, op:'init',
  args:[{ allowOrigins:['https://parent.example'] }] }, '*');
```

Use `'*'` in the list to allow any origin (local testing only).

### Cross-tab (`BroadcastChannel`)

For driving a simulation that runs in its **own tab/window** (not embedded), the
API also listens on a same-origin `BroadcastChannel` named `promptdrive`. This is
how the test console works: the sim runs normally at `localhost:3000`, and a
separate console page connects over the channel — no iframe, no window handle.

**Envelope** (channel `'promptdrive'`)

```
request  { ns:'promptdrive', kind:'req',   id, op, args }
response { ns:'promptdrive', kind:'res',   id, result }
event    { ns:'promptdrive', kind:'event', event, payload }
```

`op` is the same dot-path into the facade. A minimal client:

```js
const ch = new BroadcastChannel('promptdrive');
const pending = new Map(); let id = 0;
ch.onmessage = (e) => {
  const d = e.data; if (!d || d.ns !== 'promptdrive') return;
  if (d.kind === 'res' && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  if (d.kind === 'event') console.log('event', d.event, d.payload);
};
const call = (op, ...args) => new Promise((res) => {
  const n = ++id; pending.set(n, res);
  ch.postMessage({ ns: 'promptdrive', kind: 'req', id: n, op, args });
});

await call('dynamic.autodrive', true);
const state = await call('telemetry.state');
```

Because it is same-origin, the console and the sim share `localStorage` — so
`config.apply({reload})` (which runs on the sim and reloads it) and the
`pd-autostart` flag work across the two tabs. Ops execute in the **sim's**
context; a caller with no sim open simply gets timeouts until one appears.

### Auto-start (bypass the “begin” splash)

By default the sim waits behind a **begin** splash requiring a click. For
remote/headless launches you can bypass it so a static configuration boots
straight into a running sim. Enable it either way:

- **Query param:** load `…/index.html?autostart=1`.
- **API / storage:** `PromptDrive.config.autostart(true)` (sets
  `localStorage['pd-autostart']='1'`); `config.autostart(false)` clears it.

When enabled, the engine clicks the splash's begin control on load — the same
path a user takes — which starts world generation and attaches the API bridge.
Default is **off**, so the normal app still shows the splash.

> World generation is driven by `requestAnimationFrame`, which browsers pause in
> hidden/background tabs. For headless automation, keep the page/tab in the
> foreground (or use a headed browser context) so generation completes.

---

## Validation & error codes

All mutating calls return `{ ok, … }`. Failures carry an `error` code:

| `error` | Meaning |
| --- | --- |
| `unknown_key` | The path is not in the schema. |
| `bad_value` | Wrong type, or an enum value outside the declared set. |
| `requires_apply` | A static field was sent via `dynamic.set`; response includes `applyMode` (`"reload"`). Use `config.set` + `config.apply` instead. |
| `engine_rejected` | The engine's own setter threw (e.g. a weather index past the active skin's list, or the sim isn't live yet). Includes `message`. |
| `no_metrics` | A `run.*` call was made but the metrics subsystem is absent. |
| `unavailable` | A dependency (e.g. `LaneRoads`, `localStorage`) is missing. |
| `unsupported_apply_mode` | `config.apply` was called with an unknown `mode`. |

Successful results include the resulting `value`; numeric values coerced into
range additionally carry `clamped: true`. Errors are contained per-field, so one
bad key in a `dynamic.set`/`config.set` batch never aborts the others.

---

## The test console (`api-test.html`)

A local test page drives a **separately running** simulation over the
`BroadcastChannel` transport — it contains only configuration controls and the
telemetry/event streams, no game rendering.

1. Run the simulation the normal way: open
   [http://localhost:3000](http://localhost:3000) (or click **Open simulation**
   in the console, which opens it for you) and start it.
2. Open the console:
   [http://localhost:3000/api-test.html](http://localhost:3000/api-test.html).
   Its badge turns green (`live feed ✓`) once the sim's telemetry is flowing.

It is organised into three tabs plus a persistent live-feed footer:

- **① Static config** — grouped to mirror the in-game settings: *World & launch*
  (seed, node, scene, topography, vehicle, antialias, and the **Auto-start /
  bypass “begin”** toggle), *General settings* (units, road worm, barriers),
  *Graphics* (view distance, detail, render scale), *Weather*, *Vehicle* (drive
  mode, autodrive lane, grip/speed, interior side/seat/wheel/rotation/adjustment/
  height), *Road lanes* (forward/oncoming/width), and *Driving metrics to
  collect* (the five families). *Load current values*, *Stage*, *Show pending*,
  and *Apply & (re)launch*.
- **② Dynamic config** — weather/skin/cycle, drive mode, grip/speed (inline
  **Set** buttons), cruise (On/Off), autodrive and headlights (**toggle
  switches**), camera (**labeled dropdown**), lanes (±1), FOV, units, and
  press-and-hold drive inputs. Dropdowns and switches apply on change; numeric
  fields apply on their Set button.
- **③ Metrics & logs** — run *Start/Stop/Reset/Status*, *Get report (JSON)*,
  *Download report / logs*, and **End simulation & export** (finalize + auto
  report/logs + halt).
- **Footer** — a live telemetry readout and a scrolling event/response log.

Groups are **draggable** — grab a group's header (⠿) and drop it to reorder the
cards within a tab; each drop snaps to the nearest grid position and the layout
is remembered per tab in `localStorage`.

**Live-feed gating.** The Dynamic and Metrics tabs require a running sim: the
badge turns green (`live feed ✓`) only while the `tick` stream is flowing, and
those controls are disabled with a banner until then. Static config works at any
time (it stages and reloads). Enable **Auto-start** on the Static tab to launch
straight into a live sim.

---

## Source & build

| Path | Purpose |
| --- | --- |
| `src/api/config.js` | Schema table, static/dynamic classification, validation/clamping. |
| `src/api/bridge.js` | Engine-handle registry + event bus (`window.PromptDriveBridge`). |
| `src/api/PromptDriveApi.js` | The `window.PromptDrive` facade. |
| `src/api/postmessage.js` | Iframe `postMessage` transport + origin allow-list. |
| `src/api/broadcast.js` | Cross-tab `BroadcastChannel` transport. |
| `src/api/autostart.js` | Optional “begin”-splash bypass. |
| `scripts/build-api.js` | Bundles `src/api/` → `static/js/api.js`. |
| `api-test.html` | Local test console. |

Engine wiring is added by `scripts/build-main.js` (anchored patches): it
registers the live engine handles on the bridge at controller init, forwards the
engine's analytics-event seam to the API event bus, and adds the virtual
drive-input source.

```bash
npm run build:api   # src/api/ → static/js/api.js
npm run build       # full pipeline (cluster + metrics + lanes + api + main)
```
