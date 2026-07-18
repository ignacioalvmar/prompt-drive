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
export const AMBIENT_LIGHT = ['OFF', 'RED', 'GREEN', 'BLUE', 'YELLOW', 'WHITE', 'PINK', 'ORANGE', 'PURPLE', 'CYAN'];
export const FAN_AIRFLOW_DIRECTION = ['FEET', 'HEAD', 'HEAD_FEET', 'WINDSHIELD', 'WINDSHIELD_FEET', 'WINDSHIELD_HEAD', 'WINDSHIELD_HEAD_FEET'];
export const AIR_CIRCULATION = ['AUTO', 'FRESH_AIR', 'RECIRCULATION'];

/**
 * The 31 mutable ContextState fields. `type` is one of
 * int | float | bool | enum | string | list. `def` is the ContextState default.
 * Order matches the Python class so snapshots read in the same order.
 */
export const DYNAMIC_FIELDS = [
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
export const FIXED_DEFAULTS = {
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

export const FIELD_BY_KEY = {};
for (const f of DYNAMIC_FIELDS) FIELD_BY_KEY[f.key] = f;

/** Fresh dynamic state at ContextState defaults. */
export function defaultState() {
  const s = {};
  for (const f of DYNAMIC_FIELDS) s[f.key] = Array.isArray(f.def) ? f.def.slice() : f.def;
  return s;
}

/** Fresh fixed-context store at FixedContext defaults (deep copy). */
export function defaultFixed() {
  return JSON.parse(JSON.stringify(FIXED_DEFAULTS));
}

/**
 * Validate + coerce one dynamic field. Rejects out-of-range / enum-invalid /
 * non-multiple-of-step values (mirrors pydantic's reject, NOT clamp) so
 * read-back verification can't mask an adapter bug.
 * Returns { ok:true, value } or { ok:false, error:'unknown_key'|'bad_value', key }.
 */
export function validateField(key, value) {
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
