/* Gaze-tracking attention metrics — built from src/gaze/ */
(function () {
/* --- config.js --- */
/**
 * Gaze subsystem configuration: storage keys, AOI (area-of-interest) code map,
 * detection thresholds, and calibration layout. Single source of truth shared
 * by the tracker, analyzer, calibration UI and the metrics integration.
 *
 * Threshold provenance (see gaze-plan.md): ISO 15007 fixation bounds, NHTSA
 * visual-manual distraction guideline (2 s single-glance limit), and the
 * standard EAR blink literature values.
 */
const GAZE_STORAGE = {
  enabled: 'pd.gaze.enabled',
  calibration: 'pd.gaze.calibration.v1',
  skipPregame: 'pd.gaze.skipPregame',
  showDot: 'pd.gaze.showDot',
  rateHz: 'pd.gaze.rateHz',
};

/**
 * Gaze sampling rate (inference rate, decoupled from the 30 fps camera).
 * 15 Hz default: resolves the 2 s NHTSA glance standard within ±3% (boundary
 * error = ±half the sample interval) and keeps ISO 15007 200 ms minimum
 * fixations detectable (3 samples). Raise to 30 Hz for blink/PERCLOS studies
 * (short blinks are under-sampled below ~15 Hz); 5–10 Hz suffices when only
 * multi-second glance monitoring matters.
 */
const RATE_DEFAULT_HZ = 15;
const RATE_MIN_HZ = 5;
const RATE_MAX_HZ = 30;

/** Inference input size — the landmarker downsamples internally to ≤256 px,
 *  so a 320×240 grab loses nothing while quartering upload cost vs 640×480. */
const INFER_WIDTH = 320;
const INFER_HEIGHT = 240;
function clampRateHz(hz) {
  const n = Number(hz);
  if (!Number.isFinite(n)) return RATE_DEFAULT_HZ;
  return Math.min(RATE_MAX_HZ, Math.max(RATE_MIN_HZ, Math.round(n)));
}
function loadRateHz() {
  try {
    const raw = localStorage.getItem(GAZE_STORAGE.rateHz);
    if (raw === null) return RATE_DEFAULT_HZ;
    return clampRateHz(raw);
  } catch (_) {
    return RATE_DEFAULT_HZ;
  }
}

/**
 * AOI codes are Float64Array-friendly numbers logged per sample. Negative =
 * no usable gaze; 0..9 = classified screen regions.
 */
const AOI = {
  EYES_CLOSED: -2,
  INVALID: -1,
  ROAD_AHEAD: 0,
  SPEEDOMETER: 1,
  THROTTLE_GAUGE: 2,
  ROAD_WORM: 3,
  ODOMETER: 4,
  CLUSTER_OTHER: 5,
  MENU_BAR: 6,
  METRICS_OVERLAY: 7,
  OTHER_ONSCREEN: 8,
  OFF_SCREEN: 9,
};
const AOI_LABELS = {
  '-2': 'eyes-closed',
  '-1': 'invalid',
  0: 'road-ahead',
  1: 'speedometer',
  2: 'throttle-gauge',
  3: 'road-worm',
  4: 'odometer',
  5: 'cluster-other',
  6: 'menu-bar',
  7: 'metrics-overlay',
  8: 'other-onscreen',
  9: 'off-screen',
};
const GAZE_THRESHOLDS = {
  // Eye aspect ratio blink detection (with reopen hysteresis).
  EAR_BLINK: 0.20,
  EAR_OPEN: 0.25,
  BLINK_MIN_MS: 70,
  BLINK_MAX_MS: 500,
  // Eyes closed longer than a blink => drowsiness episode.
  EYES_CLOSED_EVENT_S: 0.5,
  PERCLOS_WINDOW_S: 60,
  // Glance/fixation logic.
  OFFROAD_GLANCE_MIN_S: 0.30,
  NHTSA_LONG_GLANCE_S: 2.0,
  IDT_DISPERSION_DEG: 1.5,
  IDT_MIN_FIX_MS: 200,
  IDT_MAX_FIX_MS: 2000,
  // A held sample older than this is reported invalid (face lost / tab hidden).
  STALE_SAMPLE_MS: 200,
  // Road-ahead AOI: angular radius around the projected look-ahead point.
  ROAD_AHEAD_RADIUS_DEG: 8,
  ROAD_AHEAD_DISTANCE_M: 40,
  // Head pose beyond this is far off-screen regardless of the mapping.
  HEAD_YAW_LIMIT_DEG: 35,
  HEAD_PITCH_LIMIT_DEG: 30,
};
const CALIBRATION = {
  RIDGE_LAMBDA: 1e-3,
  SETTLE_MS: 500, // shrink animation before samples count
  COLLECT_MS: 1200, // per-point collection window
  ACCURACY_OK_DEG: 3.0, // suggest redo above this
  VIEWPORT_DRIFT_FRAC: 0.10, // stored-vs-current viewport => stale calibration
  // 3x3 calibration grid + 4-point validation, in normalized viewport coords.
  POINTS_9: [
    [0.10, 0.10], [0.50, 0.10], [0.90, 0.10],
    [0.10, 0.50], [0.50, 0.50], [0.90, 0.50],
    [0.10, 0.90], [0.50, 0.90], [0.90, 0.90],
  ],
  VALIDATION_POINTS_4: [
    [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
  ],
};

/**
 * MediaPipe Face Mesh landmark indices.
 * EAR sextets are ordered [corner, lidA, lidB, corner, lidC, lidD] such that
 * |p2-p6| and |p3-p5| are vertical lid distances (see gaze-math.js).
 */
const LANDMARKS = {
  EAR_RIGHT: [33, 159, 158, 133, 153, 145],
  EAR_LEFT: [362, 380, 374, 263, 386, 385],
  // eye corners (outer, inner) and iris centers from the refined mesh
  RIGHT_EYE_OUTER: 33,
  RIGHT_EYE_INNER: 133,
  RIGHT_IRIS_CENTER: 468,
  LEFT_EYE_INNER: 362,
  LEFT_EYE_OUTER: 263,
  LEFT_IRIS_CENTER: 473,
};

/** Where the vendored MediaPipe assets live (see scripts/fetch-gaze-deps.js). */
const MEDIAPIPE_BASE = './static/lib/mediapipe';

/**
 * Fallback AOI rects (normalized viewport coords) used when live 3D projection
 * of the instrument cluster is unavailable (exterior camera, no cluster).
 */
const FALLBACK_REGIONS = {
  roadAhead: { x: 0.30, y: 0.15, w: 0.40, h: 0.45 },
  menuBar: { x: 0, y: 0.94, w: 1, h: 0.06 },
};
function loadGazeFlag(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true' || raw === '1';
  } catch (_) {
    return fallback;
  }
}
function saveGazeFlag(key, v) {
  try {
    localStorage.setItem(key, v ? 'true' : 'false');
  } catch (_) {
    /* ignore */
  }
}


/* --- filters.js --- */
/**
 * Signal filters for the gaze pipeline. The mapped gaze point is smoothed with
 * a 1-euro filter (Casiez et al. 2012): jitter-free when the eye is still,
 * low-lag when it saccades — a better fit than a fixed-cutoff filter at the
 * webcam's ~30 Hz sample rate.
 */

class OneEuroChannel {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.prevX = null;
    this.prevDx = 0;
    this.prevT = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    if (this.prevX === null || this.prevT === null || t <= this.prevT) {
      this.prevX = x;
      this.prevT = t;
      return x;
    }
    const dt = t - this.prevT;
    const dx = (x - this.prevX) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.prevDx;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.prevX;
    this.prevX = xHat;
    this.prevDx = dxHat;
    this.prevT = t;
    return xHat;
  }

  reset() {
    this.prevX = null;
    this.prevDx = 0;
    this.prevT = null;
  }
}
class OneEuroFilter2D {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.x = new OneEuroChannel(minCutoff, beta, dCutoff);
    this.y = new OneEuroChannel(minCutoff, beta, dCutoff);
  }

  /** @param {number} t seconds */
  filter(x, y, t) {
    return { x: this.x.filter(x, t), y: this.y.filter(y, t) };
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }
}

/** Simple exponential moving average (used to steady the EAR readout). */
class Ema {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }
  push(v) {
    this.value = this.value === null ? v : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }
  reset() {
    this.value = null;
  }
}


