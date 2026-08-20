/**
 * Procedural map generation expansion — configuration, presets and store.
 *
 * The engine ships five topography presets per scene (straight / casual /
 * easy / normal / hard) plus a hidden `flat` entry, each a bundle of heightmap
 * parameters + road width + midline smoothing. This module expands that space:
 *
 *   - EXPANDED_PRESETS: curated extra topographies per scene, registered
 *     non-destructively into the engine's own topography tables at startup
 *     (the engine calls MapGen._registerScene before it builds sceneMeta, so
 *     the new names flow into validation, the in-game menu and the world
 *     builder exactly like built-ins).
 *   - A per-scene "custom" topography whose parameters the user (or the API)
 *     dials in directly, validated/clamped against PARAM_SCHEMA.
 *
 * Like seed/topography in the stock game, generation parameters are *static*
 * config: they bake into the terrain, so changes apply on a world rebuild.
 * Selection persists in the engine's own `config-scene-topography` key; the
 * MapGen config itself persists under MG_STORAGE_KEY.
 */

const MG_STORAGE_KEY = 'pd-mapgen-config';

// Names the engine defines itself (per scene, incl. the hidden flat pad).
// Kept for labels/ordering; the live list always comes from the registered
// engine table so drift is impossible.
const MG_ENGINE_PRESETS = ['straight', 'casual', 'easy', 'normal', 'hard', 'flat'];

// The name the per-scene user-defined topography registers under.
const MG_CUSTOM_NAME = 'custom';

/**
 * Parameter schema per scene. `key` paths address the built heightmap entry:
 * everything except roadWidth / smoothWindow / bendyFactor lands inside
 * `heightmap`. Ranges bracket the engine's own presets with headroom without
 * leaving the numerically safe envelope (heightOffset on Planet is the crater
 * floor datum — all stock presets use 500).
 */
const PARAM_SCHEMA = {
  Hills: {
    heightScale: { type: 'float', min: 0, max: 400, step: 5, def: 160, desc: 'Terrain amplitude (m). 0 = pancake, stock presets 160-190.' },
    heightOffset: { type: 'float', min: 0, max: 300, step: 5, def: 95, desc: 'Base elevation above sea (m); low values bring the sea close to the road.' },
    resolutions: { type: 'intArray', min: 1, max: 48, maxLen: 5, def: [3, 12, 24], desc: 'Noise octaves: features per 1000 m cell, coarse to fine. More/denser layers = busier terrain.' },
    depthHeightFactor: { type: 'float', min: 0.1, max: 2, step: 0.05, def: 1, desc: 'Per-octave amplitude falloff; >1 keeps fine octaves tall (rugged), <1 smooths them out.' },
    squared: { type: 'boolean', def: true, desc: 'Square each noise bump (sharper peaks and valley floors).' },
    roadWidth: { type: 'float', min: 2.4, max: 20, step: 0.1, def: 3, desc: 'Base half-lane road width (m); stock 2.8-3.2, flat pad uses 20.' },
    smoothWindow: { type: 'int', min: 1, max: 15, step: 1, def: 7, desc: 'Midline smoothing window; lower = twistier road, higher = long sweepers.' },
    bendyFactor: { type: 'float', min: 0.2, max: 1, step: 0.05, def: 0.75, desc: 'Autodrive cornering aggressiveness on this terrain (stock 0.6-0.75).' },
  },
  Planet: {
    heightScale: { type: 'float', min: 0, max: 200, step: 5, def: 50, desc: 'Surface relief amplitude (m); stock presets 40-60.' },
    heightOffset: { type: 'float', min: 300, max: 700, step: 10, def: 500, desc: 'Surface datum height (m); all stock presets use 500.' },
    heightInitial: { type: 'float', min: 0, max: 3, step: 0.1, def: 1.1, desc: 'Initial height factor before crater carving.' },
    resolution: { type: 'int', min: 1, max: 4, step: 1, def: 1, desc: 'Base noise resolution per cell.' },
    craterLayers: { type: 'int', min: 0, max: 5, step: 1, def: 2, desc: 'How many crater passes are carved into the surface.' },
    craterDepth: { type: 'float', min: 0, max: 3, step: 0.05, def: 0.75, desc: 'Crater depth factor; >1.5 gives deep, hard-walled craters.' },
    depth: { type: 'int', min: 1, max: 6, step: 1, def: 4, desc: 'Noise octave count; more = busier surface.' },
    upscaleFactor: { type: 'float', min: 1, max: 4, step: 0.5, def: 2.5, desc: 'Resolution multiplier between octaves.' },
    squared: { type: 'boolean', def: true, desc: 'Square each noise bump (sharper ridges).' },
    compound: { type: 'boolean', def: true, desc: 'Compound octaves multiplicatively instead of additively.' },
    roadWidth: { type: 'float', min: 2.4, max: 20, step: 0.1, def: 3, desc: 'Base half-lane road width (m); stock 2.8-3.2, flat pad uses 20.' },
    smoothWindow: { type: 'int', min: 1, max: 15, step: 1, def: 7, desc: 'Midline smoothing window; lower = twistier road, higher = long sweepers.' },
    bendyFactor: { type: 'float', min: 0.2, max: 1, step: 0.05, def: 0.55, desc: 'Autodrive cornering aggressiveness on this terrain (stock 0.4-0.55).' },
  },
};

