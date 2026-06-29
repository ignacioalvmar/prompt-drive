# Driving Performance Metrics — Implementation Plan for Prompt Drive

## 1. Goal

Add a driving-performance-metrics subsystem to Prompt Drive that:

1. **Computes** research-grade driving metrics (SDLP, SDS, SWRR, steering entropy, TLC, lane departures, etc.) from live vehicle/road telemetry.
2. Exposes a **configuration panel** to select which metrics are computed.
3. Renders selected metrics in a **toggleable UI overlay**.
4. At the **end of a run**, produces a **downloadable report + raw logs**.

The design mirrors the existing instrument-cluster pattern (a self-contained bundle exposed as a `window.*` global, instantiated by the game bundle via build-time patches) so it fits the repo's established architecture and build pipeline.

---

## 2. What the codebase already gives us

The engine is a Three.js driving sim. Key integration facts (file:line in `src-extracted/deobfuscated.js`):

| Capability | Where | Notes |
|---|---|---|
| Ego speed / velocity / accel | `updateVehicleState` **18850–18883** | `Ae.speed` (m/s), `Ae.vel`, `Ae.accel`, `Ae.speedLerp` all fresh at end of method |
| Steering angle | `Ae.steer` (rad) + `this.inputs.steer` | physics + raw input |
| Throttle / brake | `this.inputs.accel`, `this.inputs.brake`, `Ae.braking`, `Ae.handbrake` | per-frame |
| Position / heading | `Ae.position`, `Ae.heading`, `Ae.quaternion`, `Ae.matrixWorld` | world frame |
| **Road-relative lateral offset** | helper `ii(x,z,node)` **3136**; primitive at **3137** | `side = n.x*(z-p.z) - n.z*(x-p.x)` — signed offset from centerline. **This is the SDLP primitive, already implemented.** |
| Current road node | `si.vehicleNode` (alias of `$t`, **3051**), updated each tick (**13585+**) | `.p {x,z}`, `.n` (normal), `.lWallDist`, `.rWallDist` (lane half-widths to walls) |
| Distance traveled | `Bh.dist` **13113**; `this.analytics.rawDS` **18856** | meters |
| Collision flag | `this.didCollide` (in `updateLive` **18819+**) | per-frame boolean |
| Units factors | `this.speedFactor`, `this.distFactor`; `ie.Units` **1481** | m/s→display |
| Physics tick | `updateLive(dt)` **18819**, `updateVehicleState(dt)` **18850** | **RAF-driven, variable `dt`** — no fixed-timestep accumulator |
| UI throttle pattern | `this.uiTimer > 0.033` **18831** | ~30 Hz; reuse idea for overlay refresh |

**Sampling-clock caveat.** Both research reports stress that frequency-dependent metrics (steering-entropy resampling, SWRR Butterworth filter) require a *uniform* sample rate, but this engine runs on variable RAF `dt`. We resolve this the way Report 1 recommends: **log every physics frame with a monotonic timestamp + `dt`, then resample per-metric to a fixed rate (4–10 Hz) inside the math layer at compute time.** We do *not* refactor the engine loop.

**Cluster pattern to mirror** (the template for everything we add):
- Source in `src/cluster/`, bundled by `scripts/build-cluster.js` into an IIFE that sets `window.InstrumentCluster`.
- Loaded in `index.html` via `<script src="./static/js/cluster.js">` *before* the main bundle.
- Instantiated inside the game by a `build-main.js` patch: `new InstrumentCluster(r)` (where `r` is THREE) in `initialise()` (**build-main.js 173–188**), then fed data each tick from `updateUI()` (**build-main.js 125–171**).
- Persisted/toggled config uses the `ReactiveValue` + localStorage pattern (e.g. autodrive `ce` **1709**).

**Gaps:** no download/export anywhere today; no traffic/lead-vehicle objects surfaced (so TTC/headway/PET/gap-acceptance are deferred — see §7).

---

## 3. Metric set & phasing

Grounded in both reports. Ego-only metrics (computable from existing state) ship first.

