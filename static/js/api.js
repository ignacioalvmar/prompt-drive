/* Prompt Drive integration API — built from src/api/ */
(function () {
/* --- config.js --- */
/**
 * Schema + validation for the Prompt Drive integration API.
 *
 * This module is engine-agnostic: it describes *what* can be configured (keys,
 * types, ranges, enum labels and the static/dynamic classification from the API
 * plan §3–§4) and validates/clamps incoming requests. It performs no engine
 * calls itself — the facade (PromptDriveApi.js) maps a validated key onto the
 * live engine handle registered on the bridge.
 *
 * `class` per field mirrors the plan:
 *   'static'  — baked at world/vehicle generation; needs reload (or query param)
 *   'dynamic' — a live setter mutates the running sim
 *   'both'    — settable at start AND live
 */

// Field type enum, mirroring the engine's own `u` descriptor types so the
// schema we publish lines up with the settings-panel descriptors.
const FieldType = {
  Boolean: 'boolean',
  Enum: 'enum',
  Integer: 'integer',
  Float: 'float',
  String: 'string',
  Object: 'object',
};

// Topography + scene enums taken verbatim from the engine (deobfuscated.js:13041,
// :13057). Skins/weathers are per-scene and discovered at runtime from the
// engine's sceneMeta, so they are not hard-coded here.
const SCENES = ['Hills', 'Planet'];
const TOPOGRAPHIES = ['straight', 'casual', 'easy', 'normal', 'hard'];
const DRIVE_MODES = ['AWD', 'FWD', 'RWD'];
const INPUT_MODES = ['keyboard', 'mouse', 'gamepad'];
const VEHICLES = ['Roadster', 'Coach'];
const DAY_NIGHT_SECONDS = [0, 180, 480, 900]; // qs (deobfuscated.js, day-night cycle)

/**
 * The canonical field table. Each entry:
 *   { domain, key, path, type, cls, min?, max?, step?, values?, labels?, desc }
 * `path` is the dot-path callers use in get()/set() (e.g. 'vehicle.gripFactor').
 */
const FIELDS = [
  // --- world & scene (3.1) ---
  { path: 'scene.seed', type: FieldType.String, cls: 'static', desc: 'Procedural generation seed; change reloads.' },
  { path: 'scene.startNode', type: FieldType.Integer, cls: 'static', min: 0, desc: 'Where along the route the drive begins.' },
  { path: 'scene.sceneName', type: FieldType.Enum, cls: 'static', values: SCENES, desc: 'Whole-world swap, baked at generation.' },
  { path: 'scene.topography', type: FieldType.Enum, cls: 'static', values: TOPOGRAPHIES, desc: 'Height/road-width profile, baked into terrain.' },
  { path: 'scene.skin', type: FieldType.String, cls: 'both', desc: 'Season/planet palette; live via setSkin.' },
  { path: 'scene.weatherIndex', type: FieldType.Integer, cls: 'both', min: 0, desc: 'Index into the active skin\'s weather list.' },
  { path: 'scene.dayNightCycle', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3], labels: DAY_NIGHT_SECONDS.map((s) => (s ? s + 's' : 'off')), desc: 'Day-night cycle length index.' },
  { path: 'scene.antialias', type: FieldType.Boolean, cls: 'static', desc: 'Renderer init flag.' },

  // --- lanes (3.1) — delegated to window.LaneRoads, live changes clamped ±1 ---
  { path: 'lanes', type: FieldType.Object, cls: 'both', desc: 'Lane layout { forward 1-5, backward 0-5, width 2.4-3.75|null }. Live changes clamp to ±1/direction.' },

  // --- traffic road actors — delegated to window.RoadTraffic (validates + persists) ---
  { path: 'traffic', type: FieldType.Object, cls: 'static', desc: 'Traffic vehicles { enabled, density 0-16, speed 2-45 m/s, oncoming, seed }. Applies on reload; the stopped-vehicle event is live via traffic.spawnStopped.' },

  // --- vehicle (3.2) ---
  { path: 'vehicle.type', type: FieldType.Enum, cls: 'static', values: VEHICLES, desc: 'Vehicle model; live swap is a heavy in-place rebuild.' },
  { path: 'vehicle.mode', type: FieldType.Enum, cls: 'both', values: [0, 1, 2], labels: DRIVE_MODES, desc: 'Drive mode (power distribution).' },
  { path: 'vehicle.gripFactor', type: FieldType.Float, cls: 'both', min: 0.25, max: 3, step: 0.01, desc: 'Tyre slip scaling.' },
  { path: 'vehicle.speedFactor', type: FieldType.Float, cls: 'both', min: 0.5, max: 2, step: 0.01, desc: 'Motor power / top-speed scaling.' },
  { path: 'vehicle.steerRotationIndex', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3, 4], labels: [270, 360, 450, 720, 900], desc: 'Steering-wheel range (visual).' },
  { path: 'vehicle.showWheel', type: FieldType.Boolean, cls: 'both', desc: 'Steering-wheel mesh visibility.' },
  { path: 'vehicle.side', type: FieldType.Enum, cls: 'both', values: [0, 1], labels: ['right', 'left'], desc: 'Driver side.' },
  { path: 'vehicle.seat', type: FieldType.Enum, cls: 'both', values: [0, 1], labels: ['driver', 'passenger'], desc: 'Interior camera anchor.' },
  { path: 'vehicle.seatAdjustment', type: FieldType.Float, cls: 'both', min: -0.25, max: 0.25, step: 0.01, desc: 'First-person camera fwd/back.' },
  { path: 'vehicle.seatHeight', type: FieldType.Float, cls: 'both', min: -0.05, max: 0.05, step: 0.01, desc: 'First-person camera up/down.' },

  // --- controls, autopilot & lights (3.3) ---
  { path: 'controls.input', type: FieldType.Enum, cls: 'both', values: [0, 1, 2], labels: INPUT_MODES, desc: 'Which signal source drives the car.' },
  { path: 'controls.autodrive', type: FieldType.Boolean, cls: 'both', desc: 'Autopilot follows the road/lane line.' },
  { path: 'controls.autodriveSideIndex', type: FieldType.Enum, cls: 'both', values: [0, 1, 2], labels: ['Left', 'None', 'Right'], desc: 'Which lane the autopilot tracks.' },
  { path: 'controls.cruise', type: FieldType.Object, cls: 'both', desc: 'Cruise/limit { enabled, speed }.' },
  { path: 'controls.headlights', type: FieldType.Boolean, cls: 'dynamic', desc: 'Manual headlight override.' },
  { path: 'controls.camera', type: FieldType.String, cls: 'dynamic', desc: 'Live camera mode; "next" cycles.' },
  { path: 'controls.cameraMode', type: FieldType.Integer, cls: 'static', min: 0, desc: 'Initial camera mode index (see cameraModes()); persisted, applied on load.' },

  // --- graphics / render (3.4) ---
  { path: 'graphics.viewLodIndex', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3, 4], labels: ['Low', 'Medium', 'High', 'Ultra', 'Ultra+'], desc: 'View distance LOD.' },
  { path: 'graphics.detailLodIndex', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3], labels: ['Low', 'Medium', 'High', 'Ultra'], desc: 'Environment detail LOD.' },
  { path: 'graphics.renderScale', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3, 4], labels: ['50%', '75%', '100%', '150%', '200%'], desc: 'Render scale.' },
  { path: 'graphics.verticalFov', type: FieldType.Float, cls: 'both', min: 40, max: 80, step: 1, desc: 'Vertical field of view.' },

  // --- units (3.6) ---
  { path: 'units', type: FieldType.Enum, cls: 'both', values: [0, 1], labels: ['MPH/MI', 'KPH/KM'], desc: 'Display units.' },

  // --- general game settings (engine GameConfig) ---
  { path: 'general.showWorm', type: FieldType.Enum, cls: 'both', values: [0, 1, 2], labels: ['Always', 'Manual drive only', 'Never'], desc: 'Show the upcoming-road worm guide.' },
  { path: 'general.barriers', type: FieldType.Boolean, cls: 'both', desc: 'Walls and collidable roadside barriers (regenerated on reload).' },

  // --- UI lockdown (participant mode) — DOM overlay, no engine backing ---
  { path: 'ui.hideMenu', type: FieldType.Boolean, cls: 'both', desc: 'Hide the bottom-bar menu icons and the autodrive toggle so participants (users without config privileges) cannot change simulation conditions. Static/persisted via config.apply; live via dynamic.hideMenu.' },
];

