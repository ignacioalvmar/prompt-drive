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
