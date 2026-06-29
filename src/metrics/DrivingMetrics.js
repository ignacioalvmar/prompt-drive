/**
 * Facade for the driving-performance-metrics subsystem. The game bundle
 * instantiates one `new DrivingMetrics(THREE)` (mirroring InstrumentCluster)
 * and calls `.sample(dt, state)` each physics frame. Everything else — config
 * panel, live overlay, run lifecycle, and report/log export — hangs off this.
 */

import { MetricsCollector } from './MetricsCollector.js';
import { MetricsPanel } from './MetricsPanel.js';
import { MetricsOverlay } from './MetricsOverlay.js';
import { loadSelection, saveSelection } from './config.js';
import { isComputable } from './compute.js';
import { buildReport, downloadReport, downloadLogs } from './report.js';

const AUTOSTART_SPEED = 0.5; // m/s — begin a run once the car actually moves

export class DrivingMetrics {
  constructor(THREE) {
    this.THREE = THREE; // kept for parity / future in-scene viz
    this.collector = new MetricsCollector();
    this.selection = loadSelection();
    this.paramOverrides = {};
    this.trafficAvailable = false; // no traffic objects in this build (see plan §7)
    this.baselineRange = null; // null => first baselineSec of run (per metric)
    this.autoStart = true;

    try {
      this.panel = new MetricsPanel(this);
      this.overlay = new MetricsOverlay(this);
      this._bindKeys();
    } catch (e) {
      console.error('DrivingMetrics UI init failed', e);
    }
  }

  // --- engine hook -------------------------------------------------------
  /** Called once per physics frame from the build-main patch. */
  sample(dt, state) {
    if (!this.collector.recording && this.autoStart && state && state.speed > AUTOSTART_SPEED) {
      this.startRun({ vehicle: state.vehicle, units: state.units });
    }
    this.collector.sample(dt, state);
  }

  get isRecording() {
    return this.collector.recording;
  }

  // --- run lifecycle -----------------------------------------------------
  startRun(meta) {
    this.collector.start(meta);
  }

  stopRun() {
    this.collector.stop();
  }

  resetRun() {
    this.collector.reset();
  }

  // --- selection / config (used by the panel) ----------------------------
  getSelection() {
    return this.selection;
  }

  setSelected(id, on) {
    this.selection[id] = !!on;
    saveSelection(this.selection);
  }

  isComputable(id) {
    return isComputable(id, this.trafficAvailable);
  }

  /** Future hook: flip on when a traffic config is added to the sim. */
  setTrafficAvailable(v) {
    this.trafficAvailable = !!v;
  }

  durationSec() {
    return this.collector.durationSec();
  }

  sampleCount() {
    return this.collector.sampleCount;
  }

  // --- overlay -----------------------------------------------------------
  toggleOverlay() {
    if (this.overlay) this.overlay.toggle();
  }

  /** Trailing-window slice of every channel, for the live overlay. */
  windowedColumns(windowSec) {
    const cols = this.collector.columns();
    const t = cols.t;
    if (!t || !t.length) return cols;
    const cutoff = t[t.length - 1] - windowSec;
    let start = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] < cutoff) {
        start = i + 1;
        break;
      }
    }
    if (start === 0) return cols;
    const out = {};
    for (const k in cols) out[k] = cols[k].slice(start);
    return out;
  }

  // --- export ------------------------------------------------------------
  buildReport() {
    return buildReport(this.collector, this.selection, {
      paramOverrides: this.paramOverrides,
      trafficAvailable: this.trafficAvailable,
      baselineRange: this.baselineRange,
    });
  }

  downloadReport() {
    downloadReport(this.buildReport());
  }

  downloadLogs() {
    downloadLogs(this.collector);
  }

  // --- keybinds ----------------------------------------------------------
  _bindKeys() {
    this._keyHandler = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === 'm' || e.key === 'M') this.toggleOverlay();
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  dispose() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this.panel) this.panel.dispose();
    if (this.overlay) this.overlay.dispose();
  }
}
