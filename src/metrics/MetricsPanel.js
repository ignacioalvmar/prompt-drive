/**
 * Driving-metrics configuration UI, integrated into the game's existing
 * settings sidebar as a collapsible section placed after "audio". The settings
 * panel is React-rendered and mounts/unmounts (and re-renders) as the user
 * opens/closes it, so the section is (re)injected via a MutationObserver.
 *
 * The section matches the native collapsible markup (.settings-input-row
 * .settings-input-list_section .collapsible + .collapsible-title +
 * .collapsible-cross) so it looks and behaves like the built-in sections.
 *
 * `app` is the DrivingMetrics facade this UI drives.
 */

import { METRICS, METRIC_FAMILIES } from './config.js';

const PANEL_STYLE_ID = 'pd-metrics-style';
const SECTION_ID = 'pd-metrics-section';
const CONTENT_ID = 'pd-metrics-content';

// Scoped to our injected nodes so we don't disturb the game's own styling.
const PANEL_CSS = `
#${SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${SECTION_ID} .collapsible-cross{float:right}
#${CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${CONTENT_ID}.open{display:block}
#${CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${CONTENT_ID} .pd-row{display:flex;align-items:flex-start;gap:8px;padding:3px 0}
#${CONTENT_ID} .pd-row.disabled{opacity:.4}
#${CONTENT_ID} .pd-row label{cursor:pointer;line-height:1.3;font-size:13px}
#${CONTENT_ID} .pd-row .hint{display:block;font-size:11px;color:#7e7e7e}
#${CONTENT_ID} .pd-unit{color:#5f7a78}
#${CONTENT_ID} .pd-controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;
  border-top:1px solid #333;padding-top:10px}
#${CONTENT_ID} .pd-controls button{flex:1 1 auto;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${CONTENT_ID} .pd-controls button:hover{border-color:#3ec6b5}
#${CONTENT_ID} .pd-controls button.primary{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${CONTENT_ID} .pd-controls button:disabled{opacity:.4;cursor:default}
#${CONTENT_ID} .pd-status{font-size:11px;color:#8aa0a0;margin-top:10px}
#${CONTENT_ID} .pd-status b{color:#cfe9e6}
#${CONTENT_ID} .pd-rec{color:#ff6b6b}
`;

export class MetricsPanel {
  constructor(app) {
    this.app = app;
    this.expanded = false;
    this._injectStyle();
    this._buildSection(); // detached DOM, reused across re-injections
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._statusTimer = setInterval(() => this._renderStatus(), 500);
  }

