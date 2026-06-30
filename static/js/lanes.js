/* Dynamic multi-lane roads — built from src/lanes/ */
(function () {
/* --- config.js --- */
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


/* --- LanePanel.js --- */
/**
 * Lane-configuration UI, injected into the game's settings sidebar as a
 * collapsible "road lanes" section (placed below the driving-metrics section).
 *
 * Mirrors MetricsPanel: the React-rendered settings list mounts/unmounts as the
 * user opens/closes it, so the section is (re)injected via a MutationObserver
 * and matches the native collapsible markup so it looks built-in.
 *
 * `store` is the LaneStore this UI reads from and writes to.
 */

const LP_STYLE_ID = 'pd-lanes-style';
const LP_SECTION_ID = 'pd-lanes-section';
const LP_CONTENT_ID = 'pd-lanes-content';

const LP_CSS = `
#${LP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${LP_SECTION_ID} .collapsible-cross{float:right}
#${LP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${LP_CONTENT_ID}.open{display:block}
#${LP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${LP_CONTENT_ID} .pd-lrow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${LP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${LP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${LP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${LP_CONTENT_ID} .pd-step .val{min-width:42px;text-align:center;color:#eafffb;font-weight:600}
#${LP_CONTENT_ID} .pd-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;
  border-top:1px solid #333;padding-top:10px}
#${LP_CONTENT_ID} .pd-presets button{flex:1 1 auto;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${LP_CONTENT_ID} .pd-presets button:hover{border-color:#3ec6b5}
#${LP_CONTENT_ID} .pd-presets button.apply{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${LP_CONTENT_ID} .pd-presets button.apply:disabled{opacity:.5;cursor:default}
#${LP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${LP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

class LanePanel {
  constructor(store) {
    this.store = store;
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
    if (document.getElementById(LP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = LP_STYLE_ID;
    s.textContent = LP_CSS;
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
    this.header = el('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = LP_SECTION_ID;
    this.title = el('div', 'collapsible-title', 'road lanes');
    this.cross = el('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = el('div');
    this.content.id = LP_CONTENT_ID;

    this.content.appendChild(el('div', 'pd-fam', 'lanes'));
    this.fwdRow = this._stepperRow('Forward (your way)', () => this._adjust('forward', -1), () => this._adjust('forward', 1));
    this.bwdRow = this._stepperRow('Oncoming', () => this._adjust('backward', -1), () => this._adjust('backward', 1));
    this.widthRow = this._stepperRow('Lane width', () => this._adjustWidth(-0.1), () => this._adjustWidth(0.1));
    this.content.append(this.fwdRow.row, this.bwdRow.row, this.widthRow.row);

    const presets = el('div', 'pd-presets');
    for (const p of LANE_PRESETS) {
      const b = el('button', null, p.label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.set(p.cfg);
      });
      presets.appendChild(b);
    }
    this.content.appendChild(presets);

    // Changes apply to the road generated ahead of the car automatically (the
    // engine re-reads the config as it builds new road). This button forces an
    // immediate full rebuild from the start for those who don't want to drive
    // forward to reach the new layout.
    const applyRow = el('div', 'pd-presets');
    this.applyBtn = el('button', 'apply', 'Rebuild from start');
    this.applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._apply();
    });
    applyRow.appendChild(this.applyBtn);
    this.content.appendChild(applyRow);

    this.note = el('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _apply() {
    // Optional immediate full rebuild from the origin. Day-to-day changes already
    // apply to the road ahead without this — set() persists and the engine picks
    // the new layout up as it generates road in front of the car.
    try {
      this.applyBtn.textContent = 'Rebuilding…';
      this.applyBtn.disabled = true;
    } catch (_e) {}
    location.reload();
  }

  _stepperRow(label, onMinus, onPlus) {
    const row = el('div', 'pd-lrow');
    row.appendChild(el('span', null, label));
    const step = el('div', 'pd-step');
    const minus = el('button', null, '−');
    const val = el('span', 'val', '');
    const plus = el('button', null, '+');
    const stop = (fn) => (e) => {
      e.stopPropagation();
      fn();
    };
    minus.addEventListener('click', stop(onMinus));
    plus.addEventListener('click', stop(onPlus));
    step.append(minus, val, plus);
    row.appendChild(step);
    return { row, val };
  }

  _adjust(key, delta) {
    const cfg = this.store.get();
    this.store.set({ [key]: cfg[key] + delta });
  }

  _adjustWidth(delta) {
    const cfg = this.store.get();
    // First press out of "auto" snaps to 3.2, then steps.
    const base = cfg.width == null ? 3.2 : cfg.width;
    const next = Math.round((base + delta) * 10) / 10;
    this.store.set({ width: next });
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
    if (!this.fwdRow) return;
    const cfg = this.store.get();
    this.fwdRow.val.textContent = String(cfg.forward);
    this.bwdRow.val.textContent = String(cfg.backward);
    this.widthRow.val.textContent = cfg.width == null ? 'auto' : cfg.width.toFixed(1) + 'm';
    const total = cfg.forward + cfg.backward;
    let driving = false;
    try {
      driving = typeof window !== 'undefined' && window.LaneRoads && window.LaneRoads._driving;
    } catch (_e) {
      driving = false;
    }
    const liveNote = driving
      ? `While driving you can add or drop <b>one lane per direction</b> at a time; ` +
        `the change tapers in on the road <b>ahead</b> as you reach it. `
      : `Set any layout up to 5 lanes each way before you start. Once driving, ` +
        `changes are limited to ±1 lane at a time and taper in ahead. `;
    this.note.innerHTML =
      `<b>${total}</b> lane${total === 1 ? '' : 's'} total ` +
      `(${cfg.forward} your way, ${cfg.backward} oncoming). ` +
      liveNote +
      `Use <b>Rebuild from start</b> to apply a full layout immediately.`;
  }

  dispose() {
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


/* --- LaneRoads.js --- */
/**
 * Public facade for the dynamic multi-lane road system, exposed as
 * `window.LaneRoads`. The game engine reads `window.LaneRoads.get()` when it
 * generates road nodes and resolves the lane geometry; this module only owns
 * the user's intent, persistence and the settings-panel UI.
 *
 * API:
 *   LaneRoads.get()            -> { forward, backward, width|null }
 *   LaneRoads.set(partial)     -> merges, validates, persists (applied on reload)
 *   LaneRoads.apply()          -> reloads so the engine rebuilds the road at the
 *                                 persisted layout (lane geometry is baked into
 *                                 the road as it generates far ahead of the car,
 *                                 so changes take effect on a rebuild — the same
 *                                 model the game uses for topography/seed)
 *   LaneRoads.subscribe(fn)    -> fn(cfg) on change; returns an unsubscribe fn
 *   LaneRoads.presets          -> [{ id, label, cfg }]
 *   LaneRoads.defaults         -> default config
 *   LaneRoads.resolved()       -> engine-published geometry, or null until set
 *                                 ({ halfWidth, laneWidth, forward, backward, ... })
 */

const store = new LaneStore();
const panel = typeof document !== 'undefined' ? new LanePanel(store) : null;

const LaneRoads = {
  get: () => store.get(),
  set: (partial) => store.set(partial),
  apply: () => {
    if (typeof location !== 'undefined') location.reload();
  },
  subscribe: (fn) => store.subscribe(fn),
  presets: LANE_PRESETS,
  defaults: Object.assign({}, LANE_DEFAULTS),
  limits: LANE_LIMITS,
  // The engine writes its resolved geometry here each time it syncs so tools
  // (and the metrics subsystem) can read the true on-road numbers.
  _resolved: null,
  resolved() {
    return this._resolved ? Object.assign({}, this._resolved) : null;
  },
  // The engine writes the lane layout actually under the car here every frame,
  // plus whether the car has started driving. While `_driving` is true, set()
  // restricts changes to ±1 lane per direction from `_applied` so each change is
  // a single continuous transition; before driving, any layout up to the caps is
  // allowed (initial configuration).
  _applied: null,
  _driving: false,
  applied() {
    return this._applied ? Object.assign({}, this._applied) : null;
  },
  driving() {
    return !!this._driving;
  },
  _panel: panel,
};

if (typeof window !== 'undefined') {
  window.LaneRoads = LaneRoads;
}

})();
