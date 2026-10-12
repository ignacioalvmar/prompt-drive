/**
 * Feature: defrost (desempañador delantero y trasero).
 *
 * Fields: window_front_defrost, window_rear_defrost
 *
 * What the driver perceives:
 *  - Front: when switched on, a faint mist over the upper windshield clears
 *    from the bottom up over ~10 s (the area nearest the vents clears first,
 *    like the real airflow), plus a soft rising fan "whoosh". The mist is
 *    capped at low opacity and never covers the lower road band.
 *  - Rear: a small group of amber heater lines near the rear-view mirror
 *    position lights up and stays on while the rear defroster is active.
 *  - A small amber tell-tale chip (bottom edge, out of the road view) shows
 *    which defroster is on, using the ISO 2575 style "wavy arrows" shape.
 *
 * Initial state: if a defroster is already on at load, the chip/lines show
 * immediately and no mist animation is played (glass is assumed clear).
 * The feature only reads VehicleState; it never writes to it.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const CLEAR_MS = 10000;
  const AMBER = 'rgba(255, 176, 64, 0.95)';
  let mist = null;
  let rearLines = null;
  let chip = null;
  let chipFront = null;
  let chipRear = null;
  let clearTimer = null;
  let first = true;
  let prevFront = false;
  let prevRear = false;

  function wavyIcon(label) {
    // Three wavy upward arrows (defrost symbol) drawn in SVG, plus F/R label.
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 32 24');
    svg.setAttribute('width', '30');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    for (const x of [8, 16, 24]) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', `M${x} 20 q-3 -4 0 -8 q3 -4 0 -8`);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', AMBER);
      p.setAttribute('stroke-width', '2.2');
      p.setAttribute('stroke-linecap', 'round');
      svg.appendChild(p);
    }
    const wrap = document.createElement('span');
    Object.assign(wrap.style, {
      display: 'none', alignItems: 'center', gap: '2px',
      font: '600 12px system-ui, sans-serif', color: AMBER,
    });
    wrap.appendChild(svg);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  function startClearing(ctx) {
    if (!mist) return;
    clearTimeout(clearTimer);
    // Reset to fogged without transition, then clear bottom-up.
    mist.style.transition = 'none';
    mist.style.opacity = '1';
    mist.style.clipPath = 'inset(0 0 0 0)';
    void mist.offsetHeight; // force reflow so the transition restarts
    mist.style.transition = `clip-path ${CLEAR_MS}ms cubic-bezier(.3,.1,.3,1), opacity 600ms ease ${CLEAR_MS - 600}ms`;
    mist.style.clipPath = 'inset(0 0 100% 0)';
    mist.style.opacity = '0';
    clearTimer = setTimeout(() => { if (mist) mist.style.transition = 'none'; }, CLEAR_MS + 50);
    // Fan whoosh: low, soft, rising sweep.
    ctx.audio.tone({ freq: 140, freqEnd: 320, ms: 700, type: 'sine', volume: 0.06 });
  }

  function stopClearing() {
    if (!mist) return;
    clearTimeout(clearTimer);
    mist.style.transition = 'opacity 300ms ease';
    mist.style.opacity = '0';
  }

  CabinFeedback.register({
    id: 'defrost',
    title: 'Desempañador',
    fields: ['window_front_defrost', 'window_rear_defrost'],

    init(ctx) {
      // Windshield mist: upper part of the view only (top 0..42%).
      mist = document.createElement('div');
      Object.assign(mist.style, {
        position: 'absolute', left: '0', right: '0', top: '0', height: '42%',
        background: 'linear-gradient(to bottom, rgba(225,232,240,0.38), rgba(225,232,240,0.22) 70%, rgba(225,232,240,0))',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        opacity: '0', clipPath: 'inset(0 0 100% 0)',
      });
      ctx.layer.appendChild(mist);

      // Rear heater lines near the rear-view mirror (top centre).
      rearLines = document.createElement('div');
      Object.assign(rearLines.style, {
        position: 'absolute', top: '3vh', left: '50%', transform: 'translateX(-50%)',
        width: '9vw', height: '3vh', opacity: '0', transition: 'opacity 400ms ease',
        background: `repeating-linear-gradient(to bottom, ${AMBER} 0 2px, transparent 2px 7px)`,
        borderRadius: '4px', filter: 'drop-shadow(0 0 4px rgba(255,160,40,0.7))',
      });
      ctx.layer.appendChild(rearLines);

      // Tell-tale chip, bottom-centre edge.
      chip = document.createElement('div');
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      Object.assign(chip.style, {
        position: 'absolute', bottom: '1.2vh', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '10px', padding: '3px 10px', borderRadius: '10px',
        background: 'rgba(10,12,16,0.55)', opacity: '0', transition: 'opacity 300ms ease',
      });
      chipFront = wavyIcon('F');
      chipRear = wavyIcon('R');
      chip.appendChild(chipFront);
      chip.appendChild(chipRear);
      ctx.layer.appendChild(chip);
    },

    onChange(changed, snapshot, ctx) {
      const front = !!snapshot.window_front_defrost;
      const rear = !!snapshot.window_rear_defrost;
      if (front !== prevFront && !first) {
        if (front) startClearing(ctx); else stopClearing();
      }
      if (rear !== prevRear && !first) {
        ctx.audio.tone({ freq: 1200, freqEnd: 800, ms: 50, type: 'triangle', volume: 0.08 });
      }
      if (chipFront) chipFront.style.display = front ? 'inline-flex' : 'none';
      if (chipRear) chipRear.style.display = rear ? 'inline-flex' : 'none';
      if (chip) {
        chip.style.opacity = front || rear ? '1' : '0';
        chip.setAttribute('aria-label', `Desempañador: ${front ? 'delantero ' : ''}${rear ? 'trasero' : ''}`.trim());
      }
      if (rearLines) rearLines.style.opacity = rear ? '0.85' : '0';
      prevFront = front;
      prevRear = rear;
      first = false;
    },
  });
})();
