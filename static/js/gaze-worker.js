/* Gaze inference worker — built from src/gaze/ (config, gaze-math, worker) */
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


/* --- worker.js --- */
/**
 * Worker-side gaze inference (bundled into static/js/gaze-worker.js together
 * with config.js and gaze-math.js — see scripts/build-gaze.js). Runs the
 * MediaPipe FaceLandmarker off the main thread so the sim's render loop never
 * blocks on inference.
 *
 * Protocol (main thread <-> worker):
 *   in : {type:'init', bundleUrl, wasmUrl, modelUrl}
 *   out: {type:'ready', delegate:'GPU'|'CPU'} | {type:'init-error', error}
 *   in : {type:'frame', bitmap: ImageBitmap, ts: number}   (bitmap transferred)
 *   out: {type:'sample', t, faceFound, features?, earL?, earR?,
 *          headYaw?, headPitch?, headRoll?}
 *
 * The worker computes the derived features itself (EAR, head pose, feature
 * vector) so only ~60 bytes travel back per frame. Bitmaps are closed after
 * detection. One frame is in flight at a time (the main thread enforces it).
 */

/* eslint-disable no-restricted-globals */

let landmarker = null;

async function initLandmarker(bundleUrl, wasmUrl, modelUrl) {
  const vision = await import(bundleUrl);
  const fileset = await vision.FilesetResolver.forVisionTasks(wasmUrl);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  });
  try {
    landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
    return 'GPU';
  } catch (_) {
    // No usable OffscreenCanvas WebGL in this worker — CPU wasm fallback.
    landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
    return 'CPU';
  }
}

function detect(bitmap, ts) {
  let result;
  try {
    result = landmarker.detectForVideo(bitmap, ts);
  } finally {
    bitmap.close();
  }
  const t = ts / 1000;
  const lm = result && result.faceLandmarks && result.faceLandmarks[0];
  if (!lm) return { type: 'sample', t, faceFound: false };
  const earR = earFromLandmarks(lm, LANDMARKS.EAR_RIGHT);
  const earL = earFromLandmarks(lm, LANDMARKS.EAR_LEFT);
  const mat = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
  const pose = headPoseFromMatrix(mat && mat.data);
  const features = featureVector(lm, pose.yaw, pose.pitch, LANDMARKS);
  return {
    type: 'sample',
    t,
    faceFound: true,
    features,
    earL,
    earR,
    headYaw: pose.yaw,
    headPitch: pose.pitch,
    headRoll: pose.roll,
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'init') {
    try {
      const delegate = await initLandmarker(msg.bundleUrl, msg.wasmUrl, msg.modelUrl);
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'init-error', error: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type === 'frame') {
    if (!landmarker) {
      if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
      return;
    }
    let out;
    try {
      out = detect(msg.bitmap, msg.ts);
    } catch (_) {
      out = { type: 'sample', t: msg.ts / 1000, faceFound: false };
    }
    self.postMessage(out);
  }
};

})();
