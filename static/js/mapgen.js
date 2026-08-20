/* Procedural map generation expansion — built from src/mapgen/ */
(function () {
/* --- config.js --- */
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


/* --- MapGenPanel.js --- */
/**
 * Map-generation UI, injected into the game's settings sidebar as a
 * collapsible "map generation" section (below the road-lanes section).
 *
 * Mirrors LanePanel: the React-rendered settings list mounts/unmounts as the
 * user opens/closes it, so the section is (re)injected via a MutationObserver
 * and matches the native collapsible markup so it looks built-in.
 *
 * `store` is the MapGenStore this UI reads/writes; `facade` is the MapGen
 * object (selection + preset/schema lookups).
 */

const MGP_STYLE_ID = 'pd-mapgen-style';
const MGP_SECTION_ID = 'pd-mapgen-section';
const MGP_CONTENT_ID = 'pd-mapgen-content';

const MGP_CSS = `
#${MGP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${MGP_SECTION_ID} .collapsible-cross{float:right}
#${MGP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${MGP_CONTENT_ID}.open{display:block}
#${MGP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${MGP_CONTENT_ID} .pd-mrow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${MGP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${MGP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${MGP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${MGP_CONTENT_ID} .pd-step .val{min-width:58px;text-align:center;color:#eafffb;font-weight:600}
#${MGP_CONTENT_ID} .pd-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#${MGP_CONTENT_ID} .pd-presets button{flex:1 1 30%;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${MGP_CONTENT_ID} .pd-presets button:hover{border-color:#3ec6b5}
#${MGP_CONTENT_ID} .pd-presets button.sel{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${MGP_CONTENT_ID} .pd-presets button.apply{background:#1d3a36;border-color:#3ec6b5;color:#eafffb;flex:1 1 auto}
#${MGP_CONTENT_ID} .pd-seedrow{display:flex;gap:6px;margin-top:8px}
#${MGP_CONTENT_ID} .pd-seedrow input{flex:1;background:#151515;color:#eafffb;
  border:1px solid #3a3a3a;border-radius:5px;padding:6px 8px;font:600 12px Jura,system-ui}
#${MGP_CONTENT_ID} .pd-seedrow button{font:600 12px Jura,system-ui;background:#2a2a2a;
  color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;padding:6px 10px;cursor:pointer}
#${MGP_CONTENT_ID} .pd-seedrow button:hover{border-color:#3ec6b5}
#${MGP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${MGP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

// Ladder used by the "detail layers" stepper to grow/shrink the Hills
// resolutions array (matches the progression of the engine's own presets).
const MGP_RES_LADDER = [3, 12, 24, 36, 48];

// Panel rows per scene: a curated, readable subset of PARAM_SCHEMA (the full
// schema stays reachable through MapGen.set / the API).
const MGP_ROWS = {
  Hills: [
    { key: 'heightScale', label: 'Terrain height' },
    { key: 'heightOffset', label: 'Base elevation' },
    { key: 'resolutions', label: 'Detail layers', ladder: true },
    { key: 'depthHeightFactor', label: 'Roughness' },
    { key: 'roadWidth', label: 'Road width' },
    { key: 'smoothWindow', label: 'Road smoothing' },
  ],
  Planet: [
    { key: 'heightScale', label: 'Terrain height' },
    { key: 'craterLayers', label: 'Crater layers' },
    { key: 'craterDepth', label: 'Crater depth' },
    { key: 'depth', label: 'Detail layers' },
    { key: 'roadWidth', label: 'Road width' },
    { key: 'smoothWindow', label: 'Road smoothing' },
  ],
};

class MapGenPanel {
  constructor(store, facade) {
    this.store = store;
    this.facade = facade;
    this.expanded = false;
    this._injectStyle();
    this._buildSection();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._unsub = store.subscribe(() => this._render());
  }

  _injectStyle() {
    if (document.getElementById(MGP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = MGP_STYLE_ID;
    s.textContent = MGP_CSS;
    document.head.appendChild(s);
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInject();
    });
  }

  _tryInject() {
    const list = document.querySelector('.settings-input-list');
    if (!list) return;
    if (list.contains(this.header) && list.contains(this.content)) return;
    list.appendChild(this.header);
    list.appendChild(this.content);
    this._render();
  }

  _buildSection() {
    this.header = mgEl('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = MGP_SECTION_ID;
    this.title = mgEl('div', 'collapsible-title', 'map generation');
    this.cross = mgEl('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = mgEl('div');
    this.content.id = MGP_CONTENT_ID;

    this.content.appendChild(mgEl('div', 'pd-fam', 'topography'));
    this.presetGrid = mgEl('div', 'pd-presets');
    this.content.appendChild(this.presetGrid);

    this.content.appendChild(mgEl('div', 'pd-fam', 'custom terrain'));
    this.paramBox = mgEl('div');
    this.content.appendChild(this.paramBox);

    this.content.appendChild(mgEl('div', 'pd-fam', 'world'));
    const seedRow = mgEl('div', 'pd-seedrow');
    this.seedInput = document.createElement('input');
    this.seedInput.placeholder = 'seed';
    this.seedInput.maxLength = 32;
    this.seedInput.addEventListener('click', (e) => e.stopPropagation());
    this.seedInput.addEventListener('change', () => this._setSeed(this.seedInput.value));
    const dice = mgEl('button', null, '🎲');
    dice.title = 'Random seed';
    dice.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setSeed(Math.random().toString(36).slice(2, 10));
    });
    seedRow.append(this.seedInput, dice);
    this.content.appendChild(seedRow);

    const applyRow = mgEl('div', 'pd-presets');
    this.applyBtn = mgEl('button', 'apply', 'Rebuild world');
    this.applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        this.applyBtn.textContent = 'Rebuilding…';
        this.applyBtn.disabled = true;
      } catch (_e) {}
      this.facade.apply();
    });
    applyRow.appendChild(this.applyBtn);
    this.content.appendChild(applyRow);

    this.note = mgEl('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _setSeed(value) {
    value = String(value || '').trim();
    if (!value) return;
    try {
      localStorage.setItem('seed', value);
    } catch (_e) {}
    this._render();
  }

  _scene() {
    return this.facade.currentScene();
  }

  _params() {
    const scene = this._scene();
    return this.store.get().custom[scene];
  }

  _setParam(key, value) {
    const scene = this._scene();
    this.facade.set({ custom: { [scene]: { [key]: value } } });
  }

  _stepParam(row, dir) {
    const scene = this._scene();
    const spec = PARAM_SCHEMA[scene][row.key];
    const params = this._params() || mgDefaultParams(scene);
    if (row.ladder) {
      const len = Math.max(1, Math.min(MGP_RES_LADDER.length, (params[row.key] || []).length + dir));
      this._setParam(row.key, MGP_RES_LADDER.slice(0, len));
    } else if (spec.type === 'boolean') {
      this._setParam(row.key, !params[row.key]);
    } else {
      this._setParam(row.key, (params[row.key] != null ? params[row.key] : spec.def) + dir * (spec.step || 1));
    }
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+';
    this.content.classList.toggle('open', this.expanded);
  }

  _render() {
    if (!this.presetGrid) return;
    const scene = this._scene();
    const selected = this.facade.selected();
    const params = this._params();

    // Topography preset grid (engine + expanded + custom when defined).
    this.presetGrid.textContent = '';
    for (const p of this.facade.presets(scene)) {
      const b = mgEl('button', p.id === selected ? 'sel' : null, p.label);
      if (p.desc) b.title = p.desc;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.facade.select(p.id);
        this._render();
      });
      this.presetGrid.appendChild(b);
    }

    // Custom-terrain parameter rows (or an enable button).
    this.paramBox.textContent = '';
    if (!params) {
      const row = mgEl('div', 'pd-presets');
      const enable = mgEl('button', null, 'Enable custom terrain');
      enable.addEventListener('click', (e) => {
        e.stopPropagation();
        this.facade.set({ custom: { [scene]: mgDefaultParams(scene) } });
      });
      row.appendChild(enable);
      this.paramBox.appendChild(row);
    } else {
      for (const row of MGP_ROWS[scene]) {
        const spec = PARAM_SCHEMA[scene][row.key];
        const line = mgEl('div', 'pd-mrow');
        const label = mgEl('span', null, row.label);
        if (spec.desc) label.title = spec.desc;
        line.appendChild(label);
        const step = mgEl('div', 'pd-step');
        const minus = mgEl('button', null, '−');
        const plus = mgEl('button', null, '+');
        minus.addEventListener('click', (e) => {
          e.stopPropagation();
          this._stepParam(row, -1);
        });
        plus.addEventListener('click', (e) => {
          e.stopPropagation();
          this._stepParam(row, 1);
        });
        const v = params[row.key];
        const text = Array.isArray(v)
          ? v.length + ' (' + v.join(',') + ')'
          : typeof v === 'boolean'
            ? v ? 'on' : 'off'
            : String(Math.round(v * 100) / 100);
        step.append(minus, mgEl('span', 'val', text), plus);
        line.appendChild(step);
        this.paramBox.appendChild(line);
      }
      const row = mgEl('div', 'pd-presets');
      const disable = mgEl('button', null, 'Disable custom');
      disable.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.facade.selected() === 'custom') this.facade.select('normal');
        this.facade.set({ custom: { [scene]: null } });
      });
      row.appendChild(disable);
      this.paramBox.appendChild(row);
    }

    try {
      this.seedInput.value = localStorage.getItem('seed') || '';
    } catch (_e) {}

    this.note.innerHTML =
      `Scene: <b>${scene}</b>, topography: <b>${selected}</b>. ` +
      `Selecting a topography regenerates the world in place; custom terrain ` +
      `parameters and a new seed bake in on <b>Rebuild world</b>.`;
  }

  dispose() {
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function mgEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


/* --- MapGen.js --- */
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

})();
