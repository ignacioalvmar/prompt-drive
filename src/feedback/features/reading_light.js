/**
 * Example feature: reading lights (luz de lectura).
 *
 * Fields: reading_light_driver, reading_light_passenger,
 *         reading_light_driver_rear, reading_light_passenger_rear
 *
 * What the driver perceives: a warm glow fading in from the top corner of the
 * cabin on the side of the seat whose light is on (front seats at the top
 * edge, rear seats a little lower and dimmer because they are behind the
 * driver), plus a soft click when a light toggles. Nothing in the 3D scene is
 * touched: this is a DOM layer over the canvas, which keeps it safe in
 * benchmark mode and independent of the engine's render loop.
 *
 * This file is the template to copy for a new feature: one id, the fields it
 * listens to, init() to build the DOM once, onChange() to render the state.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const SEATS = [
    { key: 'reading_light_driver',          side: 'driver',    row: 'front' },
    { key: 'reading_light_passenger',       side: 'passenger', row: 'front' },
    { key: 'reading_light_driver_rear',     side: 'driver',    row: 'rear' },
    { key: 'reading_light_passenger_rear',  side: 'passenger', row: 'rear' },
  ];

  const glows = {};

  function sideToX(side, config) {
    // Driver sits left in a left-hand-drive car (config.side === 'left').
    const driverLeft = config.side !== 'right';
    return (side === 'driver') === driverLeft ? 'left' : 'right';
  }

  CabinFeedback.register({
    id: 'reading_light',
    title: 'Luz de lectura',
    fields: SEATS.map((s) => s.key),

    init(ctx) {
      for (const seat of SEATS) {
        const el = document.createElement('div');
        const x = sideToX(seat.side, ctx.config);
        const front = seat.row === 'front';
        Object.assign(el.style, {
          position: 'absolute',
          top: front ? '-12vh' : '8vh',
          [x]: front ? '-8vw' : '-14vw',
          width: front ? '38vw' : '28vw',
          height: front ? '38vh' : '26vh',
          borderRadius: '50%',
          background: front
            ? 'radial-gradient(closest-side, rgba(255, 214, 150, 0.75), rgba(255, 214, 150, 0.0))'
            : 'radial-gradient(closest-side, rgba(255, 214, 150, 0.4), rgba(255, 214, 150, 0.0))',
          opacity: '0',
          transition: 'opacity 350ms ease',
          willChange: 'opacity',
        });
        ctx.layer.appendChild(el);
        glows[seat.key] = el;
      }
    },

    onChange(changed, snapshot, ctx) {
      for (const key of Object.keys(changed)) {
        const el = glows[key];
        if (!el) continue;
        const on = !!changed[key];
        const wasOn = el.style.opacity === '1';
        el.style.opacity = on ? '1' : '0';
        if (on !== wasOn) {
          // Mechanical click: a short, high, quickly decaying tone.
          ctx.audio.tone({ freq: on ? 1400 : 900, freqEnd: on ? 900 : 600, ms: 60, type: 'triangle', volume: 0.12 });
        }
      }
    },
  });
})();
