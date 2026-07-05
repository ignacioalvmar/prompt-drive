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

import { LANDMARKS, MEDIAPIPE_BASE, INFER_WIDTH, INFER_HEIGHT, RATE_DEFAULT_HZ } from './config.js';
import { earFromLandmarks, headPoseFromMatrix, featureVector } from './gaze-math.js';

const WORKER_URL = './static/js/gaze-worker.js';

export class FaceEngine {
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
