/**
 * Feature: fog lights (exploradoras / luces antiniebla).
 *
 * Field: fog_lights
 *
 * What the driver perceives: a green front-fog tell-tale (ISO 2575 style:
 * lamp with slanted beams crossed by a wavy line) at the lower-left edge of
 * the view, next to where the cluster would show it, and a low, wide, warm
 * light band along the bottom of the road view that fades in over 400 ms -
 * the broad, flat beam typical of fog lamps. A short relay click confirms
 * the toggle. Nothing is drawn in the centre of the road view.
 *
 * Initial state: rendered on the first onChange with no sound.
 * The feature only reads VehicleState; it never writes to it.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const GREEN = '#3ddc84';
  let beam = null;
  let lamp = null;
  let first = true;

  function lampIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 40 28');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '25');
    svg.setAttribute('aria-hidden', 'true');
    const parts = [
      // Lamp body (D shape facing left).
      'M16 4 C6 4 6 24 16 24 Z',
      // Slanted beams.
      'M20 7 L34 10', 'M20 14 L34 17', 'M20 21 L34 24',
      // Wavy line crossing the beams (fog).
      'M27 4 q-3 5 0 10 q3 5 0 10',
    ];
    for (const d of parts) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', GREEN);
      p.setAttribute('stroke-width', '2.2');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p);
    }
    return svg;
  }

  CabinFeedback.register({
    id: 'fog_lights',
    title: 'Luces antiniebla',
    fields: ['fog_lights'],

    init(ctx) {
      beam = document.createElement('div');
      Object.assign(beam.style, {
        position: 'absolute', left: '8%', right: '8%', bottom: '0', height: '16%',
        background: 'radial-gradient(ellipse 60% 100% at 50% 100%, rgba(255,236,190,0.22), rgba(255,236,190,0) 70%)',
        opacity: '0', transition: 'opacity 400ms ease', mixBlendMode: 'screen',
      });
      ctx.layer.appendChild(beam);

      lamp = document.createElement('div');
      lamp.setAttribute('role', 'status');
      lamp.setAttribute('aria-live', 'polite');
      lamp.setAttribute('aria-label', 'Luces antiniebla encendidas');
      Object.assign(lamp.style, {
        position: 'absolute', bottom: '1.2vh', left: '1.5vw', padding: '3px 8px',
        borderRadius: '10px', background: 'rgba(10,12,16,0.55)', lineHeight: '0',
        opacity: '0', transform: 'scale(0.9)',
        transition: 'opacity 250ms ease, transform 250ms ease',
        filter: 'drop-shadow(0 0 3px rgba(61,220,132,0.6))',
      });
      lamp.appendChild(lampIcon());
      ctx.layer.appendChild(lamp);
    },

    onChange(changed, snapshot, ctx) {
      if (!('fog_lights' in changed) || !beam || !lamp) return;
      const on = !!changed.fog_lights;
      const wasOn = lamp.style.opacity === '1';
      beam.style.opacity = on ? '1' : '0';
      lamp.style.opacity = on ? '1' : '0';
      lamp.style.transform = on ? 'scale(1)' : 'scale(0.9)';
      if (!first && on !== wasOn) {
        // Relay click: two very short ticks.
        ctx.audio.tone({ freq: 2000, freqEnd: 1200, ms: 25, type: 'square', volume: 0.05 });
        setTimeout(() => ctx.audio.tone({ freq: 1600, freqEnd: 1000, ms: 25, type: 'square', volume: 0.04 }), 70);
      }
      first = false;
    },
  });
})();
