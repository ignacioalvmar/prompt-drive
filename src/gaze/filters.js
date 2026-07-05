/**
 * Signal filters for the gaze pipeline. The mapped gaze point is smoothed with
 * a 1-euro filter (Casiez et al. 2012): jitter-free when the eye is still,
 * low-lag when it saccades — a better fit than a fixed-cutoff filter at the
 * webcam's ~30 Hz sample rate.
 */

class OneEuroChannel {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.prevX = null;
    this.prevDx = 0;
    this.prevT = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    if (this.prevX === null || this.prevT === null || t <= this.prevT) {
      this.prevX = x;
      this.prevT = t;
      return x;
    }
    const dt = t - this.prevT;
    const dx = (x - this.prevX) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.prevDx;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.prevX;
    this.prevX = xHat;
    this.prevDx = dxHat;
    this.prevT = t;
    return xHat;
  }

  reset() {
    this.prevX = null;
    this.prevDx = 0;
    this.prevT = null;
  }
}

export class OneEuroFilter2D {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.x = new OneEuroChannel(minCutoff, beta, dCutoff);
    this.y = new OneEuroChannel(minCutoff, beta, dCutoff);
  }

  /** @param {number} t seconds */
  filter(x, y, t) {
    return { x: this.x.filter(x, t), y: this.y.filter(y, t) };
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }
}

/** Simple exponential moving average (used to steady the EAR readout). */
export class Ema {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }
  push(v) {
    this.value = this.value === null ? v : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }
  reset() {
    this.value = null;
  }
}
