/**
 * `window.PromptDrive` — the single canonical in-page facade for the Prompt
 * Drive integration API (plan §5.2). Every transport (postMessage, query
 * params, a future WebSocket bridge) is a thin adapter over this object.
 *
 * It owns intent + validation + event publishing and routes changes through the
 * live engine handles registered on `PromptDriveBridge` (filled by
 * build-main.js). Static fields are staged to localStorage and applied on
 * reload; dynamic fields call the engine's own setters — the same paths the
 * settings panel uses, so the API and the UI never diverge.
 */

// localStorage keys the engine reads at load, so a staged config survives the
// reload in apply({mode:'reload'}). Keys mirror the engine's own storage maps
// (VehicleConfig Pe, SceneConfig Dh, GameConfig q) and the seed/start-node
// handling. Because a reload re-reads every one of these, apply({reload}) works
// even before the sim has started — no live engine handle needed.
const STAGE_STORAGE = {
  // scene
  'scene.seed': 'seed',
  'scene.startNode': 'start-node',
  'scene.sceneName': 'config-scene-name',
  'scene.topography': 'config-scene-topography',
  'scene.skin': 'config-scene-skin',
  'scene.weatherIndex': 'config-scene-weather-index',
  'scene.antialias': 'config-antialias',
  // graphics
  'graphics.viewLodIndex': 'config-view-lod-index',
  'graphics.detailLodIndex': 'config-detail-lod-index',
  'graphics.renderScale': 'config-render-scale',
  'graphics.verticalFov': 'config-vertical-fov',
  // vehicle
  'vehicle.type': 'config-vehicle-type',
  'vehicle.mode': 'config-vehicle-mode',
  'vehicle.gripFactor': 'config-vehicle-grip',
  'vehicle.speedFactor': 'config-vehicle-speed',
  'vehicle.showWheel': 'config-vehicle-show-wheel',
  'vehicle.side': 'config-vehicle-side',
  'vehicle.seat': 'config-vehicle-seat',
  'vehicle.seatAdjustment': 'config-vehicle-seat-adjustment',
  'vehicle.seatHeight': 'config-vehicle-seat-height',
  'vehicle.steerRotationIndex': 'config-vehicle-steer-index',
  // controls
  'controls.input': 'config-vehicle-input',
  'controls.autodriveSideIndex': 'config-autodrive-side-index',
  'controls.cameraMode': 'config-camera-mode',
  // general game config
  'units': 'Units',
  'general.showWorm': 'ShowWorm',
  'general.barriers': 'Barriers',
};

// Fields that need an extra derived localStorage key written alongside the main
// one (the engine stores the resolved value separately from its index).
function extraStageWrites(path, value) {
  if (path === 'vehicle.steerRotationIndex') {
    return { 'config-vehicle-steer-angle': [270, 360, 450, 720, 900][value] };
  }
  if (path === 'controls.autodriveSideIndex') {
    return { 'config-autodrive-side': value - 1 };
  }
  return null;
}

let _readyResolve;
const _ready = new Promise((res) => { _readyResolve = res; });

function H() {
  // Live engine handles or null. Throws a clear error if used before ready.
  const h = (typeof window !== 'undefined' && window.PromptDriveBridge)
    ? window.PromptDriveBridge.handles : null;
  if (!h) throw new Error('PromptDrive: engine not ready (await PromptDrive.ready)');
  return h;
}

function ok(value, extra) { return Object.assign({ ok: true, value }, extra || {}); }
function err(error, extra) { return Object.assign({ ok: false, error }, extra || {}); }