/* --- gaze-math.js --- */
/**
 * Pure math for the gaze pipeline (mirrors metrics-math.js: no DOM, no state).
 *  - EAR from mesh landmarks (blink / eye-openness),
 *  - head pose from MediaPipe's facial transformation matrix,
 *  - the gaze feature vector (iris offsets + head pose),
 *  - 2nd-degree polynomial ridge regression (calibration mapping),
 *  - px <-> deg conversion from the render camera's vertical FOV.
 */

const RAD2DEG = 180 / Math.PI;

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Eye aspect ratio for one eye. `idx` is a sextet ordered so that
 * (idx[1],idx[5]) and (idx[2],idx[4]) are vertically opposed lid landmarks and
 * (idx[0],idx[3]) are the corners:  EAR = (|p2-p6| + |p3-p5|) / (2 |p1-p4|).
 * ~0.3 open, ~0 closed.
 */
function earFromLandmarks(landmarks, idx) {
  const p1 = landmarks[idx[0]];
  const p2 = landmarks[idx[1]];
  const p3 = landmarks[idx[2]];
  const p4 = landmarks[idx[3]];
  const p5 = landmarks[idx[4]];
  const p6 = landmarks[idx[5]];
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return NaN;
  const horiz = dist2d(p1, p4);
  if (!(horiz > 1e-6)) return NaN;
  return (dist2d(p2, p6) + dist2d(p3, p5)) / (2 * horiz);
}

/**
 * Yaw/pitch/roll (degrees) from MediaPipe's 4x4 column-major facial
 * transformation matrix (facialTransformationMatrixes[0].data). Y-X-Z
 * decomposition of the rotation block; exact convention matters little
 * downstream because the calibration mapping learns the signs.
 */
function headPoseFromMatrix(m) {
  if (!m || m.length < 11) return { yaw: NaN, pitch: NaN, roll: NaN };
  // column-major: R[row][col] = m[col*4 + row]
  const r02 = m[8];
  const r12 = m[9];
  const r22 = m[10];
  const r10 = m[1];
  const r11 = m[5];
  const yaw = Math.atan2(r02, r22) * RAD2DEG;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r12))) * RAD2DEG;
  const roll = Math.atan2(r10, r11) * RAD2DEG;
  return { yaw, pitch, roll };
}

/**
 * Gaze feature vector: per-eye iris-center offset from the eye-corner midpoint,
 * normalized by the inter-corner distance (head-size and distance invariant),
 * plus head yaw/pitch in degrees. 6 features total.
 * Landmark roles are passed in via `L` (see config.LANDMARKS).
 */
function featureVector(landmarks, headYaw, headPitch, L) {
  const eye = (outerIdx, innerIdx, irisIdx) => {
    const a = landmarks[outerIdx];
    const b = landmarks[innerIdx];
    const iris = landmarks[irisIdx];
    if (!a || !b || !iris) return null;
    const w = dist2d(a, b);
    if (!(w > 1e-6)) return null;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return { x: (iris.x - mx) / w, y: (iris.y - my) / w };
  };
  const right = eye(L.RIGHT_EYE_OUTER, L.RIGHT_EYE_INNER, L.RIGHT_IRIS_CENTER);
  const left = eye(L.LEFT_EYE_INNER, L.LEFT_EYE_OUTER, L.LEFT_IRIS_CENTER);
  if (!right || !left || !Number.isFinite(headYaw) || !Number.isFinite(headPitch)) return null;
  // head pose scaled to roughly the same magnitude as the iris offsets
  return [right.x, right.y, left.x, left.y, headYaw / 45, headPitch / 45];
}

/**
 * 2nd-degree polynomial expansion of the 6-feature vector:
 * bias + linear (6) + squares (6) + iris x head-pose cross terms (8) = 21.
 */
function polyExpand(f) {
  const out = [1];
  for (let i = 0; i < 6; i++) out.push(f[i]);
  for (let i = 0; i < 6; i++) out.push(f[i] * f[i]);
  for (let i = 0; i < 4; i++) {
    out.push(f[i] * f[4]);
    out.push(f[i] * f[5]);
  }
  return out;
}

/**
 * Ridge regression via normal equations: w = (X'X + λI)^-1 X'y.
 * X: array of expanded feature rows, y: array of targets. Solved with plain
 * Gaussian elimination (the system is only ~21x21).
 */
