/**
 * Per-user gaze calibration: fits a 2nd-degree polynomial ridge mapping from
 * gaze features to normalized screen coordinates, validates it on held-out
 * points, and persists coefficients + quality to localStorage.
 *
 * All samples collected during a point's dwell (not per-point means) feed the
 * fit, so the ~21-coefficient system is well over-determined (9 points x
 * ~30 samples). Working in normalized coords keeps the mapping usable across
 * mild window resizes; a large viewport change marks it stale.
 */

import { CALIBRATION, GAZE_STORAGE } from './config.js';
import { polyExpand, ridgeFit, ridgePredict, pxPerDeg, meanOf } from './gaze-math.js';

/**
 * Fit the feature->screen mapping.
 * @param {Array<{features:number[], target:[number,number]}>} samples
 *   every valid raw sample from the calibration dwell phases
 * @returns {{coeffsX:number[], coeffsY:number[]}|null}
 */
export function fitCalibration(samples) {
  if (!samples || samples.length < 30) return null;
  const X = samples.map((s) => polyExpand(s.features));
  const yx = samples.map((s) => s.target[0]);
  const yy = samples.map((s) => s.target[1]);
  const coeffsX = ridgeFit(X, yx, CALIBRATION.RIDGE_LAMBDA);
  const coeffsY = ridgeFit(X, yy, CALIBRATION.RIDGE_LAMBDA);
  if (!coeffsX || !coeffsY) return null;
  return { coeffsX, coeffsY };
}

/** Map one feature vector to normalized screen coords with a fitted model. */
export function predictNorm(model, features) {
  const row = polyExpand(features);
  return { x: ridgePredict(model.coeffsX, row), y: ridgePredict(model.coeffsY, row) };
}

/**
 * Validation: per held-out point, mean predicted position vs target.
 * Errors are converted px -> degrees with the render camera's FOV so quality
 * reads in the same unit the literature uses.
 * @returns {{accuracyDeg:number, precisionDeg:number, perPoint:Array}}
 */
export function validateCalibration(model, pointSamples, viewportW, viewportH, fovDeg) {
  const ppd = pxPerDeg(viewportH, fovDeg);
  const perPoint = [];
  for (const p of pointSamples) {
    const preds = p.samples.map((s) => predictNorm(model, s.features));
    const mx = meanOf(preds.map((q) => q.x));
    const my = meanOf(preds.map((q) => q.y));
    const errPx = Math.hypot((mx - p.target[0]) * viewportW, (my - p.target[1]) * viewportH);
    // precision: RMS scatter of predictions around their own mean
    let ss = 0;
    let n = 0;
    for (const q of preds) {
      const d = Math.hypot((q.x - mx) * viewportW, (q.y - my) * viewportH);
      ss += d * d;
      n++;
    }
    const rmsPx = n ? Math.sqrt(ss / n) : NaN;
    perPoint.push({
      target: p.target,
      errorDeg: Number.isFinite(ppd) ? errPx / ppd : NaN,
      precisionDeg: Number.isFinite(ppd) ? rmsPx / ppd : NaN,
    });
  }
  return {
    accuracyDeg: meanOf(perPoint.map((q) => q.errorDeg)),
    precisionDeg: meanOf(perPoint.map((q) => q.precisionDeg)),
    perPoint,
  };
}

export function saveCalibration(model, quality) {
  const payload = {
    coeffsX: Array.from(model.coeffsX),
    coeffsY: Array.from(model.coeffsY),
    lambda: CALIBRATION.RIDGE_LAMBDA,
    accuracyDeg: quality ? quality.accuracyDeg : NaN,
    precisionDeg: quality ? quality.precisionDeg : NaN,
    screenW: window.innerWidth,
    screenH: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    createdAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(GAZE_STORAGE.calibration, JSON.stringify(payload));
  } catch (_) {
    /* storage blocked — calibration lives for this session only */
  }
  return payload;
}

/** @returns {{model, meta, stale:boolean}|null} */
export function loadCalibration() {
  let raw;
  try {
    raw = localStorage.getItem(GAZE_STORAGE.calibration);
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  let p;
  try {
    p = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (!p || !Array.isArray(p.coeffsX) || !Array.isArray(p.coeffsY)) return null;
  const drift = CALIBRATION.VIEWPORT_DRIFT_FRAC;
  const stale =
    Math.abs(window.innerWidth - p.screenW) > p.screenW * drift ||
    Math.abs(window.innerHeight - p.screenH) > p.screenH * drift;
  return {
    model: { coeffsX: p.coeffsX, coeffsY: p.coeffsY },
    meta: p,
    stale,
  };
}

export function clearCalibration() {
  try {
    localStorage.removeItem(GAZE_STORAGE.calibration);
  } catch (_) {
    /* ignore */
  }
}
