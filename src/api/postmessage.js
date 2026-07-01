/**
 * Layer 2(b): postMessage bridge (plan §5.3b). When Prompt Drive is embedded in
 * an iframe, a parent app drives the same `window.PromptDrive` facade across the
 * window boundary.
 *
 * Envelope:
 *   request  { ns:'promptdrive', id, op, args }
 *   response { ns:'promptdrive', id, result }
 *   event    { ns:'promptdrive', event, payload }
 *
 * `op` is a dot-path into the facade, e.g. 'dynamic.set', 'config.apply',
 * 'telemetry.state', 'get', 'schema'. Guarded by an origin allow-list; default
 * is same-origin only. A parent extends it by posting an 'init' op with
 * { allowOrigins:[...] }, or the host sets window.PROMPTDRIVE_ALLOWED_ORIGINS.
 */

const NS = 'promptdrive';

function resolveOp(op) {
  // Walk the dot-path to a function on the facade.
  const parts = op.split('.');
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

function startPostMessageBridge() {
  if (typeof window === 'undefined' || window.parent === window) return; // not embedded
  const sameOrigin = window.location.origin;
  let allowed = [sameOrigin];
  if (Array.isArray(window.PROMPTDRIVE_ALLOWED_ORIGINS)) {
    allowed = allowed.concat(window.PROMPTDRIVE_ALLOWED_ORIGINS);
  }

  function originOk(origin) {
    return allowed.includes('*') || allowed.includes(origin);
  }

  function post(target, msg, origin) {
    try { target.postMessage(Object.assign({ ns: NS }, msg), origin); } catch (_e) {}
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.ns !== NS || d.op == null) return;
    if (d.op === 'init') {
      if (Array.isArray(d.args && d.args[0] && d.args[0].allowOrigins)) {
        allowed = allowed.concat(d.args[0].allowOrigins);
      }
      post(e.source, { id: d.id, result: { ok: true, allowed } }, e.origin);
      return;
    }
    if (!originOk(e.origin)) {
      post(e.source, { id: d.id, result: { ok: false, error: 'origin_not_allowed', origin: e.origin } }, e.origin);
      return;
    }
    let result;
    try {
      const resolved = resolveOp(d.op);
      if (!resolved) result = { ok: false, error: 'unknown_op', op: d.op };
      else result = resolved.fn.apply(resolved.owner, d.args || []);
    } catch (err) {
      result = { ok: false, error: 'exception', message: String(err && err.message || err) };
    }
    Promise.resolve(result).then((r) => post(e.source, { id: d.id, result: r }, e.origin));
  });

  // Forward every engine event to the parent so the embedder gets the stream.
  if (window.PromptDriveBridge) {
    window.PromptDriveBridge.on('any', (event, payload) => {
      post(window.parent, { event, payload }, '*');
    });
  }

  // Announce readiness to the parent once handles attach.
  if (window.PromptDrive && window.PromptDrive.ready) {
    window.PromptDrive.ready.then(() => post(window.parent, { event: 'ready', payload: { version: '1.0' } }, '*'));
  }
}

startPostMessageBridge();
