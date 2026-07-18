/* Vehicle state (CAR-bench mirror) — built from src/vehicle/ */
(function () {
/* --- config.js --- */
/**
 * CAR-bench-shaped vehicle-state schema for `window.VehicleState`.
 *
 * Field names, enum strings, ranges and defaults mirror CAR-bench's
 * `ContextState` / `FixedContext` models EXACTLY (see car-bench-compat-plan.md
 * §2.1 / §2.2, source `car_bench/envs/car_voice_assistant/context/`). The
 * benchmark hashes the Python side; this store is the write-through mirror that
 * must not diverge, so keep this table byte-faithful to the Python models.
 */

// Enum value sets, verbatim from dynamic_context_state.py (AmbientLight,
// FanAirflowDirection, AirCirculation). Stored as plain strings, matching
// pydantic's (str, Enum) model_dump() output.
const AMBIENT_LIGHT = ['OFF', 'RED', 'GREEN', 'BLUE', 'YELLOW', 'WHITE', 'PINK', 'ORANGE', 'PURPLE', 'CYAN'];
const FAN_AIRFLOW_DIRECTION = ['FEET', 'HEAD', 'HEAD_FEET', 'WINDSHIELD', 'WINDSHIELD_FEET', 'WINDSHIELD_HEAD', 'WINDSHIELD_HEAD_FEET'];
const AIR_CIRCULATION = ['AUTO', 'FRESH_AIR', 'RECIRCULATION'];

/**
 * The 31 mutable ContextState fields. `type` is one of
 * int | float | bool | enum | string | list. `def` is the ContextState default.
 * Order matches the Python class so snapshots read in the same order.
 */
const DYNAMIC_FIELDS = [
  { key: 'sunroof_position', type: 'int', min: 0, max: 100, def: 0 },
  { key: 'sunshade_position', type: 'int', min: 0, max: 100, def: 0 },
  { key: 'trunk_door_position', type: 'string', def: 'closed' }, // free string; tool writes "OPEN"/"CLOSE"
  { key: 'window_driver_position', type: 'int', min: 0, max: 100, def: 0 },
  { key: 'window_passenger_position', type: 'int', min: 0, max: 100, def: 0 },
  { key: 'window_driver_rear_position', type: 'int', min: 0, max: 100, def: 0 },
  { key: 'window_passenger_rear_position', type: 'int', min: 0, max: 100, def: 0 },
  { key: 'reading_light_driver', type: 'bool', def: false },
  { key: 'reading_light_passenger', type: 'bool', def: false },
  { key: 'reading_light_driver_rear', type: 'bool', def: false },
  { key: 'reading_light_passenger_rear', type: 'bool', def: false },
  { key: 'fog_lights', type: 'bool', def: false },
  { key: 'head_lights_low_beams', type: 'bool', def: false },
  { key: 'head_lights_high_beams', type: 'bool', def: false },
  { key: 'ambient_light', type: 'enum', values: AMBIENT_LIGHT, def: 'OFF' },
  { key: 'climate_temperature_driver', type: 'float', min: 16, max: 28, step: 0.5, def: 20 },
  { key: 'climate_temperature_passenger', type: 'float', min: 16, max: 28, step: 0.5, def: 20 },
  { key: 'steering_wheel_heating', type: 'int', min: 0, max: 3, def: 0 },
  { key: 'seat_heating_driver', type: 'int', min: 0, max: 3, def: 0 },
  { key: 'seat_heating_passenger', type: 'int', min: 0, max: 3, def: 0 },
  { key: 'fan_speed', type: 'int', min: 0, max: 5, def: 0 },
  { key: 'window_front_defrost', type: 'bool', def: false },
  { key: 'window_rear_defrost', type: 'bool', def: false },
  { key: 'fan_airflow_direction', type: 'enum', values: FAN_AIRFLOW_DIRECTION, def: 'FEET' },
  { key: 'air_conditioning', type: 'bool', def: false },
  { key: 'air_circulation', type: 'enum', values: AIR_CIRCULATION, def: 'AUTO' },
  { key: 'navigation_active', type: 'bool', def: false },
  { key: 'waypoints_id', type: 'list', def: [] },
  { key: 'routes_to_final_destination_id', type: 'list', def: [] },
  { key: 'email_addresses_sent_mail_to', type: 'list', def: [] },
  { key: 'phone_numbers_called', type: 'list', def: [] },
];

// FixedContext defaults, verbatim from fixed_context.py (incl. the upstream
// misspelling `soc_tresholds`). Stored for inspection + ambience; never hashed.
const FIXED_DEFAULTS = {
  car_color: 'blue',
  battery_capacity_kwh: 80,
  useable_battery_percentage: 95,
  max_charging_power_ac: 11,
  max_charging_power_dc: 250,
  energy_consumption: 15,
  charging_curve_parameters: {
    soc_tresholds: [5, 10, 20, 50, 70, 80, 90, 95, 100],
    power_percentages: [60, 90, 100, 100, 100, 90, 70, 40, 20],
  },
  state_of_charge: 10,
  seats_occupied: { driver: true, passenger: false, driver_rear: false, passenger_rear: false },
  current_location: { id: 'loc_mun_9995', name: 'Munich', position: { longitude: 11.575, latitude: 48.1375 } },
  current_datetime: { year: 2025, month: 2, day: 14, hour: 12, minute: 0 },
  user_preferences: {
    points_of_interest: { airports: [], bakery: [], fast_food: [], parking: [], public_toilets: [], restaurants: [], supermarkets: [], charging_stations: [] },
    navigation_and_routing: { route_selection: [] },
    vehicle_settings: { climate_control: [], vehicle_settings: [] },
    productivity_and_communication: { email: [], calendar: [] },
    weather: { weather: [] },
  },
};
const FIELD_BY_KEY = {};
for (const f of DYNAMIC_FIELDS) FIELD_BY_KEY[f.key] = f;

/** Fresh dynamic state at ContextState defaults. */
function defaultState() {
  const s = {};
  for (const f of DYNAMIC_FIELDS) s[f.key] = Array.isArray(f.def) ? f.def.slice() : f.def;
  return s;
}

/** Fresh fixed-context store at FixedContext defaults (deep copy). */
function defaultFixed() {
  return JSON.parse(JSON.stringify(FIXED_DEFAULTS));
}

/**
 * Validate + coerce one dynamic field. Rejects out-of-range / enum-invalid /
 * non-multiple-of-step values (mirrors pydantic's reject, NOT clamp) so
 * read-back verification can't mask an adapter bug.
 * Returns { ok:true, value } or { ok:false, error:'unknown_key'|'bad_value', key }.
 */
function validateField(key, value) {
  const f = FIELD_BY_KEY[key];
  if (!f) return { ok: false, error: 'unknown_key', key };
  switch (f.type) {
    case 'bool':
      return { ok: true, value: !!value };
    case 'string':
      return { ok: true, value: String(value) };
    case 'int': {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'bad_value', key };
      if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) return { ok: false, error: 'bad_value', key };
      return { ok: true, value: n };
    }
    case 'float': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'bad_value', key };
      if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) return { ok: false, error: 'bad_value', key };
      if (f.step != null && Math.abs(n / f.step - Math.round(n / f.step)) > 1e-9) return { ok: false, error: 'bad_value', key };
      return { ok: true, value: n };
    }
    case 'enum':
      if (!f.values.includes(value)) return { ok: false, error: 'bad_value', key, values: f.values };
      return { ok: true, value };
    case 'list':
      if (!Array.isArray(value)) return { ok: false, error: 'bad_value', key };
      return { ok: true, value: value.map((x) => String(x)) };
    default:
      return { ok: false, error: 'bad_value', key };
  }
}