// Driving-metrics families and their metric ids — mirrors src/metrics/config.js
// so the API can list/toggle metric selection (and stage it to localStorage
// before the sim starts) without importing the metrics bundle.
const METRIC_FAMILIES = [
  { id: 'lane', label: 'Lane keeping', metrics: ['sdlp', 'meanLP', 'laneDepartures'] },
  { id: 'longitudinal', label: 'Speed', metrics: ['meanSpeed', 'sds'] },
  { id: 'steering', label: 'Steering control', metrics: ['swrr', 'steeringEntropy'] },
  { id: 'safety', label: 'Safety margin', metrics: ['tlc'] },
  { id: 'events', label: 'Events', metrics: ['collisions', 'throttleBrake'] },
];
const METRICS_STORAGE_KEY = 'promptdrive.metrics.selected';

// Index for O(1) lookups by dot-path.
const FIELD_BY_PATH = {};
for (const f of FIELDS) FIELD_BY_PATH[f.path] = f;

/** Which fields are static / dynamic / both — convenience for the schema. */
function fieldsByClass(cls) {
  return FIELDS.filter((f) => f.cls === cls || (cls !== 'static' && f.cls === 'both'));
}

function clampNumber(v, f) {
  let n = Number(v);
  let clamped = false;
  if (!Number.isFinite(n)) return { value: undefined, clamped: false, bad: true };
  if (f.type === FieldType.Integer) n = Math.round(n);
  if (f.min != null && n < f.min) { n = f.min; clamped = true; }
  if (f.max != null && n > f.max) { n = f.max; clamped = true; }
  return { value: n, clamped, bad: false };
}