// --- get(): resolved snapshot of every domain --------------------------------
function snapshot() {
  const h = H();
  const v = h.vehicleConfig.value;
  const s = h.sceneConfig.value;
  const cruise = h.speedControl.value;
  const lanes = (typeof window !== 'undefined' && window.LaneRoads) ? window.LaneRoads.get() : null;
  const traffic = (typeof window !== 'undefined' && window.RoadTraffic) ? window.RoadTraffic.get() : null;
  const wheel = (typeof window !== 'undefined' && window.WheelControls) ? window.WheelControls.get() : null;
  return {
    scene: {
      seed: s.seed,
      startNode: h.sceneConfig.initialNode,
      sceneName: s.sceneName,
      topography: s.topography,
      skin: s.skin,
      weatherIndex: s.weatherIndex,
      dayNightCycle: h.dayNight.value,
      antialias: s.antialias,
    },
    lanes,
    traffic,
    wheel,
    vehicle: {
      type: v.type,
      mode: v.mode,
      gripFactor: v.gripFactor,
      speedFactor: v.speedFactor,
      steerRotationIndex: v.steerRotationIndex,
      showWheel: v.showWheel,
      side: v.side,
      seat: v.seat,
      seatAdjustment: v.seatAdjustment,
      seatHeight: v.seatHeight,
    },
    controls: {
      input: v.input,
      autodrive: h.autodrive.value,
      autodriveSideIndex: v.autodriveSideIndex,
      cruise: { enabled: cruise.enabled, speed: cruise.speed },
      headlights: h.ego.headlights,
      cameraMode: readCameraMode(),
    },
    graphics: {
      viewLodIndex: s.viewLodIndex,
      detailLodIndex: s.detailLodIndex,
      renderScale: s.renderScale,
      verticalFov: s.verticalFov,
    },
    units: h.units.Units,
    general: {
      showWorm: h.units.ShowWorm,
      barriers: h.units.Barriers,
    },
    ui: {
      hideMenu: (typeof window !== 'undefined' && window.PromptDriveHideMenu)
        ? window.PromptDriveHideMenu.state() : false,
    },
  };
}

function getPath(path) {
  const snap = snapshot();
  if (path == null) return snap;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), snap);
}

// --- dynamic apply: map a validated field onto the live engine setter --------
function applyDynamic(path, value, opts) {
  const h = H();
  switch (path) {
    case 'scene.skin': h.sceneConfig.set('skin', value); return ok(value);
    case 'scene.weatherIndex': h.sceneConfig.set('weatherIndex', value); return ok(value);
    case 'scene.dayNightCycle': h.dayNight.set(value); return ok(value);

    case 'lanes': {
      if (typeof window === 'undefined' || !window.LaneRoads) return err('unavailable', { path });
      const res = window.LaneRoads.set(value); // clamps ±1 live internally
      return ok(res);
    }

    case 'wheel': {
      if (typeof window === 'undefined' || !window.WheelControls) return err('unavailable', { path });
      return ok(window.WheelControls.set(value)); // sanitises + persists + applies live
    }

    case 'vehicle.type': {
      if (!opts || !opts.allowLiveRebuild) return err('requires_apply', { applyMode: 'reload', path });
      h.vehicleConfig.set('type', value); // triggers in-place changeVehicle rebuild
      return ok(value);
    }
    case 'vehicle.mode': h.vehicleConfig.set('mode', value); return ok(value);
    case 'vehicle.gripFactor': h.vehicleConfig.set('gripFactor', value); return ok(value);
    case 'vehicle.speedFactor': h.vehicleConfig.set('speedFactor', value); return ok(value);
    case 'vehicle.steerRotationIndex': {
      const deg = [270, 360, 450, 720, 900][value];
      h.vehicleConfig.set('steerRotationIndex', value);
      h.vehicleConfig.set('steerRotation', deg);
      return ok(value);
    }
    case 'vehicle.showWheel': h.vehicleConfig.set('showWheel', value); return ok(value);
    case 'vehicle.side': h.vehicleConfig.set('side', value); return ok(value);
    case 'vehicle.seat': h.vehicleConfig.set('seat', value); return ok(value);
    case 'vehicle.seatAdjustment': h.vehicleConfig.set('seatAdjustment', value); return ok(value);
    case 'vehicle.seatHeight': h.vehicleConfig.set('seatHeight', value); return ok(value);

    case 'controls.input': h.vehicleConfig.set('input', value); return ok(value);
    case 'controls.autodrive': h.autodrive.set(!!value); return ok(!!value);
    case 'controls.autodriveSideIndex':
      h.vehicleConfig.set('autodriveSideIndex', value);
      h.vehicleConfig.set('autodriveSide', value - 1);
      return ok(value);
    case 'controls.cruise': {
      // Speed is internally m/s. With unit:'display' (or 'mph'/'kph') the caller
      // passes the value in the current display units and we convert using the
      // engine's own factor (Vl.conversion = m/s per display unit).
      let sp = value.speed;
      if (sp != null && value.unit && value.unit !== 'ms') {
        const conv = h.speedControl.conversion || (h.units.Units === 1 ? 1 / 3.6 : 0.44704);
        sp = Number(sp) * conv;
      } else if (sp != null) {
        sp = Number(sp);
      }
      if (value.enabled != null) h.speedControl.set('enabled', !!value.enabled);
      if (sp != null) h.speedControl.set('speed', sp);
      const conv = h.speedControl.conversion || 1;
      return ok({
        enabled: h.speedControl.value.enabled,
        speedMs: h.speedControl.value.speed,
        speedDisplay: Math.round(h.speedControl.value.speed / conv),
        unit: h.units.Units === 1 ? 'kph' : 'mph',
      });
    }
    case 'controls.headlights': h.ego.setHeadlights(!!value, true); return ok(!!value);
    case 'controls.camera': {
      // Cameras only cycle in the engine, so we pulse the CameraMode input
      // (a one-shot handled in the virtual-input patch). 'next' fires one pulse;
      // a named mode steps toward it, guided by the cameraChange event.
      const b = window.PromptDriveBridge;
      if (!b) return err('unavailable', { path });
      b.inputOverride = b.inputOverride || {};
      if (!value || value === 'next') { b.inputOverride.cameraPulse = true; return ok('next'); }
      stepCameraTo(normalizeCameraKey(value));
      return ok(normalizeCameraKey(value));
    }

    case 'graphics.viewLodIndex': h.sceneConfig.set('viewLodIndex', value); return ok(value);
    case 'graphics.detailLodIndex': h.sceneConfig.set('detailLodIndex', value); return ok(value);
    case 'graphics.renderScale': h.sceneConfig.set('renderScale', value); return ok(value);
    case 'graphics.verticalFov': h.sceneConfig.set('verticalFov', value); return ok(value);

    case 'units': h.units.set('Units', value); return ok(value);

    // GameConfig lives on the same handle as units (engine `ie`/`te`).
    case 'general.showWorm': h.units.set('ShowWorm', value); return ok(value);
    case 'general.barriers': h.units.set('Barriers', value ? 1 : 0); return ok(!!value);

    // UI-only lockdown (no engine handle needed). The live toggle does not
    // persist — bake it across reloads via static config (config.set/apply).
    case 'ui.hideMenu': {
      if (typeof window === 'undefined' || !window.PromptDriveHideMenu) return err('unavailable', { path });
      return ok(window.PromptDriveHideMenu.set(!!value, { persist: false }));
    }

    default:
      return err('unknown_key', { path });
  }
}

