/**
 * Turns logged telemetry columns + the selected-metric set into computed
 * results. Shared by the live overlay (over a trailing window) and the
 * end-of-run report (over the whole run).
 */

import {
  computeLaneStats,
  detectLaneDepartures,
  speedStats,
  steeringReversalRate,
  steeringEntropy,
  steeringEntropyBaseline,
  resampleUniform,
  tlcInstant,
  tlcStats,
  mean,
  percentile,
} from './metrics-math.js';
import { getMetric, paramsFor } from './config.js';

const RAD2DEG = 180 / Math.PI;

/**
 * @param {object} cols       channel arrays from MetricsCollector.columns()
 * @param {object} selection  {metricId: boolean}
 * @param {object} opts
 *   @param {object} opts.paramOverrides per-metric param overrides
 *   @param {boolean} opts.trafficAvailable gate interaction metrics
 *   @param {boolean} opts.gazeAvailable gate attention metrics
 *   @param {object} opts.gazeAnalysis native-rate analyzer summary (fixations,
 *          blinks, PERCLOS, glances) from window.GazeTracking.analyzer
 *   @param {[number,number]} opts.baselineRange [tStart,tEnd] for steering entropy
 * @returns {object} {metricId: {value|values, unit, ...}}
 */
export function computeMetrics(cols, selection, opts = {}) {
  const out = {};
  const trafficAvailable = !!opts.trafficAvailable;
  const gazeAvailable = !!opts.gazeAvailable;
  const overrides = opts.paramOverrides || {};
  const has = (id) => selection[id] && isComputable(id, trafficAvailable, gazeAvailable);

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

  // ---- Attention (gaze) ----
  // Channel-based measures come from the physics-rate sample-and-hold columns;
  // precision measures (fixations, blinks, PERCLOS, glances) come from the
  // native-rate analyzer summary passed in via opts.gazeAnalysis.
  computeGazeMetrics(out, cols, has, opts.gazeAnalysis || null);

  return out;
}

export function isComputable(id, trafficAvailable, gazeAvailable) {
  const m = getMetric(id);
  if (!m) return false;
  if (m.requiresTraffic && !trafficAvailable) return false;
  if (m.requiresGaze && !gazeAvailable) return false;
  return true;
}

// AOI code -> short label (mirrors src/gaze/config.js — the metrics bundle
// stays loadable without the gaze bundle, so the map is duplicated here).
const GAZE_AOI_LABELS = {
  0: 'road', 1: 'speedo', 2: 'throttle', 3: 'worm', 4: 'odometer',
  5: 'cluster', 6: 'menu', 7: 'overlay', 8: 'other', 9: 'off-screen',
};
const AOI_ROAD = 0;

function computeGazeMetrics(out, cols, has, analysis) {
  const anyGaze =
    has('percentRoadCenter') || has('aoiDwell') || has('trackingUptime') ||
    has('gazeDispersion') || has('offRoadGlances') || has('fixations') ||
    has('perclos') || has('blinkRate');
  if (!anyGaze) return;

  const aoi = cols.gazeAoi || [];
  const valid = cols.gazeValid || [];
  const dt = cols.dt || [];
  const gx = cols.gazeX || [];
  const gy = cols.gazeY || [];

  if (has('percentRoadCenter') || has('aoiDwell') || has('trackingUptime')) {
    let validT = 0;
    let roadT = 0;
    let totalT = 0;
    const dwell = {};
    for (let i = 0; i < aoi.length; i++) {
      const d = Number.isFinite(dt[i]) ? dt[i] : 0;
      totalT += d;
      if (!valid[i]) continue;
      validT += d;
      if (aoi[i] === AOI_ROAD) roadT += d;
      const key = String(aoi[i]);
      dwell[key] = (dwell[key] || 0) + d;
    }
    if (has('percentRoadCenter')) {
      out.percentRoadCenter = { value: validT > 0 ? (roadT / validT) * 100 : NaN, unit: '%' };
    }
    if (has('aoiDwell')) {
      const shares = {};
      for (const k in dwell) {
        shares[GAZE_AOI_LABELS[k] || k] = validT > 0 ? (dwell[k] / validT) * 100 : NaN;
      }
      out.aoiDwell = { value: validT > 0 ? 100 : NaN, shares, unit: '%' };
    }
    if (has('trackingUptime')) {
      out.trackingUptime = { value: totalT > 0 ? (validT / totalT) * 100 : NaN, unit: '%' };
    }
  }

  if (has('gazeDispersion')) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < gx.length; i++) {
      if (!valid[i] || !Number.isFinite(gx[i]) || !Number.isFinite(gy[i])) continue;
      sx += gx[i];
      sy += gy[i];
      n++;
    }
    if (n > 1) {
      const cx = sx / n;
      const cy = sy / n;
      let ss = 0;
      for (let i = 0; i < gx.length; i++) {
        if (!valid[i] || !Number.isFinite(gx[i])) continue;
        const dxp = gx[i] - cx;
        const dyp = gy[i] - cy;
        ss += dxp * dxp + dyp * dyp;
      }
      const rmsPx = Math.sqrt(ss / n);
      out.gazeDispersion = { value: rmsPx / gazePxPerDeg(), rmsPx, unit: 'deg' };
    } else {
      out.gazeDispersion = { value: NaN, unit: 'deg' };
    }
  }

  // analyzer-backed metrics
  if (has('offRoadGlances')) {
    out.offRoadGlances = analysis
      ? {
          value: analysis.glanceCount,
          meanDurationSec: analysis.glanceMeanDurSec,
          maxDurationSec: analysis.glanceMaxDurSec,
          perMin: analysis.glanceRatePerMin,
          longGlances: analysis.longGlanceCount,
          unit: 'count',
        }
      : { value: NaN, unit: 'count', note: 'gaze analyzer unavailable' };
  }
  if (has('fixations')) {
    out.fixations = analysis
      ? { value: analysis.fixationCount, meanDurationMs: analysis.fixationMeanDurMs, unit: 'count' }
      : { value: NaN, unit: 'count', note: 'gaze analyzer unavailable' };
  }
  if (has('perclos')) {
    out.perclos = analysis
      ? { value: analysis.perclos, windowSec: analysis.windowSec, unit: '%' }
      : { value: NaN, unit: '%', note: 'gaze analyzer unavailable' };
  }
  if (has('blinkRate')) {
    out.blinkRate = analysis
      ? { value: analysis.blinkRatePerMin, blinks: analysis.blinkCount, unit: '/min' }
      : { value: NaN, unit: '/min', note: 'gaze analyzer unavailable' };
  }
}

/** px per degree of visual angle from the render camera FOV (defensive). */
function gazePxPerDeg() {
  try {
    const h = typeof window !== 'undefined' && window.PromptDriveBridge
      ? window.PromptDriveBridge.handles : null;
    const fov = (h && h.camera && h.camera.fov) || 60;
    return window.innerHeight / fov;
  } catch (_) {
    return 12; // ~720px / 60°
  }
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