/**
 * Validate + coerce a single value for `path`. Returns one of:
 *   { ok:true, value, clamped? }
 *   { ok:false, error:'unknown_key' | 'bad_value' }
 * Range/enum coercion mirrors the engine's own clamping where possible.
 */
function validateField(path, value) {
  const f = FIELD_BY_PATH[path];
  if (!f) return { ok: false, error: 'unknown_key', path };

  switch (f.type) {
    case FieldType.Boolean:
      return { ok: true, value: !!value };

    case FieldType.String:
      return { ok: true, value: String(value) };

    case FieldType.Integer:
    case FieldType.Float: {
      const r = clampNumber(value, f);
      if (r.bad) return { ok: false, error: 'bad_value', path };
      return { ok: true, value: r.value, clamped: r.clamped || undefined };
    }

    case FieldType.Enum: {
      // Enums may be addressed by their raw value or (for labelled enums) coerced
      // from a numeric index. Reject anything outside the declared set.
      let v = value;
      if (typeof v === 'string' && f.values.every((x) => typeof x === 'number')) {
        const asNum = Number(v);
        if (Number.isFinite(asNum)) v = asNum;
      }
      if (!f.values.includes(v)) return { ok: false, error: 'bad_value', path, values: f.values };
      return { ok: true, value: v };
    }

    case FieldType.Object:
      // Object-shaped fields (lanes, cruise) are validated by their owner
      // (LaneRoads.set, Vl) which clamps internally. Pass through.
      if (value == null || typeof value !== 'object') return { ok: false, error: 'bad_value', path };
      return { ok: true, value };

    default:
      return { ok: false, error: 'bad_value', path };
  }
}

/** Build the public, self-documenting schema descriptor returned by schema(). */
function buildSchema(extra) {
  const fields = {};
  for (const f of FIELDS) {
    fields[f.path] = {
      type: f.type,
      class: f.cls,
      ...(f.min != null ? { min: f.min } : {}),
      ...(f.max != null ? { max: f.max } : {}),
      ...(f.step != null ? { step: f.step } : {}),
      ...(f.values ? { values: f.values } : {}),
      ...(f.labels ? { labels: f.labels } : {}),
      desc: f.desc,
    };
  }
  return {
    version: '1.0',
    fields,
    ...(extra || {}),
  };
}


