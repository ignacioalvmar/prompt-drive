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
