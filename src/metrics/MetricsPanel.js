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
      cb.title = computable ? '' : 'Requires traffic objects (not enabled in this simulation)';
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