function ridgeFit(X, y, lambda) {
  const n = X.length;
  if (!n) return null;
  const d = X[0].length;
  // A = X'X + λI (bias term regularized too — harmless at λ=1e-3), b = X'y
  const A = [];
  for (let i = 0; i < d; i++) A.push(new Float64Array(d));
  const b = new Float64Array(d);
  for (let r = 0; r < n; r++) {
    const row = X[r];
    const t = y[r];
    for (let i = 0; i < d; i++) {
      b[i] += row[i] * t;
      const Ai = A[i];
      for (let j = i; j < d; j++) Ai[j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < d; i++) {
    A[i][i] += lambda;
    for (let j = 0; j < i; j++) A[i][j] = A[j][i]; // symmetrize lower triangle
  }
  return solveGaussian(A, b, d);
}

function solveGaussian(A, b, d) {
  // augmented in-place elimination with partial pivoting
  const M = A.map((row, i) => {
    const out = new Float64Array(d + 1);
    out.set(row);
    out[d] = b[i];
    return out;
  });
  for (let col = 0; col < d; col++) {
    let pivot = col;
    for (let r = col + 1; r < d; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // singular
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const P = M[col];
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const f = M[r][col] / P[col];
      if (f === 0) continue;
      const R = M[r];
      for (let c = col; c <= d; c++) R[c] -= f * P[c];
    }
  }
  const w = new Array(d);
  for (let i = 0; i < d; i++) w[i] = M[i][d] / M[i][i];
  return w;
}
function ridgePredict(coeffs, expandedRow) {
  let s = 0;
  for (let i = 0; i < coeffs.length; i++) s += coeffs[i] * expandedRow[i];
  return s;
}

/**
 * Pixels per degree of visual angle, from the render camera's vertical FOV.
 * Coarse (assumes the viewer subtends the camera frustum) but consistent — it
 * is used symmetrically for both calibration accuracy and I-DT dispersion.
 */
function pxPerDeg(viewportH, fovDeg) {
  if (!(viewportH > 0) || !(fovDeg > 0)) return NaN;
  return viewportH / fovDeg;
}
function meanOf(xs) {
  let s = 0;
  let n = 0;
  for (const v of xs) {
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : NaN;
}


/* --- calibration.js --- */
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




/**
 * Fit the feature->screen mapping.
 * @param {Array<{features:number[], target:[number,number]}>} samples
 *   every valid raw sample from the calibration dwell phases
 * @returns {{coeffsX:number[], coeffsY:number[]}|null}
 */
function fitCalibration(samples) {
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
function predictNorm(model, features) {
  const row = polyExpand(features);
  return { x: ridgePredict(model.coeffsX, row), y: ridgePredict(model.coeffsY, row) };
}

/**
 * Validation: per held-out point, mean predicted position vs target.
 * Errors are converted px -> degrees with the render camera's FOV so quality
 * reads in the same unit the literature uses.
 * @returns {{accuracyDeg:number, precisionDeg:number, perPoint:Array}}
 */
function validateCalibration(model, pointSamples, viewportW, viewportH, fovDeg) {
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
function saveCalibration(model, quality) {
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
function loadCalibration() {
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
function clearCalibration() {
  try {
    localStorage.removeItem(GAZE_STORAGE.calibration);
  } catch (_) {
    /* ignore */
  }
}


/* --- FaceEngine.js --- */
/**
 * Webcam + MediaPipe FaceLandmarker front-end. Owns the camera lifecycle and
 * the frame loop; emits raw gaze-feature samples to a subscriber.
 *
 * Performance model: inference runs in a Web Worker (static/js/gaze-worker.js)
 * so the sim's render loop never blocks on it. The main thread only grabs a
 * downscaled ImageBitmap at the configured sampling rate (rateHz — decoupled
 * from the 30 fps camera; see config.js for the automotive-rate rationale) and
 * transfers it; one frame is in flight at a time, extra frames are dropped.
 * If module workers / createImageBitmap are unavailable the engine falls back
 * to the original main-thread detectForVideo path (still rate-gated).
 *
 * Privacy: frames are processed in-memory by the on-device model and dropped —
 * nothing is retained, recorded, or transmitted. Only derived features (iris
 * offsets, EAR, head pose) leave the worker.
 */




const WORKER_URL = './static/js/gaze-worker.js';
class FaceEngine {
  constructor() {
    this.status = 'idle'; // idle|starting|running|denied|no-camera|load-failed|stopped
    this.mode = null; // 'worker' | 'main-thread' (set once running)
    this.delegate = null; // 'GPU' | 'CPU' (informational)
    this.fps = 0; // measured inference rate
    this.rateHz = RATE_DEFAULT_HZ; // target sampling rate; GazeTracking updates it live
    this.onSample = null; // ({t, features, earL, earR, headYaw, headPitch, faceFound})
    this._video = null;
    this._stream = null;
    this._landmarker = null; // main-thread fallback only
    this._worker = null;
    this._inFlight = false;
    this._lastGrab = 0;
    this._running = false;
    this._injectedVideo = null;
    this._frameCount = 0;
    this._fpsWindowStart = 0;
    this._rafId = 0;
    this._vfcId = 0;
  }

  /** Test seam: bypass getUserMedia and read frames from a supplied element. */
  setVideoSource(el) {
    this._injectedVideo = el || null;
  }

  async start() {
    if (this._running) return this.status;
    this.status = 'starting';
    try {
      if (this._injectedVideo) {
        this._video = this._injectedVideo;
      } else {
        this._stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: 30, facingMode: 'user' },
          audio: false,
        });
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';
        video.srcObject = this._stream;
        document.body.appendChild(video);
        await video.play();
        this._video = video;
      }
    } catch (e) {
      this.status = e && e.name === 'NotAllowedError' ? 'denied'
        : e && e.name === 'NotFoundError' ? 'no-camera' : 'load-failed';
      this._teardownVideo();
      return this.status;
    }

    // Prefer the worker path; fall back to main-thread inference.
    try {
      await this._startWorker();
      this.mode = 'worker';
    } catch (workerErr) {
      console.warn('GazeTracking: worker inference unavailable, falling back to main thread', workerErr);
      this._stopWorker();
      try {
        await this._createLandmarker();
        this.mode = 'main-thread';
      } catch (e) {
        console.error('GazeTracking: MediaPipe load failed', e);
        this.status = 'load-failed';
        this._teardownVideo();
        return this.status;
      }
    }

    this._running = true;
    this.status = 'running';
    this._fpsWindowStart = performance.now();
    this._frameCount = 0;
    this._lastGrab = 0;
    this._inFlight = false;
    this._loop();
    return this.status;
  }

  // --- worker path ---------------------------------------------------------
  async _startWorker() {
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
      throw new Error('Worker/createImageBitmap unsupported');
    }
    // CLASSIC worker (no {type:'module'}): MediaPipe's FilesetResolver calls
    // importScripts() internally, which module workers forbid; dynamic
    // import() of the ESM vision bundle is still legal in classic workers.
    // Asset URLs resolve against the page, not the worker's static/js/ base.
    const worker = new Worker(new URL(WORKER_URL, document.baseURI));
    this._worker = worker;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker init timeout')), 20000);
      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`worker error: ${e.message || 'load failed'}`));
      };
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg && msg.type === 'ready') {
          clearTimeout(timeout);
          this.delegate = msg.delegate;
          resolve();
        } else if (msg && msg.type === 'init-error') {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      };
      worker.postMessage({
        type: 'init',
        bundleUrl: new URL(`${MEDIAPIPE_BASE}/vision_bundle.mjs`, document.baseURI).href,
        wasmUrl: new URL(`${MEDIAPIPE_BASE}/wasm`, document.baseURI).href,
        modelUrl: new URL(`${MEDIAPIPE_BASE}/face_landmarker.task`, document.baseURI).href,
      });
    });
    // steady-state message handling
    worker.onerror = (e) => console.error('GazeTracking worker error', e.message || e);
    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.type !== 'sample') return;
      this._inFlight = false;
      this._countFrame();
      if (this.onSample) this.onSample(msg);
    };
  }

  _stopWorker() {
    if (this._worker) {
      try { this._worker.terminate(); } catch (_) { /* already gone */ }
      this._worker = null;
    }
    this._inFlight = false;
  }

  // --- main-thread fallback path --------------------------------------------
  async _createLandmarker() {
    // Resolve against the page URL: inside the bundled classic script a bare
    // relative specifier would resolve against static/js/ instead.
    const bundleUrl = new URL(`${MEDIAPIPE_BASE}/vision_bundle.mjs`, document.baseURI).href;
    const vision = await import(bundleUrl);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_BASE}/wasm`);
    const options = (delegate) => ({
      baseOptions: {
        modelAssetPath: `${MEDIAPIPE_BASE}/face_landmarker.task`,
        delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
    try {
      this._landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (_) {
      // Some machines have no usable WebGL delegate — fall back to CPU wasm.
      this._landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
  }

  // --- frame loop -------------------------------------------------------------
  _loop() {
    const step = () => {
      if (!this._running) return;
      this._grab();
      this._schedule(step);
    };
    this._schedule(step);
  }

  _schedule(fn) {
    const v = this._video;
    if (v && typeof v.requestVideoFrameCallback === 'function') {
      this._vfcId = v.requestVideoFrameCallback(() => fn());
    } else {
      this._rafId = requestAnimationFrame(() => fn());
    }
  }

  /** Rate-gated frame grab: skip until the sampling interval elapsed. */
  _grab() {
    const v = this._video;
    if (!v) return;
    if (v.readyState < 2 || !v.videoWidth) return; // no frame yet
    if (typeof document !== 'undefined' && document.hidden) return; // no one is looking
    const nowMs = performance.now();
    const interval = 1000 / Math.max(1, this.rateHz || RATE_DEFAULT_HZ);
    if (nowMs - this._lastGrab < interval) return;

    if (this.mode === 'worker') {
      if (this._inFlight) return; // drop frame — inference still busy
      this._lastGrab = nowMs;
      this._inFlight = true;
      createImageBitmap(v, { resizeWidth: INFER_WIDTH, resizeHeight: INFER_HEIGHT })
        .then((bitmap) => {
          if (!this._running || !this._worker) {
            bitmap.close();
            this._inFlight = false;
            return;
          }
          this._worker.postMessage({ type: 'frame', bitmap, ts: nowMs }, [bitmap]);
        })
        .catch(() => {
          this._inFlight = false;
        });
      return;
    }

    // main-thread fallback
    this._lastGrab = nowMs;
    this._detectMainThread(v, nowMs);
  }

  _detectMainThread(v, nowMs) {
    if (!this._landmarker) return;
    let result;
    try {
      result = this._landmarker.detectForVideo(v, nowMs);
    } catch (_) {
      return; // transient decode failure; next frame will retry
    }
    this._countFrame();
    const t = nowMs / 1000;
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    if (!lm) {
      if (this.onSample) this.onSample({ t, faceFound: false });
      return;
    }
    const earR = earFromLandmarks(lm, LANDMARKS.EAR_RIGHT);
    const earL = earFromLandmarks(lm, LANDMARKS.EAR_LEFT);
    const mat = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
    const pose = headPoseFromMatrix(mat && mat.data);
    const features = featureVector(lm, pose.yaw, pose.pitch, LANDMARKS);
    if (this.onSample) {
      this.onSample({
        t,
        faceFound: true,
        features,
        earL,
        earR,
        headYaw: pose.yaw,
        headPitch: pose.pitch,
        headRoll: pose.roll,
      });
    }
  }

  _countFrame() {
    this._frameCount++;
    const nowMs = performance.now();
    if (nowMs - this._fpsWindowStart > 1000) {
      this.fps = (this._frameCount * 1000) / (nowMs - this._fpsWindowStart);
      this._frameCount = 0;
      this._fpsWindowStart = nowMs;
    }
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._vfcId && this._video && typeof this._video.cancelVideoFrameCallback === 'function') {
      this._video.cancelVideoFrameCallback(this._vfcId);
    }
    this._stopWorker();
    if (this._landmarker) {
      try { this._landmarker.close(); } catch (_) { /* already closed */ }
      this._landmarker = null;
    }
    this._teardownVideo();
    this.status = 'stopped';
    this.mode = null;
    this.fps = 0;
  }

  _teardownVideo() {
    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop();
      this._stream = null;
    }
    if (this._video && this._video !== this._injectedVideo) this._video.remove();
    this._video = null;
  }
}


/* --- aoi.js --- */
/**
 * AOI (area-of-interest) projection + classification. Turns the current 3D
 * scene into a small set of screen-space rects — instrument-cluster zones
 * (projected from the dashboard plane mesh through the render camera), the
 * road-ahead look point, and DOM chrome (menu bar, metrics overlay) — then
 * classifies gaze points against them.
 *
 * Projection is recomputed on a 1 Hz timer plus resize/camera events; per
 * sample classification is a handful of rect tests. Engine handles come from
 * window.PromptDriveBridge (camera, ego, controller, THREE) and every access
 * is defensive: with no handles the projector falls back to static regions.
 *
 * Zone geometry mirrors src/cluster/layout.js `zonesForCanvas()` (the cluster
 * bundle does not export it); canvas + plane dimensions are read live from the
 * cluster instance/mesh so a layout resize keeps the two in sync.
 */




const REPROJECT_MS = 1000;
class AoiProjector {
  constructor() {
    this._zones = []; // [{aoi, rect:{x,y,w,h}}] in CSS px, priority order
    this._roadAhead = null; // {cx, cy, r} px
    this._lastProject = 0;
    this._onResize = () => {
      this._lastProject = 0;
    };
    window.addEventListener('resize', this._onResize);
  }

  _handles() {
    try {
      return (window.PromptDriveBridge && window.PromptDriveBridge.handles) || null;
    } catch (_) {
      return null;
    }
  }

  /** Recompute projected zones if the reproject interval elapsed. */
  _maybeProject() {
    const now = performance.now();
    if (now - this._lastProject < REPROJECT_MS) return;
    this._lastProject = now;
    this._zones = [];
    this._roadAhead = null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // --- DOM chrome (always available) ---
    const overlay = document.querySelector('.pd-overlay.open');
    if (overlay) {
      const r = overlay.getBoundingClientRect();
      this._zones.push({ aoi: AOI.METRICS_OVERLAY, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    }
    const bar = document.getElementById('menu-bar') || document.getElementById('menu-bar-left');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        this._zones.push({ aoi: AOI.MENU_BAR, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
    } else {
      const f = FALLBACK_REGIONS.menuBar;
      this._zones.push({ aoi: AOI.MENU_BAR, rect: { x: f.x * vw, y: f.y * vh, w: f.w * vw, h: f.h * vh } });
    }

    const h = this._handles();
    const camera = h && h.camera;
    const THREE = h && h.THREE;

    // --- Instrument cluster zones (interior view only) ---
    const controller = h && h.controller;
    const cluster = controller && controller.instrumentCluster;
    const mesh = (controller && controller.clusterMesh) || (cluster && cluster.overlayMesh);
    if (camera && THREE && mesh && mesh.parent && mesh.visible !== false) {
      try {
        this._projectClusterZones(mesh, cluster, camera, THREE, vw, vh);
      } catch (_) {
        /* mesh/camera mid-rebuild — retry next tick */
      }
    }

    // --- Road-ahead look point ---
    if (camera && THREE) {
      try {
        this._projectRoadAhead(h, camera, THREE, vw, vh);
      } catch (_) {
        this._roadAhead = null;
      }
    }
    if (!this._roadAhead) {
      const f = FALLBACK_REGIONS.roadAhead;
      this._roadAhead = {
        rect: { x: f.x * vw, y: f.y * vh, w: f.w * vw, h: f.h * vh },
      };
    }
  }

  _projectClusterZones(mesh, cluster, camera, THREE, vw, vh) {
    const geo = mesh.geometry;
    const planeW = (geo && geo.parameters && geo.parameters.width) || 0.30;
    const planeH = (geo && geo.parameters && geo.parameters.height) || 0.093;
    const canvas = cluster && cluster.canvas;
    const cw = (canvas && canvas.width) || 1292;
    const chh = (canvas && canvas.height) || 400;

    // canvas-space zone rects, mirroring cluster/layout.js zonesForCanvas()
    const gaugeCy = chh * 0.46;
    const r = chh * 0.32;
    const pad = chh * 0.05;
    const canvasZones = [
      { aoi: AOI.SPEEDOMETER, x: cw * 0.225 - r - pad, y: gaugeCy - r - pad, w: 2 * (r + pad), h: 2 * (r + pad) },
      { aoi: AOI.THROTTLE_GAUGE, x: cw * 0.775 - r - pad, y: gaugeCy - r - pad, w: 2 * (r + pad), h: 2 * (r + pad) },
      { aoi: AOI.ROAD_WORM, x: cw * 0.5 - (chh * 0.62) / 2, y: chh * 0.03, w: chh * 0.62, h: chh * 0.45 },
      { aoi: AOI.ODOMETER, x: cw * 0.35, y: chh * 0.50, w: cw * 0.30, h: chh * 0.50 },
      { aoi: AOI.CLUSTER_OTHER, x: 0, y: 0, w: cw, h: chh },
    ];

    mesh.updateWorldMatrix(true, false);
    const v = new THREE.Vector3();
    const project = (cx, cy) => {
      // canvas px -> plane-local metres -> world -> NDC -> CSS px
      v.set((cx / cw - 0.5) * planeW, (0.5 - cy / chh) * planeH, 0);
      mesh.localToWorld(v);
      v.project(camera);
      if (v.z > 1) return null; // behind the camera
      return { x: ((v.x + 1) / 2) * vw, y: ((1 - v.y) / 2) * vh };
    };

    for (const z of canvasZones) {
      const corners = [
        project(z.x, z.y),
        project(z.x + z.w, z.y),
        project(z.x, z.y + z.h),
        project(z.x + z.w, z.y + z.h),
      ];
      if (corners.some((c) => !c)) continue;
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      this._zones.push({
        aoi: z.aoi,
        rect: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
      });
    }
  }

  _projectRoadAhead(h, camera, THREE, vw, vh) {
    const dist = GAZE_THRESHOLDS.ROAD_AHEAD_DISTANCE_M;
    const dir = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const ego = h.ego;
    const vel = ego && ego.vel;
    if (vel && typeof vel.length === 'function' && vel.length() > 2) {
      dir.copy(vel).normalize();
      origin.copy(ego.position);
    } else {
      // stationary: look where the camera looks
      camera.getWorldDirection(dir);
      camera.getWorldPosition(origin);
    }
    const p = origin.clone().addScaledVector(dir, dist);
    p.y += 0.5; // roughly at road-surface eye line rather than under the car
    p.project(camera);
    if (p.z > 1) return;
    const cx = ((p.x + 1) / 2) * vw;
    const cy = ((1 - p.y) / 2) * vh;
    const fov = camera.fov || 60;
    const rPx = GAZE_THRESHOLDS.ROAD_AHEAD_RADIUS_DEG * pxPerDeg(vh, fov);
    if (!Number.isFinite(rPx) || rPx <= 0) return;
    this._roadAhead = { cx, cy, r: rPx };
  }

  /**
   * Classify one gaze sample. Priority: eyes-closed > invalid > off-screen >
   * DOM chrome > cluster zones > road-ahead > other-onscreen.
   * @returns {number} AOI code
   */
  classify(x, y, eyesClosed, valid) {
    if (eyesClosed) return AOI.EYES_CLOSED;
    if (!valid || !Number.isFinite(x) || !Number.isFinite(y)) return AOI.INVALID;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x < 0 || y < 0 || x > vw || y > vh) return AOI.OFF_SCREEN;
    this._maybeProject();

    for (const z of this._zones) {
      const r = z.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return z.aoi;
    }
    const ra = this._roadAhead;
    if (ra) {
      if (ra.r != null) {
        if (Math.hypot(x - ra.cx, y - ra.cy) <= ra.r) return AOI.ROAD_AHEAD;
      } else if (ra.rect) {
        const r = ra.rect;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return AOI.ROAD_AHEAD;
      }
    }
    return AOI.OTHER_ONSCREEN;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
  }
}


/* --- GazeAnalyzer.js --- */
/**
 * Native-rate gaze analysis. Keeps a ring buffer of every ~30 Hz sample (the
 * metrics collector only holds the physics-rate sample-and-hold copy) and runs
 * streaming detectors for blinks, off-road glance episodes, and long
 * eyes-closed periods. Emits distraction/drowsiness events into the metrics
 * event stream via the DrivingMetrics facade.
 *
 * `analyze(lastSeconds)` produces the summary consumed by compute.js for the
 * precision attention metrics (fixations, PERCLOS, blink rate, glances).
 */




// Local alias (a `as TH` import alias would be lost when the build strips
// module syntax — see scripts/build-gaze.js).
const TH = GAZE_THRESHOLDS;

const CAPACITY = 30 * 60 * 30; // 30 min at 30 Hz
class GazeAnalyzer {
  constructor() {
    this.cap = CAPACITY;
    this.n = 0; // total samples ever pushed
    this.t = new Float64Array(this.cap);
    this.x = new Float64Array(this.cap);
    this.y = new Float64Array(this.cap);
    this.ear = new Float64Array(this.cap);
    this.valid = new Float64Array(this.cap);
    this.aoi = new Float64Array(this.cap);

    this.metrics = null; // DrivingMetrics facade (event sink), set by GazeTracking

    // streaming state
    this._blinkState = 'open';
    this._blinkStart = 0;
    this.blinkTimes = []; // seconds (sample clock)
    this._glanceStart = null; // {t, counts:{}} while off-road run active
    this._glanceEmitted = false;
    this.glances = []; // {tStart, dur, aoiMode}
    this._closedStart = null;
    this._closedEmitted = false;
  }

  setMetrics(m) {
    this.metrics = m;
  }

  reset() {
    this.n = 0;
    this._blinkState = 'open';
    this.blinkTimes = [];
    this._glanceStart = null;
    this._glanceEmitted = false;
    this.glances = [];
    this._closedStart = null;
    this._closedEmitted = false;
  }

  push(s) {
    const i = this.n % this.cap;
    this.t[i] = s.t;
    this.x[i] = s.x;
    this.y[i] = s.y;
    this.ear[i] = s.ear;
    this.valid[i] = s.valid ? 1 : 0;
    this.aoi[i] = s.aoi;
    this.n++;
    this._streamBlink(s);
    this._streamGlance(s);
    this._streamEyesClosed(s);
  }

  _emitEvent(type, data) {
    if (this.metrics && typeof this.metrics.addEvent === 'function') {
      try {
        this.metrics.addEvent(type, data);
      } catch (_) {
        /* metrics not recording */
      }
    }
  }

  _streamBlink(s) {
    if (!Number.isFinite(s.ear)) return;
    if (this._blinkState === 'open' && s.ear < TH.EAR_BLINK) {
      this._blinkState = 'closed';
      this._blinkStart = s.t;
    } else if (this._blinkState === 'closed' && s.ear > TH.EAR_OPEN) {
      this._blinkState = 'open';
      const durMs = (s.t - this._blinkStart) * 1000;
      if (durMs >= TH.BLINK_MIN_MS && durMs <= TH.BLINK_MAX_MS) {
        this.blinkTimes.push(s.t);
        if (this.blinkTimes.length > 5000) this.blinkTimes.splice(0, 1000);
      }
    }
  }

  _streamGlance(s) {
    const offRoad = s.valid && s.aoi !== AOI.ROAD_AHEAD && s.aoi >= 0;
    if (offRoad) {
      if (!this._glanceStart) {
        this._glanceStart = { t: s.t, counts: {} };
        this._glanceEmitted = false;
      }
      const c = this._glanceStart.counts;
      c[s.aoi] = (c[s.aoi] || 0) + 1;
      const dur = s.t - this._glanceStart.t;
      if (dur > TH.NHTSA_LONG_GLANCE_S && !this._glanceEmitted) {
        this._glanceEmitted = true;
        this._emitEvent('distraction', {
          durationSec: dur,
          aoi: AOI_LABELS[String(this._modeAoi(c))] || 'unknown',
          ongoing: true,
        });
      }
    } else if (this._glanceStart) {
      const dur = s.t - this._glanceStart.t;
      if (dur >= TH.OFFROAD_GLANCE_MIN_S) {
        this.glances.push({
          tStart: this._glanceStart.t,
          dur,
          aoiMode: this._modeAoi(this._glanceStart.counts),
        });
        if (this.glances.length > 5000) this.glances.splice(0, 1000);
      }
      this._glanceStart = null;
    }
  }

  _modeAoi(counts) {
    let best = -1;
    let bestN = -1;
    for (const k in counts) {
      if (counts[k] > bestN) {
        bestN = counts[k];
        best = Number(k);
      }
    }
    return best;
  }

  _streamEyesClosed(s) {
    const closed = Number.isFinite(s.ear) && s.ear < TH.EAR_BLINK;
    if (closed) {
      if (this._closedStart === null) {
        this._closedStart = s.t;
        this._closedEmitted = false;
      } else if (!this._closedEmitted && s.t - this._closedStart > TH.EYES_CLOSED_EVENT_S) {
        this._closedEmitted = true;
        this._emitEvent('drowsiness', { durationSec: s.t - this._closedStart, ongoing: true });
      }
    } else {
      this._closedStart = null;
    }
  }

  /** Chronological {t,x,y,ear,valid,aoi} arrays for the trailing window. */
  _window(lastSeconds) {
    const count = Math.min(this.n, this.cap);
    if (!count) return null;
    const newestIdx = (this.n - 1) % this.cap;
    const tEnd = this.t[newestIdx];
    const t0 = Number.isFinite(lastSeconds) ? tEnd - lastSeconds : -Infinity;
    const out = { t: [], x: [], y: [], ear: [], valid: [], aoi: [] };
    const start = this.n - count;
    for (let k = start; k < this.n; k++) {
      const i = k % this.cap;
      if (this.t[i] < t0) continue;
      out.t.push(this.t[i]);
      out.x.push(this.x[i]);
      out.y.push(this.y[i]);
      out.ear.push(this.ear[i]);
      out.valid.push(this.valid[i]);
      out.aoi.push(this.aoi[i]);
    }
    return out.t.length ? out : null;
  }

  /**
   * Summary over the trailing `lastSeconds` (Infinity/undefined = everything
   * buffered). Called off the physics path by report/overlay computation.
   */
  analyze(lastSeconds) {
    const w = this._window(lastSeconds);
    if (!w) return null;
    const tEnd = w.t[w.t.length - 1];
    const t0 = w.t[0];
    const span = Math.max(1e-6, tEnd - t0);

    // PERCLOS over the (clamped) standard window
    const perclosT0 = tEnd - Math.min(span, TH.PERCLOS_WINDOW_S);
    let closedN = 0;
    let earN = 0;
    for (let i = 0; i < w.t.length; i++) {
      if (w.t[i] < perclosT0 || !Number.isFinite(w.ear[i])) continue;
      earN++;
      if (w.ear[i] < TH.EAR_BLINK) closedN++;
    }

    const blinks = this.blinkTimes.filter((t) => t >= t0 && t <= tEnd).length;
    const glances = this.glances.filter((g) => g.tStart >= t0 && g.tStart <= tEnd);
    const longGlances = glances.filter((g) => g.dur > TH.NHTSA_LONG_GLANCE_S);

    const fixations = this._idtFixations(w);
    let uptimeN = 0;
    for (const v of w.valid) if (v) uptimeN++;

    return {
      windowSec: span,
      perclos: earN ? (closedN / earN) * 100 : NaN,
      blinkCount: blinks,
      blinkRatePerMin: (blinks / span) * 60,
      glanceCount: glances.length,
      glanceMeanDurSec: glances.length ? meanOf(glances.map((g) => g.dur)) : NaN,
      glanceMaxDurSec: glances.length ? Math.max(...glances.map((g) => g.dur)) : NaN,
      glanceRatePerMin: (glances.length / span) * 60,
      longGlanceCount: longGlances.length,
      fixationCount: fixations.length,
      fixationMeanDurMs: fixations.length ? meanOf(fixations.map((f) => f.durMs)) : NaN,
      trackingUptimePct: w.t.length ? (uptimeN / w.t.length) * 100 : NaN,
    };
  }

  /**
   * I-DT dispersion-based fixation detection (ISO 15007-aligned bounds).
   * Dispersion threshold in px derives from the render camera FOV.
   */
  _idtFixations(w) {
    const fov = this._cameraFov();
    const ppd = pxPerDeg(window.innerHeight, fov);
    const dispPx = Number.isFinite(ppd) ? TH.IDT_DISPERSION_DEG * ppd : 40;
    const minDur = TH.IDT_MIN_FIX_MS / 1000;
    const maxDur = TH.IDT_MAX_FIX_MS / 1000;
    const fixations = [];
    let i = 0;
    const n = w.t.length;
    while (i < n) {
      if (!w.valid[i]) {
        i++;
        continue;
      }
      // grow a window from i while dispersion stays under threshold
      let j = i;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      while (j < n && w.valid[j]) {
        const nx = Math.min(minX, w.x[j]);
        const xx = Math.max(maxX, w.x[j]);
        const ny = Math.min(minY, w.y[j]);
        const xy = Math.max(maxY, w.y[j]);
        if (xx - nx + (xy - ny) > dispPx) break;
        minX = nx;
        maxX = xx;
        minY = ny;
        maxY = xy;
        j++;
      }
      const dur = j > i ? w.t[j - 1] - w.t[i] : 0;
      if (dur >= minDur) {
        fixations.push({
          tStart: w.t[i],
          durMs: Math.min(dur, maxDur) * 1000,
          cx: meanOf(w.x.slice(i, j)),
          cy: meanOf(w.y.slice(i, j)),
        });
        i = j;
      } else {
        i++;
      }
    }
    return fixations;
  }

  _cameraFov() {
    try {
      const h = window.PromptDriveBridge && window.PromptDriveBridge.handles;
      return (h && h.camera && h.camera.fov) || 60;
    } catch (_) {
      return 60;
    }
  }
}


/* --- CalibrationModal.js --- */
/**
 * Full-screen gaze-calibration modal. State machine:
 *   consent -> permission -> positioning -> calibrate (9 dots) ->
 *   validate (4 dots) -> result -> done
 * Every screen is skippable (button or Esc); `run()` resolves
 * {calibrated:boolean, skipped:boolean, dontAskAgain:boolean} — never rejects,
 * so the pre-game gate in build-main.js can always unlock the keys.
 *
 * Reused for mid-session recalibration; the caller decides whether anything
 * (like key input) is gated on the returned promise.
 */




const STYLE_ID = 'pd-gaze-modal-style';

const CSS = `
#pd-gaze-modal{position:fixed;inset:0;z-index:10000;background:rgba(17,17,17,.97);
  display:none;font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.85)}
