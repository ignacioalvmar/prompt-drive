/**
 * Session event log for the content layer (PromptDrive spec, "Event logging").
 *
 * - Clock: `t` is seconds since session start from ONE monotonic clock
 *   (performance.now). Wall-clock time is written once, in the header. Across
 *   a page reload the clock resumes from the last persisted `t` so it never
 *   runs backwards.
 * - Buffer: every event is appended to a localStorage-backed queue first, so a
 *   reload or a network cut loses nothing; batches are sent in order and only
 *   dropped from the queue once acknowledged.
 * - Transport: HTTP POST to a configured endpoint (2xx = ack), or — the
 *   default inside WorlDrive — a `contentLogBatch` event on the PromptDrive
 *   bridge that the parent acknowledges with `content.log.ack(batch_id)`.
 *   Unacknowledged batches are re-sent (same batch_id; receivers dedupe).
 * - A session is `complete` only when its final batch is acknowledged.
 */

const LOG_STORAGE_KEY = 'pd-content-log';
const LOG_BATCH_MAX = 50;
const LOG_FLUSH_MS = 2000;
const LOG_RESEND_MS = 8000;

function logNowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export class EventLog {
  constructor(emit) {
    this.emit = emit || (() => {});
    this.endpoint = null;
    this.headers = null;
    this.state = null; // persisted: { session_id, t_offset, seq, batch_seq, queue, inflight, final, complete }
    this.all = []; // full in-memory copy of this page's events (for download/inspection)
    this._t0 = logNowMs();
    this._timer = null;
    this._sending = false;
    this._restore();
  }

  // ------------------------------------------------------------ persistence

  _restore() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOG_STORAGE_KEY) : null;
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || !s.session_id) return;
      s.inflight = null; // resend whatever was in flight
      this.state = s;
      this._t0 = logNowMs();
      this._startTimer();
    } catch (_e) {
      this.state = null;
    }
  }

  _persist() {
    if (!this.state) return;
    try {
      this.state.t_offset = this.t();
      this._t0 = logNowMs();
      if (typeof localStorage !== 'undefined') localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(this.state));
    } catch (_e) {
      // Storage full/blocked: events stay in memory and still flush.
    }
  }

  // ------------------------------------------------------------ clock

  /** Seconds since session start (monotonic, 3 decimals). */
  t() {
    if (!this.state) return 0;
    const t = (this.state.t_offset || 0) + (logNowMs() - this._t0) / 1000;
    return Math.round(t * 1000) / 1000;
  }

  get sessionId() {
    return this.state ? this.state.session_id : null;
  }

  // ------------------------------------------------------------ lifecycle

  /** Start a new session log. Pending events of an older session are flushed first by the caller. */
  begin(sessionId) {
    if (this.state && this.state.session_id === sessionId && !this.state.final) {
      return false; // same session resumed after a reload
    }
    this.state = { session_id: sessionId, t_offset: 0, seq: 0, batch_seq: 0, queue: [], inflight: null, final: false, complete: false };
    this.all = [];
    this._t0 = logNowMs();
    this._persist();
    this._startTimer();
    return true;
  }

  configure(opts) {
    const o = opts || {};
    if (o.endpoint !== undefined) this.endpoint = o.endpoint || null;
    if (o.headers !== undefined) this.headers = o.headers || null;
    return { endpoint: this.endpoint };
  }

  /** Append one event; returns the stored record. */
  append(type, fields) {
    if (!this.state) return null;
    // Envelope fields win over payload fields of the same name.
    const rec = Object.assign({ type: null, t: null, seq: null, session_id: null }, fields || {}, { type, t: this.t(), seq: ++this.state.seq, session_id: this.state.session_id });
    this.state.queue.push(rec);
    this.all.push(rec);
    this._persist();
    this.emit('contentEvent', rec);
    if (this.state.queue.length >= LOG_BATCH_MAX) this.flush();
    return rec;
  }

  /** Mark the session finished; the final flush makes it complete once acked. */
  finish() {
    if (!this.state) return;
    this.state.final = true;
    this._persist();
    this.flush();
  }

  // ------------------------------------------------------------ transport

  _startTimer() {
    if (this._timer || typeof setInterval === 'undefined') return;
    this._timer = setInterval(() => this.flush(), LOG_FLUSH_MS);
  }

  flush() {
    const s = this.state;
    if (!s || s.complete) return;
    if (s.inflight) {
      if (logNowMs() - (s.inflight._sentAt || 0) > LOG_RESEND_MS) this._send(s.inflight); // re-send, same id
      return;
    }
    if (!s.queue.length && !(s.final && !s.complete)) return;
    const events = s.queue.slice(0, LOG_BATCH_MAX);
    const isFinal = s.final && events.length === s.queue.length;
    const batch = {
      batch_id: s.session_id + ':' + (++s.batch_seq),
      session_id: s.session_id,
      seq_from: events.length ? events[0].seq : null,
      seq_to: events.length ? events[events.length - 1].seq : null,
      final: isFinal,
      events,
    };
    s.inflight = batch;
    this._persist();
    this._send(batch);
  }

  _send(batch) {
    batch._sentAt = logNowMs();
    const wire = Object.assign({}, batch);
    delete wire._sentAt;
    if (this.endpoint && typeof fetch === 'function') {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, this.headers || {});
      fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(wire), keepalive: wire.final })
        .then((res) => { if (res && res.ok) this.ack(batch.batch_id); })
        .catch(() => { /* offline: retried by the timer */ });
    } else {
      this.emit('contentLogBatch', wire);
    }
  }

  /** Acknowledge a batch (HTTP 2xx, or the parent via content.log.ack). */
  ack(batchId) {
    const s = this.state;
    if (!s || !s.inflight || s.inflight.batch_id !== batchId) return { acked: false, batch_id: batchId };
    const n = s.inflight.events.length;
    const wasFinal = s.inflight.final;
    s.queue.splice(0, n);
    s.inflight = null;
    if (wasFinal) {
      s.complete = true;
      this.emit('contentSessionComplete', { session_id: s.session_id });
    }
    this._persist();
    if (!s.complete && (s.queue.length || s.final)) this.flush();
    return { acked: true, batch_id: batchId, complete: !!s.complete, pending: s.queue.length };
  }

  status() {
    const s = this.state;
    if (!s) return { session_id: null };
    return {
      session_id: s.session_id,
      t: this.t(),
      seq: s.seq,
      pending: s.queue.length,
      inflight: s.inflight ? s.inflight.batch_id : null,
      final: !!s.final,
      complete: !!s.complete,
      transport: this.endpoint ? 'http' : 'bridge',
    };
  }

  /** Drop a completed session's persisted state (keeps unacked data otherwise). */
  clearIfComplete() {
    if (this.state && this.state.complete) {
      try { localStorage.removeItem(LOG_STORAGE_KEY); } catch (_e) {}
      return true;
    }
    return false;
  }
}
