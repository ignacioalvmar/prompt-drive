/**
 * Lane configuration store for dynamic multi-lane roads.
 *
 * Holds the user's *intent* only — how many lanes in each direction and an
 * optional lane-width override. The game engine (main bundle) resolves this
 * intent against the active topography's base road width and owns all geometry.
 *
 * `width: null` means "auto" — the engine uses the topography's own road width
 * as the per-lane width, so the default 1+1 configuration reproduces the
 * original single-carriageway road exactly.
 *
 * Selection persists in localStorage and is published on `window.LaneRoads`,
 * which the engine polls when it generates new road nodes ahead of the car.
 */

const STORAGE_KEY = 'pd-lane-config';

const LANE_DEFAULTS = {
  forward: 1, // lanes in the ego (driving) direction
  backward: 1, // oncoming lanes
  width: null, // metres per lane; null = auto (use topography road width)
};

// Caps on the per-direction lane count and lane width. Up to 5 lanes per
// direction may be set as the INITIAL configuration (before the car starts
// moving). Once driving, changes are additionally restricted to ±1 lane per
// direction at a time (see clampLive) so every transition is a single,
// continuous merge / lane-gain on the road ahead.
const LANE_LIMITS = {
  forward: { min: 1, max: 5 },
  backward: { min: 0, max: 5 },
  width: { min: 2.4, max: 3.75 }, // only applies when not auto
};

// Named presets shown as one-click buttons in the settings panel. Kept within
// the width that renders cleanly on hilly terrain (see LANE_LIMITS); wider
// layouts can still be dialled in manually with the steppers.
const LANE_PRESETS = [
  { id: 'single', label: 'Single (1+1)', cfg: { forward: 1, backward: 1, width: null } },
  { id: 'dual', label: 'Dual 2+2', cfg: { forward: 2, backward: 2, width: 3.2 } },
  { id: 'wide', label: 'Wide 3+2', cfg: { forward: 3, backward: 2, width: 3.2 } },
  { id: 'oneway3', label: 'One-way ×3', cfg: { forward: 3, backward: 0, width: 3.2 } },
];

function clampInt(v, lo, hi, fallback) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

/** Coerce an arbitrary partial config into a valid, normalised config. */
function sanitise(cfg) {
  const out = {
    forward: clampInt(cfg.forward, LANE_LIMITS.forward.min, LANE_LIMITS.forward.max, LANE_DEFAULTS.forward),
    backward: clampInt(cfg.backward, LANE_LIMITS.backward.min, LANE_LIMITS.backward.max, LANE_DEFAULTS.backward),
    width: LANE_DEFAULTS.width,
  };
  if (cfg.width != null && cfg.width !== 'auto') {
    const w = Number(cfg.width);
    if (Number.isFinite(w)) {
      out.width = Math.max(LANE_LIMITS.width.min, Math.min(LANE_LIMITS.width.max, w));
    }
  }
  // At least one lane total, or the road would vanish.
  if (out.forward + out.backward < 1) out.forward = 1;
  return out;
}

/**
 * While the car is driving, restrict a requested layout to ±1 lane per direction
 * relative to what is actually on the road under the car, so each change is a
 * single continuous transition (one lane added/dropped per stretch of road).
 * Before the car moves (initial configuration) any layout up to the caps is
 * allowed. The engine publishes the live state on `window.LaneRoads`.
 */
function clampLive(req) {
  let live = null;
  try {
    live =
      typeof window !== 'undefined' && window.LaneRoads && window.LaneRoads._driving
        ? window.LaneRoads._applied
        : null;
  } catch (_e) {
    live = null;
  }
  if (!live) return req;
  const out = Object.assign({}, req);
  if (Number.isFinite(live.forward)) {
    out.forward = Math.max(live.forward - 1, Math.min(live.forward + 1, req.forward));
  }
  if (Number.isFinite(live.backward)) {
    out.backward = Math.max(live.backward - 1, Math.min(live.backward + 1, req.backward));
  }
  return out;
}

/** Tiny observable store: get / set (merge) / subscribe, with persistence. */
class LaneStore {
  constructor() {
    this._listeners = new Set();
    this._cfg = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitise(Object.assign({}, LANE_DEFAULTS, JSON.parse(raw)));
    } catch (_e) {
      /* ignore corrupt storage */
    }
    return Object.assign({}, LANE_DEFAULTS);
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._cfg));
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
    const merged = sanitise(Object.assign({}, this._cfg, partial || {}));
    // Enforce the ±1-per-direction limit live while driving, then re-sanitise so
    // the result is always valid (e.g. never an empty road).
    const next = sanitise(clampLive(merged));
    const changed =
      next.forward !== this._cfg.forward ||
      next.backward !== this._cfg.backward ||
      next.width !== this._cfg.width;
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
