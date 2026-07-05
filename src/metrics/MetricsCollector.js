/**
 * Telemetry collector. Accumulates one row per physics frame into growable
 * struct-of-arrays buffers (low GC pressure, per Report 1/2 §Three.js), plus a
 * discrete event log (collisions, and any markers). All heavy metric
 * computation happens elsewhere, off the physics path.
 *
 * The engine calls `sample(dt, state)` from a build-main patch at the end of
 * VehicleController.updateVehicleState, where all ego state is fresh.
 */

const CHUNK = 4096;

class Channel {
  constructor() {
    this.buf = new Float64Array(CHUNK);
    this.length = 0;
  }
  push(v) {
    if (this.length >= this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }
  /** A plain Array copy of the used range (for the math layer). */
  toArray() {
    return Array.prototype.slice.call(this.buf.subarray(0, this.length));
  }
}

export class MetricsCollector {
  constructor() {
    this.channels = {
      t: new Channel(), // monotonic time (s)
      dt: new Channel(), // frame dt (s)
      posX: new Channel(),
      posZ: new Channel(),
      speed: new Channel(), // m/s
      steerRad: new Channel(),
      throttle: new Channel(), // [0..1]-ish
      brake: new Channel(),
      accelLon: new Channel(), // m/s^2
      accelLat: new Channel(),
      lateralOffset: new Channel(), // m, signed (+ = left)
      laneHalfL: new Channel(), // m, distance to left boundary
      laneHalfR: new Channel(), // m, distance to right boundary
      heading: new Channel(),
      nodeIndex: new Channel(),
      onRoad: new Channel(), // 1 = on road, 0 = off road
      // gaze sample-and-hold (NaN whenever the gaze subsystem is off/invalid)
      gazeX: new Channel(), // CSS px
      gazeY: new Channel(),
      gazeAoi: new Channel(), // AOI code (see src/gaze/config.js)
      gazeValid: new Channel(), // 1 = usable gaze estimate this frame
      gazeEar: new Channel(), // eye aspect ratio (mean of both eyes)
      headYaw: new Channel(), // deg
      headPitch: new Channel(), // deg
    };
    this.events = []; // {type, t, ...}
    this.recording = false;
    this.elapsed = 0;
    this.startWallClock = null;
    this._prevCollided = false;
    this.meta = {};
  }

  start(meta) {
    this.reset();
    this.recording = true;
    this.meta = Object.assign({ startedAt: new Date().toISOString() }, meta || {});
  }

  stop() {
    this.recording = false;
    this.meta.stoppedAt = new Date().toISOString();
  }

  reset() {
    for (const k in this.channels) this.channels[k] = new Channel();
    this.events = [];
    this.elapsed = 0;
    this.startWallClock = null;
    this._prevCollided = false;
    this.meta = {};
  }

  get isRecording() {
    return this.recording;
  }

  get sampleCount() {
    return this.channels.t.length;
  }

  /**
   * Append one frame. `state` carries fresh ego values from the engine.
   * @param {number} dt  frame delta-time (s)
   */
  sample(dt, state) {
    if (!this.recording) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;

    const ch = this.channels;
    ch.t.push(this.elapsed);
    ch.dt.push(dt);
    ch.posX.push(num(state.posX));
    ch.posZ.push(num(state.posZ));
    ch.speed.push(num(state.speed));
    ch.steerRad.push(num(state.steer));
    ch.throttle.push(num(state.throttle));
    ch.brake.push(num(state.brake));

    // accel is already body-frame in the engine (rotated by -orientation.y),
    // so store components directly: z = longitudinal, x = lateral.
    const a = state.accel;
    if (a) {
      ch.accelLon.push(num(a.z));
      ch.accelLat.push(num(a.x));
    } else {
      ch.accelLon.push(NaN);
      ch.accelLat.push(NaN);
    }

    ch.lateralOffset.push(num(state.lateralOffset));
    ch.laneHalfL.push(num(state.laneHalfL));
    ch.laneHalfR.push(num(state.laneHalfR));
    ch.heading.push(num(state.heading));
    ch.nodeIndex.push(num(state.nodeIndex));
    ch.onRoad.push(state.onRoad ? 1 : 0);

    // Gaze sample-and-hold: DrivingMetrics enriches state with the latest
    // gaze sample (or null); all channels stay rectangular via NaN.
    const g = state.gaze;
    ch.gazeX.push(g ? num(g.x) : NaN);
    ch.gazeY.push(g ? num(g.y) : NaN);
    ch.gazeAoi.push(g && Number.isFinite(g.aoi) ? g.aoi : NaN);
    ch.gazeValid.push(g && g.valid ? 1 : 0);
    ch.gazeEar.push(g ? num(g.ear) : NaN);
    ch.headYaw.push(g ? num(g.headYaw) : NaN);
    ch.headPitch.push(g ? num(g.headPitch) : NaN);

    // Rising-edge collision event.
    const collided = !!state.collided;
    if (collided && !this._prevCollided) {
      this.events.push({ type: 'collision', t: this.elapsed, speed: num(state.speed) });
    }
    this._prevCollided = collided;
  }

  /** Plain-array view of every channel, for the math/report layers. */
  columns() {
    const out = {};
    for (const k in this.channels) out[k] = this.channels[k].toArray();
    return out;
  }

  durationSec() {
    return this.elapsed;
  }

  /** Approximate path distance from logged speed * dt (m). */
  distanceM() {
    const ch = this.channels;
    let d = 0;
    for (let i = 0; i < ch.t.length; i++) d += ch.speed.buf[i] * ch.dt.buf[i];
    return d;
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}
