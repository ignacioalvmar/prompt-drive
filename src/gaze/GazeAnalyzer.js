/**
 * Native-rate gaze analysis. Keeps a ring buffer of every ~30 Hz sample (the
 * metrics collector only holds the physics-rate sample-and-hold copy) and runs
 * streaming detectors for blinks, off-road glance episodes, and long
 * eyes-closed periods. Emits distraction/drowsiness events into the metrics
 * event stream via the DrivingMetrics facade.
 *
 * `analyze(lastSeconds)` produces the summary consumed by compute.js for the
 * precision attention metrics (fixations, PERCLOS, blink rate, glances).
 */

import { AOI, AOI_LABELS, GAZE_THRESHOLDS } from './config.js';
import { pxPerDeg, meanOf } from './gaze-math.js';

// Local alias (a `as TH` import alias would be lost when the build strips
// module syntax — see scripts/build-gaze.js).
const TH = GAZE_THRESHOLDS;

const CAPACITY = 30 * 60 * 30; // 30 min at 30 Hz

export class GazeAnalyzer {
  constructor() {
    this.cap = CAPACITY;
    this.n = 0; // total samples ever pushed
    this.t = new Float64Array(this.cap);
    this.x = new Float64Array(this.cap);
    this.y = new Float64Array(this.cap);
    this.ear = new Float64Array(this.cap);
    this.valid = new Float64Array(this.cap);
    this.aoi = new Float64Array(this.cap);

    this.metrics = null; // DrivingMetrics facade (event sink), set by GazeTracking

    // streaming state
    this._blinkState = 'open';
    this._blinkStart = 0;
    this.blinkTimes = []; // seconds (sample clock)
    this._glanceStart = null; // {t, counts:{}} while off-road run active
    this._glanceEmitted = false;
    this.glances = []; // {tStart, dur, aoiMode}
    this._closedStart = null;
    this._closedEmitted = false;
  }

  setMetrics(m) {
    this.metrics = m;
  }

  reset() {
    this.n = 0;
    this._blinkState = 'open';
    this.blinkTimes = [];
    this._glanceStart = null;
    this._glanceEmitted = false;
    this.glances = [];
    this._closedStart = null;
    this._closedEmitted = false;
  }

  push(s) {
    const i = this.n % this.cap;
    this.t[i] = s.t;
    this.x[i] = s.x;
    this.y[i] = s.y;
    this.ear[i] = s.ear;
    this.valid[i] = s.valid ? 1 : 0;
    this.aoi[i] = s.aoi;
    this.n++;
    this._streamBlink(s);
    this._streamGlance(s);
    this._streamEyesClosed(s);
  }

  _emitEvent(type, data) {
    if (this.metrics && typeof this.metrics.addEvent === 'function') {
      try {
        this.metrics.addEvent(type, data);
      } catch (_) {
        /* metrics not recording */
      }
    }
  }

  _streamBlink(s) {
    if (!Number.isFinite(s.ear)) return;
    if (this._blinkState === 'open' && s.ear < TH.EAR_BLINK) {
      this._blinkState = 'closed';
      this._blinkStart = s.t;
    } else if (this._blinkState === 'closed' && s.ear > TH.EAR_OPEN) {
      this._blinkState = 'open';
      const durMs = (s.t - this._blinkStart) * 1000;
      if (durMs >= TH.BLINK_MIN_MS && durMs <= TH.BLINK_MAX_MS) {
        this.blinkTimes.push(s.t);
        if (this.blinkTimes.length > 5000) this.blinkTimes.splice(0, 1000);
      }
    }
  }

  _streamGlance(s) {
    const offRoad = s.valid && s.aoi !== AOI.ROAD_AHEAD && s.aoi >= 0;
    if (offRoad) {
      if (!this._glanceStart) {
        this._glanceStart = { t: s.t, counts: {} };
        this._glanceEmitted = false;
      }
      const c = this._glanceStart.counts;
      c[s.aoi] = (c[s.aoi] || 0) + 1;
      const dur = s.t - this._glanceStart.t;
      if (dur > TH.NHTSA_LONG_GLANCE_S && !this._glanceEmitted) {
        this._glanceEmitted = true;
        this._emitEvent('distraction', {
          durationSec: dur,
          aoi: AOI_LABELS[String(this._modeAoi(c))] || 'unknown',
          ongoing: true,
        });
      }
    } else if (this._glanceStart) {
      const dur = s.t - this._glanceStart.t;
      if (dur >= TH.OFFROAD_GLANCE_MIN_S) {
        this.glances.push({
          tStart: this._glanceStart.t,
          dur,
          aoiMode: this._modeAoi(this._glanceStart.counts),
        });
        if (this.glances.length > 5000) this.glances.splice(0, 1000);
      }
      this._glanceStart = null;
    }
  }

  _modeAoi(counts) {
    let best = -1;
    let bestN = -1;
    for (const k in counts) {
      if (counts[k] > bestN) {
        bestN = counts[k];
        best = Number(k);
      }
    }
    return best;
  }

