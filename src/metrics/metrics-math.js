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

export function finiteValues(xs) {
  return xs.filter(Number.isFinite);
}

export function mean(xs) {
  const ys = finiteValues(xs);
  if (!ys.length) return NaN;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

/** Unbiased (N-1) sample standard deviation. Used for SDLP and SDS. */
export function sampleSD(xs) {
  const ys = finiteValues(xs);
  if (ys.length < 2) return NaN;
  const m = mean(ys);
  const ss = ys.reduce((s, x) => s + (x - m) ** 2, 0);
  return Math.sqrt(ss / (ys.length - 1));
}

export function median(xs) {
  const ys = finiteValues(xs).sort((a, b) => a - b);
  if (!ys.length) return NaN;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 ? ys[mid] : 0.5 * (ys[mid - 1] + ys[mid]);
}

/** Linear-interpolated percentile (p in [0,100]). */
export function percentile(xs, p) {
  const ys = finiteValues(xs).sort((a, b) => a - b);
  if (!ys.length) return NaN;
  if (ys.length === 1) return ys[0];
  const rank = (p / 100) * (ys.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return ys[lo];
  return ys[lo] + (ys[hi] - ys[lo]) * (rank - lo);
}

export function meanAbs(xs) {
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
export function resampleUniform(t, x, hz) {
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
export function butterworth2(signal, cutoffHz, fs) {
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

export function computeLaneStats(offsetsM) {
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
export function detectLaneDepartures(offsetsM, halfWidthsM, t, vehHalfWidthM) {
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

export function speedStats(speedMs) {
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
export function steeringReversalRate(steerDeg, fs, gapDeg = 3, cutoffHz = 0.6) {
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
export function steeringPredictionErrors(steerResampled) {
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
export function steeringEntropyBaseline(baselineSteerResampled) {
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
export function steeringEntropy(evalSteerResampled, alpha) {
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
export function tlcInstant(offsetM, halfLeftM, halfRightM, lateralVelMs, vehHalfWidthM = 0) {
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
export function tlcStats(tlcSeries) {
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
export function timeGap(rangeM, egoSpeedMs) {
  if (!Number.isFinite(rangeM) || !Number.isFinite(egoSpeedMs) || egoSpeedMs <= 0)
    return Infinity;
  return rangeM / egoSpeedMs;
}

/** 1-D TTC with optional constant-accel terms. (Report 1 ttc1D.) */
export function ttc1D(rangeM, egoSpeedMs, leadSpeedMs, egoAccMs2 = 0, leadAccMs2 = 0) {
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
export function tetTit(ttcSeriesSec, dtSec, thresholdSec = 3) {
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