function setDynamic(partial) {
  const results = {};
  for (const path in partial) {
    const f = FIELD_BY_PATH[path];
    if (!f) { results[path] = err('unknown_key', { path }); continue; }
    if (f.cls === 'static') { results[path] = err('requires_apply', { applyMode: 'reload', path }); continue; }
    const v = validateField(path, partial[path]);
    if (!v.ok) { results[path] = v; continue; }
    let opts;
    if (path === 'vehicle.type') opts = { allowLiveRebuild: partial.allowLiveRebuild };
    // The engine's own setters can throw on values that pass our static schema
    // but are invalid in the current world (e.g. a weather index past the active
    // skin's list). Contain it so one bad field can't abort the whole batch.
    let r;
    try {
      r = applyDynamic(path, v.value, opts);
    } catch (e) {
      r = err('engine_rejected', { path, message: String((e && e.message) || e) });
    }
    if (r.ok && v.clamped) r.clamped = true;
    results[path] = r;
    if (r.ok && typeof window !== 'undefined' && window.PromptDriveBridge) {
      window.PromptDriveBridge.emit('applied', { path, value: r.value });
    }
  }
  return results;
}

// --- static config staging + apply ------------------------------------------
const _pending = {};

function stageStatic(partial) {
  const results = {};
  for (const path in partial) {
    const f = FIELD_BY_PATH[path];
    if (!f) { results[path] = err('unknown_key', { path }); continue; }
    const v = validateField(path, partial[path]);
    if (!v.ok) { results[path] = v; continue; }
    _pending[path] = v.value;
    results[path] = ok(v.value, { staged: true });
  }
  return results;
}