### Phase 1 — Core ego battery (v1)
| Metric | Source data | Notes / params |
|---|---|---|
| Mean lateral position (MLP) | lateral offset | bias |
| **SDLP** | lateral offset | unbiased SD; also ΔSDLP vs baseline window |
| Lane departures (count/duration/magnitude) | offset + `lWallDist`/`rWallDist` + half vehicle width | event detection |
| Mean speed / **SDS** | `Ae.speed` | + % over limit if a limit is defined |
| **SWRR** (steering reversal rate) | `Ae.steer` | 2nd-order Butterworth @0.6 Hz, gap size configurable (default 3°; offer 0.5°/2°/3°) |
| **Steering entropy** | `Ae.steer` | resample ~4 Hz, Taylor predictor, baseline-referenced, K=9 bins (Report 2) |
| **TLC** (time-to-line-crossing) | offset, lateral velocity, heading, speed | trig form (Report 2); report min & 15th percentile |
| Throttle/brake usage, longitudinal jerk | `inputs.*`, `Ae.accel` | workload proxies |
| Collision count/rate | `this.didCollide` | event-based |

### Phase 2 — Interaction metrics (only if traffic objects exist)
TTC, TET/TIT, time gap/headway, PET, gap acceptance. **Blocked** until lead/conflict objects are confirmed in the scene graph (see §7 open question).

### Phase 3 — Workload (only with sensors)
Pupil/blink, HR/RMSSD/SDNN — out of scope unless biosensor streams are added.

---

## 4. New module layout

Create `src/metrics/` (mirrors `src/cluster/`):

```
src/metrics/
  config.js          # metric registry: id, label, family, dataDeps, defaultOn, params
  metrics-math.js    # pure functions (adapted from Report 1 JS + Report 2 formulas)
  MetricsCollector.js# ring/append buffers (struct-of-arrays) + sample() + event log
  MetricsPanel.js    # DOM config panel (checkbox list by family + param inputs + run controls)
  MetricsOverlay.js  # DOM HUD overlay (live values) with on/off toggle
  report.js          # buildReport() -> summary; downloadReport(); downloadLogs()
  DrivingMetrics.js  # facade: wires collector+config+panel+overlay+report; the window global
```

### 4.1 `metrics-math.js` (pure, testable)
Port directly from the reports:
- Helpers: `finiteValues`, `mean`, `sampleSD`, `interpolateShortNaNGaps`, `resampleUniform(t[], x[], hz)` (new).
- `butterworth2(signal, cutoffHz, fs)` — 2nd-order low-pass for SWRR conditioning.
- `computeLaneStats(offsets)` → MLP, SDLP, MAD. (Report 1 lines 209–222.)
- `detectLaneDepartures(offsets, halfWidths, vehHalfWidth)` → events. (Report 1 240–250.)
- `steeringReversalRate(steerLPF, dt, gapDeg)`. (Report 1 268–277.)
- `steeringEntropy(steerResampled, baselineSegment)` — Taylor predictor `θp(n)=2.5θ(n-1)-2θ(n-2)+0.5θ(n-3)`, baseline α (90th pct), 9 bins, Shannon entropy. (Report 2 §Steering Entropy.)
- `tlcTrig({offset, halfWidth, lateralVel, speed, yawErr, curvature})` → seconds; aggregate to min & 15th percentile. (Report 2 §TLC.)
- `speedStats(speeds)`.

All functions take plain arrays so they run identically in-browser and in unit tests.

### 4.2 `MetricsCollector.js`
Struct-of-arrays (Report 1 §Three.js, lines 573–591) sized for a run, growable in chunks:
```
t, dt, posX, posZ, speed, steerRad, throttle, brake, accelLon, accelLat,
lateralOffset, laneHalfL, laneHalfR, heading, nodeIndex
```
- `sample(dt, state)` — appends one row (called from the engine patch).
- `events[]` — `{type:'collision'|'departure', tStart, tEnd, magnitude}`.
- `markBaseline(start,end)` / auto-baseline = first N seconds of calm straight driving (for steering entropy).
- `reset()`, `getRawColumns()`, `durationSec()`, `distanceM()`.

