/**
 * Feature: control handover (modo autónomo).
 *
 * Fields: none. Autonomous mode lives in the engine, not in VehicleState, so
 * this feature reads PromptDrive's telemetry `tick` (falling back to
 * PromptDrive.get('controls.autodrive')) and acts only when the value changes.
 *
 * What the person perceives: while the car drives itself, a thin violet glow
 * rings the screen edge and a small pill (steering-wheel icon + "AUTO") sits at
 * the bottom centre, above the simulator's bottom bar. When autonomy turns on,
 * the glow enters from the sides over 2.5 s with two rising tones. When it
 * turns off, the glow fades over 1.5 s with one falling tone and the pill reads
 * "MANUAL" for 2 s before disappearing. If autonomy is already on when the page
 * loads, the steady state appears at once, with no animation and no sound.
 * Violet is not used by the assistant's own cues. With prefers-reduced-motion
 * only opacity changes. DOM layer only; it never writes vehicle state.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const VIOLET = '167, 139, 250';
  const ENTER_MS = 2500;
  const EXIT_MS = 1500;
  const MANUAL_PILL_MS = 2000;
  const TONE_VOLUME = 0.15;

  const WHEEL_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/>' +
    '<path d="M3.5 10.5 10 12M20.5 10.5 14 12M12 14v7"/></svg>';

  let ctx = null;
  let edge = null;
  let pill = null;
  let pillLabel = null;
  let unsubscribe = null;
  let previous;          // last autodrive value seen; undefined until first read
  let pillTimer = null;
  let toneTimer = null;

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function setEdge(on, ms) {
    const still = reducedMotion();
    edge.style.transition = still
      ? `opacity ${ms}ms ease`
      : `opacity ${ms}ms ease, box-shadow ${ms}ms ease`;
    edge.style.opacity = on ? '1' : '0';
    edge.style.boxShadow = on || still
      ? `inset 0 0 0 2px rgba(${VIOLET}, 0.55), inset 0 0 36px 4px rgba(${VIOLET}, 0.35)`
      : `inset 0 0 0 0 rgba(${VIOLET}, 0), inset 0 0 0 0 rgba(${VIOLET}, 0)`;
  }

  function setPill(visible, label, ms) {
    pillLabel.textContent = label;
    pill.style.transition = `opacity ${ms}ms ease`;
    pill.style.opacity = visible ? '1' : '0';
  }

  function applyImmediately(on) {
    setEdge(on, 0);
    setPill(on, 'AUTO', 0);
  }

  function engage() {
    setEdge(false, 0);
    // Force the starting style to commit so the transition runs from "off".
    void edge.offsetWidth;
    setEdge(true, ENTER_MS);
    setPill(true, 'AUTO', ENTER_MS);
    ctx.audio.tone({ freq: 440, freqEnd: 520, ms: 160, type: 'sine', volume: TONE_VOLUME });
    toneTimer = setTimeout(() => {
      ctx.audio.tone({ freq: 660, freqEnd: 780, ms: 200, type: 'sine', volume: TONE_VOLUME });
    }, 220);
  }

  function release() {
    setEdge(false, EXIT_MS);
    setPill(true, 'MANUAL', 150);
    ctx.audio.tone({ freq: 620, freqEnd: 360, ms: 320, type: 'sine', volume: TONE_VOLUME });
    pillTimer = setTimeout(() => setPill(false, 'MANUAL', 400), MANUAL_PILL_MS);
  }

  function read(tickState) {
    if (tickState && typeof tickState.autodrive === 'boolean') return tickState.autodrive;
    try {
      const value = PromptDrive.get('controls.autodrive');
      return typeof value === 'boolean' ? value : undefined;
    } catch (_e) {
      return undefined;
    }
  }

  function update(tickState) {
    const current = read(tickState);
    if (current === undefined || current === previous) return;
    const first = previous === undefined;
    previous = current;
    clearTimeout(pillTimer);
    clearTimeout(toneTimer);
    if (first) applyImmediately(current);
    else if (current) engage();
    else release();
  }

  CabinFeedback.register({
    id: 'handover',
    title: 'Traspaso de control',
    fields: [],

    init(context) {
      ctx = context;
      edge = document.createElement('div');
      Object.assign(edge.style, {
        position: 'absolute',
        inset: '0',
        opacity: '0',
        willChange: 'opacity',
      });
      pill = document.createElement('div');
      Object.assign(pill.style, {
        position: 'absolute',
        left: '50%',
        bottom: 'calc(50px + 3vh)',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 12px',
        borderRadius: '999px',
        background: 'rgba(14, 10, 28, 0.65)',
        border: `1px solid rgba(${VIOLET}, 0.6)`,
        color: `rgb(${VIOLET})`,
        font: '600 13px/1 Jura, ShareTech, sans-serif',
        letterSpacing: '0.12em',
        opacity: '0',
        willChange: 'opacity',
      });
      pill.insertAdjacentHTML('beforeend', WHEEL_SVG);
      pillLabel = document.createElement('span');
      pill.appendChild(pillLabel);
      ctx.layer.appendChild(edge);
      ctx.layer.appendChild(pill);

      update(null);
      try {
        unsubscribe = PromptDrive.on('tick', update);
      } catch (_e) {
        unsubscribe = null;
      }
    },

    dispose() {
      clearTimeout(pillTimer);
      clearTimeout(toneTimer);
      if (typeof unsubscribe === 'function') unsubscribe();
      unsubscribe = null;
    },
  });
})();
