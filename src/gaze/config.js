/**
 * Gaze subsystem configuration: storage keys, AOI (area-of-interest) code map,
 * detection thresholds, and calibration layout. Single source of truth shared
 * by the tracker, analyzer, calibration UI and the metrics integration.
 *
 * Threshold provenance (see gaze-plan.md): ISO 15007 fixation bounds, NHTSA
 * visual-manual distraction guideline (2 s single-glance limit), and the
 * standard EAR blink literature values.
 */

export const GAZE_STORAGE = {
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
export const RATE_DEFAULT_HZ = 15;
export const RATE_MIN_HZ = 5;
export const RATE_MAX_HZ = 30;

/** Inference input size — the landmarker downsamples internally to ≤256 px,
 *  so a 320×240 grab loses nothing while quartering upload cost vs 640×480. */
export const INFER_WIDTH = 320;
export const INFER_HEIGHT = 240;

export function clampRateHz(hz) {
  const n = Number(hz);
  if (!Number.isFinite(n)) return RATE_DEFAULT_HZ;
  return Math.min(RATE_MAX_HZ, Math.max(RATE_MIN_HZ, Math.round(n)));
}

export function loadRateHz() {
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
export const AOI = {
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

export const AOI_LABELS = {
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

export const GAZE_THRESHOLDS = {
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

export const CALIBRATION = {
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
export const LANDMARKS = {
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
export const MEDIAPIPE_BASE = './static/lib/mediapipe';

/**
 * Fallback AOI rects (normalized viewport coords) used when live 3D projection
 * of the instrument cluster is unavailable (exterior camera, no cluster).
 */
export const FALLBACK_REGIONS = {
  roadAhead: { x: 0.30, y: 0.15, w: 0.40, h: 0.45 },
  menuBar: { x: 0, y: 0.94, w: 1, h: 0.06 },
};

export function loadGazeFlag(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true' || raw === '1';
  } catch (_) {
    return fallback;
  }
}

export function saveGazeFlag(key, v) {
  try {
    localStorage.setItem(key, v ? 'true' : 'false');
  } catch (_) {
    /* ignore */
  }
}
