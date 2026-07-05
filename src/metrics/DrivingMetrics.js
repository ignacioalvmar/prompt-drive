/**
 * Facade for the driving-performance-metrics subsystem. The game bundle
 * instantiates one `new DrivingMetrics(THREE)` (mirroring InstrumentCluster)
 * and calls `.sample(dt, state)` each physics frame. Everything else — config
 * panel, live overlay, run lifecycle, and report/log export — hangs off this.
 */

import { MetricsCollector } from './MetricsCollector.js';
import { MetricsPanel } from './MetricsPanel.js';
import { MetricsOverlay } from './MetricsOverlay.js';
import { loadSelection, saveSelection, METRIC_FAMILIES, METRICS } from './config.js';
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
    // Enrich with the latest gaze sample-and-hold (null when gaze is off).
    try {
      const gz = typeof window !== 'undefined' ? window.GazeTracking : null;
      if (gz) {
        state.gaze = gz.latestSample();
        this._bindGaze(gz);
      } else {
        state.gaze = null;
      }
    } catch (_) {
      state.gaze = null;
    }
    if (!this.collector.recording && this.autoStart && state && state.speed > AUTOSTART_SPEED) {
      this.startRun({ vehicle: state.vehicle, units: state.units });
    }
    this.collector.sample(dt, state);
  }

  /** One-time wiring: give the gaze analyzer this facade as its event sink. */
  _bindGaze(gz) {
    if (this._gazeBound) return;
    this._gazeBound = true;
    try {
      if (typeof gz.setMetrics === 'function') gz.setMetrics(this);
    } catch (_) {
      this._gazeBound = false;
    }
  }

  /** Append a discrete event (used by the gaze analyzer for distraction /
   *  drowsiness episodes; lands in the report Events table + events.json). */
  addEvent(type, data) {
    if (!this.collector.recording) return;
    this.collector.events.push(Object.assign({ type, t: this.collector.elapsed }, data || {}));
  }

  _gazeAvailable() {
    try {
      const gz = typeof window !== 'undefined' ? window.GazeTracking : null;
      return !!(gz && gz.isAvailable());
    } catch (_) {
      return false;
    }
  }

  /** Native-rate analyzer summary for the trailing window (or whole buffer). */
  _gazeAnalysis(lastSeconds) {
    try {
      const gz = typeof window !== 'undefined' ? window.GazeTracking : null;
      if (!gz || !gz.analyzer) return null;
      return gz.analyzer.analyze(lastSeconds);
    } catch (_) {
      return null;
    }
  }

  get isRecording() {
    return this.collector.recording;
  }

  // --- run lifecycle -----------------------------------------------------
  startRun(meta) {
    const m = Object.assign({}, meta || {});
    // Stamp gaze/calibration state into the run meta so the report records
    // whether attention metrics are trustworthy for this run.
    try {
      const gz = typeof window !== 'undefined' ? window.GazeTracking : null;
      if (gz) m.gaze = gz.status();
    } catch (_) {
      /* gaze bundle absent */
    }
    this.collector.start(m);
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
    return isComputable(id, this.trafficAvailable, this._gazeAvailable());
  }

  /** Metric registry (families + metrics) so external tools/the API can list
   *  and toggle metric selection without duplicating the config. */
  getRegistry() {
    return {
      families: METRIC_FAMILIES.map((f) => Object.assign({}, f)),
      metrics: METRICS.map((m) => ({ id: m.id, label: m.label, family: m.family, unit: m.unit, requiresTraffic: !!m.requiresTraffic, requiresGaze: !!m.requiresGaze })),
    };
  }

  /** Toggle every metric in a family at once (used by the API/static config). */
  setFamilySelected(family, on) {
    for (const m of METRICS) {
      if (m.family === family) this.setSelected(m.id, on);
    }
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
      gazeAvailable: this._gazeAvailable(),
      gazeAnalysis: this._gazeAnalysis(this.collector.durationSec() || Infinity),
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
