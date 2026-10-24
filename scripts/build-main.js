/**
 * Patches the deobfuscated game bundle with instrument-cluster integration
 * and writes static/js/main.ca6b3355.chunk.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'src-extracted/deobfuscated.js');
const outPath = path.join(root, 'static/js/main.ca6b3355.chunk.js');

// Normalize line endings to LF. The patch anchors below are written with
// `\n`, so a CRLF checkout (e.g. Windows with core.autocrlf=true) would
// otherwise fail to match every multi-line anchor.
let src = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

function replaceOnce(haystack, needle, replacement, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`Patch failed: could not find anchor for "${label}"`);
  }
  return haystack.replace(needle, replacement);
}

// --- Patch: throttleDisplay in VehicleController constructor ---
src = replaceOnce(
  src,
  '      this.uiTimer = 0;\n      this.speedFactor = 1;',
  '      this.uiTimer = 0;\n      this.throttleDisplay = 0;\n      this.instrumentCluster = null;\n      this.clusterMesh = null;\n      this.drivingMetrics = null;\n      this.speedFactor = 1;',
  'constructor fields',
);

// --- Patch: rename initVehicle skin variable so module THREE import `r` stays accessible ---
src = replaceOnce(
  src,
  `      const o = new ln.a();
      let r = _d;
      if (e.skins) {
        let t = Object.keys(e.skins)[0];
        for (let i in e.skins[t]) {
          r[i].color.setHex(e.skins[t][i]);
        }
      }`,
  `      const o = new ln.a();
      let skinPalette = _d;
      if (e.skins) {
        let t = Object.keys(e.skins)[0];
        for (let i in e.skins[t]) {
          skinPalette[i].color.setHex(e.skins[t][i]);
        }
      }`,
  'rename skin palette variable',
);

// --- Patch: reset cluster mesh ref on vehicle change (keep live cluster instance) ---
src = replaceOnce(
  src,
  '      for (this.update = this.updatePass; Ae.geo.children.length;) {\n        Ae.geo.remove(Ae.geo.children[Ae.geo.children.length - 1]);\n      }',
      `      this.clusterMesh = null;
      if (this.instrumentCluster) {
        this.instrumentCluster.applyToObject(Ae.geo, false);
      }
      for (this.update = this.updatePass; Ae.geo.children.length;) {
        Ae.geo.remove(Ae.geo.children[Ae.geo.children.length - 1]);
      }`,
  'initVehicle reset cluster mesh',
);

// --- Patch: body traverse unchanged; map texture hooked in initVehicle ---

// --- Patch: use canvas texture on shared map material ---
src = replaceOnce(
  src,
  `      if (e.map) {
        _d.map.map = nt(e.map);
      }`,
  `      if (e.map) {
        _d.map.map = nt(e.map);
      }`,
  'initVehicle map texture',
);

// --- Patch: steering wheel renderOrder ---
src = replaceOnce(
  src,
  `          Ae.steeringWheel = e;
          Ae.steeringWheel.visible = Fe.value.showWheel;
          Ae.geo.add(e);
        });`,
  `          Ae.steeringWheel = e;
          Ae.steeringWheel.visible = Fe.value.showWheel;
          e.traverse(child => {
            if (child.isMesh) child.renderOrder = 3;
          });
          Ae.geo.add(e);
        });`,
  'steering wheel renderOrder',
);

// --- Patch: dashboard renderOrder ---
src = replaceOnce(
  src,
  `          Ae.dashboard = e;
          Ae.geo.add(e);
        });
      } else if (Ae.dashboard) {`,
  `          Ae.dashboard = e;
          e.traverse(child => {
            if (child.isMesh) child.renderOrder = 2;
          });
          Ae.geo.add(e);
        });
      } else if (Ae.dashboard) {`,
  'dashboard renderOrder',
);

src = replaceOnce(
  src,
  `      this.dom.speed = document.getElementById("ui-speed-val");
      this.dom.dist = document.getElementById("ui-dist-val");
      this.initialisePosition();`,
  `      this.dom.speed = document.getElementById("ui-speed-val");
      this.dom.dist = document.getElementById("ui-dist-val");
      this.dom.mainStats = document.getElementById("main-stats");
      this.initialisePosition();`,
  'mainStats dom ref',
);

// --- Patch: updateUI cluster draw ---
const updateUIOld = `    updateUI() {
      this.dom.speed.innerHTML = (Bh.speed * this.speedFactor).toFixed(1);
      this.dom.dist.innerHTML = (Math.floor(Bh.dist * this.distFactor * 10) / 10).toFixed(1);
    }`;

const updateUINew = `    updateUI() {
      this.dom.speed.innerHTML = (Bh.speed * this.speedFactor).toFixed(1);
      this.dom.dist.innerHTML = (Math.floor(Bh.dist * this.distFactor * 10) / 10).toFixed(1);
      if (this.dom.mainStats) {
        const hide = this.instrumentCluster && Js.value;
        this.dom.mainStats.style.setProperty("display", hide ? "none" : "", hide ? "important" : "");
      }
      if (this.instrumentCluster && !Js.value) {
        this.instrumentCluster.applyToObject(Ae.geo, false);
      }
      if (this.instrumentCluster && Js.value) {
        if (!this.clusterMesh) {
          this.clusterMesh = this.instrumentCluster.applyToObject(Ae.geo, true);
        } else {
          this.instrumentCluster.applyToObject(Ae.geo, true);
        }
        this.instrumentCluster.syncPlacement(
          Ae.metrics.steeringPos,
          Fe.value.side == 0 ? -1 : 1,
        );
        const throttleTarget = Math.min(1, Math.abs(this.inputs.accel) / Ae.metrics.accel);
        this.throttleDisplay = this.throttleDisplay * 0.85 + throttleTarget * 0.15;
        const driveModes = ["AWD", "FWD", "RWD"];
        const speedUnits = ["MPH", "KPH"];
        const distUnits = ["MI", "KM"];
        this.instrumentCluster.draw({
          speedKph: Bh.speed * this.speedFactor,
          speedLerp: Ae.speedLerp,
          odometerKm: Math.floor(Bh.dist * this.distFactor),
          throttle: this.throttleDisplay,
          autodrive: ce.value,
          driveMode: driveModes[Fe.value.mode] || "AWD",
          speedUnit: speedUnits[ie.Units] || "KPH",
          distUnit: distUnits[ie.Units] || "KM",
          clock: new Date()
        });
        this.instrumentCluster.texture.needsUpdate = true;
      }
    }`;

src = replaceOnce(src, updateUIOld, updateUINew, 'updateUI cluster');

// --- Patch: create cluster during controller initialise ---
src = replaceOnce(
  src,
  `      this.onControllerChanged(D.value, true);
      this.initVehicle(je[Fe.value.type]);`,
  `      this.onControllerChanged(D.value, true);
      if (typeof InstrumentCluster !== "undefined" && !this.instrumentCluster) {
        try {
          this.instrumentCluster = new InstrumentCluster(r);
        } catch (clusterErr) {
          console.error("InstrumentCluster init failed", clusterErr);
        }
      }
      if (typeof DrivingMetrics !== "undefined" && !this.drivingMetrics) {
        try {
          this.drivingMetrics = new DrivingMetrics(r);
        } catch (metricsErr) {
          console.error("DrivingMetrics init failed", metricsErr);
        }
      }
      this.initVehicle(je[Fe.value.type]);`,
  'initialise cluster',
);

// --- Patch: re-apply cluster when initVehicle short-circuits ---
src = replaceOnce(
  src,
  `    initVehicle(e) {
      if (this.vehicleDef?.name == e.name) {
        return;
      }`,
  `    initVehicle(e) {
      if (this.vehicleDef?.name == e.name) {
        if (this.instrumentCluster) {
          this.clusterMesh = this.instrumentCluster.applyToObject(Ae.geo, Js.value) || this.clusterMesh;
        }
        return;
      }`,
  'initVehicle re-apply cluster',
);

// --- Patch: apply cluster after body model loads ---
src = replaceOnce(
  src,
  `        });
        this.positionHeadlights();
        this.updateHeadlights();
        e.rotation.y = -Math.PI / 2;
        Ae.geo.add(e);
      });
      o.load(s.default, t => {`,
  `        });
        this.positionHeadlights();
        this.updateHeadlights();
        e.rotation.y = -Math.PI / 2;
        Ae.geo.add(e);
        if (this.instrumentCluster) {
          this.clusterMesh = this.instrumentCluster.applyToObject(Ae.geo, Js.value) || this.clusterMesh;
        }
      });
      o.load(s.default, t => {`,
  'body load apply cluster',
);

// --- Patch: apply cluster after dashboard loads ---
src = replaceOnce(
  src,
  `          Ae.geo.add(e);
        });
      } else if (Ae.dashboard) {
        var l;`,
  `          Ae.geo.add(e);
          if (this.instrumentCluster) {
            this.clusterMesh = this.instrumentCluster.applyToObject(Ae.geo, Js.value) || this.clusterMesh;
          }
        });
      } else if (Ae.dashboard) {
        var l;`,
  'dashboard load apply cluster',
);

// --- Patch: keep cluster UI updated while stationed ---
src = replaceOnce(
  src,
  `      this.updateWheelMotion(e);
      this.updateChassisMotion(e);
      this.updateWheelState(e);
      this.audio.update(e);
      this.pdT = e;
    }
    updatePass(e, t) {}`,
  `      this.updateWheelMotion(e);
      this.updateChassisMotion(e);
      this.updateWheelState(e);
      this.audio.update(e);
      this.uiTimer += e;
      if (this.uiTimer > 0.033) {
        this.uiTimer -= 0.033;
        this.updateUI();
      }
      this.pdT = e;
    }
    updatePass(e, t) {}`,
  'updateStationed cluster UI',
);

// --- Patch: sample driving-performance telemetry each physics frame ---
src = replaceOnce(
  src,
  `      Ae.pVel.copy(Ae.vel);
      if (!isFinite(Ae.speed)) {`,
  `      Ae.pVel.copy(Ae.vel);
      if (this.drivingMetrics) {
        try {
          // ii() = engine's precise road projection: { d: perpendicular dist,
          // s: sign, w: interpolated road width, ... } (see deobfuscated ~3209).
          let _moff = NaN;
          let _mhalf = null;
          if (si.vehicleNode) {
            const _mp = ii(Ae.position.x, Ae.position.z, si.vehicleNode, true);
            if (_mp) {
              // Lane position relative to the EGO LANE CENTER. With multi-lane
              // roads the engine publishes the resolved lane geometry on
              // window.LaneRoads._resolved; use it when present and non-default.
              let _geom = null;
              try { _geom = (typeof window !== "undefined" && window.LaneRoads) ? window.LaneRoads._resolved : null; } catch (_g) { _geom = null; }
              if (_geom && !_geom.isDefault) {
                _moff = (_mp.d * _mp.s) - _geom.egoCenterSigned; // signed deviation from ego-lane center
                _mhalf = _geom.laneWidth / 2; // lane half-width (center to boundary)
              } else {
                // Default single carriageway: original behaviour. The engine
                // treats |rawProx| = 0.5 as the nominal driving line, so the
                // lane center sits at 0.5*(Yt - wheels.width/2) from the midline.
                const _usable = Yt - Ae.wheels.width / 2;
                const _laneCenter = 0.5 * _usable;
                _moff = (_mp.d - _laneCenter) * _mp.s;
                _mhalf = _laneCenter;
              }
            }
          }
          this.drivingMetrics.sample(e, {
            speed: Ae.speed,
            steer: Ae.steer,
            throttle: Math.abs(this.inputs.accel),
            brake: this.inputs.brake,
            accel: Ae.accel,
            heading: Ae.heading,
            posX: Ae.position.x,
            posZ: Ae.position.z,
            lateralOffset: _moff,
            laneHalfL: _mhalf,
            laneHalfR: _mhalf,
            nodeIndex: si.vehicleIndex,
            onRoad: Ae.onRoad,
            collided: this.didCollide,
            vehicle: Fe.value.type,
            units: ie.Units
          });
        } catch (_metricsSampleErr) {}
      }
      if (!isFinite(Ae.speed)) {`,
  'driving metrics sample',
);

// --- Patch: forward the analytics event seam (el.sendUpdate) to the API event
// bus. el's socket is null (no-op today), so this just re-exposes the existing
// event taxonomy (weatherChange, skinChange, cameraChange, driveModeChange,
// paused, resetCount, wrongWay, …) to window.PromptDrive subscribers. ---
src = replaceOnce(
  src,
  `    sendUpdate(e, t) {
      var i;
      if ((i = this.socket) !== null && i !== undefined) {`,
  `    sendUpdate(e, t) {
      var i;
      try {
        if (typeof window !== "undefined" && window.PromptDriveBridge) {
          window.PromptDriveBridge.emit(e, t);
        }
      } catch (_pdEmitErr) {}
      if ((i = this.socket) !== null && i !== undefined) {`,
  'PromptDrive event seam',
);

// --- Patch: register live engine handles on the API bridge at controller init.
// All referenced singletons (Ae, Fe, jh, ce, ie, zl, Ks, Vl, Y) and the THREE
// import `r` are module-scoped, so they are in scope here. This is the API
// equivalent of how the cluster/metrics instances are attached above. ---
src = replaceOnce(
  src,
  `      this.headlights = Ae.headlights;
      this.hasInit = true;`,
  `      this.headlights = Ae.headlights;
      this.hasInit = true;
      try {
        if (typeof window !== "undefined" && window.PromptDriveBridge) {
          window.PromptDriveBridge.attach({
            controller: this,
            ego: Ae,
            vehicleConfig: Fe,
            sceneConfig: jh,
            autodrive: ce,
            units: ie,
            world: zl,
            dayNight: Ks,
            speedControl: Vl,
            input: Y,
            inputMode: D,
            gamepadSettings: P,
            gamepadMap: T,
            ticker: oe,
            cameraDefs: Ol,
            THREE: r,
            drivingMetrics: this.drivingMetrics
          });
        }
      } catch (_pdAttachErr) {
        console.error("PromptDrive bridge attach failed", _pdAttachErr);
      }`,
  'PromptDrive bridge attach',
);

// --- Patch: virtual drive-input source (plan §5.4). OR programmatic inputs from
// window.PromptDrive.dynamic.input({...}) into the per-frame signals so a service
// can *drive* the car, not just configure it. Mirrors how controllerSignal is
// blended into steering elsewhere. ---
src = replaceOnce(
  src,
  `    handleInput(e) {
      this.hasBoost = this.hasBoost && (this.hasAccel || this.hasCruiseTarget);
      this.inputs.accel = 0;
      this.inputs.drive = 0;`,
  `    handleInput(e) {
      try {
        if (typeof window !== "undefined" && window.PromptDriveBridge && window.PromptDriveBridge.inputOverride) {
          const _pdo = window.PromptDriveBridge.inputOverride;
          const _orSig = (k, v) => { if (v != null) Y.signal[k] = Math.max(Y.signal[k] || 0, +v || 0); };
          _orSig("Forward", _pdo.forward);
          _orSig("Backward", _pdo.backward);
          _orSig("Left", _pdo.left);
          _orSig("Right", _pdo.right);
          _orSig("Boost", _pdo.boost);
          _orSig("Handbrake", _pdo.handbrake);
          // One-shot camera cycle: fire CameraMode for exactly this frame, then
          // clear so it advances a single mode per requested pulse.
          if (_pdo.cameraPulse) {
            Y.signal.CameraMode = 1;
            window.PromptDriveBridge.inputOverride.cameraPulse = false;
          }
        }
      } catch (_pdInputErr) {}
      this.hasBoost = this.hasBoost && (this.hasAccel || this.hasCruiseTarget);
      this.inputs.accel = 0;
      this.inputs.drive = 0;`,
  'PromptDrive virtual input',
);

// --- Patch: never hard-pause the sim on low FPS. The engine raises the `ne`
// observable when it detects a stalled/slow first-load (checkNoGPU) or a sub-20
// FPS reading, and a truthy `ne` renders the full-screen, click-to-dismiss
// "Critically low FPS detected …" overlay (game-paused, g == 1) that blocks the
// participant. We drop the `ne.set(true)` from both detectors so the sim never
// gets blocked; the non-blocking "Low FPS?" hint (`hc`) is left untouched. ---
src = replaceOnce(
  src,
  `          if (this.checkNoGPU > 10) {
            ne.set(true);
            ne.disable();
          }`,
  `          if (this.checkNoGPU > 10) {
            ne.disable();
          }`,
  'low-FPS no-GPU no block',
);

src = replaceOnce(
  src,
  `      if (this.lowFPSWaiter > 3 && this.curFPS < 45 && this.curFPS > 15 && !hc.disabled) {
        if (this.curFPS < 20) {
          ne.set(true);
        }
        hc.set(true);
        hc.disable();
      }`,
  `      if (this.lowFPSWaiter > 3 && this.curFPS < 45 && this.curFPS > 15 && !hc.disabled) {
        hc.set(true);
        hc.disable();
      }`,
  'low-FPS stats no block',
);

// --- Patch: steering-wheel input takeover (wheel-controls-plan.md §3). When
// window.WheelControls is enabled and a device is present, the wheel subsystem
// computes the per-frame signals itself (calibrated rest→full pedal ranges,
// rotation-scaled steering, button→action bindings) and the stock gamepad
// mapping is skipped. With no device — or the subsystem disabled — behaviour
// is exactly stock. Runs inside input mode 2 (gamepad), so steering still
// flows through smoothControllerSteer and all downstream behaviour holds. ---
src = replaceOnce(
  src,
  `    updateGamepad() {
      H = T.value;
      Q = this.getGP();
      if (Q) {`,
  `    updateGamepad() {
      H = T.value;
      try {
        if (typeof window !== "undefined" && window.WheelControls && window.WheelControls.enabled() && window.WheelControls._engineApply(this)) {
          return;
        }
      } catch (_wcErr) {}
      Q = this.getGP();
      if (Q) {`,
  'WheelControls input takeover',
);

// ---------------------------------------------------------------------------
// Center console (window.CenterConsole, src/console/ -> static/js/console.js).
// The patches below anchor on text INSERTED by the cluster/metrics/bridge
// patches above, so they must stay after them in this file.
// ---------------------------------------------------------------------------

// --- Patch: centerConsole field in VehicleController constructor ---
src = replaceOnce(
  src,
  '      this.drivingMetrics = null;\n      this.speedFactor = 1;',
  '      this.drivingMetrics = null;\n      this.centerConsole = null;\n      this.speedFactor = 1;',
  'constructor centerConsole field',
);

// --- Patch: create the center console during controller initialise ---
src = replaceOnce(
  src,
  '      if (typeof DrivingMetrics !== "undefined" && !this.drivingMetrics) {',
  `      if (typeof CenterConsole !== "undefined" && !this.centerConsole) {
        try {
          this.centerConsole = new CenterConsole(r);
        } catch (consoleErr) {
          console.error("CenterConsole init failed", consoleErr);
        }
      }
      if (typeof DrivingMetrics !== "undefined" && !this.drivingMetrics) {`,
  'initialise center console',
);

// --- Patch: drive the console every updateUI tick (attach + redraw; the
// console itself gates all work on the first-person observable) ---
src = replaceOnce(
  src,
  '        this.instrumentCluster.texture.needsUpdate = true;\n      }\n    }',
  `        this.instrumentCluster.texture.needsUpdate = true;
      }
      if (this.centerConsole) {
        try {
          this.centerConsole.frame(Ae.geo, Js.value);
        } catch (consoleFrameErr) {}
      }
    }`,
  'updateUI center console frame',
);

// --- Patch: drop console meshes before initVehicle purges Ae.geo children ---
src = replaceOnce(
  src,
  `      this.clusterMesh = null;
      if (this.instrumentCluster) {
        this.instrumentCluster.applyToObject(Ae.geo, false);
      }`,
  `      this.clusterMesh = null;
      if (this.instrumentCluster) {
        this.instrumentCluster.applyToObject(Ae.geo, false);
      }
      if (this.centerConsole) {
        try {
          this.centerConsole.resetForVehicleChange();
        } catch (consoleResetErr) {}
      }`,
  'initVehicle reset center console',
);

// --- Patch: extend the bridge handles with the camera + road/audio seams the
// console (and future tools) need: Xs = the PerspectiveCamera, si = road
// state, ii/ti = road projection / closest node, Js = first-person
// observable, xe = the WebAudio manager. All module-scoped, in scope here. ---
src = replaceOnce(
  src,
  `            THREE: r,
            drivingMetrics: this.drivingMetrics
          });`,
  `            THREE: r,
            camera: Xs,
            roadState: si,
            project: ii,
            closestNode: ti,
            firstPerson: Js,
            audioManager: xe,
            drivingMetrics: this.drivingMetrics,
            centerConsole: this.centerConsole
          });`,
  'bridge attach center console handles',
);

// --- Patch: add a `showConsole` VehicleConfig field so the center console can
// be toggled from the game's own settings panel (like "Interior: Show wheel").
// Three insertions into the VehicleConfig triplet — storage key map (Pe),
// defaults (Ge), and the settings descriptors (Be) that the panel renders. ---
src = replaceOnce(
  src,
  '    showWheel: "config-vehicle-show-wheel",\n    autodriveSide: "config-autodrive-side",',
  '    showWheel: "config-vehicle-show-wheel",\n    showConsole: "config-vehicle-show-console",\n    autodriveSide: "config-autodrive-side",',
  'VehicleConfig showConsole storage key',
);

src = replaceOnce(
  src,
  '    showWheel: true,\n    seatAdjustment: 0,',
  '    showWheel: true,\n    showConsole: true,\n    seatAdjustment: 0,',
  'VehicleConfig showConsole default',
);

src = replaceOnce(
  src,
  `    showWheel: {
      readable: "Interior: Show wheel",
      desc: "Toggle visibility of the steering wheel",
      type: u.Boolean,
      default: true,
      onSet: e => We.set("showWheel", e)
    },
    steerRotationIndex: {`,
  `    showWheel: {
      readable: "Interior: Show wheel",
      desc: "Toggle visibility of the steering wheel",
      type: u.Boolean,
      default: true,
      onSet: e => We.set("showWheel", e)
    },
    showConsole: {
      readable: "Interior: Show center console",
      desc: "Toggle the in-cabin center-stack touchscreen (map / nav / audio / phone / comfort)",
      type: u.Boolean,
      default: true,
      onSet: e => We.set("showConsole", e)
    },
    steerRotationIndex: {`,
  'VehicleConfig showConsole descriptor',
);

// --- Patch: benchmark-mode headlight lock (car-bench-compat-plan.md §4.5 #1) ---
// In benchmark mode the vehicle state is Python-authoritative; only
// VehicleState's own projection (_applying) may drive the engine headlights.
// Gate setHeadlights itself so auto-dusk (deobf ~:10873), weather-forced
// (~:11205/:13083) and KeyH writes are blocked and reported, rather than
// silently flipping a mirrored field between eval snapshots.
src = replaceOnce(
  src,
  `    setHeadlights(e, t = false) {
      if (!!e || !!t || !this.headlights || !this.headlightsManual) {`,
  `    setHeadlights(e, t = false) {
      if (typeof window !== "undefined" && window.VehicleState && window.VehicleState._benchmark && !window.VehicleState._applying) {
        try { if (window.PromptDriveBridge) window.PromptDriveBridge.emit("vehicleExternalAttempt", { field: "head_lights_low_beams", source: "engine" }); } catch (_e) {}
        return;
      }
      if (!!e || !!t || !this.headlights || !this.headlightsManual) {`,
  'benchmark headlight lock',
);

// ---------------------------------------------------------------------------
// Season × Time-of-day × Weather (prompt-drive-weather-season).
// ---------------------------------------------------------------------------

// --- Patch: rebuild each Hills skin's flat `weathers` list into a deterministic
// 4×4 grid so time-of-day and weather become INDEPENDENT axes:
//     weatherIndex = timeIdx*4 + weatherIdx
//     timeIdx:    0 morning, 1 midday, 2 dusk, 3 night
//     weatherIdx: 0 clear,   1 rain,   2 snow, 3 fog
// Clear reuses the existing hand-tuned time-of-day presets verbatim (so the
// day-night `cycles` still resolve by name); rain/snow/fog are composed by
// overlaying precipitation/haze onto that base and registered on Vs.weathers.
// The ordering + skin keys MUST stay in sync with src/api/config.js. This runs
// at module eval, before SceneConfig/buildSceneMeta, so the grid is already in
// place when the settings panel and sceneMeta read it. Only Hills (Vs) is
// gridded; Planet keeps raw skin/weatherIndex semantics.
src = replaceOnce(
  src,
  '  var Vs = Ms;',
  `  var Vs = Ms;
  (function pdBuildAtmosphereGrid() {
    try {
      var W = Vs.weathers;
      // Per-season (engine skin key) time-of-day base preset names.
      var BASES = {
        spring: ["springSunrise", "clearSpring", "autumnSunset", "night"],
        default: ["sunrise", "clear", "sunset", "night"],
        autumn: ["autumnSunrise", "clearAutumn", "twilight", "night"],
        winter: ["winterSunrise", "clearSnow", "winterSunset", "nightSnow"]
      };
      var rainAudio = (W.rain && W.rain.audio) || (W.springRain && W.springRain.audio) || null;
      var snowParticles = (W.snow && W.snow.particles) || { colour: 14406598, half: false, speed: 1.25 };
      var KINDS = ["clear", "rain", "snow", "fog"];
      var compose = function (baseName, kind, key) {
        var base = W[baseName] || W.default;
        if (kind === "clear") return baseName; // reuse the base preset verbatim
        var o = Object.assign({}, base);
        var bFar = base.fogFar != null ? base.fogFar : 1;
        if (kind === "rain") {
          o.dynamicFog = true;
          o.fogFar = Math.min(bFar, 0.7);
          o.dir = (base.dir != null ? base.dir : 0.8) * 0.6; // overcast gloom
          if (rainAudio) o.audio = Object.assign({}, base.audio, { ambiance: rainAudio.ambiance });
          delete o.particles; // engine has no rain mesh: haze + audio convey rain
        } else if (kind === "snow") {
          o.particles = snowParticles; // visible falling snow on any base
          o.dynamicFog = true;
          o.fogFar = Math.min(bFar, 0.7);
        } else if (kind === "fog") {
          o.dynamicFog = true;
          o.fogNear = 0;
          o.fogFar = 0.4; // thick synthetic haze (no dedicated engine fog preset)
          delete o.particles;
        }
        W[key] = o;
        return key;
      };
      for (var skinKey in BASES) {
        if (!Vs.skins[skinKey]) continue;
        var bases = BASES[skinKey];
        var grid = [];
        for (var ti = 0; ti < bases.length; ti++) {
          for (var wi = 0; wi < KINDS.length; wi++) {
            grid.push(compose(bases[ti], KINDS[wi], "pd_" + skinKey + "_" + ti + "_" + KINDS[wi]));
          }
        }
        Vs.skins[skinKey].weathers = grid;
      }
      Vs._pdAtmosphereGrid = true;
    } catch (_pdGridErr) {
      try { console.error("PromptDrive atmosphere grid failed", _pdGridErr); } catch (_e) {}
    }
  })();`,
  'atmosphere grid data',
);

// --- Patch: sensible scene default under the new grid. The stock default was
// skin "summer" (not a real skin key — it was sanitised to "default") with
// weatherIndex 2 (which is now morning/snow). Point it at the real "default"
// (summer) skin and grid index 4 = midday + clear.
src = replaceOnce(
  src,
  '    skin: "summer",\n    weatherIndex: 2,',
  '    skin: "default",\n    weatherIndex: 4,',
  'scene default midday/clear grid index',
);

// --- Patch: rebuild the scene settings panel into three independent rows
// (Season / Time of day / Weather) + the cycle timer, for the gridded Hills
// scene. Other scenes (Planet) fall back to the stock season→weather layout.
// New time-of-day / weather icon assets live in static/media (the stock weather
// icons w_*.svg were missing entirely). Row order + the 4×4 index math mirror
// src/api/config.js.
src = replaceOnce(
  src,
  `  const Bp = () => {
    const [e, t] = Object(s.useState)(jh.sceneMeta.scenes[jh.sceneMeta.current]);
    const [i, n] = Object(s.useState)(jh.value.skin);
    const a = Object(s.useCallback)(() => {
      t(jh.sceneMeta.scenes[jh.value.sceneName]);
      n("default");
    }, [t]);
    Object(s.useEffect)(() => {
      jh.addListener("sceneName", a);
      return () => {
        jh.removeListener("sceneName", a);
      };
    }, [a]);
    Object(s.useEffect)(() => {
      jh.addListener("skin", n);
      return () => {
        jh.removeListener("skin", n);
      };
    }, [n]);
    Object(s.useEffect)(() => {
      jh.addListener("seed", a);
      return () => {
        jh.removeListener("seed", a);
      };
    }, [a]);
    const o = Object(s.useCallback)((t, i) => {
      jh.set("skin", e.skins[t]);
      jh.set("weatherIndex", i);
    }, [e]);
    const r = Object(s.useCallback)(t => {
      jh.set("skin", e.skins[t]);
      jh.set("weatherIndex", 0);
    }, [e]);
    let h = e.skins;
    let l = e.skinNames;
    let d = e.skinWeathers;
    return Object(vc.jsxs)(Vp, {
      icon: wp,
      children: [h.length && h.map((e, t) => Object(vc.jsx)(Xp, {
        selected: e == i,
        icon: Np[l[e]],
        label: l[e],
        onMouseDown: () => r(t),
        children: d[e].map((s, n) => Object(vc.jsx)(Gp, {
          canSelect: e == i,
          configKey: "weatherIndex",
          configVal: n,
          icon: kp[s],
          onMouseDown: () => o(t, n)
        }, n))
      }, e)), e.hasCycles && Object(vc.jsx)(Pp, {}), Object(vc.jsx)("div", {
        className: "stack-back",
        style: {
          width: "200px"
        }
      })]
    });
  };`,
  `  var pdIconMorning = i.p + "static/media/td_morning.svg";
  var pdIconMidday = i.p + "static/media/td_midday.svg";
  var pdIconDusk = i.p + "static/media/td_dusk.svg";
  var pdIconNight = i.p + "static/media/td_night.svg";
  var pdIconWxClear = i.p + "static/media/wx_clear.svg";
  var pdIconWxRain = i.p + "static/media/wx_rain.svg";
  var pdIconWxSnow = i.p + "static/media/wx_snow.svg";
  var pdIconWxFog = i.p + "static/media/wx_fog.svg";
  const pdTimeLabels = ["morning", "midday", "dusk", "night"];
  const pdTimeIcons = [pdIconMorning, pdIconMidday, pdIconDusk, pdIconNight];
  const pdWeatherLabels = ["clear", "rain", "snow", "fog"];
  const pdWeatherIcons = [pdIconWxClear, pdIconWxRain, pdIconWxSnow, pdIconWxFog];
  const pdWeatherSpan = pdTimeLabels.length * pdWeatherLabels.length;
  const Bp = () => {
    const [meta, setMeta] = Object(s.useState)(jh.sceneMeta.scenes[jh.sceneMeta.current]);
    const [skin, setSkinState] = Object(s.useState)(jh.value.skin);
    const [wx, setWx] = Object(s.useState)(jh.value.weatherIndex);
    const onScene = Object(s.useCallback)(() => {
      setMeta(jh.sceneMeta.scenes[jh.value.sceneName]);
      setSkinState(jh.value.skin);
      setWx(jh.value.weatherIndex);
    }, []);
    Object(s.useEffect)(() => {
      jh.addListener("sceneName", onScene);
      jh.addListener("seed", onScene);
      jh.addListener("skin", setSkinState);
      jh.addListener("weatherIndex", setWx);
      return () => {
        jh.removeListener("sceneName", onScene);
        jh.removeListener("seed", onScene);
        jh.removeListener("skin", setSkinState);
        jh.removeListener("weatherIndex", setWx);
      };
    }, [onScene]);
    const skinKeys = (meta && meta.skins) || [];
    const skinNames = (meta && meta.skinNames) || {};
    const isGrid = jh.value.sceneName === "Hills";
    if (!isGrid) {
      const d = (meta && meta.skinWeathers) || {};
      return Object(vc.jsxs)(Vp, {
        icon: wp,
        children: [skinKeys.length && skinKeys.map(k => Object(vc.jsx)(Xp, {
          selected: k == skin,
          icon: Np[skinNames[k]],
          label: skinNames[k],
          onMouseDown: () => { jh.set("skin", k); jh.set("weatherIndex", 0); },
          children: (d[k] || []).map((nm, wi) => Object(vc.jsx)(Gp, {
            canSelect: k == skin,
            configKey: "weatherIndex",
            configVal: wi,
            icon: kp[nm],
            onMouseDown: () => { jh.set("skin", k); jh.set("weatherIndex", wi); }
          }, wi))
        }, k)), meta && meta.hasCycles && Object(vc.jsx)(Pp, {}), Object(vc.jsx)("div", {
          className: "stack-back",
          style: { width: "200px" }
        })]
      });
    }
    const safeWx = ((Math.round(wx) % pdWeatherSpan) + pdWeatherSpan) % pdWeatherSpan;
    const timeIdx = Math.floor(safeWx / pdWeatherLabels.length);
    const wxIdx = safeWx % pdWeatherLabels.length;
    const seasonHeader = Np[skinNames[skin]] || Np.summer;
    return Object(vc.jsxs)(Vp, {
      icon: wp,
      children: [Object(vc.jsx)(Xp, {
        selected: false,
        icon: seasonHeader,
        label: skinNames[skin] || "season",
        children: skinKeys.map(k => Object(vc.jsx)(qp, {
          selected: k == skin,
          icon: Np[skinNames[k]],
          onMouseDown: () => jh.set("skin", k)
        }, k))
      }, "pd-season"), Object(vc.jsx)(Xp, {
        selected: false,
        icon: pdTimeIcons[timeIdx],
        label: pdTimeLabels[timeIdx],
        children: pdTimeLabels.map((lb, ti) => Object(vc.jsx)(qp, {
          selected: ti == timeIdx,
          icon: pdTimeIcons[ti],
          onMouseDown: () => jh.set("weatherIndex", ti * pdWeatherLabels.length + wxIdx)
        }, lb))
      }, "pd-time"), Object(vc.jsx)(Xp, {
        selected: false,
        icon: pdWeatherIcons[wxIdx],
        label: pdWeatherLabels[wxIdx],
        children: pdWeatherLabels.map((lb, wi) => Object(vc.jsx)(qp, {
          selected: wi == wxIdx,
          icon: pdWeatherIcons[wi],
          onMouseDown: () => jh.set("weatherIndex", timeIdx * pdWeatherLabels.length + wi)
        }, lb))
      }, "pd-weather"), Object(vc.jsx)(Pp, {}), Object(vc.jsx)("div", {
        className: "stack-back",
        style: { width: "200px" }
      })]
    });
  };`,
  'scene panel three-axis rebuild',
);

fs.writeFileSync(outPath, src);
console.log('Wrote patched main bundle to', outPath);