  _streamEyesClosed(s) {
    const closed = Number.isFinite(s.ear) && s.ear < TH.EAR_BLINK;
    if (closed) {
      if (this._closedStart === null) {
        this._closedStart = s.t;
        this._closedEmitted = false;
      } else if (!this._closedEmitted && s.t - this._closedStart > TH.EYES_CLOSED_EVENT_S) {
        this._closedEmitted = true;
        this._emitEvent('drowsiness', { durationSec: s.t - this._closedStart, ongoing: true });
      }
    } else {
      this._closedStart = null;
    }
  }

  /** Chronological {t,x,y,ear,valid,aoi} arrays for the trailing window. */
  _window(lastSeconds) {
    const count = Math.min(this.n, this.cap);
    if (!count) return null;
    const newestIdx = (this.n - 1) % this.cap;
    const tEnd = this.t[newestIdx];
    const t0 = Number.isFinite(lastSeconds) ? tEnd - lastSeconds : -Infinity;
    const out = { t: [], x: [], y: [], ear: [], valid: [], aoi: [] };
    const start = this.n - count;
    for (let k = start; k < this.n; k++) {
      const i = k % this.cap;
      if (this.t[i] < t0) continue;
      out.t.push(this.t[i]);
      out.x.push(this.x[i]);
      out.y.push(this.y[i]);
      out.ear.push(this.ear[i]);
      out.valid.push(this.valid[i]);
      out.aoi.push(this.aoi[i]);
    }
    return out.t.length ? out : null;
  }

  /**
   * Summary over the trailing `lastSeconds` (Infinity/undefined = everything
   * buffered). Called off the physics path by report/overlay computation.
   */
  analyze(lastSeconds) {
    const w = this._window(lastSeconds);
    if (!w) return null;
    const tEnd = w.t[w.t.length - 1];
    const t0 = w.t[0];
    const span = Math.max(1e-6, tEnd - t0);

    // PERCLOS over the (clamped) standard window
    const perclosT0 = tEnd - Math.min(span, TH.PERCLOS_WINDOW_S);
    let closedN = 0;
    let earN = 0;
    for (let i = 0; i < w.t.length; i++) {
      if (w.t[i] < perclosT0 || !Number.isFinite(w.ear[i])) continue;
      earN++;
      if (w.ear[i] < TH.EAR_BLINK) closedN++;
    }

    const blinks = this.blinkTimes.filter((t) => t >= t0 && t <= tEnd).length;
    const glances = this.glances.filter((g) => g.tStart >= t0 && g.tStart <= tEnd);
    const longGlances = glances.filter((g) => g.dur > TH.NHTSA_LONG_GLANCE_S);

    const fixations = this._idtFixations(w);
    let uptimeN = 0;
    for (const v of w.valid) if (v) uptimeN++;

    return {
      windowSec: span,
      perclos: earN ? (closedN / earN) * 100 : NaN,
      blinkCount: blinks,
      blinkRatePerMin: (blinks / span) * 60,
      glanceCount: glances.length,
      glanceMeanDurSec: glances.length ? meanOf(glances.map((g) => g.dur)) : NaN,
      glanceMaxDurSec: glances.length ? Math.max(...glances.map((g) => g.dur)) : NaN,
      glanceRatePerMin: (glances.length / span) * 60,
      longGlanceCount: longGlances.length,
      fixationCount: fixations.length,
      fixationMeanDurMs: fixations.length ? meanOf(fixations.map((f) => f.durMs)) : NaN,
      trackingUptimePct: w.t.length ? (uptimeN / w.t.length) * 100 : NaN,
    };
  }

  /**
   * I-DT dispersion-based fixation detection (ISO 15007-aligned bounds).
   * Dispersion threshold in px derives from the render camera FOV.
   */
  _idtFixations(w) {
    const fov = this._cameraFov();
    const ppd = pxPerDeg(window.innerHeight, fov);
    const dispPx = Number.isFinite(ppd) ? TH.IDT_DISPERSION_DEG * ppd : 40;
    const minDur = TH.IDT_MIN_FIX_MS / 1000;
    const maxDur = TH.IDT_MAX_FIX_MS / 1000;
    const fixations = [];
    let i = 0;
    const n = w.t.length;
    while (i < n) {
      if (!w.valid[i]) {
        i++;
        continue;
      }
      // grow a window from i while dispersion stays under threshold
      let j = i;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      while (j < n && w.valid[j]) {
        const nx = Math.min(minX, w.x[j]);
        const xx = Math.max(maxX, w.x[j]);
        const ny = Math.min(minY, w.y[j]);
        const xy = Math.max(maxY, w.y[j]);
        if (xx - nx + (xy - ny) > dispPx) break;
        minX = nx;
        maxX = xx;
        minY = ny;
        maxY = xy;
        j++;
      }
      const dur = j > i ? w.t[j - 1] - w.t[i] : 0;
      if (dur >= minDur) {
        fixations.push({
          tStart: w.t[i],
          durMs: Math.min(dur, maxDur) * 1000,
          cx: meanOf(w.x.slice(i, j)),
          cy: meanOf(w.y.slice(i, j)),
        });
        i = j;
      } else {
        i++;
      }
    }
    return fixations;
  }

  _cameraFov() {
    try {
      const h = window.PromptDriveBridge && window.PromptDriveBridge.handles;
      return (h && h.camera && h.camera.fov) || 60;
    } catch (_) {
      return 60;
    }
  }
}
