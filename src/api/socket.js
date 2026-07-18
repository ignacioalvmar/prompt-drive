/**
 * Layer 2(f): WebSocket transport. Lets an EXTERNAL process (e.g. the car-bench
 * Python harness) drive a running simulation in real time. The browser connects
 * OUT to a WebSocket server (default ws://127.0.0.1:8765) — there is still no
 * server running inside the page, matching the app's browser-only design.
 *
 * Activate by loading the sim with ?ws=<url>&wsToken=<token> (or by setting
 * localStorage 'pd-ws' / 'pd-ws-token'). Without a url the module stays inert,
 * so normal users are unaffected.
 *
 * Envelope (mirrors broadcast.js; ns:'promptdrive'):
 *   browser→server  { ns, kind:'hello', role:'sim', token, version, url }
 *   server→browser  { ns, kind:'req',   id, op, args }   op = dot-path into window.PromptDrive
 *   browser→server  { ns, kind:'res',   id, result }
 *   browser→server  { ns, kind:'event', event, payload }
 *
 * `op` resolution and result passthrough are identical to the BroadcastChannel
 * transport, so every facade capability (including vehicle.*) is reachable with
 * no extra wiring. Reconnects with exponential backoff (0.5s → 30s) forever.
 * See car-bench-compat-plan.md §4.4 / Appendix A.
 */
(function () {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  const NS = 'promptdrive';
  const MAX_BACKOFF = 30000;

  const params = (() => { try { return new URLSearchParams(window.location.search); } catch (_e) { return null; } })();
  const ls = (k) => { try { return window.localStorage.getItem(k); } catch (_e) { return null; } };
  const wsUrl = (params && params.get('ws')) || ls('pd-ws');
  if (!wsUrl) return; // inert unless explicitly pointed at a server
  const token = (params && params.get('wsToken')) || ls('pd-ws-token') || '';

  // Resolve a dot-path op into window.PromptDrive (same walk as broadcast.js).
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

  let ws = null;
  let backoff = 500;
  let unsub = null;
  let closedByUs = false;

  function send(obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (_e) {}
    }
  }

  function onEvent(event, payload) {
    send({ ns: NS, kind: 'event', event, payload });
  }

  function connect() {
    try { ws = new WebSocket(wsUrl); } catch (_e) { scheduleReconnect(); return; }

    ws.onopen = () => {
      backoff = 500;
      send({ ns: NS, kind: 'hello', role: 'sim', token, version: '1.0', url: window.location.href });
      // Forward every engine/API event to the server; subscribing to 'any' also
      // keeps the ~10 Hz telemetry tick alive (it only emits while a listener
      // exists). Re-subscribed on every (re)connect, torn down on close.
      if (window.PromptDriveBridge && !unsub) {
        unsub = window.PromptDriveBridge.on('any', onEvent);
      }
    };

    ws.onmessage = (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch (_e) { return; }
      if (!d || d.ns !== NS || d.kind !== 'req') return;
      let result;
      try {
        const r = resolveOp(d.op);
        if (!r) result = { ok: false, error: 'unknown_op', op: d.op };
        else result = r.fn.apply(r.owner, Array.isArray(d.args) ? d.args : []);
      } catch (ex) {
        result = { ok: false, error: 'exception', message: String((ex && ex.message) || ex) };
      }
      send({ ns: NS, kind: 'res', id: d.id, result });
    };

    ws.onclose = () => {
      if (unsub) { try { unsub(); } catch (_e) {} unsub = null; }
      ws = null;
      if (!closedByUs) scheduleReconnect();
    };

    ws.onerror = () => { try { if (ws) ws.close(); } catch (_e) {} };
  }

  function scheduleReconnect() {
    const delay = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
    setTimeout(() => { if (!closedByUs) connect(); }, delay);
  }

  // Small introspection handle (not part of the facade; for debugging).
  window.PromptDriveSocket = {
    url: wsUrl,
    connected: () => !!(ws && ws.readyState === 1),
    close: () => { closedByUs = true; if (ws) { try { ws.close(); } catch (_e) {} } },
  };

  connect();
})();