### 4.3 `config.js` — metric registry (drives panel, compute, report)
Each entry: `{ id, label, family, dataDeps:['offset'|'steer'|'speed'|'traffic'], defaultOn, params }`. The collector always logs all *cheap* raw channels; the registry's selected set controls **what is computed, shown, and reported**. Selection persisted to `localStorage['promptdrive.metrics.selected']` (autodrive `ce` pattern).

### 4.4 `MetricsPanel.js` — configuration panel
DOM panel (fixed-position, top/side, over the canvas; CSS in a `<style>` injected by the module or appended to `static/css`). Contents:
- Checkbox list grouped by family (Lane / Longitudinal / Steering / Safety-margin / Events), each with a one-line tooltip from the registry.
- Per-metric param inputs where relevant (SWRR gap size, entropy resample Hz, TLC/threshold values, baseline window length).
- **Run controls:** Start / Stop / Reset; live status (recording, elapsed, distance).
- **Export buttons:** Download Report (.md + .json), Download Logs (.csv).
- A gear/hotkey to open/close the panel.

### 4.5 `MetricsOverlay.js` — live overlay
DOM overlay (separate from the cluster, which is in-scene on the dashboard). Shows live values for selected metrics computed on a throttled timer (~2–4 Hz) over a rolling window (e.g. trailing 30 s) from the collector buffers. A single **on/off toggle** (button in panel + keybind, e.g. `M`). Lightweight: rolling-window stats only; full-fidelity compute happens at report time.

### 4.6 `report.js` — end-of-run report + logs
- `buildReport(collector, selectedConfig)` → object with per-metric results (whole-run + per-segment straight/curve where applicable), run metadata (vehicle type, units, duration, distance, baseline window), and parameter values used (reproducibility, per SAE J2944 guidance in the reports).
- `downloadReport()` — emits **Markdown** (human-readable, tables) and **JSON** (machine) via `Blob` + `URL.createObjectURL` + temporary `<a download>`.
- `downloadLogs()` — emits **CSV** of raw telemetry columns + an events table.

### 4.7 `DrivingMetrics.js` — facade / global
Constructor `new DrivingMetrics(THREE)`:
- builds collector, loads selection from localStorage, creates panel + overlay, registers keybinds.
- exposes `.sample(dt, state)` (called by engine patch), `.startRun()`, `.stopRun()`, `.isRecording`.
- Bundled to `window.DrivingMetrics`.

---

## 5. Build-pipeline changes

Mirror the cluster build exactly.

1. **New `scripts/build-metrics.js`** — copy of `build-cluster.js`: read `src/metrics/*.js`, strip `import`/`export`, wrap in IIFE, set `window.DrivingMetrics`, write `static/js/metrics.js`.
2. **`package.json`** — add `"build:metrics": "node scripts/build-metrics.js"` and chain it into `"build"`: `build:cluster && build:metrics && build:main`.
3. **`index.html`** — add `<script src="./static/js/metrics.js"></script>` after `cluster.js`, before the main bundle.
4. **`scripts/build-main.js`** — add two new `replaceOnce` patches:

   **Patch A — construct collector in `initialise()`** (extend the existing cluster-init anchor at **build-main.js 173–188**):
   ```js
   if (typeof DrivingMetrics !== "undefined" && !this.drivingMetrics) {
     try { this.drivingMetrics = new DrivingMetrics(r); }
     catch (e) { console.error("DrivingMetrics init failed", e); }
   }
   ```
   Also add `this.drivingMetrics = null;` to the constructor-fields patch (**build-main.js 22–27**).

   **Patch B — sample telemetry** at the end of `updateVehicleState` (anchor on the closing of the method around **deobfuscated.js 18882–18883**, before the `isFinite` throw or right after `Bh.speed = Ae.speed`):
   ```js
   if (this.drivingMetrics && this.drivingMetrics.isRecording) {
     const node = si.vehicleNode;
     // signed lateral offset (engine primitive, line 3137)
     const off = node ? node.n.x*(Ae.position.z - node.p.z) - node.n.z*(Ae.position.x - node.p.x) : NaN;
     this.drivingMetrics.sample(e, {
       speed: Ae.speed, steer: Ae.steer,
       throttle: Math.abs(this.inputs.accel), brake: this.inputs.brake,
       accel: Ae.accel, vel: Ae.vel, heading: Ae.heading,
       posX: Ae.position.x, posZ: Ae.position.z,
       lateralOffset: off,
       laneHalfL: node && node.lWallDist, laneHalfR: node && node.rWallDist,
       collided: this.didCollide, nodeIndex: si.vehicleIndex
     });
   }
   ```
   (`e` is the engine's `dt` param. `ii()` is in module scope and could be called instead, but inlining the one-line cross-product avoids depending on `ii`'s side-effecting scratch object `ei`.)