// Persist one staged field to the localStorage substrate. Strings are written
// raw and everything else JSON-encoded — matching how the engine's stores read
// each key back on load (VehicleConfig reads `type` raw, SceneConfig reads
// seed/sceneName raw, all JSON.parse the rest).
function commitStagedField(path, value) {
  // lanes, traffic and metric selection own their storage; delegate.
  if (path === 'lanes') {
    if (typeof window !== 'undefined' && window.LaneRoads) window.LaneRoads.set(value);
    return true;
  }
  if (path === 'traffic') {
    if (typeof window !== 'undefined' && window.RoadTraffic) {
      window.RoadTraffic.set(value);
      return true;
    }
    return false;
  }
  if (path === 'wheel') {
    if (typeof window !== 'undefined' && window.WheelControls) {
      window.WheelControls.set(value);
      return true;
    }
    return false;
  }
  if (path.indexOf('metrics.') === 0) return true; // handled by the metrics namespace directly

  // Autodrive on/off has no index-style store: the engine records it as the
  // *presence* of the `has-autodrive` localStorage key (see the engine's ce.set)
  // and reads `getItem("has-autodrive") !== null` at load to decide the initial
  // autopilot state. Persist it the same presence-based way so static config
  // (config.set + apply/reload) starts the sim already autodriving — matching an
  // in-game autodrive toggle, which is why it previously only worked when the
  // state was carried over from a prior session.
  if (path === 'controls.autodrive') {
    try {
      if (value) localStorage.setItem('has-autodrive', 'true');
      else localStorage.removeItem('has-autodrive');
      return true;
    } catch (_e) { return false; }
  }

  // ui.hideMenu is a DOM-overlay flag owned by hidemenu.js (its own storage
  // key/format); persist through it so a reload re-applies the lockdown.
  if (path === 'ui.hideMenu') {
    if (typeof window !== 'undefined' && window.PromptDriveHideMenu) {
      window.PromptDriveHideMenu.set(!!value, { persist: true });
      return true;
    }
    try {
      if (value) localStorage.setItem('pd-hide-menu', '1'); else localStorage.removeItem('pd-hide-menu');
      return true;
    } catch (_e) { return false; }
  }

  const key = STAGE_STORAGE[path];
  if (!key) return false; // e.g. scene.dayNightCycle has no persistent store
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    const extra = extraStageWrites(path, value);
    if (extra) for (const k in extra) localStorage.setItem(k, JSON.stringify(extra[k]));
  } catch (_e) { return false; }
  return true;
}

function applyStatic(opts) {
  const mode = (opts && opts.mode) || 'reload';

  if (mode === 'ahead') {
    // Lane-style rebuild-ahead — only lanes support it today.
    if (_pending.lanes && typeof window !== 'undefined' && window.LaneRoads) {
      window.LaneRoads.set(_pending.lanes);
      const applied = Object.assign({}, _pending);
      for (const k in _pending) delete _pending[k];
      return ok({ mode: 'ahead', applied });
    }
    return err('unsupported_apply_mode', { mode });
  }
  if (mode !== 'reload') return err('unsupported_apply_mode', { mode });

  // Commit every staged field to localStorage; a reload re-reads them all, so no
  // live engine handle is required (static config works pre-launch).
  const applied = {};
  const skipped = {};
  for (const path in _pending) {
    if (commitStagedField(path, _pending[path])) applied[path] = _pending[path];
    else skipped[path] = 'no_persistent_store';
  }
  // Autodrive is authoritative per launch. The engine reads its startup autopilot
  // state from the *sticky* `has-autodrive` localStorage key, which an in-sim
  // autodrive toggle on a PREVIOUS run (e.g. someone driving the public web sim)
  // leaves behind. A configured (re)launch must be deterministic, so unless this
  // config explicitly enables autodrive, clear the stale key — otherwise a prior
  // autodrive run traps the next participant in autopilot with no way to drive
  // manually (the participant-lockdown UI hides the autodrive toggle). This is
  // the symmetric complement of commitStagedField, which writes the key for an
  // explicit `true` and clears it for an explicit `false`; here we also cover the
  // common case where the harness simply omits the field when autopilot is off.
  // applyStatic is only ever the API path (a normal page refresh never calls it),
  // so this never disturbs a plain web user's persisted toggle.
  if (!_pending['controls.autodrive']) {
    try { localStorage.removeItem('has-autodrive'); } catch (_e) {}
  }
  if (typeof location !== 'undefined') location.reload();
  return ok({ mode: 'reload', applied, skipped });
}

