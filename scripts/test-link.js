/**
 * Node test for the WP3 linkage + benchmark logic (src/vehicle/link.js +
 * ambience.js), exercised through the built static/js/vehicle.js with mocked
 * engine handles / console / facade. Covers projection, benchmark locks, the
 * keyboard filter, reset ordering and ambience mapping. The engine setHeadlights
 * patch (main bundle) and the console pointer-swallow are verified in-browser.
 *
 * Run: node scripts/test-link.js   (exit 0 = pass)
 */
const fs = require('fs');
const path = require('path');

// Minimal capture-capable event target (honors stopImmediatePropagation).
function makeTarget() {
  const caps = {};
  return {
    addEventListener(t, fn) { (caps[t] = caps[t] || []).push(fn); },
    removeEventListener(t, fn) { const a = caps[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    _fire(t, ev) {
      ev.type = t; let stop = false;
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      ev.stopImmediatePropagation = () => { stop = true; };
      ev.stopPropagation = () => {};
      for (const fn of (caps[t] || []).slice()) { fn(ev); if (stop) break; }
      return ev;
    },
    _count(t) { return (caps[t] || []).length; },
  };
}

const listeners = { any: [] };
const bridge = {
  handles: null,
  on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); return () => {}; },
  emit(e, p) { (listeners[e] || []).slice().forEach((fn) => fn(p, e)); listeners.any.slice().forEach((fn) => fn(e, p)); },
};
const ego = { _on: null, _manual: null, setHeadlights(on, manual) { this._on = on; this._manual = manual; } };
const comfort = { _sets: [], set(p) { this._sets.push(p); return {}; } };
const consoleInst = { apps: { comfort: { controller: comfort } }, _locked: null, setInputLocked(v) { this._locked = v; } };
bridge.handles = { ego, centerConsole: consoleInst };
const dyn = { _cycle: [], _weather: [], _hide: [], cycle(v) { this._cycle.push(v); }, weather(n) { this._weather.push(n); }, hideMenu(v) { this._hide.push(v); } };
const promptDrive = {
  get(p) { return p === 'scene.dayNightCycle' ? 2 : null; },
  dynamic: dyn,
  weathers() { return [{ index: 0, name: 'sunrise' }, { index: 1, name: 'clear' }, { index: 2, name: 'rain' }, { index: 3, name: 'sunset' }, { index: 4, name: 'night' }]; },
};

const win = makeTarget();
win.PromptDriveBridge = bridge;
win.PromptDrive = promptDrive;
win.CenterConsole = { lastInstance: consoleInst };
global.window = win;
global.document = makeTarget();

(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'static/js/vehicle.js'), 'utf8'));
const VS = global.window.VehicleState;

let failures = 0;
function check(name, cond) { if (!cond) { failures++; console.error('  FAIL:', name); } else console.log('  ok  :', name); }

const attempts = [];
bridge.on('vehicleExternalAttempt', (p) => attempts.push(p));

// --- projection: headlights ---------------------------------------------------
VS.set({ head_lights_low_beams: true });
check('headlights projected to ego (true, manual)', ego._on === true && ego._manual === true);
VS.set({ head_lights_low_beams: false });
check('headlights projected off', ego._on === false);

// --- projection: comfort (temps/seat/fan to 3 zones) --------------------------
VS.set({ climate_temperature_driver: 22.5, climate_temperature_passenger: 19, seat_heating_driver: 2, fan_speed: 4 });
const last = comfort._sets[comfort._sets.length - 1];
check('comfort driver temp/seat/fan projected', last.driver.tempC === 22.5 && last.driver.seatHeat === 2 && last.driver.fan === 4);
check('comfort passenger temp/fan projected', last.passenger.tempC === 19 && last.passenger.fan === 4);
check('comfort rear fan projected (single fan -> all zones)', last.rear.fan === 4);

// --- benchmark on: locks engaged ---------------------------------------------
VS.benchmark(true);
check('benchmark froze day/night to 0', dyn._cycle[dyn._cycle.length - 1] === 0);
check('benchmark locked console input', consoleInst._locked === true);
check('benchmark hid menu', dyn._hide[dyn._hide.length - 1] === true);
check('keyboard filter installed on window', win._count('keydown') === 1);

// --- keyboard filter swallows KeyH, emits attempt -----------------------------
const before = attempts.length;
const ev = win._fire('keydown', { code: 'KeyH' });
check('KeyH default-prevented (swallowed)', ev.defaultPrevented === true);
check('KeyH emitted vehicleExternalAttempt(keyboard)', attempts.length === before + 1 && attempts[attempts.length - 1].source === 'keyboard');
const ev2 = win._fire('keydown', { code: 'KeyW' });
check('non-blocked key passes through', ev2.defaultPrevented !== true);

// --- benchmark off: restore ---------------------------------------------------
VS.benchmark(false);
check('benchmark restored day/night to prev (2)', dyn._cycle[dyn._cycle.length - 1] === 2);
check('benchmark unlocked console', consoleInst._locked === false);
check('benchmark unhid menu', dyn._hide[dyn._hide.length - 1] === false);
check('keyboard filter removed', win._count('keydown') === 0);

// --- set still works while benchmark-locked (the _applying path) --------------
VS.benchmark(true);
ego._on = null;
VS.set({ head_lights_low_beams: true });
check('vehicle.set projects headlights even while locked', ego._on === true);
VS.benchmark(false);

// --- reset: applies config, projects, freezes comfort extras, re-asserts bench --
const rr = VS.reset({
  head_lights_low_beams: true, climate_temperature_driver: 24, fan_speed: 3,
  current_datetime: { year: 2025, month: 2, day: 14, hour: 22, minute: 0 },
}, { ambienceCondition: 'sunny' });
check('reset ok + snapshot', rr.ok === true && rr.value.dynamic.climate_temperature_driver === 24);
check('reset projected headlights', ego._on === true);
const cLast = comfort._sets[comfort._sets.length - 1];
check('reset froze comfort extras (auto/sync off, rear seatHeat 0)', cLast.auto === false && cLast.sync === false && cLast.rear.seatHeat === 0);
check('reset re-asserted benchmark (console locked)', consoleInst._locked === true);
check('reset ambience: hour 22 -> night preset', dyn._weather[dyn._weather.length - 1] === 'night');
VS.benchmark(false);

// --- ambience mapping ---------------------------------------------------------
VS.ambience({ hour: 12, condition: 'cloudy_and_rain' });
check('ambience rain condition -> rain', dyn._weather[dyn._weather.length - 1] === 'rain');
VS.ambience({ hour: 6, condition: 'sunny' });
check('ambience hour 6 -> sunrise', dyn._weather[dyn._weather.length - 1] === 'sunrise');
VS.ambience({ hour: 12, condition: 'sunny' });
check('ambience clear day -> clear', dyn._weather[dyn._weather.length - 1] === 'clear');
VS.ambience({ hour: 23, condition: 'cloudy_and_rain' });
check('ambience night wins over condition', dyn._weather[dyn._weather.length - 1] === 'night');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