/* --- bridge.js --- */
/**
 * Engine-handle registry + event bus for the Prompt Drive API.
 *
 * The facade (PromptDriveApi.js) needs live references to the engine's
 * module-scoped singletons (vehicle config, autodrive, units, scene/world
 * manager, day-night, speed control, the ego vehicle, the scene config, the
 * active controller and THREE). Those are not on `window`, so `build-main.js`
 * injects one call at controller init:
 *
 *     PromptDriveBridge.attach({ vehicleConfig, sceneConfig, autodrive, units,
 *       world, dayNight, speedControl, ego, input, controller, THREE,
 *       drivingMetrics });
 *
 * and emits engine events through `PromptDriveBridge.emit(event, payload)`.
 *
 * Mirrors how `window.LaneRoads._resolved/_applied` is written back by the
 * engine — the bridge is the seam, the facade is the public surface.
 */

const Bridge = {
  // Live engine handles, filled by build-main.js. Null until attach().
  handles: null,
  attached: false,

  _onAttach: [],
  _listeners: { any: [] }, // event name -> [fn]; 'any' -> [fn(event,payload)]

  /** Called once by the patched engine when the controller initialises. */
  attach(handles) {
    this.handles = handles || {};
    this.attached = true;
    const cbs = this._onAttach.slice();
    this._onAttach.length = 0;
    for (const cb of cbs) {
      try { cb(this.handles); } catch (e) { console.error('PromptDrive attach cb failed', e); }
    }
    this.emit('ready', { version: '1.0' });
  },

  /** Run `fn(handles)` once handles are attached (immediately if already). */
  whenAttached(fn) {
    if (this.attached) { try { fn(this.handles); } catch (e) { console.error(e); } return; }
    this._onAttach.push(fn);
  },

  // --- event bus ---------------------------------------------------------
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    const arr = this._listeners[event];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },

  emit(event, payload) {
    const direct = this._listeners[event] || [];
    for (const fn of direct.slice()) {
      try { fn(payload, event); } catch (e) { console.error('PromptDrive listener failed', e); }
    }
    for (const fn of this._listeners.any.slice()) {
      try { fn(event, payload); } catch (e) { console.error('PromptDrive listener failed', e); }
    }
  },
};

// Expose the bridge so build-main.js (which runs in the page after this bundle
// loads) can reach it without the facade having to be ready first.
if (typeof window !== 'undefined') {
  window.PromptDriveBridge = Bridge;
}


/* --- PromptDriveApi.js --- */
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
  if (path.indexOf('metrics.') === 0) return true; // handled by the metrics namespace directly

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


/* --- postmessage.js --- */
/**
 * Layer 2(b): postMessage bridge (plan §5.3b). When Prompt Drive is embedded in
 * an iframe, a parent app drives the same `window.PromptDrive` facade across the
 * window boundary.
 *
 * Envelope:
 *   request  { ns:'promptdrive', id, op, args }
 *   response { ns:'promptdrive', id, result }
 *   event    { ns:'promptdrive', event, payload }
 *
 * `op` is a dot-path into the facade, e.g. 'dynamic.set', 'config.apply',
 * 'telemetry.state', 'get', 'schema'. Guarded by an origin allow-list; default
 * is same-origin only. A parent extends it by posting an 'init' op with
 * { allowOrigins:[...] }, or the host sets window.PROMPTDRIVE_ALLOWED_ORIGINS.
 */

const NS = 'promptdrive';

function resolveOp(op) {
  // Walk the dot-path to a function on the facade.
  const parts = op.split('.');
  let ctx = window.PromptDrive;
  let owner = null;
  for (const p of parts) {
    if (ctx == null) return null;
    owner = ctx;
    ctx = ctx[p];
  }
  if (typeof ctx !== 'function') return null;
  return { fn: ctx, owner };
}

