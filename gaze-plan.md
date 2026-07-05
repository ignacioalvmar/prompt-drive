# Gaze-Tracking Attention Metrics for Prompt Drive

## Context

Prompt Drive measures driver performance (SDLP, steering entropy, TLC, …) but has no way to tell **where the user is looking** or **whether they are distracted** during an interaction. Based on the two automotive gaze-tracking research reports (`PromptDrive-cursor/plan/gaze_tracking/`), we add a lightweight, fully in-browser, on-device gaze-tracking subsystem that:

1. Estimates gaze on screen from the webcam (MediaPipe FaceLandmarker: 478 landmarks + iris + head pose — a perception front-end, **not** a gaze estimator by itself, so we add a per-user calibrated mapping).
2. Classifies each sample into Areas of Interest (road ahead, speedometer, throttle gauge, road worm, odometer, menu bar, metrics overlay, off-screen, eyes-closed).
3. Derives research-grade attention metrics (percent road centre, off-road glances incl. NHTSA >2 s, I-DT fixations per ISO 15007, PERCLOS, blink rate, gaze dispersion, tracking uptime) that plug into the **existing** metrics panel, live overlay, report, and CSV/JSON export with near-zero export plumbing changes.
4. Runs a skippable **9-point calibration with 4-point validation before the game begins** (hooked into the Begin splash), with recalibration available anytime.

Privacy by design: all processing on-device, no video frames retained or transmitted; only derived gaze coordinates/features are logged. Gaze is **off by default**; camera permission is requested only when the user enables it.

## Approach in one diagram

```
webcam ──getUserMedia──▶ FaceEngine (MediaPipe FaceLandmarker, ~30 FPS, VIDEO mode)
  landmarks + head pose ──▶ feature vector (iris offsets + yaw/pitch)
    ──calibrated 2°-poly ridge mapping──▶ screen (x,y) ──1-euro filter──▶
      ├─▶ AoiProjector.classify → AOI code
      ├─▶ GazeAnalyzer ring buffer (native 30 Hz: fixations, blinks, PERCLOS, glances, distraction events)
      └─▶ GazeTracking.latestSample() ──sample-and-hold──▶ DrivingMetrics.sample()
             → new MetricsCollector channels → existing CSV/report/overlay export
```

