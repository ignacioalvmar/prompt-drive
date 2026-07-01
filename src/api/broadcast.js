/**
 * Layer 2(e): cross-tab BroadcastChannel transport. Lets a *separate*
 * same-origin page (e.g. api-test.html) drive a running simulation without
 * embedding it — the sim runs normally in its own tab on localhost:3000, and a
 * console tab connects over a BroadcastChannel and issues the same facade ops.
 *
 * Channel: 'promptdrive'. Envelope:
 *   request  { ns:'promptdrive', kind:'req',   id, op, args }
 *   response { ns:'promptdrive', kind:'res',   id, result }
 *   event    { ns:'promptdrive', kind:'event', event, payload }
 *
 * This runs on the *simulation* page (where api.js is loaded). `op` is a
 * dot-path into window.PromptDrive, exactly like the postMessage bridge. The
 * console page implements the requester half. BroadcastChannel is origin-scoped
 * and never echoes to the sender, so the two tabs talk without loops.
 */
(function () {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  const NS = 'promptdrive';
  let ch;
  try { ch = new BroadcastChannel(NS); } catch (_e) { return; }

  function resolveOp(op) {
    const parts = String(op).split('.');
    let ctx = window.PromptDrive;
    let owner = null;
    for (const p of parts) {
      if (ctx == null) return null;
      owner = ctx;
      ctx = ctx[p];
    }
    if (typeof ctx !== 'function') return null;
    return { fn: ctx, owner };
  }

  ch.onmessage = (e) => {
    const d = e.data;
    if (!d || d.ns !== NS || d.kind !== 'req') return;
    let result;
    try {
      const r = resolveOp(d.op);
      if (!r) result = { ok: false, error: 'unknown_op', op: d.op };
      else result = r.fn.apply(r.owner, d.args || []);
    } catch (err) {
      result = { ok: false, error: 'exception', message: String((err && err.message) || err) };
    }
    Promise.resolve(result).then((res) => {
      try { ch.postMessage({ ns: NS, kind: 'res', id: d.id, result: res }); } catch (_e) {}
    });
  };

  // Forward every engine event to connected consoles (this 'any' listener also
  // keeps the ~10 Hz telemetry tick alive so the console gets a live feed).
  if (window.PromptDriveBridge) {
    window.PromptDriveBridge.on('any', (event, payload) => {
      try { ch.postMessage({ ns: NS, kind: 'event', event, payload }); } catch (_e) {}
    });
  }
  if (window.PromptDrive && window.PromptDrive.ready) {
    window.PromptDrive.ready.then(() => {
      try { ch.postMessage({ ns: NS, kind: 'event', event: 'ready', payload: { version: '1.0' } }); } catch (_e) {}
    });
  }
})();
