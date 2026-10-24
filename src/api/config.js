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
const VEHICLES = ['Roadster', 'Truck'];
const DAY_NIGHT_SECONDS = [0, 180, 480, 900]; // qs (deobfuscated.js, day-night cycle)

// --- Season / Time of day / Weather (prompt-drive-weather-season) -------------
// The engine models scene atmosphere as skin (season) × weatherIndex (a flat
// per-skin list that conflates time-of-day and weather). The build-main.js
// "atmosphere grid" patch rebuilds each Hills skin's weather list into a 4×4
// grid so the two become independent axes, with:
//
//     weatherIndex = timeIdx * WEATHERS.length + weatherIdx
//
// These vocab arrays, the grid ordering, and the season↔skin map below MUST stay
// in sync with that patch (same order, same engine skin keys). Only the Hills
// scene is gridded; other scenes (Planet) keep raw skin/weatherIndex semantics.
const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const TIMES_OF_DAY = ['morning', 'midday', 'dusk', 'night'];
const WEATHERS = ['clear', 'rain', 'snow', 'fog'];
const GRID_SCENE = 'Hills'; // the only scene that uses the 4×4 atmosphere grid

// Hills season (API vocab) → engine skin key, and back. 'summer' is the engine's
// 'default' skin; accept the pre-sanitise 'summer' key as an alias on decode.
const SEASON_TO_SKIN = { spring: 'spring', summer: 'default', fall: 'autumn', winter: 'winter' };
const SKIN_TO_SEASON = { spring: 'spring', default: 'summer', summer: 'summer', autumn: 'fall', winter: 'winter' };

function encodeWeatherIndex(timeIdx, weatherIdx) {
  return timeIdx * WEATHERS.length + weatherIdx;
}
function decodeWeatherIndex(weatherIndex) {
  const n = WEATHERS.length;
  const span = TIMES_OF_DAY.length * n; // 16
  const i = ((Math.round(weatherIndex) % span) + span) % span; // wrap into [0, span)
  return { timeIdx: Math.floor(i / n), weatherIdx: i % n };
}

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
  // Atmosphere, three independent axes (preferred interface; Hills scene).
  { path: 'scene.season', type: FieldType.Enum, cls: 'both', values: SEASONS, desc: 'Season / palette: spring, summer, fall, winter. Live + static.' },
  { path: 'scene.timeOfDay', type: FieldType.Enum, cls: 'both', values: TIMES_OF_DAY, desc: 'Time of day: morning, midday, dusk, night — independent of weather. Live + static.' },
  { path: 'scene.weather', type: FieldType.Enum, cls: 'both', values: WEATHERS, desc: 'Weather: clear, rain, snow, fog (fog is synthesized thick haze) — independent of time of day. Live + static.' },
  // Low-level engine handles (advanced / back-compat). season+timeOfDay+weather
  // desugar to these; weatherIndex is the 4×4 grid index on Hills.
  { path: 'scene.skin', type: FieldType.String, cls: 'both', desc: 'Engine skin key (advanced); prefer scene.season. Live via setSkin.' },
  { path: 'scene.weatherIndex', type: FieldType.Integer, cls: 'both', min: 0, desc: 'Raw index into the active skin\'s weather list (advanced); prefer scene.timeOfDay + scene.weather. On Hills this is timeIdx*4 + weatherIdx.' },
  { path: 'scene.dayNightCycle', type: FieldType.Enum, cls: 'both', values: [0, 1, 2, 3], labels: DAY_NIGHT_SECONDS.map((s) => (s ? s + 's' : 'off')), desc: 'Day-night cycle length index (auto-advances time of day when on).' },
  { path: 'scene.antialias', type: FieldType.Boolean, cls: 'static', desc: 'Renderer init flag.' },

  // --- lanes (3.1) — delegated to window.LaneRoads, live changes clamped ±1 ---
  { path: 'lanes', type: FieldType.Object, cls: 'both', desc: 'Lane layout { forward 1-5, backward 0-5, width 2.4-3.75|null }. Live changes clamp to ±1/direction.' },

  // --- traffic road actors — delegated to window.RoadTraffic (validates + persists) ---
  { path: 'traffic', type: FieldType.Object, cls: 'static', desc: 'Traffic vehicles { enabled, density 0-16, speed 2-45 m/s, oncoming, seed }. Applies on reload; the stopped-vehicle event is live via traffic.spawnStopped.' },

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
    atmosphere: {
      seasons: SEASONS,
      timesOfDay: TIMES_OF_DAY,
      weathers: WEATHERS,
      gridScene: GRID_SCENE, // scene.season/timeOfDay/weather apply fully here
    },
    ...(extra || {}),
  };
}
