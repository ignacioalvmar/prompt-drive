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

import { GAZE_STORAGE, GAZE_THRESHOLDS, AOI, AOI_LABELS, loadGazeFlag, saveGazeFlag, loadRateHz, clampRateHz } from './config.js';
import { OneEuroFilter2D } from './filters.js';
import { FaceEngine } from './FaceEngine.js';
import { predictNorm, loadCalibration, clearCalibration } from './calibration.js';
import { AoiProjector } from './aoi.js';
import { GazeAnalyzer } from './GazeAnalyzer.js';
import { CalibrationModal } from './CalibrationModal.js';

const DOT_ID = 'pd-gaze-dot';

export class GazeTracking {
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
