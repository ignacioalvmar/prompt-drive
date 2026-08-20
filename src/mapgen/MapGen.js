/**
 * Public facade for procedural map generation expansion, exposed as
 * `window.MapGen`. The engine calls `MapGen._registerScene(...)` at startup
 * with its own per-scene topography tables; this module injects the expanded
 * presets and the user's custom parameter set into those tables so every
 * downstream consumer (scene meta, the in-game "road complexity" menu, the
 * world builder, query-string validation) treats them like built-ins. The
 * module only owns the user's intent, validation, persistence and the
 * settings-panel UI.
 *
 * API:
 *   MapGen.get()               -> { expanded, custom: { Hills, Planet } }
 *   MapGen.set(partial)        -> merges, validates, persists (terrain params
 *                                 bake into the world; applied on rebuild)
 *   MapGen.select(name)        -> switch the active topography (live when the
 *                                 engine is running — same path as the game's
 *                                 own menu — otherwise persisted for reload)
 *   MapGen.apply()             -> reloads so the engine rebuilds the world
 *   MapGen.presets(scene?)     -> selectable topographies with labels/sources
 *   MapGen.schema()            -> per-scene parameter metadata (ranges, docs)
 *   MapGen.resolve(scene,name) -> effective engine entry for a topography
 *   MapGen.active()            -> what the engine actually generated with
 *                                 ({ scene, topography, seed, params }) or null
 *   MapGen.subscribe(fn)       -> fn(cfg) on change; returns an unsubscribe fn
 *
 * Engine hooks (used by build-main.js patches, all guarded there):
 *   MapGen._registerScene(scene, table)  – inject presets into an engine table
 *   MapGen._publishActive(info)          – record live generation parameters
 *   MapGen.has(name) / menuNames(scene) / menuOptions(scene) / bendyFactor(...)
 */

const mgStore = new MapGenStore();

// Engine topography tables by scene, registered by the main bundle at startup,
// plus the names this module injected (so a config change can retract them).
const mgRegistered = {};
const mgInjected = { Hills: [], Planet: [] };

function mgCurrentScene() {
  try {
    const s = localStorage.getItem('config-scene-name');
    if (s === 'Hills' || s === 'Planet') return s;
  } catch (_e) {
    /* storage may be unavailable */
  }
  return 'Hills';
}

/** (Re)inject expanded + custom entries into a registered engine table. */
function mgSyncScene(scene) {
  const table = mgRegistered[scene];
  if (!table) return;
  const cfg = mgStore.get();

  // Retract everything we previously injected, then re-add per current config.
  for (const name of mgInjected[scene]) delete table[name];
  mgInjected[scene] = [];

  if (cfg.expanded) {
    const extras = EXPANDED_PRESETS[scene] || {};
    for (const name in extras) {
      if (table[name]) continue; // never shadow an engine-defined entry
      const src = extras[name];
      table[name] = {
        label: src.label,
        desc: src.desc,
        heightmap: Object.assign({}, src.heightmap, {
          resolutions: src.heightmap.resolutions ? src.heightmap.resolutions.slice() : undefined,
        }),
        roadWidth: src.roadWidth,
        smoothWindow: src.smoothWindow,
        bendyFactor: src.bendyFactor,
      };
      if (table[name].heightmap.resolutions === undefined) delete table[name].heightmap.resolutions;
      mgInjected[scene].push(name);
    }
  }

  // All injected names were retracted above, so `custom` can only be present
  // here if the engine itself defined it — in which case leave it alone.
  const params = cfg.custom[scene];
  if (params && !table[MG_CUSTOM_NAME]) {
    table[MG_CUSTOM_NAME] = mgBuildEntry(scene, params);
    mgInjected[scene].push(MG_CUSTOM_NAME);
  }
}

function mgNames(scene) {
  const table = mgRegistered[scene];
  if (table) return Object.keys(table);
  // Pre-registration fallback (settings UI before the engine loads): engine
  // defaults plus whatever this config would inject.
  const cfg = mgStore.get();
  const names = MG_ENGINE_PRESETS.slice();
  if (cfg.expanded) for (const n in EXPANDED_PRESETS[scene] || {}) names.push(n);
  if (cfg.custom[scene]) names.push(MG_CUSTOM_NAME);
  return names;
}

