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

fs.writeFileSync(outPath, src);
console.log('Wrote patched main bundle to', outPath);
