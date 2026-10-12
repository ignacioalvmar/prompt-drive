/**
 * Autonomy handover: a non-interactive perimeter cue for who is controlling
 * the car. It reads the engine observable and never changes it.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const NOTICE_MS = 3000;
  let frame = null;
  let label = null;
  let pollTimer = null;
  let noticeTimer = null;
  let observable = null;
  let listener = null;
  let hasInitialState = false;
  let currentValue = false;
  let disposed = false;

  function setVisible(visible) {
    if (!frame) return;
    frame.dataset.visible = visible ? 'true' : 'false';
    frame.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function clearNotice() {
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
  }

  function showState(active, initial) {
    if (!frame) return;
    currentValue = Boolean(active);
    clearNotice();
    if (initial) frame.style.transition = 'none';
    frame.dataset.active = currentValue ? 'true' : 'false';

    if (currentValue) {
      frame.setAttribute('aria-label', 'Control automático activo; el vehículo maneja');
      setVisible(true);
      if (initial) {
        frame.dataset.phase = 'active';
        label.textContent = '';
        frame.offsetHeight;
        frame.style.transition = '';
        return;
      }

      frame.dataset.phase = 'active-notice';
      label.textContent = 'Control automático activo · el vehículo maneja';
      noticeTimer = setTimeout(() => {
        if (currentValue && frame.dataset.phase === 'active-notice') {
          label.textContent = '';
          frame.dataset.phase = 'active';
        }
        noticeTimer = null;
      }, NOTICE_MS);
      return;
    }

    if (initial) {
      frame.dataset.phase = 'idle';
      frame.setAttribute('aria-label', 'Control manual; manejas tú');
      label.textContent = '';
      setVisible(false);
      frame.offsetHeight;
      frame.style.transition = '';
      return;
    }

    frame.dataset.phase = 'handover';
    frame.setAttribute('aria-label', 'Toma el control; manejas tú');
    label.textContent = 'Toma el control · manejas tú';
    setVisible(true);
    noticeTimer = setTimeout(() => {
      if (!currentValue && frame.dataset.phase === 'handover') {
        label.textContent = '';
        frame.dataset.phase = 'idle';
        setVisible(false);
      }
      noticeTimer = null;
    }, NOTICE_MS);
  }

  function readValue(source) {
    try { return Boolean(source && source.value); } catch (_error) { return false; }
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function attach(ctx, candidate) {
    if (!candidate || disposed) return false;
    observable = candidate;
    const initial = readValue(observable);
    if (!hasInitialState) {
      hasInitialState = true;
      showState(initial, true);
    }

    if (typeof observable.addListener === 'function' && typeof observable.removeListener === 'function') {
      listener = (value) => {
        const next = Boolean(value);
        if (next !== currentValue) showState(next, false);
      };
      try {
        observable.addListener(listener);
        stopPolling();
        return true;
      } catch (_error) {
        listener = null;
      }
    }

    // Compatibility fallback for observable-shaped handles without listeners.
    stopPolling();
    pollTimer = setInterval(() => {
      const next = readValue(observable);
      if (next !== currentValue) showState(next, false);
    }, 500);
    return true;
  }

  function findObservable(ctx) {
    try {
      const handles = ctx.handles();
      return handles && handles.autodrive ? handles.autodrive : null;
    } catch (_error) { return null; }
  }

  CabinFeedback.register({
    id: 'autonomy_handover',
    title: 'Transferencia de control',
    fields: [],

    init(ctx) {
      const style = document.createElement('style');
      style.textContent = [
        '.ah-frame {',
        'position: absolute; inset: 0.8vh 0.6vw; box-sizing: border-box;',
        'border: clamp(0.18vw, 0.28vw, 0.6vw) solid rgba(225, 236, 239, 0.24);',
        'border-radius: 1.2vw; opacity: 0; visibility: hidden;',
        'transition: opacity 220ms ease, border-color 220ms ease, visibility 220ms;',
        '}',
        '.ah-frame[data-visible="true"] { opacity: 1; visibility: visible; }',
        '.ah-frame[data-phase="handover"] {',
        'border-color: #e5a941; box-shadow: 0 0 0 0.12vw rgba(229,169,65,0.16);',
        '}',
        '.ah-label {',
        'position: absolute; top: 0.8vh; left: 50%; transform: translateX(-50%);',
        'max-width: 78%; box-sizing: border-box; padding: 0.65vh 1.2vw;',
        'border: 1px solid rgba(255,255,255,0.26); border-radius: 2vw;',
        'background: rgba(10,18,25,0.94); color: #f4f7f8;',
        'font: 700 clamp(0.8vw, 1vw, 1.2vw)/1.25 system-ui, -apple-system, sans-serif;',
        'text-align: center; white-space: normal;',
        'box-shadow: 0 0.8vh 1.6vw rgba(0,0,0,0.24);',
        '}',
        '.ah-frame[data-phase="handover"] .ah-label { color: #ffd18a; }',
        '.ah-frame[data-phase="active"] .ah-label, .ah-frame[data-phase="idle"] .ah-label { display: none; }',
        '@media (prefers-reduced-motion: reduce) { .ah-frame { transition: none; } }',
      ].join('\n');
      ctx.layer.appendChild(style);

      frame = document.createElement('div');
      frame.className = 'ah-frame';
      frame.dataset.visible = 'false';
      frame.dataset.active = 'false';
      frame.dataset.phase = 'idle';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('role', 'status');
      label = document.createElement('div');
      label.className = 'ah-label';
      frame.appendChild(label);
      ctx.layer.appendChild(frame);

      const tryAttach = () => {
        if (disposed || observable) return;
        const candidate = findObservable(ctx);
        if (candidate) attach(ctx, candidate);
      };
      tryAttach();
      if (!observable) pollTimer = setInterval(tryAttach, 1000);
    },

    dispose() {
      disposed = true;
      stopPolling();
      clearNotice();
      if (observable && listener && typeof observable.removeListener === 'function') {
        try { observable.removeListener(listener); } catch (_error) {}
      }
      listener = null;
      observable = null;
    },
  });
})();
