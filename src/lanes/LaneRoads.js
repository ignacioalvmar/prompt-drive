/**
 * Public facade for the dynamic multi-lane road system, exposed as
 * `window.LaneRoads`. The game engine reads `window.LaneRoads.get()` when it
 * generates road nodes and resolves the lane geometry; this module only owns
 * the user's intent, persistence and the settings-panel UI.
 *
 * API:
 *   LaneRoads.get()            -> { forward, backward, width|null }
 *   LaneRoads.set(partial)     -> merges, validates, persists, applies ahead
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
  _panel: panel,
};

if (typeof window !== 'undefined') {
  window.LaneRoads = LaneRoads;
}
