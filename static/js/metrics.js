/* Driving performance metrics — built from src/metrics/ */
(function () {
/* --- config.js --- */
/**
 * Metric registry. Single source of truth for:
 *   - what appears in the configuration panel,
 *   - what gets computed and shown in the overlay,
 *   - what sections the end-of-run report contains.
 *
 * `requiresTraffic: true` metrics are only selectable/computed when the
 * simulation has traffic objects enabled (see DrivingMetrics.setTrafficAvailable).
 */
const METRIC_FAMILIES = [
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
const METRICS = [
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
const STORAGE_KEY = 'promptdrive.metrics.selected';

/** Default selection: every defaultOn metric. */
function defaultSelection() {
  const sel = {};
  for (const m of METRICS) sel[m.id] = !!m.defaultOn;
  return sel;
}
function loadSelection() {
  const base = defaultSelection();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch (_) {
    /* ignore corrupt/blocked storage */
  }
  return base;
}
function saveSelection(sel) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
  } catch (_) {
    /* ignore */
  }
}
function getMetric(id) {
  return METRICS.find((m) => m.id === id);
}

/** Merge any per-metric params overrides with registry defaults. */
function paramsFor(id, overrides) {
  const m = getMetric(id);
  return Object.assign({}, (m && m.params) || {}, (overrides && overrides[id]) || {});
}


/* --- metrics-math.js --- */
/**
 * Pure, dependency-free math for driving-performance metrics.
 *
 * Every function takes plain arrays/numbers so it runs identically in the
 * browser bundle and in Node unit tests. No THREE, no DOM, no globals.
 *
 * Formulas are ported from the two research reports in the repo root
 * (driving_performance_metrics-report.md and
 *  "Driving Simulator Performance Metrics.md").
 */

// ---------------------------------------------------------------------------
// Basic statistics
// ---------------------------------------------------------------------------
function finiteValues(xs) {
  return xs.filter(Number.isFinite);
}
function mean(xs) {
  const ys = finiteValues(xs);
  if (!ys.length) return NaN;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

/** Unbiased (N-1) sample standard deviation. Used for SDLP and SDS. */
function sampleSD(xs) {
  const ys = finiteValues(xs);
  if (ys.length < 2) return NaN;
  const m = mean(ys);
  const ss = ys.reduce((s, x) => s + (x - m) ** 2, 0);
  return Math.sqrt(ss / (ys.length - 1));
}
function median(xs) {
  const ys = finiteValues(xs).sort((a, b) => a - b);
  if (!ys.length) return NaN;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 ? ys[mid] : 0.5 * (ys[mid - 1] + ys[mid]);
}

/** Linear-interpolated percentile (p in [0,100]). */
function percentile(xs, p) {
  const ys = finiteValues(xs).sort((a, b) => a - b);
  if (!ys.length) return NaN;
  if (ys.length === 1) return ys[0];
  const rank = (p / 100) * (ys.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return ys[lo];
  return ys[lo] + (ys[hi] - ys[lo]) * (rank - lo);
}
function meanAbs(xs) {
  return mean(xs.map((v) => (Number.isFinite(v) ? Math.abs(v) : NaN)));
}

// ---------------------------------------------------------------------------
// Resampling — the engine runs on a variable RAF dt, so frequency-dependent
// metrics (SWRR Butterworth, steering entropy) must be resampled to a uniform
// rate before processing. (See Report 1 §Scope; Report 2 §Frame Decoupling.)
// ---------------------------------------------------------------------------

/**
 * Resample an irregular time series to a uniform rate via linear interpolation.
 * @param {number[]} t   monotonic timestamps (seconds)
 * @param {number[]} x   values aligned with t
 * @param {number} hz    target sample rate
 * @returns {{t:number[], x:number[], fs:number}}
 */
function resampleUniform(t, x, hz) {
  const out = { t: [], x: [], fs: hz };
  const n = Math.min(t.length, x.length);
  if (n < 2 || !(hz > 0)) return out;
  const step = 1 / hz;
  const t0 = t[0];
  const tEnd = t[n - 1];
  let j = 0;
  for (let tk = t0; tk <= tEnd + 1e-9; tk += step) {
    while (j < n - 2 && t[j + 1] < tk) j++;
    const ta = t[j];
    const tb = t[j + 1];
    let v;
    if (tb === ta) {
      v = x[j];
    } else {
      const u = (tk - ta) / (tb - ta);
      v = x[j] + (x[j + 1] - x[j]) * u;
    }
    out.t.push(tk);
    out.x.push(v);
  }
  return out;
}

/**
 * Second-order (biquad) low-pass Butterworth filter, applied forward only.
 * Used to condition the steering signal before reversal detection
 * (Report 1 SRR; Report 2 SWRR signal-conditioning, ~0.6 Hz cutoff).
 */
function butterworth2(signal, cutoffHz, fs) {
  const n = signal.length;
  if (n === 0 || !(fs > 0) || !(cutoffHz > 0)) return signal.slice();
  const wc = Math.tan((Math.PI * cutoffHz) / fs);
  const k = Math.SQRT2 * wc;
  const denom = wc * wc + k + 1;
  const b0 = (wc * wc) / denom;
  const b1 = 2 * b0;
  const b2 = b0;
  const a1 = (2 * (wc * wc - 1)) / denom;
  const a2 = (wc * wc - k + 1) / denom;
  const out = new Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = Number.isFinite(signal[i]) ? signal[i] : 0;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lane metrics (offsets in meters, signed)
// ---------------------------------------------------------------------------
function computeLaneStats(offsetsM) {
  return {
    meanLP: mean(offsetsM),
    medianLP: median(offsetsM),
    madLP: meanAbs(offsetsM),
    sdlp: sampleSD(offsetsM),
  };
}

/**
 * Detect lane-departure events. A departure starts when the vehicle edge
 * crosses the lane boundary: |offset| + halfVehicleWidth > halfWidth.
 * (Report 1 detectLaneDepartures.)
 *
 * @param {number[]} offsetsM      signed lateral offset per sample
 * @param {number[]} halfWidthsM   lane half-width per sample (boundary distance)
 * @param {number[]} t             timestamps (s) per sample
 * @param {number}   vehHalfWidthM half the vehicle width
 */
function detectLaneDepartures(offsetsM, halfWidthsM, t, vehHalfWidthM) {
  const events = [];
  let inEvent = false;
  let startIdx = -1;
  let maxMag = 0;
  for (let i = 0; i < offsetsM.length; i++) {
    const off = offsetsM[i];
    const hw = halfWidthsM[i];
    if (!Number.isFinite(off) || !Number.isFinite(hw)) continue;
    const margin = hw - vehHalfWidthM;
    const mag = Math.abs(off) - margin;
    const violation = mag > 0;
    if (violation && !inEvent) {
      inEvent = true;
      startIdx = i;
      maxMag = mag;
    } else if (violation && inEvent) {
      maxMag = Math.max(maxMag, mag);
    } else if (!violation && inEvent) {
      events.push({
        tStart: t[startIdx],
        tEnd: t[i - 1],
        durationSec: t[i - 1] - t[startIdx],
        maxMagnitudeM: maxMag,
      });
      inEvent = false;
    }
  }
  if (inEvent) {
    const last = offsetsM.length - 1;
    events.push({
      tStart: t[startIdx],
      tEnd: t[last],
      durationSec: t[last] - t[startIdx],
      maxMagnitudeM: maxMag,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Speed metrics
// ---------------------------------------------------------------------------
function speedStats(speedMs) {
  return { meanSpeedMs: mean(speedMs), sdsMs: sampleSD(speedMs) };
}

// ---------------------------------------------------------------------------
// Steering-wheel reversal rate (SWRR)
// Low-pass the steering signal, find turning points, count reversals whose
// amplitude exceeds the gap threshold. (Report 1 SRR; Report 2 SWRR.)
// ---------------------------------------------------------------------------

function findTurningPoints(xs) {
  const pts = [];
  for (let i = 1; i < xs.length - 1; i++) {
    if (!Number.isFinite(xs[i - 1] + xs[i] + xs[i + 1])) continue;
    const up = xs[i] > xs[i - 1] && xs[i] >= xs[i + 1];
    const dn = xs[i] < xs[i - 1] && xs[i] <= xs[i + 1];
    if (up || dn) pts.push(i);
  }
  return pts;
}

/**
 * @param {number[]} steerDeg   steering angle in DEGREES, already resampled
 * @param {number}   fs         sample rate of steerDeg
 * @param {number}   gapDeg     reversal amplitude threshold (deg)
 * @param {number}   cutoffHz   low-pass cutoff (default 0.6 Hz, per SWRR algo)
 * @returns {{reversals:number, reversalsPerMin:number}}
 */
function steeringReversalRate(steerDeg, fs, gapDeg = 3, cutoffHz = 0.6) {
  if (steerDeg.length < 3 || !(fs > 0)) {
    return { reversals: 0, reversalsPerMin: NaN };
  }
  const filtered = butterworth2(steerDeg, cutoffHz, fs);
  const tp = findTurningPoints(filtered);
  let reversals = 0;
  for (let i = 1; i < tp.length; i++) {
    const amp = Math.abs(filtered[tp[i]] - filtered[tp[i - 1]]);
    if (amp >= gapDeg) reversals++;
  }
  const minutes = steerDeg.length / fs / 60;
  return { reversals, reversalsPerMin: minutes > 0 ? reversals / minutes : NaN };
}

// ---------------------------------------------------------------------------
// Steering entropy (Nakayama 1999 / Boer)
// Predict each sample from the 3 prior samples via 2nd-order Taylor expansion,
// build a baseline error distribution to set the scale alpha (90th pct),
// bin into 9 symmetric bins, then Shannon entropy of the evaluation
// distribution. (Report 2 §Steering Entropy.)
// ---------------------------------------------------------------------------

/** Prediction errors e(n) = θ(n) - θp(n) for a uniformly-sampled signal. */
function steeringPredictionErrors(steerResampled) {
  const e = [];
  for (let n = 3; n < steerResampled.length; n++) {
    const pred =
      2.5 * steerResampled[n - 1] -
      2 * steerResampled[n - 2] +
      0.5 * steerResampled[n - 3];
    e.push(steerResampled[n] - pred);
  }
  return e;
}

/** alpha = 90th percentile of |baseline prediction errors|. */
function steeringEntropyBaseline(baselineSteerResampled) {
  const pe = steeringPredictionErrors(baselineSteerResampled).map(Math.abs);
  const alpha = percentile(pe, 90);
  return { alpha: Number.isFinite(alpha) && alpha > 0 ? alpha : NaN };
}

/** Nine symmetric bin edges around 0, scaled by alpha. */
function entropyBinEdges(alpha) {
  // boundaries at multiples of alpha: -5a,-2.5a,-a,-0.5a,0.5a,a,2.5a,5a
  return [
    -Infinity,
    -5 * alpha,
    -2.5 * alpha,
    -alpha,
    -0.5 * alpha,
    0.5 * alpha,
    alpha,
    2.5 * alpha,
    5 * alpha,
    Infinity,
  ];
}

/**
 * Steering entropy Hp of an evaluation segment against a baseline alpha.
 * Returns Hp (bits, 0..~log2(9)) plus the bin probabilities.
 */
function steeringEntropy(evalSteerResampled, alpha) {
  if (!Number.isFinite(alpha) || alpha <= 0) return { Hp: NaN, probs: [] };
  const errors = steeringPredictionErrors(evalSteerResampled);
  const edges = entropyBinEdges(alpha);
  const counts = new Array(9).fill(0);
  let n = 0;
  for (const e of errors) {
    if (!Number.isFinite(e)) continue;
    for (let k = 0; k < 9; k++) {
      if (e >= edges[k] && e < edges[k + 1]) {
        counts[k]++;
        n++;
        break;
      }
    }
  }
  if (!n) return { Hp: NaN, probs: [] };
  const probs = counts.map((c) => c / n);
  let Hp = 0;
  for (const p of probs) {
    if (p > 0) Hp -= p * Math.log(p) / Math.log(9); // normalized base-9 (0..1)
  }
  return { Hp, probs };
}

// ---------------------------------------------------------------------------
// Time-to-line-crossing (TLC)
// Trigonometric form for a straight segment (Report 2 §TLC): time for the
// vehicle edge to reach the boundary given lateral position, speed and the
// relative yaw (heading error). Reported as min and 15th percentile.
// ---------------------------------------------------------------------------

/**
 * Instantaneous first-order TLC from the lateral-velocity approximation
 * (Report 2 §TLC): time for the vehicle edge to reach the boundary it is
 * drifting toward, given the current lateral velocity relative to the lane.
 * Returns +Infinity when not drifting toward a boundary (the metric is only
 * meaningful for closing motion; min/percentile aggregates ignore the Infs).
 *
 * Lane frame: offset signed (+ = left). Left boundary at +halfLeft, right
 * boundary at -halfRight. lateralVel = d(offset)/dt (+ = moving left).
 *
 * @param {number} offsetM      signed lateral position
 * @param {number} halfLeftM    distance from centerline to left boundary
 * @param {number} halfRightM   distance from centerline to right boundary
 * @param {number} lateralVelMs signed lateral velocity (+ = toward left)
 * @param {number} vehHalfWidthM half the vehicle width (edge offset)
 */
function tlcInstant(offsetM, halfLeftM, halfRightM, lateralVelMs, vehHalfWidthM = 0) {
  if (!Number.isFinite(offsetM) || !Number.isFinite(lateralVelMs)) return Infinity;
  if (Math.abs(lateralVelMs) <= 1e-3) return Infinity; // not drifting
  if (lateralVelMs > 0) {
    // drifting left
    if (!Number.isFinite(halfLeftM)) return Infinity;
    const dist = halfLeftM - vehHalfWidthM - offsetM;
    return dist <= 0 ? 0 : dist / lateralVelMs;
  }
  // drifting right
  if (!Number.isFinite(halfRightM)) return Infinity;
  const dist = halfRightM - vehHalfWidthM + offsetM;
  return dist <= 0 ? 0 : dist / -lateralVelMs;
}

/**
 * Aggregate a TLC series. Researchers use the minimum and the robust 15th
 * percentile rather than the (skewed) mean. (Report 2 §TLC.)
 */
function tlcStats(tlcSeries) {
  const finite = tlcSeries.filter((v) => Number.isFinite(v));
  if (!finite.length) return { minTlc: NaN, p15Tlc: NaN, count: 0 };
  return {
    minTlc: Math.min(...finite),
    p15Tlc: percentile(finite, 15),
    count: finite.length,
  };
}

// ---------------------------------------------------------------------------
// Interaction metrics (Phase 2 — only computable when traffic objects exist).
// Kept here so they're ready the moment per-frame lead-vehicle state is wired.
// ---------------------------------------------------------------------------

/** Bumper-to-bumper time gap (s). +Inf if stationary. (Report 1.) */
function timeGap(rangeM, egoSpeedMs) {
  if (!Number.isFinite(rangeM) || !Number.isFinite(egoSpeedMs) || egoSpeedMs <= 0)
    return Infinity;
  return rangeM / egoSpeedMs;
}

/** 1-D TTC with optional constant-accel terms. (Report 1 ttc1D.) */
function ttc1D(rangeM, egoSpeedMs, leadSpeedMs, egoAccMs2 = 0, leadAccMs2 = 0) {
  if (!Number.isFinite(rangeM) || rangeM <= 0) return 0;
  const vRel = egoSpeedMs - leadSpeedMs;
  const aRel = egoAccMs2 - leadAccMs2;
  if (Math.abs(aRel) < 1e-6) return vRel > 0 ? rangeM / vRel : Infinity;
  const A = 0.5 * aRel;
  const B = vRel;
  const C = -rangeM;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return Infinity;
  const r1 = (-B - Math.sqrt(disc)) / (2 * A);
  const r2 = (-B + Math.sqrt(disc)) / (2 * A);
  const roots = [r1, r2].filter((t) => t > 0 && Number.isFinite(t)).sort((a, b) => a - b);
  return roots.length ? roots[0] : Infinity;
}

/** Time-exposed & time-integrated TTC against a threshold. (Report 1.) */
function tetTit(ttcSeriesSec, dtSec, thresholdSec = 3) {
  let tet = 0;
  let tit = 0;
  for (const ttc of ttcSeriesSec) {
    if (!Number.isFinite(ttc)) continue;
    if (ttc >= 0 && ttc <= thresholdSec) {
      tet += dtSec;
      tit += (thresholdSec - ttc) * dtSec;
    }
  }
  return { tet, tit };
}


/* --- compute.js --- */
/**
 * Turns logged telemetry columns + the selected-metric set into computed
 * results. Shared by the live overlay (over a trailing window) and the
 * end-of-run report (over the whole run).
 */




const RAD2DEG = 180 / Math.PI;

/**
 * @param {object} cols       channel arrays from MetricsCollector.columns()
 * @param {object} selection  {metricId: boolean}
 * @param {object} opts
 *   @param {object} opts.paramOverrides per-metric param overrides
 *   @param {boolean} opts.trafficAvailable gate interaction metrics
 *   @param {[number,number]} opts.baselineRange [tStart,tEnd] for steering entropy
 * @returns {object} {metricId: {value|values, unit, ...}}
 */
function computeMetrics(cols, selection, opts = {}) {
  const out = {};
  const trafficAvailable = !!opts.trafficAvailable;
  const overrides = opts.paramOverrides || {};
  const has = (id) => selection[id] && isComputable(id, trafficAvailable);

  const rawOffsets = cols.lateralOffset || [];
  const onRoad = cols.onRoad || [];
  const speeds = cols.speed || [];
  const t = cols.t || [];

  // Lane geometry is only valid on-road; mask off-road samples to NaN so the
  // math layer (which filters non-finite) ignores them. (Reports: exclude
  // samples where the lane model is undefined.)
  const offsets = rawOffsets.map((o, i) =>
    onRoad.length ? (onRoad[i] ? o : NaN) : o
  );

  // ---- Lane ----
  if (has('sdlp') || has('meanLP')) {
    const lane = computeLaneStats(offsets);
    if (has('sdlp')) out.sdlp = { value: lane.sdlp, unit: 'm' };
    if (has('meanLP'))
      out.meanLP = { value: lane.meanLP, median: lane.medianLP, mad: lane.madLP, unit: 'm' };
  }

  if (has('laneDepartures')) {
    const p = paramsFor('laneDepartures', overrides);
    // nearer-boundary half width per sample
    const halfW = nearerHalfWidth(cols);
    const events = detectLaneDepartures(offsets, halfW, t, p.vehicleHalfWidthM);
    const dist = pathDistanceKm(cols);
    out.laneDepartures = {
      value: events.length,
      events,
      perKm: dist > 0 ? events.length / dist : NaN,
      meanDurationSec: events.length ? mean(events.map((e) => e.durationSec)) : NaN,
      maxMagnitudeM: events.length ? Math.max(...events.map((e) => e.maxMagnitudeM)) : NaN,
      unit: 'count',
    };
  }

  // ---- Speed ----
  if (has('meanSpeed') || has('sds')) {
    const ss = speedStats(speeds);
    if (has('meanSpeed')) out.meanSpeed = { value: ss.meanSpeedMs, unit: 'm/s' };
    if (has('sds')) out.sds = { value: ss.sdsMs, unit: 'm/s' };
  }

  // ---- Steering ----
  if (has('swrr')) {
    const p = paramsFor('swrr', overrides);
    const steerDeg = (cols.steerRad || []).map((r) => r * RAD2DEG);
    const rs = resampleUniform(t, steerDeg, p.resampleHz);
    const r = steeringReversalRate(rs.x, rs.fs, p.gapDeg, p.cutoffHz);
    out.swrr = { value: r.reversalsPerMin, reversals: r.reversals, unit: '/min' };
  }

  if (has('steeringEntropy')) {
    const p = paramsFor('steeringEntropy', overrides);
    const steerRad = cols.steerRad || [];
    const rs = resampleUniform(t, steerRad, p.resampleHz);
    // baseline slice
    const [b0, b1] = opts.baselineRange || [t[0], (t[0] || 0) + p.baselineSec];
    const baselineSlice = sliceByTime(rs.t, rs.x, b0, b1);
    const { alpha } = steeringEntropyBaseline(baselineSlice);
    const { Hp } = steeringEntropy(rs.x, alpha);
    out.steeringEntropy = { value: Hp, alpha, unit: 'norm' };
  }

  // ---- Safety margin ----
  if (has('tlc')) {
    const p = paramsFor('laneDepartures', overrides); // reuse vehicle half-width
    const vehHalf = p && Number.isFinite(p.vehicleHalfWidthM) ? p.vehicleHalfWidthM : 0;
    const lateralVel = smoothedLateralVelocity(offsets, cols.t || [], 0.25);
    const series = [];
    for (let i = 0; i < offsets.length; i++) {
      if (!Number.isFinite(offsets[i]) || !Number.isFinite(lateralVel[i])) continue;
      // only count while actually moving — TLC at standstill is meaningless
      if (!(speeds[i] > 0.5)) continue;
      series.push(
        tlcInstant(offsets[i], cols.laneHalfL[i], cols.laneHalfR[i], lateralVel[i], vehHalf)
      );
    }
    const st = tlcStats(series);
    out.tlc = { value: st.minTlc, p15: st.p15Tlc, unit: 's' };
  }

  // ---- Events ----
  if (has('collisions')) {
    const collisions = (opts.events || []).filter((e) => e.type === 'collision');
    const dist = pathDistanceKm(cols);
    const hours = (t[t.length - 1] || 0) / 3600;
    out.collisions = {
      value: collisions.length,
      perKm: dist > 0 ? collisions.length / dist : NaN,
      perHour: hours > 0 ? collisions.length / hours : NaN,
      unit: 'count',
    };
  }

  if (has('throttleBrake')) {
    const thr = cols.throttle || [];
    const brk = cols.brake || [];
    const jerk = longitudinalJerk(cols);
    out.throttleBrake = {
      throttleShare: shareActive(thr, 0.05),
      brakeShare: shareActive(brk, 0.05),
      peakJerk: jerk,
      unit: 'misc',
    };
  }

  // ---- Interaction (traffic only) ----
  // Computed in DrivingMetrics when per-frame lead state is wired; gated here.
  if (has('timeHeadway')) out.timeHeadway = { value: NaN, unit: 's', note: 'awaiting traffic stream' };
  if (has('ttc')) out.ttc = { value: NaN, unit: 's', note: 'awaiting traffic stream' };

  return out;
}
function isComputable(id, trafficAvailable) {
  const m = getMetric(id);
  if (!m) return false;
  if (m.requiresTraffic && !trafficAvailable) return false;
  return true;
}

// --- helpers ---

function nearerHalfWidth(cols) {
  const L = cols.laneHalfL || [];
  const R = cols.laneHalfR || [];
  const n = Math.max(L.length, R.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const l = L[i];
    const r = R[i];
    const vals = [l, r].filter(Number.isFinite);
    out[i] = vals.length ? Math.min(...vals) : NaN;
  }
  return out;
}

function sliceByTime(t, x, t0, t1) {
  const out = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= t0 && t[i] <= t1) out.push(x[i]);
  return out;
}

function pathDistanceKm(cols) {
  const speed = cols.speed || [];
  const dt = cols.dt || [];
  let d = 0;
  for (let i = 0; i < speed.length; i++) {
    if (Number.isFinite(speed[i]) && Number.isFinite(dt[i])) d += speed[i] * dt[i];
  }
  return d / 1000;
}

/**
 * Lateral velocity relative to the lane (d offset / dt), smoothed over a short
 * window to suppress per-frame noise. Returns one value per sample.
 */
function smoothedLateralVelocity(offsets, t, windowSec) {
  const n = offsets.length;
  const out = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    // walk back until the window spans ~windowSec
    let j = i - 1;
    while (j > 0 && t[i] - t[j] < windowSec) j--;
    const dtw = t[i] - t[j];
    if (dtw > 1e-4 && Number.isFinite(offsets[i]) && Number.isFinite(offsets[j])) {
      out[i] = (offsets[i] - offsets[j]) / dtw;
    }
  }
  return out;
}

function shareActive(xs, thr) {
  let n = 0;
  let active = 0;
  for (const v of xs) {
    if (!Number.isFinite(v)) continue;
    n++;
    if (Math.abs(v) > thr) active++;
  }
  return n ? active / n : NaN;
}

function longitudinalJerk(cols) {
  const a = cols.accelLon || [];
  const dt = cols.dt || [];
  let peak = 0;
  for (let i = 1; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(a[i - 1]) || !(dt[i] > 0)) continue;
    const j = Math.abs((a[i] - a[i - 1]) / dt[i]);
    if (j > peak) peak = j;
  }
  return peak;
}


/* --- report.js --- */
/**
 * End-of-run report + raw-log export. Produces a human-readable Markdown
 * report, a machine-readable JSON report, and a CSV of raw telemetry, each
 * downloadable via a Blob + temporary <a download>.
 */




/** Build the structured report object for a finished run. */
function buildReport(collector, selection, opts = {}) {
  const cols = collector.columns();
  const results = computeMetrics(cols, selection, {
    paramOverrides: opts.paramOverrides,
    trafficAvailable: opts.trafficAvailable,
    baselineRange: opts.baselineRange,
    events: collector.events,
  });
  return {
    generatedAt: new Date().toISOString(),
    meta: collector.meta,
    run: {
      durationSec: collector.durationSec(),
      distanceM: collector.distanceM(),
      samples: collector.sampleCount,
      events: collector.events,
    },
    selection,
    paramOverrides: opts.paramOverrides || {},
    results,
  };
}

function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return Number(v).toFixed(digits);
}

/** Render the report object as Markdown. */
function reportToMarkdown(report) {
  const r = report.results;
  const lines = [];
  lines.push('# Driving Performance Report');
  lines.push('');
  lines.push(`*Generated ${report.generatedAt}*`);
  lines.push('');
  lines.push('## Run');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Duration | ${fmt(report.run.durationSec, 1)} s |`);
  lines.push(`| Distance | ${fmt(report.run.distanceM, 1)} m |`);
  lines.push(`| Samples | ${report.run.samples} |`);
  if (report.meta.vehicle) lines.push(`| Vehicle | ${report.meta.vehicle} |`);
  if (report.meta.units != null) lines.push(`| Units mode | ${report.meta.units} |`);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value | Detail | Unit |');
  lines.push('|---|---|---|---|');
  for (const id in r) {
    const m = getMetric(id);
    const res = r[id];
    lines.push(
      `| ${m ? m.label : id} | ${fmt(res.value)} | ${detailString(id, res)} | ${res.unit || ''} |`
    );
  }
  lines.push('');

  if (report.run.events.length) {
    lines.push('## Events');
    lines.push('');
    lines.push('| # | Type | t (s) | Detail |');
    lines.push('|---|---|---|---|');
    report.run.events.forEach((e, i) => {
      lines.push(`| ${i + 1} | ${e.type} | ${fmt(e.t, 2)} | ${e.speed != null ? fmt(e.speed, 1) + ' m/s' : ''} |`);
    });
    lines.push('');
  }

  lines.push('## Parameters');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.paramOverrides, null, 2));
  lines.push('```');
  return lines.join('\n');
}

function detailString(id, res) {
  switch (id) {
    case 'meanLP':
      return `median ${fmt(res.median)}, MAD ${fmt(res.mad)}`;
    case 'laneDepartures':
      return `${fmt(res.perKm, 2)}/km, mean dur ${fmt(res.meanDurationSec, 2)} s`;
    case 'tlc':
      return `15th pct ${fmt(res.p15, 2)} s`;
    case 'swrr':
      return `${res.reversals} reversals`;
    case 'steeringEntropy':
      return `α ${fmt(res.alpha, 4)}`;
    case 'collisions':
      return `${fmt(res.perKm, 2)}/km, ${fmt(res.perHour, 2)}/h`;
    case 'throttleBrake':
      return `thr ${fmt(res.throttleShare, 2)}, brk ${fmt(res.brakeShare, 2)}, jerk ${fmt(res.peakJerk, 1)}`;
    default:
      return res.note || '';
  }
}

/** Raw telemetry as CSV (one row per logged frame). */
function logsToCsv(collector) {
  const cols = collector.columns();
  const keys = Object.keys(cols);
  const n = cols.t ? cols.t.length : 0;
  const rows = [keys.join(',')];
  for (let i = 0; i < n; i++) {
    rows.push(keys.map((k) => csvNum(cols[k][i])).join(','));
  }
  return rows.join('\n');
}

function csvNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
  return String(v);
}

/** Trigger a browser download of a text blob. */
function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Download report (.md + .json). */
function downloadReport(report) {
  const base = `driving-report-${stamp()}`;
  downloadText(`${base}.md`, reportToMarkdown(report), 'text/markdown');
  downloadText(`${base}.json`, JSON.stringify(report, null, 2), 'application/json');
}

/** Download raw telemetry logs (.csv) + events (.json). */
function downloadLogs(collector) {
  const base = `driving-logs-${stamp()}`;
  downloadText(`${base}.csv`, logsToCsv(collector), 'text/csv');
  downloadText(
    `${base}.events.json`,
    JSON.stringify({ meta: collector.meta, events: collector.events }, null, 2),
    'application/json'
  );
}


/* --- MetricsCollector.js --- */
/**
 * Telemetry collector. Accumulates one row per physics frame into growable
 * struct-of-arrays buffers (low GC pressure, per Report 1/2 §Three.js), plus a
 * discrete event log (collisions, and any markers). All heavy metric
 * computation happens elsewhere, off the physics path.
 *
 * The engine calls `sample(dt, state)` from a build-main patch at the end of
 * VehicleController.updateVehicleState, where all ego state is fresh.
 */

const CHUNK = 4096;

class Channel {
  constructor() {
    this.buf = new Float64Array(CHUNK);
    this.length = 0;
  }
  push(v) {
    if (this.length >= this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }
  /** A plain Array copy of the used range (for the math layer). */
  toArray() {
    return Array.prototype.slice.call(this.buf.subarray(0, this.length));
  }
}
class MetricsCollector {
  constructor() {
    this.channels = {
      t: new Channel(), // monotonic time (s)
      dt: new Channel(), // frame dt (s)
      posX: new Channel(),
      posZ: new Channel(),
      speed: new Channel(), // m/s
      steerRad: new Channel(),
      throttle: new Channel(), // [0..1]-ish
      brake: new Channel(),
      accelLon: new Channel(), // m/s^2
      accelLat: new Channel(),
      lateralOffset: new Channel(), // m, signed (+ = left)
      laneHalfL: new Channel(), // m, distance to left boundary
      laneHalfR: new Channel(), // m, distance to right boundary
      heading: new Channel(),
      nodeIndex: new Channel(),
      onRoad: new Channel(), // 1 = on road, 0 = off road
    };
    this.events = []; // {type, t, ...}
    this.recording = false;
    this.elapsed = 0;
    this.startWallClock = null;
    this._prevCollided = false;
    this.meta = {};
  }

  start(meta) {
    this.reset();
    this.recording = true;
    this.meta = Object.assign({ startedAt: new Date().toISOString() }, meta || {});
  }

  stop() {
    this.recording = false;
    this.meta.stoppedAt = new Date().toISOString();
  }

  reset() {
    for (const k in this.channels) this.channels[k] = new Channel();
    this.events = [];
    this.elapsed = 0;
    this.startWallClock = null;
    this._prevCollided = false;
    this.meta = {};
  }

  get isRecording() {
    return this.recording;
  }

  get sampleCount() {
    return this.channels.t.length;
  }

  /**
   * Append one frame. `state` carries fresh ego values from the engine.
   * @param {number} dt  frame delta-time (s)
   */
  sample(dt, state) {
    if (!this.recording) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;

    const ch = this.channels;
    ch.t.push(this.elapsed);
    ch.dt.push(dt);
    ch.posX.push(num(state.posX));
    ch.posZ.push(num(state.posZ));
    ch.speed.push(num(state.speed));
    ch.steerRad.push(num(state.steer));
    ch.throttle.push(num(state.throttle));
    ch.brake.push(num(state.brake));

    // accel is already body-frame in the engine (rotated by -orientation.y),
    // so store components directly: z = longitudinal, x = lateral.
    const a = state.accel;
    if (a) {
      ch.accelLon.push(num(a.z));
      ch.accelLat.push(num(a.x));
    } else {
      ch.accelLon.push(NaN);
      ch.accelLat.push(NaN);
    }

    ch.lateralOffset.push(num(state.lateralOffset));
    ch.laneHalfL.push(num(state.laneHalfL));
    ch.laneHalfR.push(num(state.laneHalfR));
    ch.heading.push(num(state.heading));
    ch.nodeIndex.push(num(state.nodeIndex));
    ch.onRoad.push(state.onRoad ? 1 : 0);

    // Rising-edge collision event.
    const collided = !!state.collided;
    if (collided && !this._prevCollided) {
      this.events.push({ type: 'collision', t: this.elapsed, speed: num(state.speed) });
    }
    this._prevCollided = collided;
  }

  /** Plain-array view of every channel, for the math/report layers. */
  columns() {
    const out = {};
    for (const k in this.channels) out[k] = this.channels[k].toArray();
    return out;
  }

  durationSec() {
    return this.elapsed;
  }

  /** Approximate path distance from logged speed * dt (m). */
  distanceM() {
    const ch = this.channels;
    let d = 0;
    for (let i = 0; i < ch.t.length; i++) d += ch.speed.buf[i] * ch.dt.buf[i];
    return d;
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}


/* --- MetricsPanel.js --- */
/**
 * Driving-metrics configuration UI, integrated into the game's existing
 * settings sidebar as a collapsible section placed after "audio". The settings
 * panel is React-rendered and mounts/unmounts (and re-renders) as the user
 * opens/closes it, so the section is (re)injected via a MutationObserver.
 *
 * The section matches the native collapsible markup (.settings-input-row
 * .settings-input-list_section .collapsible + .collapsible-title +
 * .collapsible-cross) so it looks and behaves like the built-in sections.
 *
 * `app` is the DrivingMetrics facade this UI drives.
 */



const PANEL_STYLE_ID = 'pd-metrics-style';
const SECTION_ID = 'pd-metrics-section';
const CONTENT_ID = 'pd-metrics-content';

// Scoped to our injected nodes so we don't disturb the game's own styling.
const PANEL_CSS = `
#${SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${SECTION_ID} .collapsible-cross{float:right}
#${CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${CONTENT_ID}.open{display:block}
#${CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${CONTENT_ID} .pd-row{display:flex;align-items:flex-start;gap:8px;padding:3px 0}
#${CONTENT_ID} .pd-row.disabled{opacity:.4}
#${CONTENT_ID} .pd-row label{cursor:pointer;line-height:1.3;font-size:13px}
#${CONTENT_ID} .pd-row .hint{display:block;font-size:11px;color:#7e7e7e}
#${CONTENT_ID} .pd-unit{color:#5f7a78}
#${CONTENT_ID} .pd-controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;
  border-top:1px solid #333;padding-top:10px}
#${CONTENT_ID} .pd-controls button{flex:1 1 auto;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${CONTENT_ID} .pd-controls button:hover{border-color:#3ec6b5}
#${CONTENT_ID} .pd-controls button.primary{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${CONTENT_ID} .pd-controls button:disabled{opacity:.4;cursor:default}
#${CONTENT_ID} .pd-status{font-size:11px;color:#8aa0a0;margin-top:10px}
#${CONTENT_ID} .pd-status b{color:#cfe9e6}
#${CONTENT_ID} .pd-rec{color:#ff6b6b}
`;
class MetricsPanel {
  constructor(app) {
    this.app = app;
    this.expanded = false;
    this._injectStyle();
    this._buildSection(); // detached DOM, reused across re-injections
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._statusTimer = setInterval(() => this._renderStatus(), 500);
  }

  _injectStyle() {
    if (document.getElementById(PANEL_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = PANEL_STYLE_ID;
    s.textContent = PANEL_CSS;
    document.head.appendChild(s);
  }

  // Coalesce frequent DOM mutations into one injection check per frame.
  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInject();
    });
  }

  /** Insert (or re-insert) the section into the settings list after "audio". */
  _tryInject() {
    const list = document.querySelector('.settings-input-list');
    if (!list) return; // settings panel is closed
    if (list.contains(this.header) && list.contains(this.content)) return;
    list.appendChild(this.header);
    list.appendChild(this.content);
    this._renderChecks();
    this._renderStatus();
  }

  _buildSection() {
    // header row — matches native collapsible section markup
    this.header = el('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = SECTION_ID;
    this.title = el('div', 'collapsible-title', 'driving metrics');
    this.cross = el('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    // content row (full-width block below the header)
    this.content = el('div');
    this.content.id = CONTENT_ID;

    for (const fam of METRIC_FAMILIES) {
      const metrics = METRICS.filter((m) => m.family === fam.id);
      if (!metrics.length) continue;
      this.content.appendChild(el('div', 'pd-fam', fam.label));
      for (const m of metrics) this.content.appendChild(this._metricRow(m));
    }

    // run controls — the live overlay is toggled from the lower menu band
    // (see MetricsOverlay) so it can't steal keyboard focus from the game.
    const controls = el('div', 'pd-controls');
    this.startBtn = el('button', 'primary', 'Start');
    this.stopBtn = el('button', null, 'Stop');
    this.resetBtn = el('button', null, 'Reset');
    this.startBtn.addEventListener('click', () => this.app.startRun());
    this.stopBtn.addEventListener('click', () => this.app.stopRun());
    this.resetBtn.addEventListener('click', () => this.app.resetRun());
    controls.append(this.startBtn, this.stopBtn, this.resetBtn);
    this.content.appendChild(controls);

    const exports = el('div', 'pd-controls');
    this.reportBtn = el('button', null, 'Download report');
    this.logsBtn = el('button', null, 'Download logs');
    this.reportBtn.addEventListener('click', () => this.app.downloadReport());
    this.logsBtn.addEventListener('click', () => this.app.downloadLogs());
    exports.append(this.reportBtn, this.logsBtn);
    this.content.appendChild(exports);

    this.status = el('div', 'pd-status');
    this.content.appendChild(this.status);

    this._applyExpanded();
  }

  _metricRow(m) {
    const row = el('div', 'pd-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `pd-m-${m.id}`;
    cb.dataset.metric = m.id;
    cb.addEventListener('click', (e) => e.stopPropagation()); // don't toggle the section
    cb.addEventListener('change', () => this.app.setSelected(m.id, cb.checked));
    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.addEventListener('click', (e) => e.stopPropagation());
    label.innerHTML =
      `${m.label}${m.unit ? ` <span class="pd-unit">(${m.unit})</span>` : ''}` +
      `<span class="hint">${m.hint || ''}${m.requiresTraffic ? ' — needs traffic' : ''}</span>`;
    row.append(cb, label);
    this._rows = this._rows || {};
    this._rows[m.id] = { row, cb };
    return row;
  }

  /** Sync checkbox checked/disabled state from the app (after re-injection). */
  _renderChecks() {
    if (!this._rows) return;
    const sel = this.app.getSelection();
    for (const id in this._rows) {
      const { row, cb } = this._rows[id];
      const computable = this.app.isComputable(id);
      cb.checked = !!sel[id] && computable;
      cb.disabled = !computable;
      row.classList.toggle('disabled', !computable);
      cb.title = computable ? '' : 'Requires traffic objects (not enabled in this simulation)';
    }
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+'; // − / +
    this.content.classList.toggle('open', this.expanded);
  }

  _renderStatus() {
    if (!this.status || !this.app) return;
    const rec = this.app.isRecording;
    this.startBtn.disabled = rec;
    this.stopBtn.disabled = !rec;
    this.status.innerHTML =
      `Status: <b class="${rec ? 'pd-rec' : ''}">${rec ? '● recording' : 'idle'}</b> · ` +
      `<b>${this.app.durationSec().toFixed(1)}s</b> · <b>${this.app.sampleCount()}</b> samples`;
  }

  dispose() {
    clearInterval(this._statusTimer);
    if (this._observer) this._observer.disconnect();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


/* --- MetricsOverlay.js --- */
/**
 * Live HUD overlay (DOM). Shows the selected metrics computed over a trailing
 * window from the collector buffers, refreshed on its own throttled timer so
 * nothing heavy runs on the physics thread.
 *
 * The overlay is toggled from a button injected into the game's lower menu
 * band (`#menu-bar-left`), built to match the native weather/scene/vehicle
 * controls: a `.menu-item` whose `.menu-icon` fires on `mousedown`. Those
 * controls act on a non-focusable element, so the press never pulls keyboard
 * focus off `#game-main` (which owns the vehicle keydown listener). A plain
 * focusable `<button>` would steal that focus and silently swallow the driving
 * keys until something refocused the game — so we deliberately mirror the
 * native band mechanism here.
 */




const OVERLAY_STYLE_ID = 'pd-overlay-style';
const MENU_BUTTON_ID = 'pd-overlay-menu-item';
const MENU_ICON_URL = './static/media/driver_performance.svg';

const OVERLAY_CSS = `
.pd-overlay{position:fixed;left:12px;bottom:12px;z-index:9999;min-width:210px;
  background:rgba(10,16,21,.86);color:#dbe7e6;border:1px solid #243842;border-radius:10px;
  padding:10px 12px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;
  box-shadow:0 6px 24px rgba(0,0,0,.45);display:none}
.pd-overlay.open{display:block}
.pd-overlay .t{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.08em;
  color:#7fb6ad;margin-bottom:6px}
.pd-overlay .m{display:flex;justify-content:space-between;gap:14px;padding:2px 0}
.pd-overlay .m .k{color:#9fb4b3}
.pd-overlay .m .v{color:#eafffb;font-variant-numeric:tabular-nums}
.pd-overlay .warn{color:#ffb454}
`;

// metrics meaningful as a live trailing-window readout
const LIVE_IDS = ['sdlp', 'meanLP', 'sds', 'meanSpeed', 'swrr', 'steeringEntropy', 'tlc', 'laneDepartures', 'collisions'];
class MetricsOverlay {
  constructor(app, { windowSec = 30, refreshHz = 3 } = {}) {
    this.app = app;
    this.windowSec = windowSec;
    this.visible = false;
    this._injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'pd-overlay';
    document.body.appendChild(this.root);
    this._timer = setInterval(() => this._refresh(), 1000 / refreshHz);
    this._buildMenuButton();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._scheduleInject());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInjectMenuButton();
  }

  // --- lower-band toggle button -----------------------------------------
  // Mirrors the native menu-bar controls (see file header): a `.menu-item`
  // with a `.menu-icon` that toggles on `mousedown` of a non-focusable image,
  // so the game keeps keyboard focus.
  _buildMenuButton() {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.id = MENU_BUTTON_ID;
    item.tabIndex = -1;
    item.title = 'Driving performance overlay';

    const icon = document.createElement('img');
    icon.className = 'menu-icon';
    icon.src = MENU_ICON_URL;
    icon.alt = '';
    icon.addEventListener('mousedown', (e) => {
      // Keep focus on #game-main so vehicle keyboard input is never captured.
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    item.appendChild(icon);
    this.menuButton = item;
  }

  _scheduleInject() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInjectMenuButton();
    });
  }

  /** (Re)insert the toggle into the lower band once it exists. */
  _tryInjectMenuButton() {
    const bar = document.getElementById('menu-bar-left');
    if (!bar || !this.menuButton) return; // band not mounted yet
    if (bar.contains(this.menuButton)) return;
    bar.appendChild(this.menuButton);
    this._updateMenuButton();
  }

  _updateMenuButton() {
    if (this.menuButton) this.menuButton.classList.toggle('item-selected', this.visible);
  }

  _injectStyle() {
    if (document.getElementById(OVERLAY_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = OVERLAY_STYLE_ID;
    s.textContent = OVERLAY_CSS;
    document.head.appendChild(s);
  }

  setVisible(v) {
    this.visible = v;
    this.root.classList.toggle('open', v);
    this._updateMenuButton();
    if (v) this._refresh();
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  _refresh() {
    if (!this.visible) return;
    const cols = this.app.windowedColumns(this.windowSec);
    const selection = this.app.getSelection();
    const results = computeMetrics(cols, selection, {
      paramOverrides: this.app.paramOverrides,
      trafficAvailable: this.app.trafficAvailable,
      baselineRange: this.app.baselineRange,
      events: this.app.collector.events,
    });

    const rows = [`<div class="t">Live · ${this.windowSec}s window</div>`];
    let any = false;
    for (const id of LIVE_IDS) {
      if (!selection[id] || !results[id]) continue;
      any = true;
      const m = getMetric(id);
      rows.push(
        `<div class="m"><span class="k">${m ? m.label : id}</span><span class="v">${formatVal(results[id])}</span></div>`
      );
    }
    if (!any) rows.push('<div class="m warn">No live metrics selected</div>');
    this.root.innerHTML = rows.join('');
  }

  dispose() {
    clearInterval(this._timer);
    if (this._observer) this._observer.disconnect();
    if (this.menuButton) this.menuButton.remove();
    this.root.remove();
  }
}

function formatVal(res) {
  const v = res.value;
  const unit = res.unit && res.unit !== 'count' ? ' ' + res.unit : '';
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const digits = res.unit === 'count' ? 0 : 2;
  return v.toFixed(digits) + unit;
}


/* --- DrivingMetrics.js --- */
/**
 * Facade for the driving-performance-metrics subsystem. The game bundle
 * instantiates one `new DrivingMetrics(THREE)` (mirroring InstrumentCluster)
 * and calls `.sample(dt, state)` each physics frame. Everything else — config
 * panel, live overlay, run lifecycle, and report/log export — hangs off this.
 */








const AUTOSTART_SPEED = 0.5; // m/s — begin a run once the car actually moves
class DrivingMetrics {
  constructor(THREE) {
    this.THREE = THREE; // kept for parity / future in-scene viz
    this.collector = new MetricsCollector();
    this.selection = loadSelection();
    this.paramOverrides = {};
    this.trafficAvailable = false; // no traffic objects in this build (see plan §7)
    this.baselineRange = null; // null => first baselineSec of run (per metric)
    this.autoStart = true;

    try {
      this.panel = new MetricsPanel(this);
      this.overlay = new MetricsOverlay(this);
      this._bindKeys();
    } catch (e) {
      console.error('DrivingMetrics UI init failed', e);
    }
  }

  // --- engine hook -------------------------------------------------------
  /** Called once per physics frame from the build-main patch. */
  sample(dt, state) {
    if (!this.collector.recording && this.autoStart && state && state.speed > AUTOSTART_SPEED) {
      this.startRun({ vehicle: state.vehicle, units: state.units });
    }
    this.collector.sample(dt, state);
  }

  get isRecording() {
    return this.collector.recording;
  }

  // --- run lifecycle -----------------------------------------------------
  startRun(meta) {
    this.collector.start(meta);
  }

  stopRun() {
    this.collector.stop();
  }

  resetRun() {
    this.collector.reset();
  }

  // --- selection / config (used by the panel) ----------------------------
  getSelection() {
    return this.selection;
  }

  setSelected(id, on) {
    this.selection[id] = !!on;
    saveSelection(this.selection);
  }

  isComputable(id) {
    return isComputable(id, this.trafficAvailable);
  }

  /** Future hook: flip on when a traffic config is added to the sim. */
  setTrafficAvailable(v) {
    this.trafficAvailable = !!v;
  }

  durationSec() {
    return this.collector.durationSec();
  }

  sampleCount() {
    return this.collector.sampleCount;
  }

  // --- overlay -----------------------------------------------------------
  toggleOverlay() {
    if (this.overlay) this.overlay.toggle();
  }

  /** Trailing-window slice of every channel, for the live overlay. */
  windowedColumns(windowSec) {
    const cols = this.collector.columns();
    const t = cols.t;
    if (!t || !t.length) return cols;
    const cutoff = t[t.length - 1] - windowSec;
    let start = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] < cutoff) {
        start = i + 1;
        break;
      }
    }
    if (start === 0) return cols;
    const out = {};
    for (const k in cols) out[k] = cols[k].slice(start);
    return out;
  }

  // --- export ------------------------------------------------------------
  buildReport() {
    return buildReport(this.collector, this.selection, {
      paramOverrides: this.paramOverrides,
      trafficAvailable: this.trafficAvailable,
      baselineRange: this.baselineRange,
    });
  }

  downloadReport() {
    downloadReport(this.buildReport());
  }

  downloadLogs() {
    downloadLogs(this.collector);
  }

  // --- keybinds ----------------------------------------------------------
  _bindKeys() {
    this._keyHandler = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === 'm' || e.key === 'M') this.toggleOverlay();
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  dispose() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this.panel) this.panel.dispose();
    if (this.overlay) this.overlay.dispose();
  }
}


  if (typeof window !== 'undefined') {
    window.DrivingMetrics = DrivingMetrics;
  }
})();
