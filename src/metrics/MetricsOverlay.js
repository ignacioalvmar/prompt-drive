/**
 * Live HUD overlay (DOM). Shows the selected metrics computed over a trailing
 * window from the collector buffers, refreshed on its own throttled timer so
 * nothing heavy runs on the physics thread.
 *
 * The overlay is toggled from a button injected into the game's lower menu
 * band (`#menu-bar-left`), built to match the native weather/scene/vehicle
 * controls: a `.menu-item` whose `.menu-icon` fires on `mousedown`. Those
 * controls act on a non-focusable element, so the press never pulls keyboard
 * focus off `#game-main` (which owns the vehicle keydown listener). A plain
 * focusable `<button>` would steal that focus and silently swallow the driving
 * keys until something refocused the game — so we deliberately mirror the
 * native band mechanism here.
 */

import { computeMetrics } from './compute.js';
import { getMetric } from './config.js';

const OVERLAY_STYLE_ID = 'pd-overlay-style';
const MENU_BUTTON_ID = 'pd-overlay-menu-item';
const MENU_ICON_URL = './static/media/driver_performance.svg';

// Styled to match the native lower-band menus (.menu-panel / .menu-panel-title):
// flat dark panel, Jura font, centred title bar. Anchored just above the 50px
// menu band (bottom:50px) at the left so it no longer covers the band icons —
// the toggle button stays clickable to hide it again.
const OVERLAY_CSS = `
.pd-overlay{position:fixed;left:0;bottom:50px;z-index:9999;width:280px;
  background:rgba(34,34,34,.8666666666666667);color:hsla(0,0%,100%,.7333333333333333);
  font-family:Jura,sans-serif;padding-bottom:6px;pointer-events:none;display:none}
.pd-overlay.open{display:block}
.pd-overlay .t{line-height:30px;height:30px;font-size:14px;text-align:center;
  text-transform:uppercase;letter-spacing:.1em;color:hsla(0,0%,100%,.6);
  background:#222;border-top:2px solid #1e1e1e;border-bottom:2px solid #1e1e1e;
  margin-bottom:6px}
.pd-overlay .m{display:flex;justify-content:space-between;gap:14px;
  padding:5px 14px;font-size:14px}
.pd-overlay .m .k{color:hsla(0,0%,100%,.6)}
.pd-overlay .m .v{color:#fff;font-variant-numeric:tabular-nums}
.pd-overlay .warn{color:#ffb454}
`;

// metrics meaningful as a live trailing-window readout
const LIVE_IDS = ['sdlp', 'meanLP', 'sds', 'meanSpeed', 'swrr', 'steeringEntropy', 'tlc', 'laneDepartures', 'collisions', 'percentRoadCenter', 'offRoadGlances', 'perclos', 'trackingUptime'];

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
    this._buildMenuButton();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._scheduleInject());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInjectMenuButton();
  }

  // --- lower-band toggle button -----------------------------------------
  // Mirrors the native menu-bar controls (see file header): a `.menu-item`
  // with a `.menu-icon` that toggles on `mousedown` of a non-focusable image,
  // so the game keeps keyboard focus.
  _buildMenuButton() {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.id = MENU_BUTTON_ID;
    item.tabIndex = -1;
    item.title = 'Driving performance overlay';

    const icon = document.createElement('img');
    icon.className = 'menu-icon';
    icon.src = MENU_ICON_URL;
    icon.alt = '';
    icon.addEventListener('mousedown', (e) => {
      // Keep focus on #game-main so vehicle keyboard input is never captured.
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    item.appendChild(icon);
    this.menuButton = item;
  }

  _scheduleInject() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInjectMenuButton();
    });
  }

  /** (Re)insert the toggle into the lower band once it exists. */
  _tryInjectMenuButton() {
    const bar = document.getElementById('menu-bar-left');
    if (!bar || !this.menuButton) return; // band not mounted yet
    if (bar.contains(this.menuButton)) return;
    bar.appendChild(this.menuButton);
    this._updateMenuButton();
  }

  _updateMenuButton() {
    if (this.menuButton) this.menuButton.classList.toggle('item-selected', this.visible);
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
    this._updateMenuButton();
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
      gazeAvailable: this.app._gazeAvailable ? this.app._gazeAvailable() : false,
      gazeAnalysis: this.app._gazeAnalysis ? this.app._gazeAnalysis(this.windowSec) : null,
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
    if (this._observer) this._observer.disconnect();
    if (this.menuButton) this.menuButton.remove();
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