#pd-gaze-modal.open{display:block}
#pd-gaze-modal .pd-gz-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  max-width:520px;width:90%;text-align:center}
#pd-gaze-modal h2{font-size:20px;letter-spacing:2px;text-transform:uppercase;
  color:#cfe9e6;margin:0 0 14px}
#pd-gaze-modal p{font-size:14px;line-height:1.6;color:rgba(255,255,255,.7);margin:0 0 10px}
#pd-gaze-modal .pd-gz-note{font-size:12px;color:#7e8a8a}
#pd-gaze-modal .pd-gz-buttons{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap}
#pd-gaze-modal button{font:600 13px Jura,system-ui;background:#2a2a2a;color:#cfe9e6;
  border:1px solid #3a3a3a;border-radius:5px;padding:10px 18px;cursor:pointer;letter-spacing:1px}
#pd-gaze-modal button:hover{border-color:#3ec6b5}
#pd-gaze-modal button.primary{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#pd-gaze-modal button.subtle{background:transparent;border-color:transparent;color:#6d7a7a}
#pd-gaze-modal .pd-gz-face{width:14px;height:14px;border-radius:50%;display:inline-block;
  background:#a33;margin-right:8px;vertical-align:middle;transition:background .3s}
#pd-gaze-modal .pd-gz-face.ok{background:#3ec6b5}
#pd-gaze-modal .pd-gz-dot{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;
  border-radius:50%;background:#3ec6b5;box-shadow:0 0 18px rgba(62,198,181,.8);display:none}