// --- telemetry ---------------------------------------------------------------
function telemetryState() {
  const h = H();
  const ego = h.ego;
  const out = {
    t: (typeof performance !== 'undefined' ? performance.now() : 0) / 1000,
    speed: ego.speed,
    steerRad: ego.steer,
    heading: ego.heading,
    posX: ego.position ? ego.position.x : null,
    posY: ego.position ? ego.position.y : null,
    posZ: ego.position ? ego.position.z : null,
    onRoad: ego.onRoad,
    wrongWay: ego.wrongWay,
    headlights: ego.headlights,
    autodrive: h.autodrive.value,
    driveMode: ['AWD', 'FWD', 'RWD'][h.vehicleConfig.value.mode] || 'AWD',
    units: h.units.Units,
  };
  // Lane geometry the engine resolved, if multi-lane roads are active.
  try {
    if (typeof window !== 'undefined' && window.LaneRoads && window.LaneRoads._resolved) {
      out.lane = window.LaneRoads.applied ? window.LaneRoads.applied() : null;
    }
  } catch (_e) {}
  // Traffic summary: actor count + the ego's lead vehicle (gap in metres,
  // speed m/s), when traffic is active — the basis for THW/TTC-style measures.
  try {
    if (typeof window !== 'undefined' && window.RoadTraffic && window.RoadTraffic._engineAttached) {
      const mgr = window.RoadTraffic._manager;
      out.traffic = {
        count: mgr.vehicles.length,
        lead: mgr.egoLead ? mgr.egoLead() : null,
      };
    }
  } catch (_e) {}
  return out;
}

function metricsSnapshot() {
  const h = H();
  if (!h.drivingMetrics) return null;
  try { return h.drivingMetrics.buildReport(); } catch (_e) { return null; }
}

// --- camera mode selection ---------------------------------------------------
// Fallback labels for the base modes; the live list comes from the vehicle's own
// camera set (Ae.cameras) so per-vehicle modes (Bonnet, Hood, interior, …) all
// appear with the engine's own names (Ol[key].name).
const CAMERA_LABELS = {
  Chase: 'Near Chase', ChaseFar: 'Far Chase', FirstPerson: 'First Person (in-cabin)',
  Bonnet: 'Bonnet', Hood: 'Hood', Debug: 'Debug',
};
function liveCameraModes() {
  const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
  const h = b && b.handles;
  if (h && h.ego && h.ego.cameras) {
    // Order matches the engine's camera cycle (Object.keys(Ae.cameras)), so the
    // array position is the modeIndex persisted to config-camera-mode.
    return Object.keys(h.ego.cameras).map((key, index) => ({
      index,
      key,
      label: (h.cameraDefs && h.cameraDefs[key] && h.cameraDefs[key].name) || CAMERA_LABELS[key] || key,
    }));
  }
  return Object.keys(CAMERA_LABELS).slice(0, 3).map((key, index) => ({ index, key, label: CAMERA_LABELS[key] }));
}
// The persisted initial camera index (also updated live as the camera cycles).
function readCameraMode() {
  try {
    const raw = localStorage.getItem('config-camera-mode');
    if (raw != null) return JSON.parse(raw);
  } catch (_e) {}
  return 0;
}
function normalizeCameraKey(v) {
  const s = String(v);
  const hit = liveCameraModes().find((m) => m.key === s || m.label === s);
  return hit ? hit.key : s;
}
// Step the camera toward `targetKey` by pulsing CameraMode, waiting for each
// `cameraChange` event before pulsing again. Bounded so it can't loop forever.
function stepCameraTo(targetKey) {
  const b = window.PromptDriveBridge;
  if (!b) return;
  b.inputOverride = b.inputOverride || {};
  let steps = 0;
  const pulse = () => {
    if (b._lastCamera === targetKey || steps >= 8) return;
    steps++;
    b.inputOverride.cameraPulse = true;
    setTimeout(pulse, 200);
  };
  pulse();
}

