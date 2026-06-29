/**
 * Live HUD overlay (DOM). Shows the selected metrics computed over a trailing
 * window from the collector buffers, refreshed on its own throttled timer so
 * nothing heavy runs on the physics thread. Toggle on/off independently of the
 * configuration panel.
 */

import { computeMetrics } from './compute.js';
import { getMetric } from './config.js';

const OVERLAY_STYLE_ID = 'pd-overlay-style';

const OVERLAY_CSS = `
.pd-overlay{position:fixed;left:12px;bottom:12px;z-index:9999;min-width:210px;
  background:rgba(10,16,21,.86);color:#dbe7e6;border:1px solid #243842;border-radius:10px;
  padding:10px 12px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;
  box-shadow:0 6px 24px rgba(0,0,0,.45);display:none}
.pd-overlay.open{display:block}
.pd-overlay .t{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.08em;
  color:#7fb6ad;margin-bottom:6px}
.pd-overlay .m{display:flex;justify-content:space-between;gap:14px;padding:2px 0}
.pd-overlay .m .k{color:#9fb4b3}
.pd-overlay .m .v{color:#eafffb;font-variant-numeric:tabular-nums}
.pd-overlay .warn{color:#ffb454}
`;

// metrics meaningful as a live trailing-window readout
const LIVE_IDS = ['sdlp', 'meanLP', 'sds', 'meanSpeed', 'swrr', 'steeringEntropy', 'tlc', 'laneDepartures', 'collisions'];

export class MetricsOverlay {
  constructor(app, { windowSec = 30, refreshHz = 3 } = {}) {
    this.app = app;
    this.windowSec = windowSec;
    this.visible = false;
    this._injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'pd-overlay';
    document.body.appendChild(this.root);
    this._timer = setInterval(() => this._refresh(), 1000 / refreshHz);
  }

  _injectStyle() {
    if (document.getElementById(OVERLAY_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = OVERLAY_STYLE_ID;
    s.textContent = OVERLAY_CSS;
    document.head.appendChild(s);
  }

  setVisible(v) {
    this.visible = v;
    this.root.classList.toggle('open', v);
    if (v) this._refresh();
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  _refresh() {
    if (!this.visible) return;
    const cols = this.app.windowedColumns(this.windowSec);
    const selection = this.app.getSelection();
    const results = computeMetrics(cols, selection, {
      paramOverrides: this.app.paramOverrides,
      trafficAvailable: this.app.trafficAvailable,
      baselineRange: this.app.baselineRange,
      events: this.app.collector.events,
    });

    const rows = [`<div class="t">Live · ${this.windowSec}s window</div>`];
    let any = false;
    for (const id of LIVE_IDS) {
      if (!selection[id] || !results[id]) continue;
      any = true;
      const m = getMetric(id);
      rows.push(
        `<div class="m"><span class="k">${m ? m.label : id}</span><span class="v">${formatVal(results[id])}</span></div>`
      );
    }
    if (!any) rows.push('<div class="m warn">No live metrics selected</div>');
    this.root.innerHTML = rows.join('');
  }

  dispose() {
    clearInterval(this._timer);
    this.root.remove();
  }
}

function formatVal(res) {
  const v = res.value;
  const unit = res.unit && res.unit !== 'count' ? ' ' + res.unit : '';
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const digits = res.unit === 'count' ? 0 : 2;
  return v.toFixed(digits) + unit;
}