Key verified facts making this cheap:
- `logsToCsv()` iterates `Object.keys(collector.columns())` ([src/metrics/report.js:113-121](../Documents/code/prompt-drive/src/metrics/report.js)) → new channels auto-appear in CSV.
- Report/overlay iterate the `METRICS` registry → new registry entries auto-appear.
- `isComputable(id, trafficAvailable)` ([src/metrics/compute.js:154](../Documents/code/prompt-drive/src/metrics/compute.js)) is the exact gating extension point (`requiresGaze`).
- `beginGame()` anchor verified verbatim at deobfuscated.js:20781 — `w.unlockKeys(); this.canvas.focus();` is the input-unlock gate to defer behind the calibration promise. It re-runs on every splash close, so the hook must be idempotent.
- The THREE `PerspectiveCamera` (`Xs`) is in the same module scope as the existing `'PromptDrive bridge attach'` patch (build-main.js:388, `THREE: r`) — just add `camera: Xs` there for AOI projection.
- `@mediapipe/tasks-vision` has no IIFE/UMD build → vendor the ESM `vision_bundle.mjs` + wasm + `face_landmarker.task` model into `static/lib/mediapipe/` and load via dynamic `import()` at gaze-enable time (keeps the repo's no-CDN offline pattern, zero cost when gaze is off).

## Work items (ordered)

### 1. Vendor MediaPipe — `scripts/fetch-gaze-deps.js` + `npm run fetch:gaze`
Plain-Node download script (pinned `@mediapipe/tasks-vision@0.10.14` from jsDelivr + the `face_landmarker.task` float16 model ~3.7 MB from storage.googleapis.com) into `static/lib/mediapipe/{vision_bundle.mjs, wasm/*, face_landmarker.task}`. Committed (offline pattern, like `alea.min.js`).

### 2. New subsystem `src/gaze/` → `static/js/gaze.js` (via `scripts/build-gaze.js`, clone of build-metrics.js)

| File | Responsibility |
|---|---|
| `config.js` | Storage keys (`pd.gaze.*`), AOI numeric code map (−2 eyes-closed … 9 off-screen), thresholds (EAR blink 0.20/0.25 hysteresis, PERCLOS window 60 s, off-road glance min 0.3 s, NHTSA long-glance 2.0 s, I-DT dispersion 1.5° / 200–2000 ms, ridge λ=1e-3, 9+4 calibration point layouts, settle 500 ms / collect 1200 ms per point, accept ≤3.0°), MediaPipe EAR landmark indices (R [33,159,158,133,153,145], L [362,380,374,263,386,385]), fallback static AOI rects |
| `filters.js` | `OneEuroFilter2D` (minCutoff 1.0, beta 0.02) for the gaze point; EMA for EAR |
| `gaze-math.js` | Pure math (mirrors metrics-math.js): `earFromLandmarks`, `headPoseFromMatrix` (yaw/pitch from `facialTransformationMatrixes`), `featureVector` (iris centers 468–477 normalized by eye-corner geometry + yaw/pitch), `polyExpand` (2nd-degree, ~20 terms), `ridgeFit`/`ridgePredict` (normal equations + Gaussian elimination), `pxPerDeg(viewportH, fov)` |
| `FaceEngine.js` | Webcam lifecycle (`getUserMedia` 640×480@30, hidden video el), dynamic `import()` of vendored MediaPipe, `FaceLandmarker` VIDEO mode w/ GPU→CPU fallback, `requestVideoFrameCallback` loop, error taxonomy (`denied`/`no-camera`/`load-failed`), test seam `setVideoSource(el)` |
| `calibration.js` | Per-point blink-gated feature averaging, `fit()` (ridge on poly-expanded features → normalized screen x,y), `validate()` → accuracy°/precision°, save/load/clear in localStorage; stale if viewport changed >10% |
| `aoi.js` | `AoiProjector`: 1 Hz + on resize/cameraChange — projects instrument-cluster canvas zones (`zonesForCanvas()` from src/cluster/layout.js → plane-local → `mesh.localToWorld` → `camera.project` → CSS px) via `PromptDriveBridge.handles.controller.instrumentCluster.overlayMesh`; road-ahead = ~8° circle around a point 40 m ahead along heading; DOM rects for `#menu-bar` and `.pd-overlay`; static-rect fallback. `classify(x,y,ear,valid)` → AOI code |
| `GazeAnalyzer.js` | Native-rate (30 Hz) Float64 ring buffer `{t,x,y,ear,valid,aoi}` (30 min cap); streaming blink detector, off-road glance episodes, **distraction event** (eyes-off-road >2 s → `drivingMetrics.addEvent('distraction', …)`); `analyze(t0,t1)` → fixations (I-DT), blink rate, PERCLOS, glance stats, uptime |
| `CalibrationModal.js` | Full-screen fixed overlay (z-index 10000, Jura font, matches panel styling). States: consent (on-device privacy copy; Calibrate / Skip this run / Don't ask again) → permission (spinner; error+Skip) → positioning (face-found + head-pose check) → 9-dot calibration → 4-dot validation ("Accuracy 2.1° — Good"; Accept / Redo, suggest redo >3°) → save. Esc = skip everywhere. Reused for mid-session recalibration (no key-lock then) |
| `GazeTracking.js` | Facade `window.GazeTracking`: `setEnabled()` (permission requested here), pipeline wiring, `latestSample()` (sample-and-hold; NaN/invalid when disabled/uncalibrated/stale >200 ms), `isAvailable()`, `wantsPreGameCalibration()` (false under `?autostart=1` unless `?gazecal=1`), `runPreGameCalibration()` (idempotent), `calibrate()`, `status()`, optional live gaze-dot debug overlay, `_debug.injectSample()` / `_debug.useVideoSource()` test seams |

### 3. Metrics subsystem extension (`src/metrics/`)

- **`MetricsCollector.js`** — 7 new channels, pushed every physics frame (NaN when absent): `gazeX, gazeY, gazeAoi, gazeValid, gazeEar, headYaw, headPitch`. CSV export picks them up automatically.
- **`config.js`** — new family `{id:'attention', label:'Attention (gaze)'}` + registry entries, all `requiresGaze:true`: `percentRoadCenter` (%), `aoiDwell` (per-AOI dwell %), `offRoadGlances` (count + mean/max dur + rate/min + n>2 s NHTSA), `fixations` (I-DT count + mean dur), `perclos` (%), `blinkRate` (/min), `gazeDispersion` (deg RMS), `trackingUptime` (%). Panel + report pick these up automatically.
- **`compute.js`** — `isComputable(id, trafficAvailable, gazeAvailable)` adds `requiresGaze` gating; channel-based metrics (percentRoadCenter, aoiDwell, trackingUptime, gazeDispersion) computed from `cols`; precision metrics (fixations, blinkRate, perclos, offRoadGlances) taken from `opts.gazeAnalysis` (analyzer summary), NaN + note when unavailable.
- **`DrivingMetrics.js`** — enrich `sample()` with `state.gaze = window.GazeTracking?.latestSample()` (guarded try/catch — no extra build-main.js sampling surface); new `addEvent(type, data)` for distraction events; `isComputable` passes gaze availability; `startRun()` merges `meta.gaze = GazeTracking.status()` (calibration accuracy lands in report meta); report/overlay opts get `gazeAvailable` + `gazeAnalysis`.
- **`MetricsPanel.js`** — gaze controls block under the Attention family: Enable-gaze checkbox, **Calibrate** button (recalibrate anytime), Show-gaze-dot toggle, live status line (`gaze: ● tracking 29 fps · calib 2.1° · uptime 96%` / `camera denied` / `not calibrated`); tooltip for disabled gaze metrics.
- **`MetricsOverlay.js`** — add `percentRoadCenter`, `offRoadGlances`, `perclos`, `trackingUptime` to live IDs; pass gaze opts in `_refresh()`.
- **`report.js`** — `detailString()` cases for the new metrics (e.g. aoiDwell top-3 zones "road 78%, speedo 9%, worm 4%"); Run table rows for gaze calibration/enabled state when `meta.gaze` present.

### 4. Engine patches (`scripts/build-main.js`) — two `replaceOnce` additions

1. **Camera handle**: extend the existing `'PromptDrive bridge attach'` replacement (line ~388) — add `camera: Xs,` next to `THREE: r` (verified same module scope).
2. **Pre-game calibration gate**: anchor on the verbatim `beginGame()` body (verified unique, deobfuscated.js:20781). Replacement keeps everything but defers `w.unlockKeys(); this.canvas.focus();` behind `GazeTracking.runPreGameCalibration()`'s promise when `wantsPreGameCalibration()` — resolves on completion, skip, Esc, or error (both promise branches unlock). Zero-cost when gaze disabled; idempotent across repeated splash closes; world keeps loading behind the opaque modal.

### 5. API + wiring

- `src/api/PromptDriveApi.js`: `PromptDrive.gaze = {enable, disable, calibrate, status, latest}` delegating to `window.GazeTracking`.
- `index.html`: `<script src="./static/js/gaze.js"></script>` after `metrics.js`, before `api.js`.
- `package.json`: `fetch:gaze`, `build:gaze`, extend `build` chain (`… build:wheel && build:gaze && build:api && build:main`).

### 6. Docs

`AGENTS.md` subsystem-table row + script order + vendored-lib note; `README.md` feature + privacy note; `API.md` (`PromptDrive.gaze`, `?gazecal=1`); `gaze-plan.md` capturing this design.

## Metric definitions (formulas/thresholds)

- **EAR** = (‖p2−p6‖+‖p3−p5‖)/(2‖p1−p4‖), both eyes averaged; blink = EAR<0.20 with reopen hysteresis 0.25, 70–500 ms.
- **PERCLOS** = % of valid time eyes-closed over rolling 60 s.
- **Percent road centre** = Σ(dt·[aoi=road ∧ valid]) / Σ(dt·valid) × 100.
- **Off-road glance** = contiguous valid non-road AOI ≥0.3 s; report count, mean/max duration, rate/min, count >2.0 s (NHTSA).
- **Fixations** (I-DT, ISO 15007): dispersion ≤1.5° (px via viewportH/fov), 200–2000 ms; count + mean duration.
- **Gaze dispersion** = RMS angular deviation from window centroid (deg).
- **Tracking uptime** = valid/total samples ×100.
- **Distraction event**: eyes-off-road >2 s → `{type:'distraction', t, durationSec, aoi}` in the events stream (report Events table + events.json).

## Export additions (riding existing plumbing)

- **CSV**: +7 columns (`gazeX…headPitch`), empty when gaze off.
- **report.json/md**: new attention metrics in Results; `meta.gaze` (calibration accuracy, enabled) in the Run table; distraction events in Events.
- **events.json**: distraction/drowsiness events + AOI code legend.

## Verification

1. **Build gate**: `npm run build` — `replaceOnce` anchors throw if drifted.
2. **No-camera synthetic test**: `GazeTracking._debug.injectSample()` at 30 Hz with a scripted scanpath (road → speedo → 3 s off-road → blink burst); assert CSV columns fill, percentRoadCenter/offRoadGlances/perclos match hand-computed values, distraction event lands in events.json. Calibration math: `ridgeFit` on synthetic feature→target pairs with noise, accuracy <0.5°.
3. **Headless preview-tab run**: `?autostart=1` (pre-game calibration auto-skipped by design) with the repo's known tricks — MessageChannel rAF shim + KeyP pause-bounce (memory: prompt-drive-headless-verification); fake webcam via `navigator.mediaDevices.getUserMedia = async () => faceCanvas.captureStream(30)` drawing a static face photo, or bypass perception via `_debug.useVideoSource()`. Verify gaze channels in downloaded logs, no console errors, frame cost <2 ms.
4. **Manual (real webcam)**: enable in panel → permission prompt only then; clear `pd.gaze.*` → fresh Begin shows calibration modal; gaze dot lands on gauges when looking at them; camera-mode switch deactivates dashboard AOIs; window resize → recalibration prompt; permission denied → status shows `camera denied`, sim unaffected.
5. Cleanup: clear `pd.gaze.*` localStorage after testing.

## Defaults & decisions locked in

- Gaze **off by default**; enable via settings panel → then pre-game calibration offered on next Begin.
- Calibration skippable at every step (Skip / Don't ask again / Esc); autostart runs never block.
- MediaPipe vendored locally (offline-consistent), lazy-loaded via dynamic `import()`.
- Sample-and-hold into MetricsCollector at physics rate **plus** native-rate ring buffer in GazeAnalyzer for fixation/blink precision.
- 1-euro filter over Kalman (fewer tunables, equal quality at 30 Hz).

---

## Addendum (2026-07-05): performance optimization, rate config, pre-game-only calibration

**Problem**: `detectForVideo()` ran synchronously on the main thread at full
camera rate (~30 Hz), costing 10–40 ms per inference and contending with the
Three.js renderer for the GPU — sim FPS collapsed with gaze enabled.

**Changes**:
1. **Worker offload** — inference moved to `static/js/gaze-worker.js` (module
   worker built from `src/gaze/{config,gaze-math,worker}.js`). Main thread only
   grabs a 320×240 `ImageBitmap` per sample and transfers it; one frame in
   flight, extras dropped; capture paused while `document.hidden`. Main-thread
   fallback path retained (`status().mode`: `worker` | `main-thread`).
2. **Configurable sampling rate** — `rateHz` (5–30, default **15 Hz**,
   `pd.gaze.rateHz`), decoupled from camera fps. Rationale: episode boundary
   error = ±half the sample interval, so 15 Hz keeps the automotive 2–3 s
   glance standard within ±3% and ISO 15007 200 ms fixations at ≥3 samples;
   30 Hz only needed for blink/PERCLOS microdynamics. Exposed in the settings
   panel, `PromptDrive.gaze.get/set`, and api-test.html.
3. **Calibration strictly pre-game** — the beginGame gate is the only path
   that opens the modal; the engine patch sets `GazeTracking.gameBegun` at key
   unlock, after which `calibrate()` stages recalibration (clears stored
   calibration + skip flag, returns `{staged:true}`) for the next Begin
   instead of interrupting the drive.
4. **api-test.html** — Static tab: "Gaze tracking (webcam)" card (enable, rate,
   dot) committed on Stage/Apply via `gaze.set`; attention family checkbox.
   Metrics tab: "Gaze status" card (status / latest sample / stage
   recalibration).
