/**
 * `window.VehicleState` — a CAR-bench-shaped mirror of the in-cabin vehicle
 * state (car-bench-compat-plan.md §4.2).
 *
 * Python (car-bench) stays authoritative and owns the hashed truth; this store
 * is written through on every tool call and read back for verification. It is
 * deliberately:
 *   - synchronous and rAF-independent, so state ops work in throttled /
 *     background / headless tabs even when rendering stalls;
 *   - engine-agnostic — the linked-field projection (console Comfort, engine
 *     headlights) and the benchmark-mode locks live in link.js (WP3) and attach
 *     through registerProjector() / onBenchmark() / onReset().
 *
 * Events emitted through PromptDriveBridge (resolved lazily — this bundle loads
 * before api.js, so the bridge may not exist yet at module-eval time):
 *   vehicleState      { changed:{k:v}, snapshot }   after every set()
 *   vehicleReset      { snapshot }                   after reset()
 *   vehicleBenchmark  { on }                         after benchmark()
 *   vehicleFixed      { snapshot }                   after fixed.set()
 */

function vsClone(v) {
  return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
}

function vsEq(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

// Snapshot in DYNAMIC_FIELDS order so callers (and the adapter) read a stable shape.
function vsSnapshotState(state) {
  const o = {};
  for (const f of DYNAMIC_FIELDS) {
    o[f.key] = Array.isArray(state[f.key]) ? state[f.key].slice() : state[f.key];
  }
  return o;
}

export const VehicleState = {
  version: '1.0',
  _state: defaultState(),
  _fixed: defaultFixed(),
  _benchmark: false,
  // true only while link.js projects VehicleState → engine; the setHeadlights
  // benchmark guard (WP3) permits engine writes exclusively during this window.
  _applying: false,
  _projectors: [],                       // fn(keys[], snapshot) after set()/reset()
  _benchmarkHandlers: { on: [], off: [] },
  _resetHooks: { pre: [], post: [] },    // fn(initConfig, opts)

  // --- extension seams (link.js / ambience.js, WP3) ---------------------------
  registerProjector(fn) { if (typeof fn === 'function') this._projectors.push(fn); },
  onBenchmark(phase, fn) { if (this._benchmarkHandlers[phase] && typeof fn === 'function') this._benchmarkHandlers[phase].push(fn); },
  onReset(phase, fn) { if (this._resetHooks[phase] && typeof fn === 'function') this._resetHooks[phase].push(fn); },

  /** Run `fn` with `_applying` set, so link.js's engine writes pass the WP3 lock. */
  withApplying(fn) {
    const prev = this._applying;
    this._applying = true;
    try { return fn(); } finally { this._applying = prev; }
  },

  _emit(event, payload) {
    const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
    if (b && typeof b.emit === 'function') {
      try { b.emit(event, payload); } catch (_e) { /* listener errors are their own problem */ }
    }
  },

  _runProjectors(keys) {
    if (!keys || !keys.length || !this._projectors.length) return;
    const snap = this.get();
    for (const fn of this._projectors.slice()) {
      try { fn(keys, snap); } catch (e) { if (typeof console !== 'undefined') console.error('VehicleState projector failed', e); }
    }
  },

  // --- dynamic state ----------------------------------------------------------
  /** Full dynamic snapshot, or a subset when `keys` is an array of field names. */
  get(keys) {
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) if (k in this._state) out[k] = vsClone(this._state[k]);
      return out;
    }
    return vsSnapshotState(this._state);
  },

  /**
   * Apply a partial update. Validation is atomic — a single bad key rejects the
   * whole call (like pydantic), so the mirror never lands half a diff. Stores,
   * projects linked fields, emits `vehicleState`.
   * Returns { ok:true, value:{ changed:[keys] } } or { ok:false, error, key }.
   */
  set(partial) {
    if (partial == null || typeof partial !== 'object') return { ok: false, error: 'bad_value' };
    const keys = Object.keys(partial);
    const validated = {};
    for (const k of keys) {
      const r = validateField(k, partial[k]);
      if (!r.ok) return r;                 // reject atomically, store nothing
      validated[k] = r.value;
    }
    const changed = [];
    const changedMap = {};
    for (const k of keys) {
      if (!vsEq(this._state[k], validated[k])) changed.push(k);
      this._state[k] = validated[k];
      changedMap[k] = vsClone(validated[k]);
    }
    // Project every requested key (idempotent re-assert), not just diffs, so a
    // re-set of an already-true linked field still drives the engine.
    this._runProjectors(keys);
    this._emit('vehicleState', { changed: changedMap, snapshot: this.get() });
    return { ok: true, value: { changed } };
  },

  /**
   * Per-task initialization (car-bench-compat-plan.md §4.6). Applies one flat
   * `initConfig` dict spanning ContextState + FixedContext fields; foreign keys
   * are ignored (mirrors update_state). Order: pre-hooks (ambience) → reset
   * stores → apply config → project all linked fields → post-hooks (benchmark)
   * → emit. Returns the full snapshot for the adapter's t0 parity check.
   */
  reset(initConfig, opts) {
    opts = opts || {};
    for (const fn of this._resetHooks.pre.slice()) {
      try { fn(initConfig, opts); } catch (e) { if (typeof console !== 'undefined') console.error('VehicleState reset pre-hook failed', e); }
    }
    this._state = defaultState();
    this._fixed = defaultFixed();
    if (initConfig && typeof initConfig === 'object') {
      for (const k of Object.keys(initConfig)) {
        if (k in FIELD_BY_KEY) {
          const r = validateField(k, initConfig[k]);
          if (!r.ok) return r;             // a bad value fails the whole reset
          this._state[k] = r.value;
        } else if (k in this._fixed) {
          this._fixed[k] = vsClone(initConfig[k]);
        }
        // else: foreign key — silently ignored
      }
    }
    this._runProjectors(DYNAMIC_FIELDS.map((f) => f.key));
    for (const fn of this._resetHooks.post.slice()) {
      try { fn(initConfig, opts); } catch (e) { if (typeof console !== 'undefined') console.error('VehicleState reset post-hook failed', e); }
    }
    const snap = this.snapshot();
    this._emit('vehicleReset', { snapshot: snap });
    return { ok: true, value: snap };
  },

  /** { dynamic, fixed, benchmark } — the full inspectable state. */
  snapshot() {
    return { dynamic: this.get(), fixed: vsClone(this._fixed), benchmark: this._benchmark };
  },

  /**
   * Engage/release benchmark mode (WP3 installs the actual locks via onBenchmark
   * handlers). Returns { ok:true, value:{ benchmark } }.
   */
  benchmark(on, opts) {
    on = !!on;
    this._benchmark = on;
    const handlers = on ? this._benchmarkHandlers.on : this._benchmarkHandlers.off;
    for (const fn of handlers.slice()) {
      try { fn(opts || {}); } catch (e) { if (typeof console !== 'undefined') console.error('VehicleState benchmark handler failed', e); }
    }
    this._emit('vehicleBenchmark', { on });
    return { ok: true, value: { benchmark: on } };
  },

  isBenchmark() { return this._benchmark; },

  // --- fixed context ----------------------------------------------------------
  fixed: {
    get() { return vsClone(VehicleState._fixed); },
    set(partial) {
      if (partial == null || typeof partial !== 'object') return { ok: false, error: 'bad_value' };
      for (const k of Object.keys(partial)) {
        if (k in VehicleState._fixed) VehicleState._fixed[k] = vsClone(partial[k]);
      }
      VehicleState._emit('vehicleFixed', { snapshot: vsClone(VehicleState._fixed) });
      return { ok: true, value: vsClone(VehicleState._fixed) };
    },
  },
};