// --- metric selection --------------------------------------------------------
function readMetricSelection() {
  try {
    const raw = localStorage.getItem(METRICS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_e) { return {}; }
}
function writeMetricSelection(sel) {
  try { localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(sel)); } catch (_e) {}
}
function setMetric(id, on) {
  const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
  const dm = b && b.handles && b.handles.drivingMetrics;
  if (dm) { dm.setSelected(id, on); return; }        // live: updates instance + persists
  const sel = readMetricSelection(); sel[id] = !!on; writeMetricSelection(sel); // pre-launch: persist for next load
}
function setMetricFamily(family, on) {
  const fam = METRIC_FAMILIES.find((f) => f.id === family || f.label === family);
  if (!fam) return err('unknown_key', { family });
  const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
  const dm = b && b.handles && b.handles.drivingMetrics;
  if (dm && dm.setFamilySelected) { dm.setFamilySelected(fam.id, on); return ok({ family: fam.id, on: !!on }); }
  for (const id of fam.metrics) setMetric(id, on);
  return ok({ family: fam.id, on: !!on });
}

// --- end the simulation ------------------------------------------------------
// Stop the metrics run, produce the driver-performance report + logs
// automatically, halt the sim, and announce it on the event bus.
function endSimulation(opts) {
  const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
  const h = b && b.handles;
  if (!h) return err('engine_rejected', { message: 'engine not ready' });
  const download = !opts || opts.download !== false;
  let report = null;
  if (h.drivingMetrics) {
    try { h.drivingMetrics.stopRun(); } catch (_e) {}
    try { report = h.drivingMetrics.buildReport(); } catch (_e) {}
    if (download) {
      try { h.drivingMetrics.downloadReport(); } catch (_e) {}
      try { h.drivingMetrics.downloadLogs(); } catch (_e) {}
    }
  }
  if (h.ticker && typeof h.ticker.pause === 'function') {
    try { h.ticker.pause(true); } catch (_e) {}
  }
  if (b) b.emit('ended', { report, downloaded: download && !!h.drivingMetrics });
  return ok({ ended: true, downloaded: download && !!h.drivingMetrics, report });
}