/* --- VehicleState.js --- */
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
const VehicleState = {
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


/* --- link.js --- */
/**
 * Engine linkage + benchmark-mode locks for VehicleState (WP3,
 * car-bench-compat-plan.md §4.5 / §4.6). Runs inside the vehicle bundle after
 * VehicleState is defined, so it references the `VehicleState` const directly;
 * engine handles + the facade are reached lazily at runtime (this bundle loads
 * before api.js).
 *
 * Projects the baseline "linked" fields onto real visuals:
 *   head_lights_low_beams                    -> engine ego.setHeadlights (manual)
 *   climate_temperature_driver/_passenger    -> console Comfort per-zone tempC
 *   seat_heating_driver/_passenger           -> console Comfort per-zone seatHeat
 *   fan_speed                                -> console Comfort fan (all 3 zones)
 *
 * Benchmark mode makes "the system never autonomously changes state" literal:
 *   1 headlight hard lock (engine patch reads VehicleState._benchmark/_applying)
 *   2 day/night cycle frozen
 *   3 capture-phase keyboard filter (default KeyH)
 *   4 console input lock (screen taps swallowed, not routed)
 *   5 menu lockdown (ui.hideMenu)
 * Every blocked external attempt emits `vehicleExternalAttempt`.
 */
(function () {
  if (typeof VehicleState === 'undefined') return;

  const COMFORT_KEYS = [
    'climate_temperature_driver', 'climate_temperature_passenger',
    'seat_heating_driver', 'seat_heating_passenger', 'fan_speed',
  ];

  function bridge() { return (typeof window !== 'undefined') ? window.PromptDriveBridge : null; }
  function pd() { return (typeof window !== 'undefined') ? window.PromptDrive : null; }

  function egoHandle() {
    const b = bridge();
    return (b && b.handles && b.handles.ego) || null;
  }

  function consoleInst() {
    const b = bridge();
    const h = b && b.handles;
    if (h && h.centerConsole) return h.centerConsole;
    const C = (typeof window !== 'undefined') ? window.CenterConsole : null;
    return (C && C.lastInstance) || null;
  }

  function comfortCtl() {
    const inst = consoleInst();
    if (inst && inst.apps && inst.apps.comfort && inst.apps.comfort.controller) return inst.apps.comfort.controller;
    return null;
  }

  function emitAttempt(source, extra) {
    const b = bridge();
    if (b) { try { b.emit('vehicleExternalAttempt', Object.assign({ source }, extra || {})); } catch (_e) {} }
  }

  // --- projection (linked fields -> engine/console) ---------------------------
  function project(keys, snap) {
    if (keys.indexOf('head_lights_low_beams') >= 0) {
      const ego = egoHandle();
      if (ego && typeof ego.setHeadlights === 'function') {
        // withApplying opens the benchmark headlight lock for our own write.
        VehicleState.withApplying(() => { try { ego.setHeadlights(!!snap.head_lights_low_beams, true); } catch (_e) {} });
      }
    }
    if (keys.some((k) => COMFORT_KEYS.indexOf(k) >= 0)) {
      const cf = comfortCtl();
      if (cf) {
        const fan = snap.fan_speed;
        try {
          cf.set({
            driver: { tempC: snap.climate_temperature_driver, fan: fan, seatHeat: snap.seat_heating_driver },
            passenger: { tempC: snap.climate_temperature_passenger, fan: fan, seatHeat: snap.seat_heating_passenger },
            rear: { fan: fan },
          });
        } catch (_e) { /* controller validates; ignore transient rejects */ }
      }
    }
  }
  VehicleState.registerProjector(project);

  // --- lock 2: day/night freeze ----------------------------------------------
  let _dayNightFrozen = false;
  let _prevCycle = null;
  function freezeDayNight() {
    if (_dayNightFrozen) return;
    const api = pd();
    if (!api) return;
    try {
      _prevCycle = api.get ? api.get('scene.dayNightCycle') : null;
      if (api.dynamic && api.dynamic.cycle) api.dynamic.cycle(0);
      _dayNightFrozen = true;
    } catch (_e) {}
  }
  function restoreDayNight() {
    if (!_dayNightFrozen) return;
    const api = pd();
    try {
      if (api && api.dynamic && api.dynamic.cycle && _prevCycle != null) api.dynamic.cycle(_prevCycle);
    } catch (_e) {}
    _dayNightFrozen = false;
    _prevCycle = null;
  }

  // --- lock 3: keyboard filter -----------------------------------------------
  let _keyFilter = null;
  function installKeyFilter(codes) {
    removeKeyFilter();
    const set = new Set(codes && codes.length ? codes : ['KeyH']);
    _keyFilter = (e) => {
      if (set.has(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === 'keydown') emitAttempt('keyboard', { code: e.code });
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', _keyFilter, true);
      window.addEventListener('keyup', _keyFilter, true);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', _keyFilter, true);
      document.addEventListener('keyup', _keyFilter, true);
    }
  }
  function removeKeyFilter() {
    if (!_keyFilter) return;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', _keyFilter, true);
      window.removeEventListener('keyup', _keyFilter, true);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', _keyFilter, true);
      document.removeEventListener('keyup', _keyFilter, true);
    }
    _keyFilter = null;
  }

  // --- lock 4/5: console input lock + menu lockdown ---------------------------
  function setConsoleLock(locked) {
    const inst = consoleInst();
    if (inst && typeof inst.setInputLocked === 'function') { try { inst.setInputLocked(locked); } catch (_e) {} }
  }
  function setHideMenu(on) {
    const api = pd();
    try { if (api && api.dynamic && api.dynamic.hideMenu) api.dynamic.hideMenu(on); } catch (_e) {}
  }

  // --- benchmark on/off -------------------------------------------------------
  VehicleState.onBenchmark('on', (opts) => {
    freezeDayNight();
    installKeyFilter(opts && opts.blockKeys);
    setConsoleLock(true);
    setHideMenu(true);
  });
  VehicleState.onBenchmark('off', () => {
    restoreDayNight();
    removeKeyFilter();
    setConsoleLock(false);
    setHideMenu(false);
  });

  // --- reset: freeze comfort extras + (re)assert benchmark --------------------
  VehicleState.onReset('post', (initConfig, opts) => {
    const cf = comfortCtl();
    if (cf) {
      const snap = VehicleState.get();
      // Comfort UI extras have no car-bench counterpart: freeze them so they
      // can't imply autonomous behavior. Rear zone mirrors the driver temp for
      // cosmetic coherence; sync/auto off so sync's driver-copy can't fight the
      // per-zone temps.
      try { cf.set({ auto: false, sync: false, rear: { tempC: snap.climate_temperature_driver, fan: snap.fan_speed, seatHeat: 0 } }); } catch (_e) {}
    }
    if (!opts || opts.benchmark !== false) VehicleState.benchmark(true, opts || {});
  });
})();


/* --- ambience.js --- */
/**
 * Optional ambience sync for VehicleState (WP3, car-bench-compat-plan.md §4.7 /
 * Appendix B). Maps a task's time-of-day + weather condition onto a sim weather
 * preset — pure visual flavor with zero eval impact. Python resolves the weather
 * condition string for the current location and passes it in; the sim only
 * chooses a preset by name-substring against the active skin's weather list.
 *
 * Installs VehicleState.ambience(spec) and a reset pre-hook (so the preset lands
 * before reset projects the linked fields — the weather system's forced
 * headlight write is then overridden by the headlight projection under the lock).
 */
(function () {
  if (typeof VehicleState === 'undefined') return;

  function pd() { return (typeof window !== 'undefined') ? window.PromptDrive : null; }

  // hour + condition -> a preset intent (substring to match against skin weathers)
  function pickPreset(hour, condition) {
    let slot = 'clear';
    if (hour != null) {
      const h = Number(hour);
      if (h >= 5 && h < 8) slot = 'sunrise';
      else if (h >= 8 && h < 17) slot = 'clear';
      else if (h >= 17 && h < 20) slot = 'sunset';
      else slot = 'night';
    }
    let want = slot;
    if (slot !== 'night' && condition) { // night wins over condition
      const c = String(condition).toLowerCase();
      if (/rain|thunderstorm|hail/.test(c)) want = 'rain';
      else if (/snow/.test(c)) want = 'snow';
      else if (/fog/.test(c)) want = 'rain'; // closest wet/dim preset
    }
    return want;
  }

  function applyAmbience(spec) {
    spec = spec || {};
    const api = pd();
    if (!api) return { ok: false, error: 'unavailable' };
    try {
      const want = pickPreset(spec.hour, spec.condition);
      const list = (typeof api.weathers === 'function') ? api.weathers() : [];
      let match = null;
      for (const w of list) {
        if (String(w.name).toLowerCase().indexOf(want) >= 0) { match = w; break; }
      }
      if (!match && want === 'sunset') { // sunset also satisfied by 'twilight'
        for (const w of list) { if (/twilight/i.test(w.name)) { match = w; break; } }
      }
      const target = match ? match.name : (list[1] ? list[1].name : null);
      if (target != null && api.dynamic && api.dynamic.weather) api.dynamic.weather(target);
      return { ok: true, value: { requested: want, applied: target } };
    } catch (e) {
      return { ok: false, error: 'exception', message: String((e && e.message) || e) };
    }
  }

  VehicleState.ambience = function (spec) { return applyAmbience(spec); };

  // Reset pre-hook: read datetime from the incoming initConfig (the fixed store
  // isn't populated yet at this point) and the condition from opts.
  VehicleState.onReset('pre', (initConfig, opts) => {
    if (!opts || opts.ambience === false) return;
    const dt = (initConfig && initConfig.current_datetime) || null;
    applyAmbience({ hour: dt ? dt.hour : null, condition: opts.ambienceCondition || null });
  });
})();

  if (typeof window !== 'undefined') {
    window.VehicleState = VehicleState;
  }
})();
