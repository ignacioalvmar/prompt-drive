/**
 * Traffic configuration store for AI traffic road actors.
 *
 * Holds the researcher's *intent* only — whether traffic is enabled, how many
 * vehicles to maintain, their constant cruise speed, and whether oncoming
 * lanes are populated. The traffic manager resolves this intent against the
 * live road (lane layout, build frontier) and owns all actor state.
 *
 * Static class: the store is read when the sim goes live; density/speed are
 * not re-applied to vehicles already on the road. The stopped-vehicle event
 * is the dynamic path (see RoadTraffic.spawnStopped).
 *
 * Selection persists in localStorage and is published on `window.RoadTraffic`,
 * which the engine hands live handles to and ticks every rendered frame.
 */

const TRAFFIC_STORAGE_KEY = 'pd-traffic-config';

const TRAFFIC_DEFAULTS = {
  enabled: false, // off by default — zero impact on existing studies
  density: 6, // total vehicles maintained around the ego
  speed: 15, // m/s, constant cruise speed for all traffic vehicles
  oncoming: true, // also populate oncoming lanes (when backward > 0)
  seed: null, // RNG seed; null = derive from the scene seed
};

const TRAFFIC_LIMITS = {
  density: { min: 0, max: 16 }, // perf cap: cloned OBJ meshes, no instancing
  speed: { min: 2, max: 45 },
};

// Plausible car body colors, picked per vehicle from the seeded RNG so a
// given scene seed always produces the same traffic appearance.
const TRAFFIC_COLORS = [
  0xc0c5c9, // silver
  0x2a2d30, // near black
  0xffffff, // white
  0x7a8288, // grey
  0x8b1e24, // dark red
  0x1f3a63, // dark blue
  0x2e5339, // dark green
  0xb8860b, // ochre
  0x5c3a21, // brown
  0x9e9646, // olive
  0x36454f, // charcoal blue
  0xd4653a, // orange
];

// Behaviour tuning, isolated here on purpose (plan §7). Distances in metres,
// speeds m/s, times seconds.
const TRAFFIC_TUNING = {
  corridorAhead: 1200, // recycle a vehicle drifting further ahead of the ego
  corridorBehind: 400, // … or further behind
  spawnAheadMin: 250, // ahead spawns: at least this far AND fog-hidden (see manager)
  spawnBehindMin: 150, // … behind the ego
  spawnGap: 40, // min in-lane gap to other traffic at the spawn point
  sensorRange: 60, // front-sensor scan distance along the lane
  timeHeadway: 1.5, // desired following gap = minGap + speed * timeHeadway
  minGap: 2.5, // standstill gap to the lead vehicle
  accelRate: 3, // m/s² toward target speed
  brakeRate: 7, // m/s² when the sensor demands slowing
  stoppedEventMinDist: 30, // spawnStopped distance clamp
  maxVehicles: 24, // hard cap incl. event spawns (density max + extras)
};

function trafficClampNum(v, lo, hi, fallback) {
  v = Number(v);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

/** Coerce an arbitrary partial config into a valid, normalised config. */
function trafficSanitise(cfg) {
  const out = {
    enabled: !!cfg.enabled,
    density: Math.round(
      trafficClampNum(cfg.density, TRAFFIC_LIMITS.density.min, TRAFFIC_LIMITS.density.max, TRAFFIC_DEFAULTS.density)
    ),
    speed: trafficClampNum(cfg.speed, TRAFFIC_LIMITS.speed.min, TRAFFIC_LIMITS.speed.max, TRAFFIC_DEFAULTS.speed),
    oncoming: cfg.oncoming == null ? TRAFFIC_DEFAULTS.oncoming : !!cfg.oncoming,
    seed: cfg.seed == null ? null : String(cfg.seed),
  };
  return out;
}

/** Tiny observable store: get / set (merge) / subscribe, with persistence. */
class TrafficStore {
  constructor() {
    this._listeners = new Set();
    this._cfg = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(TRAFFIC_STORAGE_KEY);
      if (raw) return trafficSanitise(Object.assign({}, TRAFFIC_DEFAULTS, JSON.parse(raw)));
    } catch (_e) {
      /* ignore corrupt storage */
    }
    return Object.assign({}, TRAFFIC_DEFAULTS);
  }

  _save() {
    try {
      localStorage.setItem(TRAFFIC_STORAGE_KEY, JSON.stringify(this._cfg));
    } catch (_e) {
      /* storage may be unavailable */
    }
  }

  /** Current configuration (a copy — callers must not mutate it). */
  get() {
    return Object.assign({}, this._cfg);
  }

  /** Merge a partial config, validate, persist, and notify subscribers. */
  set(partial) {
    const next = trafficSanitise(Object.assign({}, this._cfg, partial || {}));
    const changed = JSON.stringify(next) !== JSON.stringify(this._cfg);
    this._cfg = next;
    if (changed) {
      this._save();
      this._emit();
    }
    return this.get();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snap = this.get();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch (_e) {
        /* a bad listener must not break the others */
      }
    }
  }
}