  _injectStyle() {
    if (document.getElementById(PANEL_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = PANEL_STYLE_ID;
    s.textContent = PANEL_CSS;
    document.head.appendChild(s);
  }

  // Coalesce frequent DOM mutations into one injection check per frame.
  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInject();
    });
  }

  /** Insert (or re-insert) the section into the settings list after "audio". */
  _tryInject() {
    const list = document.querySelector('.settings-input-list');
    if (!list) return; // settings panel is closed
    if (list.contains(this.header) && list.contains(this.content)) return;
    list.appendChild(this.header);
    list.appendChild(this.content);
    this._renderChecks();
    this._renderStatus();
  }

  _buildSection() {
    // header row — matches native collapsible section markup
    this.header = el('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = SECTION_ID;
    this.title = el('div', 'collapsible-title', 'driving metrics');
    this.cross = el('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    // content row (full-width block below the header)
    this.content = el('div');
    this.content.id = CONTENT_ID;

    for (const fam of METRIC_FAMILIES) {
      const metrics = METRICS.filter((m) => m.family === fam.id);
      if (!metrics.length) continue;
      this.content.appendChild(el('div', 'pd-fam', fam.label));
      for (const m of metrics) this.content.appendChild(this._metricRow(m));
      if (fam.id === 'attention') this._buildGazeControls();
    }

    // run controls — the live overlay is toggled from the lower menu band
    // (see MetricsOverlay) so it can't steal keyboard focus from the game.
    const controls = el('div', 'pd-controls');
    this.startBtn = el('button', 'primary', 'Start');
    this.stopBtn = el('button', null, 'Stop');
    this.resetBtn = el('button', null, 'Reset');
    this.startBtn.addEventListener('click', () => this.app.startRun());
    this.stopBtn.addEventListener('click', () => this.app.stopRun());
    this.resetBtn.addEventListener('click', () => this.app.resetRun());
    controls.append(this.startBtn, this.stopBtn, this.resetBtn);
    this.content.appendChild(controls);

    const exports = el('div', 'pd-controls');
    this.reportBtn = el('button', null, 'Download report');
    this.logsBtn = el('button', null, 'Download logs');
    this.reportBtn.addEventListener('click', () => this.app.downloadReport());
    this.logsBtn.addEventListener('click', () => this.app.downloadLogs());
    exports.append(this.reportBtn, this.logsBtn);
    this.content.appendChild(exports);

    this.status = el('div', 'pd-status');
    this.content.appendChild(this.status);

    this._applyExpanded();
  }

  _metricRow(m) {
    const row = el('div', 'pd-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `pd-m-${m.id}`;
    cb.dataset.metric = m.id;
    cb.addEventListener('click', (e) => e.stopPropagation()); // don't toggle the section
    cb.addEventListener('change', () => this.app.setSelected(m.id, cb.checked));
    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.addEventListener('click', (e) => e.stopPropagation());
    label.innerHTML =
      `${m.label}${m.unit ? ` <span class="pd-unit">(${m.unit})</span>` : ''}` +
      `<span class="hint">${m.hint || ''}${m.requiresTraffic ? ' — needs traffic' : ''}</span>`;
    row.append(cb, label);
    this._rows = this._rows || {};
    this._rows[m.id] = { row, cb };
    return row;
  }

  /**
   * Gaze subsystem controls, rendered under the Attention family: enable
   * toggle (this is where camera permission gets requested), calibrate button
   * (works anytime — pre-game calibration reuses the same modal), and a live
   * gaze-dot debug toggle. Skipped when the gaze bundle isn't loaded.
   */
  _buildGazeControls() {
    const gz = () => (typeof window !== 'undefined' ? window.GazeTracking : null);
    if (!gz()) return;

    const row = el('div', 'pd-row');
    this._gazeEnableCb = document.createElement('input');
    this._gazeEnableCb.type = 'checkbox';
    this._gazeEnableCb.id = 'pd-gaze-enable';
    this._gazeEnableCb.addEventListener('click', (e) => e.stopPropagation());
    this._gazeEnableCb.addEventListener('change', async () => {
      const g = gz();
      if (g) await g.setEnabled(this._gazeEnableCb.checked);
      this._renderChecks();
      this._renderStatus();
    });
    const label = document.createElement('label');
    label.htmlFor = this._gazeEnableCb.id;
    label.addEventListener('click', (e) => e.stopPropagation());
    label.innerHTML =
      'Enable gaze tracking' +
      '<span class="hint">Uses the webcam on-device — no video is stored or sent anywhere.</span>';
    row.append(this._gazeEnableCb, label);
    this.content.appendChild(row);

    // Sampling-rate select: 15 Hz default resolves 2 s NHTSA glances within
    // ±3%; 30 Hz only needed for blink/PERCLOS microdynamics.
    const rateRow = el('div', 'pd-row');
    this._gazeRateSel = document.createElement('select');
    this._gazeRateSel.id = 'pd-gaze-rate';
    for (const hz of [5, 10, 15, 20, 30]) {
      const opt = document.createElement('option');
      opt.value = String(hz);
      opt.textContent = `${hz} Hz${hz === 15 ? ' (recommended)' : hz === 30 ? ' (blink studies)' : ''}`;
      this._gazeRateSel.appendChild(opt);
    }
    this._gazeRateSel.addEventListener('click', (e) => e.stopPropagation());
    this._gazeRateSel.addEventListener('change', () => {
      const g = gz();
      if (g) g.setRate(Number(this._gazeRateSel.value));
    });
    const rateLabel = document.createElement('label');
    rateLabel.addEventListener('click', (e) => e.stopPropagation());
    rateLabel.innerHTML =
      'Sampling rate' +
      '<span class="hint">15 Hz resolves the 2–3 s automotive glance standard within ±3%; lower saves CPU, 30 Hz for blink studies.</span>';
    rateRow.append(this._gazeRateSel, rateLabel);
    this.content.appendChild(rateRow);

    const dotRow = el('div', 'pd-row');
    this._gazeDotCb = document.createElement('input');
    this._gazeDotCb.type = 'checkbox';
    this._gazeDotCb.id = 'pd-gaze-dot-toggle';
    this._gazeDotCb.addEventListener('click', (e) => e.stopPropagation());
    this._gazeDotCb.addEventListener('change', () => {
      const g = gz();
      if (g) g.setShowDot(this._gazeDotCb.checked);
    });
    const dotLabel = document.createElement('label');
    dotLabel.htmlFor = this._gazeDotCb.id;
    dotLabel.addEventListener('click', (e) => e.stopPropagation());
    dotLabel.textContent = 'Show live gaze dot';
    dotRow.append(this._gazeDotCb, dotLabel);
    this.content.appendChild(dotRow);

    const controls = el('div', 'pd-controls');
    this._gazeCalBtn = el('button', null, 'Calibrate gaze');
    this._gazeCalBtn.addEventListener('click', async () => {
      const g = gz();
      if (!g) return;
      this._gazeEnableCb.checked = true;
      // Pre-game: opens the modal. After begin: stages recalibration for the
      // next load (calibration is strictly pre-game).
      const result = await g.calibrate();
      this._gazeStagedNote = result && result.staged ? result.note : null;
      this._renderChecks();
      this._renderStatus();
    });
    controls.append(this._gazeCalBtn);
    this.content.appendChild(controls);

    this._gazeStatus = el('div', 'pd-status');
    this.content.appendChild(this._gazeStatus);
  }

  _renderGazeStatus() {
    if (!this._gazeStatus) return;
    const gz = typeof window !== 'undefined' ? window.GazeTracking : null;
    if (!gz) return;
    const s = gz.status();
    if (this._gazeEnableCb) this._gazeEnableCb.checked = s.enabled;
    if (this._gazeDotCb) this._gazeDotCb.checked = !!gz.showDot;
    if (this._gazeRateSel && document.activeElement !== this._gazeRateSel) {
      this._gazeRateSel.value = String(s.rateHz);
    }
    if (this._gazeCalBtn) {
      this._gazeCalBtn.textContent = s.gameBegun ? 'Recalibrate on next start' : 'Calibrate gaze';
    }
    if (this._gazeStagedNote) {
      this._gazeStatus.innerHTML = `gaze: <b>recalibration staged</b> — ${this._gazeStagedNote}`;
      return;
    }
    let txt;
    if (!s.enabled) {
      txt = 'gaze: <b>off</b>';
    } else if (s.engineStatus === 'denied') {
      txt = 'gaze: <b class="pd-rec">camera denied</b>';
    } else if (s.engineStatus === 'no-camera') {
      txt = 'gaze: <b class="pd-rec">no camera found</b>';
    } else if (s.engineStatus === 'load-failed') {
      txt = 'gaze: <b class="pd-rec">tracker failed to load</b>';
    } else if (!s.running) {
      txt = 'gaze: <b>starting…</b>';
    } else if (!s.calibrated) {
      txt = `gaze: <b>● ${s.fps}/${s.rateHz} Hz ${s.mode || ''}</b> · <b class="pd-rec">${s.needsRecalibration ? 'recalibration needed (window resized)' : 'not calibrated'}</b>`;
    } else {
      txt = `gaze: <b>● ${s.fps}/${s.rateHz} Hz ${s.mode || ''}</b> · calib <b>${Number.isFinite(s.accuracyDeg) ? s.accuracyDeg.toFixed(1) + '°' : '—'}</b>`;
    }
    this._gazeStatus.innerHTML = txt;
  }

  /** Sync checkbox checked/disabled state from the app (after re-injection). */
  _renderChecks() {
    if (!this._rows) return;
    const sel = this.app.getSelection();
    for (const id in this._rows) {
      const { row, cb } = this._rows[id];
      const computable = this.app.isComputable(id);
      cb.checked = !!sel[id] && computable;
      cb.disabled = !computable;
      row.classList.toggle('disabled', !computable);
      const m = METRICS.find((x) => x.id === id);
      cb.title = computable
        ? ''
        : m && m.requiresGaze
          ? 'Requires gaze tracking (enable & calibrate in this section)'
          : 'Requires traffic objects (not enabled in this simulation)';
    }
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+'; // − / +
    this.content.classList.toggle('open', this.expanded);
  }

  _renderStatus() {
    if (!this.status || !this.app) return;
    const rec = this.app.isRecording;
    this.startBtn.disabled = rec;
    this.stopBtn.disabled = !rec;
    this.status.innerHTML =
      `Status: <b class="${rec ? 'pd-rec' : ''}">${rec ? '● recording' : 'idle'}</b> · ` +
      `<b>${this.app.durationSec().toFixed(1)}s</b> · <b>${this.app.sampleCount()}</b> samples`;
    this._renderGazeStatus();
  }

  dispose() {
    clearInterval(this._statusTimer);
    if (this._observer) this._observer.disconnect();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
