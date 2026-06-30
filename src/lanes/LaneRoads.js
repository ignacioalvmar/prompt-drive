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
