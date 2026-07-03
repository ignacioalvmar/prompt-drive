/**
 * Engine-handle registry + event bus for the Prompt Drive API.
 *
 * The facade (PromptDriveApi.js) needs live references to the engine's
 * module-scoped singletons (vehicle config, autodrive, units, scene/world
 * manager, day-night, speed control, the ego vehicle, the scene config, the
 * active controller and THREE). Those are not on `window`, so `build-main.js`
 * injects one call at controller init:
 *
 *     PromptDriveBridge.attach({ vehicleConfig, sceneConfig, autodrive, units,
 *       world, dayNight, speedControl, ego, input, controller, THREE,
 *       drivingMetrics });
 *
 * and emits engine events through `PromptDriveBridge.emit(event, payload)`.
 *
 * Mirrors how `window.LaneRoads._resolved/_applied` is written back by the
 * engine — the bridge is the seam, the facade is the public surface.
 */

const Bridge = {
  // Live engine handles, filled by build-main.js. Null until attach().
  handles: null,
  attached: false,
  paused: false,

  /** Freeze the simulation loop — vehicle stops, telemetry pauses. */
  pause() {
    if (!this.handles) return;
    try {
      if (this.handles.ticker && typeof this.handles.ticker.pause === 'function') {
        this.handles.ticker.pause(true);
      }
    } catch (e) { console.error('PromptDrive pause failed', e); }
    this.paused = true;
    this.emit('paused', { source: 'bridge' });
  },

  /** Resume the simulation loop after a pause. */
  resume() {
    if (!this.handles) return;
    try {
      if (this.handles.ticker && typeof this.handles.ticker.pause === 'function') {
        this.handles.ticker.pause(false);
      }
    } catch (e) { console.error('PromptDrive resume failed', e); }
    this.paused = false;
    this.emit('resumed', { source: 'bridge' });
  },

  _onAttach: [],
  _listeners: { any: [] }, // event name -> [fn]; 'any' -> [fn(event,payload)]

  /** Called once by the patched engine when the controller initialises. */
  attach(handles) {
    this.handles = handles || {};
    this.attached = true;
    const cbs = this._onAttach.slice();
    this._onAttach.length = 0;
    for (const cb of cbs) {
      try { cb(this.handles); } catch (e) { console.error('PromptDrive attach cb failed', e); }
    }
    this.emit('ready', { version: '1.0' });
  },

  /** Run `fn(handles)` once handles are attached (immediately if already). */
  whenAttached(fn) {
    if (this.attached) { try { fn(this.handles); } catch (e) { console.error(e); } return; }
    this._onAttach.push(fn);
  },

  // --- event bus ---------------------------------------------------------
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    const arr = this._listeners[event];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },

  emit(event, payload) {
    const direct = this._listeners[event] || [];
    for (const fn of direct.slice()) {
      try { fn(payload, event); } catch (e) { console.error('PromptDrive listener failed', e); }
    }
    for (const fn of this._listeners.any.slice()) {
      try { fn(event, payload); } catch (e) { console.error('PromptDrive listener failed', e); }
    }
  },
};

// Expose the bridge so build-main.js (which runs in the page after this bundle
// loads) can reach it without the facade having to be ready first.
if (typeof window !== 'undefined') {
  window.PromptDriveBridge = Bridge;
}