function startPostMessageBridge() {
  if (typeof window === 'undefined' || window.parent === window) return; // not embedded
  const sameOrigin = window.location.origin;
  let allowed = [sameOrigin];
  if (Array.isArray(window.PROMPTDRIVE_ALLOWED_ORIGINS)) {
    allowed = allowed.concat(window.PROMPTDRIVE_ALLOWED_ORIGINS);
  }

  function originOk(origin) {
    return allowed.includes('*') || allowed.includes(origin);
  }

  function post(target, msg, origin) {
    try { target.postMessage(Object.assign({ ns: NS }, msg), origin); } catch (_e) {}
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.ns !== NS || d.op == null) return;
    if (d.op === 'init') {
      if (Array.isArray(d.args && d.args[0] && d.args[0].allowOrigins)) {
        allowed = allowed.concat(d.args[0].allowOrigins);
      }
      post(e.source, { id: d.id, result: { ok: true, allowed } }, e.origin);
      return;
    }
    if (!originOk(e.origin)) {
      post(e.source, { id: d.id, result: { ok: false, error: 'origin_not_allowed', origin: e.origin } }, e.origin);
      return;
    }
    let result;
    try {
      const resolved = resolveOp(d.op);
      if (!resolved) result = { ok: false, error: 'unknown_op', op: d.op };
      else result = resolved.fn.apply(resolved.owner, d.args || []);
    } catch (err) {
      result = { ok: false, error: 'exception', message: String(err && err.message || err) };
    }
    Promise.resolve(result).then((r) => post(e.source, { id: d.id, result: r }, e.origin));
  });

  // Forward every engine event to the parent so the embedder gets the stream.
  if (window.PromptDriveBridge) {
    window.PromptDriveBridge.on('any', (event, payload) => {
      post(window.parent, { event, payload }, '*');
    });
  }

  // Announce readiness to the parent once handles attach.
  if (window.PromptDrive && window.PromptDrive.ready) {
    window.PromptDrive.ready.then(() => post(window.parent, { event: 'ready', payload: { version: '1.0' } }, '*'));
  }
}

startPostMessageBridge();


/* --- broadcast.js --- */
/**
 * Layer 2(e): cross-tab BroadcastChannel transport. Lets a *separate*
 * same-origin page (e.g. api-test.html) drive a running simulation without
 * embedding it — the sim runs normally in its own tab on localhost:3000, and a
 * console tab connects over a BroadcastChannel and issues the same facade ops.
 *
 * Channel: 'promptdrive'. Envelope:
 *   request  { ns:'promptdrive', kind:'req',   id, op, args }
 *   response { ns:'promptdrive', kind:'res',   id, result }
 *   event    { ns:'promptdrive', kind:'event', event, payload }
 *
 * This runs on the *simulation* page (where api.js is loaded). `op` is a
 * dot-path into window.PromptDrive, exactly like the postMessage bridge. The
 * console page implements the requester half. BroadcastChannel is origin-scoped
 * and never echoes to the sender, so the two tabs talk without loops.
 */
(function () {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  const NS = 'promptdrive';
  let ch;
  try { ch = new BroadcastChannel(NS); } catch (_e) { return; }

  function resolveOp(op) {
    const parts = String(op).split('.');
    let ctx = window.PromptDrive;
    let owner = null;
    for (const p of parts) {
      if (ctx == null) return null;
      owner = ctx;
      ctx = ctx[p];
    }
    if (typeof ctx !== 'function') return null;
    return { fn: ctx, owner };
  }

  ch.onmessage = (e) => {
    const d = e.data;
    if (!d || d.ns !== NS || d.kind !== 'req') return;
    let result;
    try {
      const r = resolveOp(d.op);
      if (!r) result = { ok: false, error: 'unknown_op', op: d.op };
      else result = r.fn.apply(r.owner, d.args || []);
    } catch (err) {
      result = { ok: false, error: 'exception', message: String((err && err.message) || err) };
    }
    Promise.resolve(result).then((res) => {
      try { ch.postMessage({ ns: NS, kind: 'res', id: d.id, result: res }); } catch (_e) {}
    });
  };

  // Forward every engine event to connected consoles (this 'any' listener also
  // keeps the ~10 Hz telemetry tick alive so the console gets a live feed).
  if (window.PromptDriveBridge) {
    window.PromptDriveBridge.on('any', (event, payload) => {
      try { ch.postMessage({ ns: NS, kind: 'event', event, payload }); } catch (_e) {}
    });
  }
  if (window.PromptDrive && window.PromptDrive.ready) {
    window.PromptDrive.ready.then(() => {
      try { ch.postMessage({ ns: NS, kind: 'event', event: 'ready', payload: { version: '1.0' } }); } catch (_e) {}
    });
  }
})();