No changes to `static/js/main.ca6b3355.chunk.original.js` or the extract step.

---

## 6. Run lifecycle

- **Start:** auto-start on first vehicle movement (`Ae.speed > ε`) *or* manual Start button. `startRun()` resets buffers, records metadata (vehicle, units, timestamp), begins baseline capture window.
- **During:** engine patch streams samples; overlay refreshes on its own throttled timer; nothing heavy on the physics thread.
- **Stop:** manual Stop button (or idle-timeout). `stopRun()` freezes buffers and enables/auto-triggers report + log download.
- **Reset:** clears buffers and report.

---

## 7. Open decisions (recommend defaults; confirm if you disagree)

1. **Overlay tech — DOM vs in-scene 3D canvas.** *Recommend DOM overlay* (HTML/CSS over the WebGL canvas) for the panel, live overlay, and download buttons. The instrument cluster is intentionally in-scene (on the dashboard); a research HUD + config + file downloads are far simpler and more legible as DOM. (Alternative: extend the cluster's CanvasTexture approach — heavier, no clickable config/download.)
2. **v1 metric scope.** *Recommend the Phase-1 ego battery* (§3). Interaction metrics need traffic objects.
3. **Traffic objects for TTC/headway.** Needs verification: does the scene contain other vehicles/obstacles with synchronized state? If yes, Phase 2 becomes feasible; if no, those metrics stay deferred. **(Action: confirm before committing to Phase 2.)**
4. **Report format.** *Recommend Markdown + JSON for the report, CSV for raw logs* (Markdown is readable/diffable; JSON+CSV are tool-friendly).
5. **Units in report.** Report SI internally (m, m/s, s) per the literature; mirror the user's display units (`ie.Units`) as a secondary column.

---

## 8. Step-by-step execution order

1. Scaffold `src/metrics/` with `metrics-math.js` (port report functions) + a tiny test harness (Node) for the math.
2. Implement `MetricsCollector.js` (buffers + `sample`).
3. Implement `config.js` registry + localStorage persistence.
4. Implement `DrivingMetrics.js` facade with no UI (just collect), `window.DrivingMetrics`.
5. Add `scripts/build-metrics.js`, wire `package.json` + `index.html`.
6. Add `build-main.js` Patch A (construct) + Patch B (sample); `npm run build`; verify samples accumulate (temporary `console.log`/preview).
7. Build `MetricsPanel.js` (config + run controls) and selection→compute wiring.
8. Build `MetricsOverlay.js` (live values + toggle).
9. Build `report.js` (buildReport + downloads); verify a full drive → report + CSV.
10. Verify in the running app via the preview workflow (drive, toggle overlay, change selection, download, inspect files).
11. (Optional) Phase 2 interaction metrics if traffic objects are confirmed.

---

## 9. Risks & mitigations

- **Variable frame rate** distorts SWRR/entropy → resample to fixed Hz at compute time (§2); log `dt` per sample so resampling is exact.
- **Patch anchors drift** if `deobfuscated.js` is re-extracted → `replaceOnce` already throws on a missing anchor (build-main.js 15); keep anchors minimal and unique.
- **Lane geometry discontinuities / undefined node** → guard `si.vehicleNode` null; treat as NaN and let math layer skip (it filters non-finite).
- **Performance** → `sample()` is O(1) array writes; all heavy compute is off the physics path (overlay throttled, report on demand).
- **Baseline for steering entropy** → auto-capture first calm window; expose manual baseline marking in the panel.