// --- the public object -------------------------------------------------------
const PromptDrive = {
  version: '1.0',
  ready: _ready,

  schema() {
    let extra = {};
    try {
      const meta = H().sceneConfig.sceneMeta;
      if (meta && meta.scenes) {
        const scenes = {};
        for (const name in meta.scenes) {
          scenes[name] = {
            topography: meta.scenes[name].topography,
            skins: meta.scenes[name].skins,
            skinWeathers: meta.scenes[name].skinWeathers,
          };
        }
        extra.scenes = scenes;
      }
    } catch (_e) { /* not ready yet — schema still useful */ }
    return buildSchema(extra);
  },

  get: (path) => getPath(path),

  config: {
    set: (partial) => stageStatic(partial),
    pending: () => Object.assign({}, _pending),
    apply: (opts) => applyStatic(opts),
    // Bypass the "begin" splash on the next load: a static, remote-settable
    // launch option (read by autostart.js). Returns the resulting flag state.
    autostart: (enable) => {
      try {
        if (enable === false) localStorage.removeItem('pd-autostart');
        else localStorage.setItem('pd-autostart', '1');
      } catch (_e) { return err('unavailable'); }
      return ok(enable !== false);
    },
  },

  dynamic: {
    set: (partial) => setDynamic(partial),
    weather: (idxOrName) => {
      // Accept a weather name (e.g. 'rain') as well as an index by resolving it
      // against the active skin's weather list.
      let v = idxOrName;
      if (typeof v === 'string' && !/^\d+$/.test(v)) {
        try {
          const list = H().world.scene.skinWeatherList;
          const i = Array.isArray(list) ? list.indexOf(v) : -1;
          if (i >= 0) v = i; else return { 'scene.weatherIndex': err('bad_value', { path: 'scene.weatherIndex', message: 'unknown weather name', options: list }) };
        } catch (_e) {}
      }
      return setDynamic({ 'scene.weatherIndex': v });
    },
    skin: (name) => setDynamic({ 'scene.skin': name }),
    cycle: (idx) => setDynamic({ 'scene.dayNightCycle': idx }),
    headlights: (on) => setDynamic({ 'controls.headlights': on }),
    autodrive: (on) => setDynamic({ 'controls.autodrive': on }),
    driveMode: (m) => setDynamic({ 'vehicle.mode': typeof m === 'string' ? ['AWD', 'FWD', 'RWD'].indexOf(m) : m }),
    camera: (mode) => setDynamic({ 'controls.camera': mode || 'next' }),
    lanes: (cfg) => setDynamic({ lanes: cfg }),
    cruise: (cfg) => setDynamic({ 'controls.cruise': cfg }),
    grip: (f) => setDynamic({ 'vehicle.gripFactor': f }),
    speed: (f) => setDynamic({ 'vehicle.speedFactor': f }),
    fov: (f) => setDynamic({ 'graphics.verticalFov': f }),
    units: (u) => setDynamic({ units: u }),
    // Participant lockdown: hide the bottom-bar menu icons + autodrive toggle.
    hideMenu: (on) => setDynamic({ 'ui.hideMenu': on }),
    // §5.4 live drive-input hook (requires the build-main virtual input patch).
    input: (signals) => {
      if (typeof window !== 'undefined' && window.PromptDriveBridge) {
        window.PromptDriveBridge.inputOverride = Object.assign(
          window.PromptDriveBridge.inputOverride || {}, signals || {});
        return ok(window.PromptDriveBridge.inputOverride);
      }
      return err('unavailable');
    },
  },

  telemetry: {
    state: () => telemetryState(),
    metrics: () => metricsSnapshot(),
    report: () => metricsSnapshot(),
  },

  // Traffic road actors (window.RoadTraffic). Static config is staged via
  // config.set({ traffic: {…} }) / applied on reload; traffic.set persists the
  // config immediately (also effective on the next reload). The stopped-vehicle
  // event is live.
  traffic: {
    get: () => (typeof window !== 'undefined' && window.RoadTraffic ? ok(window.RoadTraffic.get()) : err('unavailable')),
    set: (cfg) => {
      if (typeof window === 'undefined' || !window.RoadTraffic) return err('unavailable');
      if (cfg == null || typeof cfg !== 'object') return err('bad_value', { path: 'traffic' });
      return ok(window.RoadTraffic.set(cfg), { appliesOn: 'reload' });
    },
    state: () => (typeof window !== 'undefined' && window.RoadTraffic ? ok(window.RoadTraffic.state()) : err('unavailable')),
    spawnStopped: (opts) => (typeof window !== 'undefined' && window.RoadTraffic ? window.RoadTraffic.spawnStopped(opts) : err('unavailable')),
    clear: () => (typeof window !== 'undefined' && window.RoadTraffic ? window.RoadTraffic.clear() : err('unavailable')),
  },

  // Steering-wheel & pedal rig (window.WheelControls, src/wheel/). All calls
  // work live AND pre-launch — the subsystem owns its own persistence, and the
  // engine polls it per frame once the sim runs (input mode 2 / gamepad).
  // Calibration/capture completion is announced on the event stream
  // ('wheelCalibrated' / 'wheelBinding'), so remote callers subscribe rather
  // than long-poll.
  wheel: {
    get: () => (typeof window !== 'undefined' && window.WheelControls ? ok(window.WheelControls.get()) : err('unavailable')),
    set: (cfg) => {
      if (typeof window === 'undefined' || !window.WheelControls) return err('unavailable');
      if (cfg == null || typeof cfg !== 'object') return err('bad_value', { path: 'wheel' });
      return ok(window.WheelControls.set(cfg));
    },
    state: () => (typeof window !== 'undefined' && window.WheelControls ? ok(window.WheelControls.state()) : err('unavailable')),
    devices: () => (typeof window !== 'undefined' && window.WheelControls ? ok(window.WheelControls.devices()) : err('unavailable')),
    actions: () => (typeof window !== 'undefined' && window.WheelControls ? ok(window.WheelControls.actions()) : err('unavailable')),
    bind: (button, action) => (typeof window !== 'undefined' && window.WheelControls ? window.WheelControls.bind(button, action) : err('unavailable')),
    unbind: (button) => (typeof window !== 'undefined' && window.WheelControls ? window.WheelControls.unbind(button) : err('unavailable')),
    calibrate: (target, opts) => (typeof window !== 'undefined' && window.WheelControls ? window.WheelControls.calibrate(target, opts) : err('unavailable')),
    captureButton: (action, opts) => (typeof window !== 'undefined' && window.WheelControls ? window.WheelControls.captureButton(action, opts) : err('unavailable')),
    cancelCapture: () => (typeof window !== 'undefined' && window.WheelControls ? window.WheelControls.cancelCapture() : err('unavailable')),
    resetCalibration: (target) => (typeof window !== 'undefined' && window.WheelControls ? window.WheelControls.resetCalibration(target) : err('unavailable')),
  },

  // Driving-metrics selection (which families/metrics are computed). Works live
  // and pre-launch (staged to localStorage the metrics subsystem reads on load).
  metrics: {
    families: () => METRIC_FAMILIES.map((f) => ({ id: f.id, label: f.label, metrics: f.metrics.slice() })),
    selection: () => {
      const b = window.PromptDriveBridge;
      const dm = b && b.handles && b.handles.drivingMetrics;
      return dm ? dm.getSelection() : readMetricSelection();
    },
    select: (id, on) => { setMetric(id, on); return ok({ id, on: !!on }); },
    selectFamily: (family, on) => setMetricFamily(family, on),
  },

  // Camera modes available to dynamic.camera() — the current vehicle's own set.
  cameraModes: () => liveCameraModes(),

  // Weather options for the active skin, as { index, name } (labels for the
  // otherwise-opaque weatherIndex).
  weathers: () => {
    try {
      const list = H().world.scene.skinWeatherList;
      if (Array.isArray(list)) return list.map((name, index) => ({ index, name }));
    } catch (_e) {}
    return [];
  },

  // End the simulation: finalize the run, auto-download report + logs, halt.
  end: (opts) => endSimulation(opts),

  run: {
    start: () => { const h = H(); if (!h.drivingMetrics) return err('no_metrics'); h.drivingMetrics.startRun({}); return ok(true); },
    stop: () => { const h = H(); if (!h.drivingMetrics) return err('no_metrics'); h.drivingMetrics.stopRun(); return ok(true); },
    reset: () => { const h = H(); if (!h.drivingMetrics) return err('no_metrics'); h.drivingMetrics.resetRun(); return ok(true); },
    status: () => {
      const h = H();
      if (!h.drivingMetrics) return err('no_metrics');
      const m = h.drivingMetrics;
      return ok({ recording: !!m.isRecording, durationSec: m.durationSec(), samples: m.sampleCount() });
    },
    // Trigger the same downloads the metrics panel offers, from the sim's
    // document (Markdown report / JSON+CSV logs).
    downloadReport: () => { const h = H(); if (!h.drivingMetrics) return err('no_metrics'); h.drivingMetrics.downloadReport(); return ok(true); },
    downloadLogs: () => { const h = H(); if (!h.drivingMetrics) return err('no_metrics'); h.drivingMetrics.downloadLogs(); return ok(true); },
    end: (opts) => endSimulation(opts),
  },

  on: (event, fn) => window.PromptDriveBridge.on(event, fn),
  off: (event, fn) => window.PromptDriveBridge.off(event, fn),
  subscribe: (fn) => window.PromptDriveBridge.on('any', fn),
};

// Resolve `ready` and start a throttled telemetry tick once handles attach.
if (typeof window !== 'undefined' && window.PromptDriveBridge) {
  window.PromptDriveBridge.whenAttached(() => {
    _readyResolve(PromptDrive);
    // Track the live camera mode so stepCameraTo() knows when it has arrived.
    window.PromptDriveBridge.on('cameraChange', (mode) => {
      window.PromptDriveBridge._lastCamera = normalizeCameraKey(mode);
    });
    // ~10 Hz tick — only does work while someone is listening for 'tick'.
    setInterval(() => {
      const b = window.PromptDriveBridge;
      if (!b || !b._listeners) return;
      const hasTick = (b._listeners.tick && b._listeners.tick.length) || (b._listeners.any && b._listeners.any.length);
      if (!hasTick) return;
      try { b.emit('tick', telemetryState()); } catch (_e) {}
    }, 100);
  });
  window.PromptDrive = PromptDrive;
}
