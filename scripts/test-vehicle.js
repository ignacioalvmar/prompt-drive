/**
 * Node acceptance test for window.VehicleState (WP1). Evaluates the built
 * static/js/vehicle.js in a minimal `window` shim (proving it works
 * engine-detached), then checks default/get/set/reset/validation parity against
 * the CAR-bench ContextState field table (car-bench-compat-plan.md §2.1).
 *
 * Run: node scripts/test-vehicle.js   (exit 0 = pass)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'static/js/vehicle.js'), 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(bundle, sandbox);
const VS = sandbox.window.VehicleState;

let failures = 0;
function check(name, cond) {
  if (!cond) { failures++; console.error('  FAIL:', name); }
  else console.log('  ok  :', name);
}

// --- defaults ---------------------------------------------------------------
const d = VS.get();
check('31 dynamic fields', Object.keys(d).length === 31);
check('sunroof_position default 0', d.sunroof_position === 0);
check('trunk default "closed"', d.trunk_door_position === 'closed');
check('ambient_light default OFF', d.ambient_light === 'OFF');
check('climate driver default 20', d.climate_temperature_driver === 20);
check('fan_airflow default FEET', d.fan_airflow_direction === 'FEET');
check('air_circulation default AUTO', d.air_circulation === 'AUTO');
check('waypoints_id default []', Array.isArray(d.waypoints_id) && d.waypoints_id.length === 0);

// --- valid sets -------------------------------------------------------------
check('set fan_speed 3 ok', VS.set({ fan_speed: 3 }).ok === true && VS.get().fan_speed === 3);
check('set temp 21.5 ok', VS.set({ climate_temperature_driver: 21.5 }).ok === true);
check('set ambient YELLOW ok', VS.set({ ambient_light: 'YELLOW' }).ok === true);
check('set trunk "OPEN" verbatim', VS.set({ trunk_door_position: 'OPEN' }).ok === true && VS.get().trunk_door_position === 'OPEN');
check('set waypoints list ok', VS.set({ waypoints_id: ['loc_a', 'loc_b'] }).ok === true && VS.get().waypoints_id.length === 2);

// --- rejections (mirror pydantic ge/le/multiple_of/enum) --------------------
check('reject sunroof -1', VS.set({ sunroof_position: -1 }).ok === false);
check('reject sunroof 101', VS.set({ sunroof_position: 101 }).ok === false);
check('reject fan_speed 6', VS.set({ fan_speed: 6 }).ok === false);
check('reject seat_heating 4', VS.set({ seat_heating_driver: 4 }).ok === false);
check('reject temp 15.5 (below min)', VS.set({ climate_temperature_driver: 15.5 }).ok === false);
check('reject temp 21.3 (not 0.5 step)', VS.set({ climate_temperature_driver: 21.3 }).ok === false);
check('reject ambient PLAID', VS.set({ ambient_light: 'PLAID' }).ok === false);
check('reject airflow SIDEWAYS', VS.set({ fan_airflow_direction: 'SIDEWAYS' }).ok === false);
check('reject unknown key', VS.set({ not_a_field: 1 }).ok === false);
check('atomic: bad key rolls back the whole set', (() => {
  const before = VS.get().fan_speed;
  const r = VS.set({ fan_speed: 5, sunroof_position: 999 });
  return r.ok === false && VS.get().fan_speed === before; // fan_speed not applied
})());

// --- reset (flat dict spanning ContextState + FixedContext, foreign keys ignored) ---
const rr = VS.reset({
  fan_speed: 4,
  climate_temperature_driver: 22.5,
  head_lights_low_beams: true,
  ambient_light: 'BLUE',
  // fixed:
  state_of_charge: 55,
  car_color: 'GREEN',
  // foreign / ignored:
  calendar_id: 'cal_2834',
});
check('reset ok', rr.ok === true);
check('reset applied dynamic', VS.get().fan_speed === 4 && VS.get().climate_temperature_driver === 22.5);
check('reset cleared unspecified to default', VS.get().sunroof_position === 0);
check('reset applied fixed', VS.fixed.get().state_of_charge === 55 && VS.fixed.get().car_color === 'GREEN');
check('reset snapshot shape', rr.value.dynamic && rr.value.fixed && 'benchmark' in rr.value);

// --- fixed defaults incl. upstream misspelling ------------------------------
VS.reset({});
const fx = VS.fixed.get();
check('fixed battery default 80', fx.battery_capacity_kwh === 80);
check('fixed soc_tresholds (sic) present', Array.isArray(fx.charging_curve_parameters.soc_tresholds));
check('fixed seats_occupied driver true', fx.seats_occupied.driver === true);
check('fixed current_location Munich', fx.current_location.id === 'loc_mun_9995');

// --- benchmark flag ---------------------------------------------------------
check('benchmark on', VS.benchmark(true).ok === true && VS.isBenchmark() === true);
check('benchmark off', VS.benchmark(false).ok === true && VS.isBenchmark() === false);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