// Which heightmap keys each scene's generator consumes (everything else in a
// param set is entry-level). Mirrors the engine's own preset key sets so a
// built entry never misses a key the generator reads.
const MG_HEIGHTMAP_KEYS = {
  Hills: ['heightScale', 'heightOffset', 'resolutions', 'depthHeightFactor', 'squared'],
  Planet: ['heightScale', 'heightOffset', 'heightInitial', 'resolution', 'craterLayers', 'craterDepth', 'depth', 'upscaleFactor', 'squared', 'compound'],
};

// Fixed engine-side heightmap fields the schema doesn't expose (kept at the
// stock presets' values so custom terrain stays inside tested behaviour).
const MG_HEIGHTMAP_FIXED = {
  Hills: { compound: false },
  Planet: { midlineDepth: 5 },
};

/**
 * Curated expanded presets, registered into the engine tables at startup.
 * Values are interpolations/extrapolations of the engine's own presets: each
 * entry carries the full key set of a stock preset for its scene, plus a
 * bendyFactor consumed by the autodrive patch and label/desc for UIs.
 */
const EXPANDED_PRESETS = {
  Hills: {
    rolling: {
      label: 'Rolling', desc: 'Gentle wide hills and long sweepers — easier than casual.',
      heightmap: { heightScale: 120, heightOffset: 100, resolutions: [3, 7], compound: false, squared: true, depthHeightFactor: 0.7 },
      roadWidth: 3.4, smoothWindow: 9, bendyFactor: 0.8,
    },
    alpine: {
      label: 'Alpine', desc: 'Steep peaks, narrow twisty road — harder than hard.',
      heightmap: { heightScale: 260, heightOffset: 150, resolutions: [3, 12, 24, 36], compound: false, squared: true, depthHeightFactor: 1 },
      roadWidth: 2.6, smoothWindow: 4, bendyFactor: 0.5,
    },
    canyon: {
      label: 'Canyon', desc: 'Deep cut valleys near sea level with rugged fine detail.',
      heightmap: { heightScale: 230, heightOffset: 60, resolutions: [4, 16, 32], compound: false, squared: true, depthHeightFactor: 1.15 },
      roadWidth: 3, smoothWindow: 6, bendyFactor: 0.6,
    },
  },
  Planet: {
    plains: {
      label: 'Plains', desc: 'Smooth off-world flats with sparse shallow craters.',
      heightmap: { heightScale: 60, heightOffset: 500, heightInitial: 1.5, resolution: 2, craterLayers: 1, craterDepth: 0.4, upscaleFactor: 2, depth: 2, midlineDepth: 5, squared: false, compound: true },
      roadWidth: 3.4, smoothWindow: 9, bendyFactor: 0.6,
    },
    cratered: {
      label: 'Cratered', desc: 'Dense deep craters and a tight winding road.',
      heightmap: { heightScale: 45, heightOffset: 500, heightInitial: 1, resolution: 2, craterLayers: 4, craterDepth: 1.8, upscaleFactor: 2, depth: 5, midlineDepth: 5, squared: true, compound: false },
      roadWidth: 2.7, smoothWindow: 5, bendyFactor: 0.4,
    },
  },
};

// Friendly labels for the engine's own presets (menu strings match the stock UI).
const MG_ENGINE_LABELS = {
  straight: 'Straight', casual: 'Casual', easy: 'Easy', normal: 'Normal', hard: 'Hard', flat: 'Flat',
};

const MG_DEFAULTS = {
  expanded: true, // register the curated extra presets
  custom: { Hills: null, Planet: null }, // per-scene user parameter sets
};

function mgClampNumber(v, spec, fallback) {
  let n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (spec.type === 'int') n = Math.round(n);
  return Math.max(spec.min, Math.min(spec.max, n));
}

