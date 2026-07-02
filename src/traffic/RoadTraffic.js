/**
 * Public facade for AI traffic road actors, exposed as `window.RoadTraffic`.
 * The game engine hands it live handles once the world exists and ticks it
 * every rendered frame; this module owns the researcher's intent (config +
 * persistence + settings UI) and the traffic manager owns all actor state.
 *
 * API:
 *   RoadTraffic.get()             -> { enabled, density, speed, oncoming, seed }
 *   RoadTraffic.set(partial)      -> merges, validates, persists (static: takes
 *                                    effect for vehicles spawned from now on;
 *                                    enabling traffic needs a reload so the
 *                                    ego line is lane-centred from the start)
 *   RoadTraffic.spawnStopped(o)   -> dynamic event: stationary vehicle o.distance
 *                                    metres ahead in lane o.lane (plan §8)
 *   RoadTraffic.clear()           -> remove all traffic vehicles
 *   RoadTraffic.state()           -> live actor list (id, lane, mode, speed)
 *   RoadTraffic.subscribe(fn)     -> fn(cfg) on config change; returns unsubscribe
 *   RoadTraffic.defaults/limits/colors
 *
 * Engine-facing seam (called by the patched main bundle, not by users):
 *   RoadTraffic._engineAttach(handles)   once, when the world is live
 *   RoadTraffic._engineUpdate(dt)        every rendered frame
 */

const trafficStore = new TrafficStore();
const trafficManager = new TrafficManager(trafficStore);
const trafficPanel =
  typeof document !== 'undefined' && typeof TrafficPanel !== 'undefined'
    ? new TrafficPanel(trafficStore, () => RoadTraffic)
    : null;

const RoadTraffic = {
  get: () => trafficStore.get(),
  set: (partial) => trafficStore.set(partial),
  subscribe: (fn) => trafficStore.subscribe(fn),
  defaults: Object.assign({}, TRAFFIC_DEFAULTS),
  limits: TRAFFIC_LIMITS,
  colors: TRAFFIC_COLORS.slice(),
  tuning: TRAFFIC_TUNING,

  spawnStopped: (opts) => trafficManager.spawnStopped(opts),
  clear: () => trafficManager.clear(),
  state: () => trafficManager.state(),

  // --- engine seam ---
  _engineAttached: false,
  _engineAttach(handles) {
    trafficManager.attach(handles);
    this._engineAttached = true;
  },
  _engineUpdate(dt) {
    trafficManager.update(dt);
  },
  _manager: trafficManager,
  _panel: trafficPanel,
};

if (typeof window !== 'undefined') {
  window.RoadTraffic = RoadTraffic;
}
