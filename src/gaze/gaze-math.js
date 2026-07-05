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
export function earFromLandmarks(landmarks, idx) {
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
export function headPoseFromMatrix(m) {
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
export function featureVector(landmarks, headYaw, headPitch, L) {
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
export function polyExpand(f) {
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
export function ridgeFit(X, y, lambda) {
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

export function ridgePredict(coeffs, expandedRow) {
  let s = 0;
  for (let i = 0; i < coeffs.length; i++) s += coeffs[i] * expandedRow[i];
  return s;
}

/**
 * Pixels per degree of visual angle, from the render camera's vertical FOV.
 * Coarse (assumes the viewer subtends the camera frustum) but consistent — it
 * is used symmetrically for both calibration accuracy and I-DT dispersion.
 */
export function pxPerDeg(viewportH, fovDeg) {
  if (!(viewportH > 0) || !(fovDeg > 0)) return NaN;
  return viewportH / fovDeg;
}

export function meanOf(xs) {
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
