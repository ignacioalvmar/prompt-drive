/**
 * Ambient lighting: a quiet, persistent glow along the lower cabin edges.
 * Reads VehicleState only; CSS handles the transition without a frame loop.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const COLORS = {
    RED: '#ff4545', GREEN: '#42d77d', BLUE: '#4285ff',
    YELLOW: '#ffe066', WHITE: '#f2f5ff', PINK: '#ff89c8',
    ORANGE: '#ff9a45', PURPLE: '#ad78ff', CYAN: '#40e0d0',
  };

  let glow = null;
  let strips = [];
  let current = null;

  CabinFeedback.register({
    id: 'ambient_light',
    title: 'Luz ambiental',
    fields: ['ambient_light'],

    init(ctx) {
      current = null;
      strips = [];
      glow = document.createElement('div');
      glow.setAttribute('aria-hidden', 'true');
      Object.assign(glow.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0',
      });

      const regions = [
        { left: '0', right: '0', bottom: '0', height: '13%',
          maskImage: 'linear-gradient(to top, #000, transparent)' },
        { left: '0', bottom: '0', width: '5%', height: '44%',
          maskImage: 'linear-gradient(to right, #000, transparent), linear-gradient(to top, #000 25%, transparent)',
          maskComposite: 'intersect' },
        { right: '0', bottom: '0', width: '5%', height: '44%',
          maskImage: 'linear-gradient(to left, #000, transparent), linear-gradient(to top, #000 25%, transparent)',
          maskComposite: 'intersect' },
      ];
      for (const region of regions) {
        const strip = document.createElement('div');
        Object.assign(strip.style, { position: 'absolute' }, region);
        glow.appendChild(strip);
        strips.push(strip);
      }
      ctx.layer.appendChild(glow);
    },

    onChange(changed, snapshot) {
      if (!glow) return;
      const color = Object.prototype.hasOwnProperty.call(COLORS, snapshot.ambient_light)
        ? snapshot.ambient_light : 'OFF';
      if (color === current) return;

      // Render the initial snapshot immediately. Respect reduced motion on
      // later changes, including preferences changed while the page is open.
      const reduced = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const animate = current !== null && !reduced;
      glow.style.transition = animate ? 'opacity 400ms ease' : 'none';
      for (const strip of strips) {
        strip.style.transition = animate ? 'background-color 400ms ease' : 'none';
        // Keep the previous tint when switching OFF so it fades to darkness.
        if (color !== 'OFF') strip.style.backgroundColor = COLORS[color];
      }
      glow.style.opacity = color === 'OFF' ? '0' : '0.32';
      glow.dataset.color = color;
      current = color;
    },

    dispose() {
      if (glow) glow.remove();
      glow = null;
      strips = [];
      current = null;
    },
  });
})();
