/**
 * Metric registry. Single source of truth for:
 *   - what appears in the configuration panel,
 *   - what gets computed and shown in the overlay,
 *   - what sections the end-of-run report contains.
 *
 * `requiresTraffic: true` metrics are only selectable/computed when the
 * simulation has traffic objects enabled (see DrivingMetrics.setTrafficAvailable).
 */

export const METRIC_FAMILIES = [
  { id: 'lane', label: 'Lane keeping' },
  { id: 'longitudinal', label: 'Speed' },
  { id: 'steering', label: 'Steering control' },
  { id: 'safety', label: 'Safety margin' },
  { id: 'events', label: 'Events' },
  { id: 'interaction', label: 'Interaction (traffic)' },
];

/**
 * dataDeps documents which logged channels a metric needs:
 *   'offset' | 'speed' | 'steer' | 'lane' | 'accel' | 'events' | 'traffic'
 */
export const METRICS = [
  // --- Lane keeping (Phase 1) ---
  {
    id: 'sdlp',
    label: 'SDLP',
    family: 'lane',
    defaultOn: true,
    dataDeps: ['offset'],
    unit: 'm',
    hint: 'Standard deviation of lateral lane position — the gold-standard weaving metric.',
  },
  {
    id: 'meanLP',
    label: 'Mean lateral position',
    family: 'lane',
    defaultOn: true,
    dataDeps: ['offset'],
    unit: 'm',
    hint: 'Systematic bias relative to lane center (signed; 0 = centered in lane).',
  },
  {
    id: 'laneDepartures',
    label: 'Lane departures',
    family: 'lane',
    defaultOn: true,
    dataDeps: ['offset', 'lane'],
    unit: 'count',
    // 0: the lane half-width already encodes the wheel-center's allowable
    // deviation (it derives from Yt - wheels.width/2), so no extra margin.
    params: { vehicleHalfWidthM: 0 },
    hint: 'Count / duration / magnitude of lane-boundary crossings.',
  },

  // --- Speed (Phase 1) ---
  {
    id: 'meanSpeed',
    label: 'Mean speed',
    family: 'longitudinal',
    defaultOn: true,
    dataDeps: ['speed'],
    unit: 'm/s',
    hint: 'Average forward speed over the run.',
  },
  {
    id: 'sds',
    label: 'SDS',
    family: 'longitudinal',
    defaultOn: true,
    dataDeps: ['speed'],
    unit: 'm/s',
    hint: 'Standard deviation of speed — longitudinal control variability.',
  },

  // --- Steering control (Phase 1) ---
  {
    id: 'swrr',
    label: 'Steering reversal rate',
    family: 'steering',
    defaultOn: true,
    dataDeps: ['steer'],
    unit: '/min',
    params: { gapDeg: 3, resampleHz: 10, cutoffHz: 0.6 },
    hint: 'Frequency of corrective steering reversals above a gap threshold.',
  },
  {
    id: 'steeringEntropy',
    label: 'Steering entropy',
    family: 'steering',
    defaultOn: true,
    dataDeps: ['steer'],
    unit: 'bits (norm)',
    params: { resampleHz: 4, baselineSec: 15 },
    hint: 'Unpredictability of steering vs a calm baseline — workload sensitive.',
  },

  // --- Safety margin (Phase 1) ---
  {
    id: 'tlc',
    label: 'Time-to-line-crossing',
    family: 'safety',
    defaultOn: true,
    dataDeps: ['offset', 'lane', 'speed'],
    unit: 's',
    hint: 'Predicted time until the vehicle edge crosses a lane boundary (min & 15th pct).',
  },

  // --- Events (Phase 1) ---
  {
    id: 'collisions',
    label: 'Collisions',
    family: 'events',
    defaultOn: true,
    dataDeps: ['events'],
    unit: 'count',
    hint: 'Collision count and rate per km / per hour.',
  },
  {
    id: 'throttleBrake',
    label: 'Throttle / brake / jerk',
    family: 'events',
    defaultOn: false,
    dataDeps: ['accel'],
    unit: 'misc',
    hint: 'Pedal usage shares and peak longitudinal jerk (workload proxies).',
  },

  // --- Interaction (Phase 2 — traffic only) ---
  {
    id: 'timeHeadway',
    label: 'Time headway / gap',
    family: 'interaction',
    defaultOn: false,
    requiresTraffic: true,
    dataDeps: ['speed', 'traffic'],
    unit: 's',
    hint: 'Following time gap to the lead vehicle (needs traffic).',
  },
  {
    id: 'ttc',
    label: 'Time-to-collision',
    family: 'interaction',
    defaultOn: false,
    requiresTraffic: true,
    dataDeps: ['speed', 'traffic'],
    unit: 's',
    params: { thresholdSec: 3 },
    hint: 'Closing-conflict severity, plus TET/TIT exposure (needs traffic).',
  },
];

export const STORAGE_KEY = 'promptdrive.metrics.selected';

/** Default selection: every defaultOn metric. */
export function defaultSelection() {
  const sel = {};
  for (const m of METRICS) sel[m.id] = !!m.defaultOn;
  return sel;
}

export function loadSelection() {
  const base = defaultSelection();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch (_) {
    /* ignore corrupt/blocked storage */
  }
  return base;
}

export function saveSelection(sel) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
  } catch (_) {
    /* ignore */
  }
}

export function getMetric(id) {
  return METRICS.find((m) => m.id === id);
}

/** Merge any per-metric params overrides with registry defaults. */
export function paramsFor(id, overrides) {
  const m = getMetric(id);
  return Object.assign({}, (m && m.params) || {}, (overrides && overrides[id]) || {});
}
