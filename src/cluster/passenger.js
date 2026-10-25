import { COLORS } from './layout.js';

// Passenger information display for driverless vehicles (the shuttle). The
// cluster renders this layout instead of the driver gauges when the vehicle
// publishes `metrics.infoDisplay` (see vehicles-plan.md §4). It shares the
// cluster's canvas, texture and pod; only the drawing differs.
//
// Stops are simulated: the route is a fixed loop of named stops a fixed
// distance apart, advanced by integrating the displayed speed. The shuttle
// does not (yet) halt at them — the display is passenger-facing context.

export const PASSENGER_ROUTE = {
  line: 'LINE 1',
  name: 'CAMPUS LOOP',
  spacingM: 700,
  stops: ['Campus North', 'Library', 'Innovation Park', 'Main Station', 'Hospital', 'Old Town', 'Lakeside'],
};

const AMBER = '#ffb547';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function font(px, weight = 400) {
  return `${weight} ${Math.round(px)}px ShareTech, Arial, sans-serif`;
}

/** Speed in display units → m/s. */
function toMetresPerSecond(speed, unit) {
  return String(unit).toUpperCase() === 'MPH' ? speed / 2.23694 : speed / 3.6;
}

/**
 * Draws the passenger layout. `trip` is per-cluster state ({ distM, lastT })
 * that accumulates distance between calls.
 */
export function drawPassengerInfo(ctx, width, height, state, trip) {
  const { speedKph = 0, speedUnit = 'KPH', autodrive = false, clock = new Date() } = state;

  // Advance the simulated trip.
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = trip.lastT == null ? 0 : Math.min(0.5, Math.max(0, (now - trip.lastT) / 1000));
  trip.lastT = now;
  const v = Math.max(0, toMetresPerSecond(speedKph, speedUnit));
  trip.distM = (trip.distM || 0) + v * dt;

  const route = PASSENGER_ROUTE;
  const leg = Math.floor(trip.distM / route.spacingM);
  const legM = trip.distM - leg * route.spacingM;
  const remainM = route.spacingM - legM;
  const next = route.stops[(leg + 1) % route.stops.length];
  const after = route.stops[(leg + 2) % route.stops.length];
  const etaMin = Math.max(1, Math.round(remainM / Math.max(v, 4) / 60));

  const pad = height * 0.09;
  ctx.clearRect(0, 0, width, height);
  roundRect(ctx, 0, 0, width, height, height * 0.08);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, COLORS.background);
  bg.addColorStop(1, COLORS.backgroundEdge);
  ctx.fillStyle = bg;
  ctx.fill();

  // --- Left: line, next stop, progress to it ---
  const leftW = width * 0.66;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.speedArc;
  ctx.font = font(height * 0.085);
  ctx.fillText(`${route.line} · ${route.name}`, pad, pad + height * 0.07);

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(height * 0.075);
  ctx.fillText('NEXT STOP', pad, pad + height * 0.2);
  ctx.fillStyle = COLORS.text;
  ctx.font = font(height * 0.2, 600);
  ctx.fillText(next, pad, pad + height * 0.41);

  const barY = pad + height * 0.5;
  const barW = leftW - pad * 2;
  const barH = height * 0.035;
  roundRect(ctx, pad, barY, barW, barH, barH / 2);
  ctx.fillStyle = COLORS.arcTrack;
  ctx.fill();
  roundRect(ctx, pad, barY, Math.max(barH, barW * (legM / route.spacingM)), barH, barH / 2);
  ctx.fillStyle = COLORS.speedArc;
  ctx.fill();

  ctx.fillStyle = COLORS.text;
  ctx.font = font(height * 0.085);
  const remainText = remainM >= 1000 ? `${(remainM / 1000).toFixed(1)} km` : `${Math.round(remainM / 10) * 10} m`;
  ctx.fillText(`${remainText}  ·  ~${etaMin} min`, pad, barY + height * 0.16);
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(height * 0.07);
  ctx.fillText(`then ${after}`, pad, barY + height * 0.27);

  // --- Right: speed and clock ---
  const rx = leftW + (width - leftW) / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.text;
  ctx.font = font(height * 0.26, 600);
  ctx.fillText(String(Math.round(speedKph)), rx, pad + height * 0.3);
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(height * 0.08);
  ctx.fillText(String(speedUnit).toUpperCase(), rx, pad + height * 0.41);
  ctx.fillStyle = COLORS.text;
  ctx.font = font(height * 0.11);
  const timeStr = clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  ctx.fillText(timeStr, rx, pad + height * 0.6);

  // --- Bottom: driving mode ---
  const sy = height - pad * 0.9;
  const label = autodrive ? 'AUTOMATED DRIVING' : 'SAFETY OPERATOR IN CONTROL';
  const color = autodrive ? COLORS.throttleArc : AMBER;
  ctx.font = font(height * 0.075);
  ctx.textAlign = 'left';
  const dotR = height * 0.025;
  const tw = ctx.measureText(label).width;
  const sx = rx - (tw + dotR * 3) / 2;
  ctx.beginPath();
  ctx.arc(sx + dotR, sy - dotR * 1.1, dotR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillText(label, sx + dotR * 3, sy);
}
