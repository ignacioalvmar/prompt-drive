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
// Procedural map generation expansion (window.MapGen, src/mapgen/ ->
// static/js/mapgen.js). MapGen injects expanded/custom topography presets
// into the engine's own per-scene tables; the patches below (a) hand it those
// tables before SceneConfig builds sceneMeta, (b) accept the extra names in
// validation and the in-game menu, (c) publish what was actually generated,
// and (d) keep name-keyed lookups (autodrive bendiness, fastest-mile records)
// safe for topography names the stock tables don't know.
// ---------------------------------------------------------------------------

// --- Patch: register the per-scene topography tables on MapGen at startup.
// Must run before SceneConfig (Nh) is constructed so buildSceneMeta and the
// world builders see the injected names exactly like built-ins. ---
src = replaceOnce(
  src,
  `  const yh = {
    Hills: Yo,
    Planet: Ah
  };`,
  `  try {
    if (typeof window !== "undefined" && window.MapGen) {
      window.MapGen._registerScene("Hills", Yo.config.topography);
      window.MapGen._registerScene("Planet", Ah.config.topography);
    }
  } catch (mapGenRegErr) {
    console.error("MapGen topography registration failed", mapGenRegErr);
  }
  const yh = {
    Hills: Yo,
    Planet: Ah
  };`,
  'MapGen scene registration',
);

// --- Patch: accept MapGen topography names in the ?topo= query-string check ---
src = replaceOnce(
  src,
  `        } else if (e[0] == "topo") {
          if (Sh.includes(e[1]) || e[1] === "flat") {`,
  `        } else if (e[0] == "topo") {
          if (Sh.includes(e[1]) || e[1] === "flat" || typeof window !== "undefined" && window.MapGen && window.MapGen.has(e[1])) {`,
  'MapGen QS topo validation',
);

// --- Patch: Hills world build — fall back to "normal" if the persisted
// topography name is unknown (e.g. MapGen was removed/disabled after a custom
// name was saved), and publish the effective generation parameters. ---
src = replaceOnce(
  src,
  `      this.seed = e;
      let s = t.topography;
      this.topoIndex = this.topoList.indexOf(s);
      delete this.heightmap;
      this.heightmap = new wi(e, Vs.topography[s].heightmap);
      bt(Vs.topography[s].smoothWindow);
      Vt(Vs.topography[s].roadWidth);`,
  `      this.seed = e;
      let s = t.topography;
      if (!Vs.topography[s]) {
        console.warn("Unknown topography '" + s + "', generating with 'normal'");
        s = "normal";
      }
      this.topoIndex = this.topoList.indexOf(s);
      delete this.heightmap;
      this.heightmap = new wi(e, Vs.topography[s].heightmap);
      bt(Vs.topography[s].smoothWindow);
      Vt(Vs.topography[s].roadWidth);
      try {
        if (typeof window !== "undefined" && window.MapGen) {
          window.MapGen._publishActive({ scene: "Hills", topography: s, seed: e, params: Vs.topography[s] });
        }
      } catch (mapGenPubErr) {}`,
  'MapGen Hills generation',
);

// --- Patch: Planet world build — same fallback + publish as Hills ---
src = replaceOnce(
  src,
  `      this.seed = e;
      let n = t.topography;
      this.topoIndex = this.topoList.indexOf(n);
      if ((s = this.heightmap) !== null && s !== undefined) {
        s.destroy();
      }
      this.heightmap = new Xo(e, Fr.topography[n].heightmap);`,
  `      this.seed = e;
      let n = t.topography;
      if (!Fr.topography[n]) {
        console.warn("Unknown topography '" + n + "', generating with 'normal'");
        n = "normal";
      }
      this.topoIndex = this.topoList.indexOf(n);
      if ((s = this.heightmap) !== null && s !== undefined) {
        s.destroy();
      }
      this.heightmap = new Xo(e, Fr.topography[n].heightmap);
      try {
        if (typeof window !== "undefined" && window.MapGen) {
          window.MapGen._publishActive({ scene: "Planet", topography: n, seed: e, params: Fr.topography[n] });
        }
      } catch (mapGenPubErr) {}`,
  'MapGen Planet generation',
);