/** Coerce one scene's custom params against PARAM_SCHEMA. null stays null. */
function mgSanitiseParams(scene, params) {
  const schema = PARAM_SCHEMA[scene];
  if (!schema || params == null) return null;
  if (typeof params !== 'object') return null;
  const out = {};
  for (const key in schema) {
    const spec = schema[key];
    const v = params[key];
    if (spec.type === 'boolean') {
      out[key] = v == null ? spec.def : !!v;
    } else if (spec.type === 'intArray') {
      let arr = Array.isArray(v) ? v : spec.def;
      arr = arr
        .map((x) => Math.round(Number(x)))
        .filter((x) => Number.isFinite(x))
        .map((x) => Math.max(spec.min, Math.min(spec.max, x)))
        .slice(0, spec.maxLen);
      out[key] = arr.length ? arr : spec.def.slice();
    } else {
      out[key] = mgClampNumber(v, spec, spec.def);
    }
  }
  return out;
}

/**
 * Build an engine topography entry ({ heightmap, roadWidth, smoothWindow,
 * bendyFactor }) from a sanitised custom parameter set.
 */
function mgBuildEntry(scene, params) {
  const heightmap = Object.assign({}, MG_HEIGHTMAP_FIXED[scene] || {});
  for (const key of MG_HEIGHTMAP_KEYS[scene] || []) {
    if (params[key] !== undefined) {
      heightmap[key] = Array.isArray(params[key]) ? params[key].slice() : params[key];
    }
  }
  return {
    label: 'Custom', desc: 'User-defined generation parameters.',
    heightmap,
    roadWidth: params.roadWidth,
    smoothWindow: params.smoothWindow,
    bendyFactor: params.bendyFactor,
  };
}

/** Default custom params for a scene (schema defaults = "normal"-ish). */
function mgDefaultParams(scene) {
  const schema = PARAM_SCHEMA[scene];
  const out = {};
  for (const key in schema) {
    const d = schema[key].def;
    out[key] = Array.isArray(d) ? d.slice() : d;
  }
  return out;
}

function mgDeepCopyConfig(cfg) {
  return {
    expanded: cfg.expanded,
    custom: {
      Hills: cfg.custom.Hills ? Object.assign({}, cfg.custom.Hills, { resolutions: (cfg.custom.Hills.resolutions || []).slice() }) : null,
      Planet: cfg.custom.Planet ? Object.assign({}, cfg.custom.Planet) : null,
    },
  };
}

/** Tiny observable store: get / set (merge) / subscribe, with persistence. */
class MapGenStore {
  constructor() {
    this._listeners = new Set();
    this._cfg = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(MG_STORAGE_KEY);
      if (raw) return this._sanitise(JSON.parse(raw));
    } catch (_e) {
      /* ignore corrupt storage */
    }
    return mgDeepCopyConfig(MG_DEFAULTS);
  }

  _sanitise(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : {};
    const custom = cfg.custom && typeof cfg.custom === 'object' ? cfg.custom : {};
    return {
      expanded: cfg.expanded == null ? MG_DEFAULTS.expanded : !!cfg.expanded,
      custom: {
        Hills: mgSanitiseParams('Hills', custom.Hills),
        Planet: mgSanitiseParams('Planet', custom.Planet),
      },
    };
  }

  _save() {
    try {
      localStorage.setItem(MG_STORAGE_KEY, JSON.stringify(this._cfg));
    } catch (_e) {
      /* storage may be unavailable */
    }
  }

  /** Current configuration (a deep copy — callers must not mutate it). */
  get() {
    return mgDeepCopyConfig(this._cfg);
  }

  /**
   * Merge a partial config ({ expanded?, custom?: { Hills?, Planet? } }),
   * validate, persist and notify. Per-scene custom params merge onto the
   * existing set (or schema defaults when starting from null); passing
   * `custom: { Hills: null }` clears that scene's custom topography.
   */
  set(partial) {
    partial = partial || {};
    const next = mgDeepCopyConfig(this._cfg);
    if (partial.expanded != null) next.expanded = !!partial.expanded;
    if (partial.custom && typeof partial.custom === 'object') {
      for (const scene of ['Hills', 'Planet']) {
        if (!(scene in partial.custom)) continue;
        const p = partial.custom[scene];
        if (p == null) {
          next.custom[scene] = null;
        } else {
          const base = next.custom[scene] || mgDefaultParams(scene);
          next.custom[scene] = mgSanitiseParams(scene, Object.assign({}, base, p));
        }
      }
    }
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