#pd-gaze-modal .pd-gz-dot .ring{position:absolute;inset:-14px;border:2px solid rgba(62,198,181,.5);
  border-radius:50%;animation:pd-gz-shrink .5s linear forwards}
@keyframes pd-gz-shrink{from{transform:scale(1.6);opacity:.9}to{transform:scale(.6);opacity:.2}}
#pd-gaze-modal .pd-gz-progress{position:absolute;left:50%;bottom:5%;transform:translateX(-50%);
  font-size:12px;color:#7e8a8a;letter-spacing:1px}
#pd-gaze-modal .pd-gz-skip{position:absolute;right:18px;top:14px}
`;
class CalibrationModal {
  /** @param {object} tracker the GazeTracking facade (engine + latest sample access) */
  constructor(tracker) {
    this.tracker = tracker;
    this._injectStyle();
    this._build();
    this._resolve = null;
    this._running = false;
    this._keyHandler = (e) => {
      if (e.key === 'Escape' && this._running) this._finish({ calibrated: false, skipped: true });
    };
  }

  _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  _build() {
    this.root = document.createElement('div');
    this.root.id = 'pd-gaze-modal';
    this.center = document.createElement('div');
    this.center.className = 'pd-gz-center';
    this.dot = document.createElement('div');
    this.dot.className = 'pd-gz-dot';
    this.progress = document.createElement('div');
    this.progress.className = 'pd-gz-progress';
    this.skipCorner = document.createElement('button');
    this.skipCorner.className = 'subtle pd-gz-skip';
    this.skipCorner.textContent = 'skip (Esc)';
    this.skipCorner.addEventListener('click', () => this._finish({ calibrated: false, skipped: true }));
    this.root.append(this.center, this.dot, this.progress, this.skipCorner);
    document.body.appendChild(this.root);
  }

  /** @returns {Promise<{calibrated:boolean, skipped:boolean, dontAskAgain?:boolean}>} */
  run() {
    if (this._running && this._promise) return this._promise;
    this._running = true;
    this.root.classList.add('open');
    window.addEventListener('keydown', this._keyHandler, true);
    this._promise = new Promise((res) => {
      this._resolve = res;
    });
    this._showConsent();
    return this._promise;
  }

  _finish(result) {
    if (!this._running) return;
    this._running = false;
    this.root.classList.remove('open');
    this.dot.style.display = 'none';
    this.progress.textContent = '';
    window.removeEventListener('keydown', this._keyHandler, true);
    if (this._resolve) this._resolve(result);
    this._resolve = null;
  }

  _screen(html) {
    this.center.innerHTML = html;
    this.center.style.display = '';
    this.dot.style.display = 'none';
  }

  _btn(label, cls, onClick) {
    const b = document.createElement('button');
    if (cls) b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // --- state: consent -----------------------------------------------------
  _showConsent() {
    this._screen(`
      <h2>Gaze calibration</h2>
      <p>Prompt Drive can measure where you look during the drive
      (road, gauges, mirrors) to compute attention metrics.</p>
      <p class="pd-gz-note">Webcam images are processed on-device by a local model.
      Only gaze coordinates are recorded — no video is stored or transmitted.</p>
      <p>Follow the dots with your eyes while keeping your head still.
      Takes about 30 seconds.</p>`);
    const row = document.createElement('div');
    row.className = 'pd-gz-buttons';
    row.append(
      this._btn('Calibrate', 'primary', () => this._showPermission()),
      this._btn('Skip this run', null, () => this._finish({ calibrated: false, skipped: true })),
      this._btn("Don't ask again", 'subtle', () => {
        saveGazeFlag(GAZE_STORAGE.skipPregame, true);
        this._finish({ calibrated: false, skipped: true, dontAskAgain: true });
      })
    );
    this.center.appendChild(row);
  }

  // --- state: permission / engine start ------------------------------------
  async _showPermission() {
    this._screen('<h2>Starting camera…</h2><p>Allow camera access when prompted.</p>');
    const status = await this.tracker.ensureEngine();
    if (!this._running) return;
    if (status !== 'running') {
      const msg = status === 'denied'
        ? 'Camera permission was denied. You can enable it in the browser site settings and recalibrate later.'
        : status === 'no-camera'
          ? 'No camera was found on this device.'
          : 'The gaze tracker failed to load.';
      this._screen(`<h2>Camera unavailable</h2><p>${msg}</p>`);
      const row = document.createElement('div');
      row.className = 'pd-gz-buttons';
      row.append(this._btn('Continue without gaze', 'primary', () =>
        this._finish({ calibrated: false, skipped: true })));
      this.center.appendChild(row);
      return;
    }
    this._showPositioning();
  }

  // --- state: positioning ---------------------------------------------------
  _showPositioning() {
    this._screen(`
      <h2>Position check</h2>
      <p><span class="pd-gz-face" id="pd-gz-face-ind"></span>
      <span id="pd-gz-face-txt">Looking for your face…</span></p>
      <p class="pd-gz-note">Sit as you would while driving. Face the screen,
      keep your head roughly straight.</p>`);
    const row = document.createElement('div');
    row.className = 'pd-gz-buttons';
    const startBtn = this._btn('Start calibration', 'primary', () => {
      clearInterval(this._posTimer);
      this._runPoints();
    });
    startBtn.disabled = true;
    row.append(startBtn);
    this.center.appendChild(row);

    let stableSince = 0;
    this._posTimer = setInterval(() => {
      if (!this._running) {
        clearInterval(this._posTimer);
        return;
      }
      const ind = document.getElementById('pd-gz-face-ind');
      const txt = document.getElementById('pd-gz-face-txt');
      const raw = this.tracker.rawSample();
      const good = raw && raw.faceFound && raw.features &&
        Math.abs(raw.headYaw) < 20 && Math.abs(raw.headPitch) < 20;
      if (good) {
        stableSince = stableSince || performance.now();
        if (ind) ind.classList.add('ok');
        if (txt) txt.textContent = 'Face found — hold still';
        if (performance.now() - stableSince > 800) startBtn.disabled = false;
      } else {
        stableSince = 0;
        startBtn.disabled = true;
        if (ind) ind.classList.remove('ok');
        if (txt) {
          txt.textContent = raw && raw.faceFound
            ? 'Face the screen straight on'
            : 'Looking for your face…';
        }
      }
    }, 200);
  }

  // --- state: calibration + validation points -------------------------------
  async _runPoints() {
    const calSamples = [];
    const ok = await this._collectSeries(CALIBRATION.POINTS_9, 'Calibrating', (features, target) => {
      calSamples.push({ features, target });
    });
    if (!ok || !this._running) return;

    const model = fitCalibration(calSamples);
    if (!model) {
      this._showFailure('Not enough clean samples were collected (blinks or lost tracking).');
      return;
    }

    const valPoints = CALIBRATION.VALIDATION_POINTS_4.map((target) => ({ target, samples: [] }));
    let vi = 0;
    const ok2 = await this._collectSeries(CALIBRATION.VALIDATION_POINTS_4, 'Validating', (features) => {
      valPoints[vi].samples.push({ features });
    }, () => {
      vi++;
    });
    if (!ok2 || !this._running) return;

    const fov = this._cameraFov();
    const quality = validateCalibration(model, valPoints, window.innerWidth, window.innerHeight, fov);
    this._showResult(model, quality);
  }

  /**
   * Show each point: settle animation then collect valid (non-blink) samples.
   * @returns {Promise<boolean>} false if the modal was skipped mid-series
   */
  _collectSeries(points, label, onSample, onPointDone) {
    this.center.style.display = 'none';
    this.dot.style.display = 'block';
    return new Promise((resolve) => {
      let idx = 0;
      const showPoint = () => {
        if (!this._running) return resolve(false);
        if (idx >= points.length) {
          this.dot.style.display = 'none';
          return resolve(true);
        }
        const [nx, ny] = points[idx];
        this.dot.style.left = `${nx * 100}%`;
        this.dot.style.top = `${ny * 100}%`;
        this.dot.innerHTML = '<div class="ring"></div>';
        this.progress.textContent = `${label} ${idx + 1} / ${points.length}`;
        const collectStart = performance.now() + CALIBRATION.SETTLE_MS;
        const collectEnd = collectStart + CALIBRATION.COLLECT_MS;
        const tick = () => {
          if (!this._running) return resolve(false);
          const now = performance.now();
          if (now >= collectStart && now < collectEnd) {
            const raw = this.tracker.rawSample();
            if (raw && raw.faceFound && raw.features && !this._blinking(raw)) {
              onSample(raw.features, points[idx]);
            }
          }
          if (now >= collectEnd) {
            if (onPointDone) onPointDone(idx);
            idx++;
            showPoint();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      };
      showPoint();
    });
  }

  _blinking(raw) {
    const ear = (raw.earL + raw.earR) / 2;
    return Number.isFinite(ear) && ear < GAZE_THRESHOLDS.EAR_OPEN;
  }

  _cameraFov() {
    try {
      const h = window.PromptDriveBridge && window.PromptDriveBridge.handles;
      return (h && h.camera && h.camera.fov) || 60;
    } catch (_) {
      return 60;
    }
  }

  // --- state: result ---------------------------------------------------------
  _showResult(model, quality) {
    const acc = quality.accuracyDeg;
    const good = Number.isFinite(acc) && acc <= CALIBRATION.ACCURACY_OK_DEG;
    const grade = !Number.isFinite(acc) ? 'unknown' : acc <= 1.5 ? 'Excellent' : good ? 'Good' : 'Poor';
    this._screen(`
      <h2>Calibration ${good ? 'complete' : 'finished'}</h2>
      <p>Accuracy: <b>${Number.isFinite(acc) ? acc.toFixed(1) + '°' : '—'}</b> — ${grade}</p>
      ${good ? '' : '<p class="pd-gz-note">Above 3° the AOI classification gets coarse — a redo usually helps (steady head, follow dots with eyes only).</p>'}`);
    const row = document.createElement('div');
    row.className = 'pd-gz-buttons';
    row.append(
      this._btn(good ? 'Accept' : 'Accept anyway', good ? 'primary' : null, () => {
        const meta = saveCalibration(model, quality);
        this.tracker.applyCalibration(model, meta);
        this._finish({ calibrated: true, skipped: false });
      }),
      this._btn('Redo', good ? null : 'primary', () => this._runPoints()),
      this._btn('Skip', 'subtle', () => this._finish({ calibrated: false, skipped: true }))
    );
    this.center.appendChild(row);
  }

  _showFailure(msg) {
    this._screen(`<h2>Calibration failed</h2><p>${msg}</p>`);
    const row = document.createElement('div');
    row.className = 'pd-gz-buttons';
    row.append(
      this._btn('Retry', 'primary', () => this._runPoints()),
      this._btn('Skip', null, () => this._finish({ calibrated: false, skipped: true }))
    );
    this.center.appendChild(row);
  }

  dispose() {
    this._finish({ calibrated: false, skipped: true });
    this.root.remove();
  }
}


/* --- GazeTracking.js --- */
/**
 * `window.GazeTracking` — facade for the gaze-tracking subsystem. Owns the
 * FaceEngine (webcam + MediaPipe), the calibration mapping, AOI classification,
 * the native-rate analyzer, and the calibration modal. DrivingMetrics reads
 * `latestSample()` each physics frame (sample-and-hold); the engine patch in
 * build-main.js gates pre-game key unlock on `runPreGameCalibration()`.
 *
 * Gaze is OFF by default. Camera permission is only requested when the user
 * enables gaze (settings panel / calibration modal / PromptDrive.gaze API).
 */









const DOT_ID = 'pd-gaze-dot';
class GazeTracking {
  constructor() {
    this.engine = new FaceEngine();
    this.engine.onSample = (s) => this._onEngineSample(s);
    this.analyzer = new GazeAnalyzer();
    this.projector = new AoiProjector();
    this.filter = new OneEuroFilter2D({ minCutoff: 1.0, beta: 0.02 });
    this.modal = null; // lazy — needs document.body

    this.enabled = loadGazeFlag(GAZE_STORAGE.enabled, false);
    this.showDot = loadGazeFlag(GAZE_STORAGE.showDot, false);
    this.rateHz = loadRateHz();
    this.engine.rateHz = this.rateHz;
    this.gameBegun = false; // set by the beginGame engine patch; gates calibration UI
    this.calibration = null; // {model, meta, stale}
    this._latest = null; // last processed sample
    this._raw = null; // last raw engine sample (calibration UI reads this)
    this._eyesClosed = false;
    this._preGamePromise = null;
    this._dot = null;

    const stored = loadCalibration();
    if (stored) this.calibration = stored;

    if (this.enabled) {
      // Re-arm the engine on load without stealing focus: permission was
      // granted in a prior session, so this resolves silently.
      this.ensureEngine();
    }
  }

  // --- enable / lifecycle ---------------------------------------------------
  async setEnabled(on) {
    this.enabled = !!on;
    saveGazeFlag(GAZE_STORAGE.enabled, this.enabled);
    if (this.enabled) {
      return this.ensureEngine();
    }
    this.engine.stop();
    this._latest = null;
    this._raw = null;
    this._updateDot(null);
    return 'stopped';
  }

  /** Start the camera+model if not running. Returns the engine status. */
  async ensureEngine() {
    if (this.engine.status === 'running') return 'running';
    return this.engine.start();
  }

  isEnabled() {
    return this.enabled;
  }

  /** Set the gaze sampling (inference) rate in Hz; clamped, persisted, live. */
  setRate(hz) {
    this.rateHz = clampRateHz(hz);
    this.engine.rateHz = this.rateHz;
    try {
      localStorage.setItem(GAZE_STORAGE.rateHz, String(this.rateHz));
    } catch (_) {
      /* session-only */
    }
    return this.rateHz;
  }

  /** True when gaze metrics are meaningfully computable. */
  isAvailable() {
    return this.enabled && this.engine.status === 'running' && !!this.calibration;
  }

  // --- calibration ------------------------------------------------------------
  needsCalibration() {
    return !this.calibration || this.calibration.stale;
  }

  wantsPreGameCalibration() {
    if (!this.enabled) return false;
    if (loadGazeFlag(GAZE_STORAGE.skipPregame, false)) return false;
    if (!this.needsCalibration()) return false;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('autostart') && !q.get('gazecal')) return false;
    } catch (_) {
      /* no location (tests) */
    }
    return true;
  }

  /** Idempotent: repeated Begin clicks share one in-flight modal promise.
   *  This is the ONLY path that opens the modal once the game is near start —
   *  it runs from the beginGame patch, before input unlocks. */
  runPreGameCalibration() {
    if (this._preGamePromise) return this._preGamePromise;
    this._preGamePromise = this._openModal().finally(() => {
      this._preGamePromise = null;
    });
    return this._preGamePromise;
  }

  /**
   * Calibration is strictly pre-game. Before the game begins (splash showing)
   * this opens the modal immediately; after begin it STAGES recalibration for
   * the next load instead: stored calibration + "don't ask" flag are cleared
   * so the pre-game modal triggers on the next Begin.
   * @returns modal result, or {staged:true, note} when the game is running
   */
  async calibrate() {
    if (!this.enabled) {
      this.enabled = true;
      saveGazeFlag(GAZE_STORAGE.enabled, true);
    }
    if (this.gameBegun) {
      clearCalibration();
      this.calibration = null;
      saveGazeFlag(GAZE_STORAGE.skipPregame, false);
      return {
        calibrated: false,
        staged: true,
        note: 'calibration runs before the drive — reload the sim; the calibration screen appears at Begin',
      };
    }
    return this._openModal();
  }

  async _openModal() {
    if (!this.modal) this.modal = new CalibrationModal(this);
    return this.modal.run();
  }

  /** Called by the modal when the user accepts a fitted model. */
  applyCalibration(model, meta) {
    this.calibration = { model, meta, stale: false };
    this.filter.reset();
  }

  // --- per-frame pipeline -------------------------------------------------------
  _onEngineSample(s) {
    this._raw = s;
    const t = s.t;
    if (!s.faceFound || !s.features) {
      this._latest = this._invalidSample(t, s.faceFound ? AOI.INVALID : AOI.INVALID);
      this.analyzer.push(this._latest);
      this._updateDot(null);
      return;
    }
    const ear = (s.earL + s.earR) / 2;
    this._eyesClosed = Number.isFinite(ear) && ear < GAZE_THRESHOLDS.EAR_BLINK;

    let x = NaN;
    let y = NaN;
    let valid = false;
    if (this.calibration && !this._eyesClosed) {
      const norm = predictNorm(this.calibration.model, s.features);
      const f = this.filter.filter(norm.x * window.innerWidth, norm.y * window.innerHeight, t);
      x = f.x;
      y = f.y;
      valid =
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Math.abs(s.headYaw) < GAZE_THRESHOLDS.HEAD_YAW_LIMIT_DEG &&
        Math.abs(s.headPitch) < GAZE_THRESHOLDS.HEAD_PITCH_LIMIT_DEG;
    }

    const aoi = this.projector.classify(x, y, this._eyesClosed, valid);
    this._latest = {
      t,
      x,
      y,
      xNorm: x / window.innerWidth,
      yNorm: y / window.innerHeight,
      aoi,
      aoiLabel: AOI_LABELS[String(aoi)],
      valid: valid && aoi >= 0,
      ear,
      headYaw: s.headYaw,
      headPitch: s.headPitch,
    };
    this.analyzer.push(this._latest);
    this._updateDot(valid ? this._latest : null);
  }

  _invalidSample(t, aoi) {
    return {
      t,
      x: NaN,
      y: NaN,
      xNorm: NaN,
      yNorm: NaN,
      aoi,
      aoiLabel: AOI_LABELS[String(aoi)],
      valid: false,
      ear: NaN,
      headYaw: NaN,
      headPitch: NaN,
    };
  }

  /**
   * Sample-and-hold read for DrivingMetrics.sample(). Returns null when gaze
   * is off; an invalid-marked sample when the held value is stale.
   */
  latestSample() {
    if (!this.enabled || !this._latest) return null;
    const ageMs = performance.now() - this._latest.t * 1000;
    if (ageMs > GAZE_THRESHOLDS.STALE_SAMPLE_MS) {
      return Object.assign({}, this._latest, { valid: false, aoi: AOI.INVALID });
    }
    return this._latest;
  }

  /** Raw (uncalibrated) engine sample — used by the calibration modal. */
  rawSample() {
    return this._raw;
  }

  /** Wire the metrics facade in as the analyzer's event sink. */
  setMetrics(drivingMetrics) {
    this.analyzer.setMetrics(drivingMetrics);
  }

  // --- status / panel -----------------------------------------------------------
  status() {
    const meta = this.calibration && this.calibration.meta;
    return {
      enabled: this.enabled,
      running: this.engine.status === 'running',
      engineStatus: this.engine.status,
      mode: this.engine.mode, // 'worker' | 'main-thread' | null
      delegate: this.engine.delegate, // 'GPU' | 'CPU' | null
      rateHz: this.rateHz,
      fps: Math.round(this.engine.fps),
      gameBegun: this.gameBegun,
      calibrated: !!this.calibration && !this.calibration.stale,
      needsRecalibration: !!this.calibration && !!this.calibration.stale,
      accuracyDeg: meta ? meta.accuracyDeg : NaN,
      calibratedAt: meta ? meta.createdAt : null,
    };
  }

  /** Config snapshot for PromptDrive.gaze.get() (mirrors WheelControls.get). */
  get() {
    const s = this.status();
    return {
      enabled: s.enabled,
      rateHz: s.rateHz,
      showDot: this.showDot,
      calibrated: s.calibrated,
      accuracyDeg: s.accuracyDeg,
      mode: s.mode,
      fps: s.fps,
    };
  }

  /** Bulk config apply: {enabled?, rateHz?, showDot?}. Persists everything. */
  async set(cfg) {
    if (!cfg || typeof cfg !== 'object') return this.get();
    if (cfg.rateHz != null) this.setRate(cfg.rateHz);
    if (cfg.showDot != null) this.setShowDot(!!cfg.showDot);
    if (cfg.enabled != null) await this.setEnabled(!!cfg.enabled);
    return this.get();
  }

  // --- live gaze dot (debug/demo) --------------------------------------------------
  setShowDot(on) {
    this.showDot = !!on;
    saveGazeFlag(GAZE_STORAGE.showDot, this.showDot);
    if (!this.showDot) this._updateDot(null);
  }

  _updateDot(sample) {
    if (!this.showDot || !sample) {
      if (this._dot) this._dot.style.display = 'none';
      return;
    }
    if (!this._dot) {
      this._dot = document.createElement('div');
      this._dot.id = DOT_ID;
      this._dot.style.cssText =
        'position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
        'border:2px solid #3ec6b5;background:rgba(62,198,181,.25);z-index:9998;' +
        'pointer-events:none;display:none';
      document.body.appendChild(this._dot);
    }
    this._dot.style.display = 'block';
    this._dot.style.left = `${sample.x}px`;
    this._dot.style.top = `${sample.y}px`;
  }

  // --- debug/test seams --------------------------------------------------------------
  get _debug() {
    return {
      /** Feed a synthetic processed sample straight into the pipeline tail. */
      injectSample: (s) => {
        const t = s.t != null ? s.t : performance.now() / 1000;
        const full = {
          t,
          x: s.x,
          y: s.y,
          xNorm: s.x / window.innerWidth,
          yNorm: s.y / window.innerHeight,
          aoi: s.aoi != null ? s.aoi : this.projector.classify(s.x, s.y, !!s.eyesClosed, s.valid !== false),
          valid: s.valid !== false && !s.eyesClosed,
          ear: s.ear != null ? s.ear : 0.3,
          headYaw: s.headYaw || 0,
          headPitch: s.headPitch || 0,
        };
        full.aoiLabel = AOI_LABELS[String(full.aoi)];
        this._latest = full;
        this.analyzer.push(full);
        return full;
      },
      /** Route the engine at an injected <video>/canvas element (no webcam). */
      useVideoSource: (el) => this.engine.setVideoSource(el),
    };
  }

  dispose() {
    this.engine.stop();
    this.projector.dispose();
    if (this.modal) this.modal.dispose();
    if (this._dot) this._dot.remove();
  }
}


  if (typeof window !== 'undefined') {
    try {
      window.GazeTracking = new GazeTracking();
    } catch (e) {
      console.error('GazeTracking init failed', e);
    }
  }
})();
