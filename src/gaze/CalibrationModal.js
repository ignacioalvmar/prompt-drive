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

import { CALIBRATION, GAZE_STORAGE, GAZE_THRESHOLDS, saveGazeFlag } from './config.js';
import { fitCalibration, validateCalibration, saveCalibration } from './calibration.js';

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

export class CalibrationModal {
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