// --- Patch: autodrive bendiness — the stock factor tables are keyed by the
// five built-in names; expanded/custom presets carry their own bendyFactor,
// and anything else falls back to "normal" instead of undefined (which would
// NaN the cornering-speed math). ---
src = replaceOnce(
  src,
  `    onTopographyChanged() {
      if (jh.value.sceneName == "Planet") {
        this.bendyFactor = Qd[jh.value.topography];
      } else {
        this.bendyFactor = Hd[jh.value.topography];
      }
    }`,
  `    onTopographyChanged() {
      let mapGenBendy = null;
      try {
        if (typeof window !== "undefined" && window.MapGen) {
          mapGenBendy = window.MapGen.bendyFactor(jh.value.sceneName, jh.value.topography);
        }
      } catch (mapGenBendyErr) {
        mapGenBendy = null;
      }
      if (jh.value.sceneName == "Planet") {
        this.bendyFactor = Qd[jh.value.topography] ?? mapGenBendy ?? Qd.normal;
      } else {
        this.bendyFactor = Hd[jh.value.topography] ?? mapGenBendy ?? Hd.normal;
      }
    }`,
  'MapGen autodrive bendy fallback',
);

// --- Patch: fastest-mile records — the personal-record table is built from
// the five stock names (and older tables persist in localStorage), so lazily
// add a slot for topographies it doesn't know instead of throwing. ---
src = replaceOnce(
  src,
  `    checkRecordBreak(e, t, i) {
      return !(e < 1) && (this.tr = t.personal[od.view.topography][od.view.vehicle], (e < this.tr || this.tr < 0) && (t.personal[od.view.topography][od.view.vehicle] = e, true));
    }`,
  `    checkRecordBreak(e, t, i) {
      if (!t.personal[od.view.topography]) {
        t.personal[od.view.topography] = {};
      }
      if (t.personal[od.view.topography][od.view.vehicle] == null) {
        t.personal[od.view.topography][od.view.vehicle] = -1;
      }
      return !(e < 1) && (this.tr = t.personal[od.view.topography][od.view.vehicle], (e < this.tr || this.tr < 0) && (t.personal[od.view.topography][od.view.vehicle] = e, true));
    }`,
  'MapGen records guard',
);

// --- Patch: records UI — guard the personal + global record reads the same way ---
src = replaceOnce(
  src,
  `    const o = i[e][t];`,
  `    const o = i[e] && i[e][t] != null ? i[e][t] : -1;`,
  'MapGen personal record UI guard',
);

src = replaceOnce(
  src,
  `    if (o) {
      h = o[e][t][i];
    }`,
  `    if (o && o[e] && o[e][t]) {
      h = o[e][t][i];
    }`,
  'MapGen global record UI guard',
);

// --- Patch: in-game "road complexity" menu — list every registered
// topography (engine + expanded + custom) for the pending scene selection.
// The five extra background images simply don't exist for injected names;
// Rp already tolerates an undefined bg entry. ---
src = replaceOnce(
  src,
  `            options: ["STRAIGHT", "CASUAL", "EASY", "NORMAL", "HARD"],`,
  `            options: typeof window !== "undefined" && window.MapGen ? window.MapGen.menuOptions(v) : ["STRAIGHT", "CASUAL", "EASY", "NORMAL", "HARD"],`,
  'MapGen menu options',
);

src = replaceOnce(
  src,
  `            selectedIndex: Sh.indexOf(f),
            onSelectIndex: e => b(Sh[e])`,
  `            selectedIndex: typeof window !== "undefined" && window.MapGen ? window.MapGen.menuNames(v).indexOf(f) : Sh.indexOf(f),
            onSelectIndex: e => b(typeof window !== "undefined" && window.MapGen ? window.MapGen.menuNames(v)[e] : Sh[e])`,
  'MapGen menu selection',
);

fs.writeFileSync(outPath, src);
console.log('Wrote patched main bundle to', outPath);