function mgLabel(scene, name) {
  const table = mgRegistered[scene];
  if (table && table[name] && table[name].label) return table[name].label;
  if (MG_ENGINE_LABELS[name]) return MG_ENGINE_LABELS[name];
  const extras = EXPANDED_PRESETS[scene] || {};
  if (extras[name]) return extras[name].label;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const MapGen = {
  get: () => mgStore.get(),
  set: (partial) => {
    const out = mgStore.set(partial);
    // Keep live engine tables in sync so a subsequent (live or reload)
    // topography switch generates with the latest parameters.
    for (const scene in mgRegistered) mgSyncScene(scene);
    return out;
  },
  subscribe: (fn) => mgStore.subscribe(fn),
  apply: () => {
    if (typeof location !== 'undefined') location.reload();
  },

  /**
   * Switch the active topography. Uses the engine's own SceneConfig when the
   * sim is running (regenerates the world live, exactly like the game menu's
   * "apply changes"), otherwise persists to the engine's localStorage key so
   * the next load picks it up.
   */
  select(name) {
    const scene = mgCurrentScene();
    if (mgNames(scene).indexOf(name) < 0) {
      return { ok: false, error: 'unknown_topography', options: mgNames(scene) };
    }
    try {
      const b = typeof window !== 'undefined' ? window.PromptDriveBridge : null;
      if (b && b.handles && b.handles.sceneConfig) {
        b.handles.sceneConfig.set('topography', name);
        return { ok: true, value: name, appliedLive: true };
      }
    } catch (_e) {
      /* fall through to persistence */
    }
    try {
      localStorage.setItem('config-scene-topography', name);
      return { ok: true, value: name, appliesOn: 'reload' };
    } catch (_e) {
      return { ok: false, error: 'storage_unavailable' };
    }
  },

  /** Currently selected topography name (persisted engine key). */
  selected() {
    try {
      return localStorage.getItem('config-scene-topography') || 'normal';
    } catch (_e) {
      return 'normal';
    }
  },

  currentScene: mgCurrentScene,

  /** Selectable topographies for one scene (default: the current scene). */
  presets(scene) {
    scene = scene || mgCurrentScene();
    const table = mgRegistered[scene] || {};
    const cfg = mgStore.get();
    return mgNames(scene).map((name) => {
      const entry = table[name];
      const source = MG_ENGINE_PRESETS.includes(name)
        ? 'engine'
        : name === MG_CUSTOM_NAME
          ? 'custom'
          : 'expanded';
      return {
        id: name,
        label: mgLabel(scene, name),
        desc: (entry && entry.desc) || ((EXPANDED_PRESETS[scene] || {})[name] || {}).desc || null,
        source,
        roadWidth: entry ? entry.roadWidth : null,
        smoothWindow: entry ? entry.smoothWindow : null,
        params: source === 'custom' ? cfg.custom[scene] : undefined,
      };
    });
  },

  /** Per-scene custom parameter metadata (JSON-safe copy of PARAM_SCHEMA). */
  schema() {
    return JSON.parse(JSON.stringify(PARAM_SCHEMA));
  },

  /** Effective engine entry for a topography, or null. */
  resolve(scene, name) {
    const table = mgRegistered[scene];
    if (!table || !table[name]) return null;
    return JSON.parse(JSON.stringify(table[name]));
  },

  /** True if any registered (or configured) scene knows this topography. */
  has(name) {
    return mgNames('Hills').indexOf(name) >= 0 || mgNames('Planet').indexOf(name) >= 0;
  },

  defaults: mgDeepCopyConfig(MG_DEFAULTS),

  // --- engine hooks (called from build-main.js patches, always guarded) -----

  /** In-game menu integration: names + display labels, index-aligned. */
  menuNames(scene) {
    return mgNames(scene || mgCurrentScene());
  },
  menuOptions(scene) {
    scene = scene || mgCurrentScene();
    return mgNames(scene).map((n) => mgLabel(scene, n).toUpperCase());
  },

  /** Autodrive cornering factor carried by expanded/custom presets, or null. */
  bendyFactor(scene, name) {
    const table = mgRegistered[scene];
    const entry = table && table[name];
    return entry && typeof entry.bendyFactor === 'number' ? entry.bendyFactor : null;
  },

  /** The engine registers its per-scene topography table here at startup. */
  _registerScene(scene, table) {
    if (!table || typeof table !== 'object') return;
    mgRegistered[scene] = table;
    mgInjected[scene] = mgInjected[scene] || [];
    mgSyncScene(scene);
  },

  /** The engine publishes what it actually generated with. */
  _active: null,
  _publishActive(info) {
    this._active = info ? JSON.parse(JSON.stringify(info)) : null;
  },
  active() {
    return this._active ? JSON.parse(JSON.stringify(this._active)) : null;
  },

  _panel: null,
};

if (typeof window !== 'undefined') {
  window.MapGen = MapGen;
}

if (typeof document !== 'undefined') {
  MapGen._panel = new MapGenPanel(mgStore, MapGen);
}
