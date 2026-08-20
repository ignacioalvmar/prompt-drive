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

  // --- procedural map generation — delegated to window.MapGen (validates + persists) ---
  { path: 'map', type: FieldType.Object, cls: 'static', desc: 'Procedural map generation (window.MapGen) { expanded, custom: { Hills:{…}, Planet:{…} } }. Terrain parameters bake into the world at generation; applies on reload. Topography selection is scene.topography / PromptDrive.map.select; parameter ranges via PromptDrive.map.schema().' },

  // --- steering wheel & pedals — delegated to window.WheelControls (validates + persists) ---
  { path: 'wheel', type: FieldType.Object, cls: 'dynamic', desc: 'Steering-wheel rig (G923-class) { enabled, deviceId, axes, steering { rangeDeg, deadzone }, pedals, bindings }. Applies live; see PromptDrive.wheel.* for calibration and button bindings.' },

  // --- vehicle (3.2) ---
  { path: 'vehicle.type', type: FieldType.Enum, cls: 'static', values: VEHICLES, desc: 'Vehicle model; live swap is a heavy in-place rebuild.' },
  { path: 'vehicle.mode', type: FieldType.Enum, cls: 'both', values: [0, 1, 2], labels: DRIVE_MODES, desc: 'Drive mode (power distribution).' },
  { path: 'vehicle.gripFactor', type: FieldType.Float, cls: 'both', min: 0.25, max: 3, step: 0.01, desc: 'Tyre slip scaling.' },
  { path: 'vehicle.speedFactor', type: FieldType.Float, cls: 'both', min: 0.5, max: 2, step: 0.01, desc: 'Motor power / top-speed scaling.' },
  { path: 'vehicle.steerRotationIndex', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3, 4], labels: [270, 360, 450, 720, 900], desc: 'Steering-wheel range (visual).' },
  { path: 'vehicle.showWheel', type: FieldType.Boolean, cls: 'both', desc: 'Steering-wheel mesh visibility.' },
  { path: 'vehicle.showConsole', type: FieldType.Boolean, cls: 'both', desc: 'Center-console (center-stack touchscreen) visibility; when off the console API is disabled.' },
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
      if (!f.values.includes(v)) {
        // scene.topography is expandable at runtime: MapGen registers extra
        // presets (expanded/custom) into the engine's own topography tables.
        if (path === 'scene.topography' && typeof v === 'string'
          && typeof window !== 'undefined' && window.MapGen && window.MapGen.has(v)) {
          return { ok: true, value: v };
        }
        return { ok: false, error: 'bad_value', path, values: f.values };
      }
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
    let values = f.values;
    if (f.path === 'scene.topography') {
      // Publish the live topography list (built-in + MapGen expanded/custom).
      try {
        if (typeof window !== 'undefined' && window.MapGen) {
          const merged = new Set(values);
          for (const scene of ['Hills', 'Planet']) {
            for (const name of window.MapGen.menuNames(scene)) merged.add(name);
          }
          values = Array.from(merged);
        }
      } catch (_e) { /* fall back to the static list */ }
    }
    fields[f.path] = {
      type: f.type,
      class: f.cls,
      ...(f.min != null ? { min: f.min } : {}),
      ...(f.max != null ? { max: f.max } : {}),
      ...(f.step != null ? { step: f.step } : {}),
      ...(values ? { values } : {}),
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