/* --- autostart.js --- */
/**
 * Optional auto-start: bypass the "begin" splash gate so a remote/headless
 * caller (or the test console) can launch straight into a running simulation
 * from a static configuration — no manual click required.
 *
 * Enabled by either:
 *   - query param  ?autostart=1   (set when launching a fresh instance), or
 *   - localStorage 'pd-autostart' === '1'  (set by PromptDrive.config.autostart).
 *
 * Default OFF, so the normal app still shows the splash. When on, we watch for
 * the splash "begin" control (#splash-loader.splash-ready) and click it once —
 * the same React onClick path a user takes — which runs beginGame() and brings
 * up the live sim (and with it the API bridge attach).
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function enabled() {
    try {
      const qs = new URLSearchParams(window.location.search);
      const q = qs.get('autostart');
      if (q === '1' || q === 'true') return true;
    } catch (_e) { /* no URLSearchParams */ }
    try {
      if (window.localStorage.getItem('pd-autostart') === '1') return true;
    } catch (_e) { /* storage unavailable */ }
    return false;
  }

  if (!enabled()) return;

  let clicked = false;
  function tryClick() {
    if (clicked) return true;
    const el = document.getElementById('splash-loader');
    // Only the "begin" state (a fresh start), not "return", and only once the
    // splash is ready for interaction.
    if (el && el.classList.contains('splash-ready') && /begin/i.test(el.textContent || '')) {
      clicked = true;
      try { el.click(); } catch (_e) {}
      return true;
    }
    return false;
  }

  // The splash mounts after the React app loads, so poll briefly until it shows.
  const iv = setInterval(() => { if (tryClick()) clearInterval(iv); }, 200);
  setTimeout(() => clearInterval(iv), 30000);

  // Expose for the bridge/test console to invoke or inspect.
  window.PromptDriveAutostart = { tryClick, enabled };
})();


/* --- hidemenu.js --- */
/**
 * Optional "participant lockdown": hide the bottom-bar menu icons (`#menu-bar` —
 * the settings / scene / config icon groups) and the centre autodrive toggle
 * (`#autodrive`) so a participant without config-change privileges cannot open
 * the settings panels or flip drive conditions mid-study.
 *
 * Exposed two ways, mirroring autostart.js:
 *   - a static launch option — persisted to localStorage 'pd-hide-menu' (or the
 *     query param ?hideMenu=1), read on load and applied before the bar mounts;
 *   - a live dynamic toggle — PromptDrive.dynamic.hideMenu(bool) / the
 *     `ui.hideMenu` field — which shows/hides it on a running sim.
 *
 * Purely a DOM-overlay concern (it touches no engine state), so it lives in the
 * API bundle rather than a build-main engine patch. It injects a <style> rule
 * rather than toggling the nodes directly, so the rule takes effect the instant
 * the React-rendered bar appears — regardless of when that is relative to load.
 * The in-cabin instrument cluster (a 3D canvas) and passive HUD read-outs are
 * left untouched, so drivers still see their speed and autodrive status.
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var STORAGE_KEY = 'pd-hide-menu';
  var STYLE_ID = 'pd-hide-menu-style';
  // The interactive bottom-bar chrome: the menu icon groups (#menu-bar) and the
  // centre autodrive on/off toggle (#autodrive).
  var CSS = '#menu-bar,#autodrive{display:none!important;}';

  function readFlag() {
    try {
      var qs = new URLSearchParams(window.location.search);
      var q = qs.get('hideMenu') || qs.get('hidemenu');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
    } catch (_e) { /* no URLSearchParams */ }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw != null) return raw === '1' || raw === 'true';
    } catch (_e) { /* storage unavailable */ }
    return false;
  }

  // Inject or remove the hide rule. Idempotent.
  function apply(on) {
    var existing = document.getElementById(STYLE_ID);
    if (on) {
      if (!existing) {
        var el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = CSS;
        (document.head || document.documentElement).appendChild(el);
      }
    } else if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    return on;
  }

  // Apply live and (by default) remember the choice so it survives a reload.
  // Static config passes { persist: true }; a purely live dynamic toggle passes
  // { persist: false } to match the other live-only dynamic fields.
  function set(on, opts) {
    on = !!on;
    if (!opts || opts.persist !== false) {
      try {
        if (on) window.localStorage.setItem(STORAGE_KEY, '1');
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch (_e) { /* storage unavailable */ }
    }
    return apply(on);
  }

  function state() { return !!document.getElementById(STYLE_ID); }

  // Honour the persisted / query flag on load.
  if (readFlag()) apply(true);

  window.PromptDriveHideMenu = {
    set: set, apply: apply, state: state, readFlag: readFlag, STORAGE_KEY: STORAGE_KEY,
  };
})();

})();
