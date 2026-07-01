export function drawLightning(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const s = size / 24;
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Centre the bolt glyph (drawn in a ~16x24 box around 6,12) on the origin.
  ctx.translate(-6, -12);
  ctx.moveTo(4, 0);
  ctx.lineTo(-2, 13);
  ctx.lineTo(6, 13);
  ctx.lineTo(2, 24);
  ctx.lineTo(14, 9);
  ctx.lineTo(7, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// The game's road-worm SVG (the upcoming road geometry). The component keeps
// the polyline points and the container's opacity up to date every tick; the
// opacity already encodes the "Show upcoming road worm" setting (Always /
// Manual-drive-only / Never) and the autodrive state, so the cluster mirrors
// that visibility for free.
// Vehicle marker position inside the worm viewBox (group transform places the
// car at the bottom-centre: translate(80 96)).
const WORM_CAR_X = 80;
const WORM_CAR_Y = 96;

function findWormSvg() {
  if (typeof document === 'undefined') return null;
  const container = document.getElementById('upcoming-container');
  if (!container) return null;
  // Visibility is config-driven (opacity 1 = shown, 0 = hidden by the setting).
  const opacity = parseFloat(container.style.opacity);
  if (!Number.isNaN(opacity) && opacity < 0.01) return null;
  const svg = container.querySelector('svg');
  if (!svg) return null;
  const polylines = svg.querySelectorAll('polyline');
  if (polylines.length < 2) return null;
  // First polyline = dark casing (wide), second = bright road line.
  return { casing: polylines[0], line: polylines[1] };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Ego-vehicle silhouette as seen from a chase camera (3/4 view from above and
// behind): white roof tapering toward the front, dark rear window, tail-light
// bar, dark rear bumper and black tyres. Nose points up (the travel direction).
function drawEgoVehicle(ctx, cx, cy, w, h, colors) {
  ctx.save();
  ctx.translate(cx, cy);
  const halfFront = w * 0.40; // narrower far end (front)
  const halfRear = w * 0.50; // wider near end (rear, closest to camera)
  const top = -h / 2;
  const bot = h / 2;

  // Body silhouette: rounded, wider at the rear, with a soft drop shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = w * 0.4;
  ctx.shadowOffsetY = h * 0.05;
  ctx.beginPath();
  ctx.moveTo(-halfFront, top + h * 0.14);
  ctx.quadraticCurveTo(0, top, halfFront, top + h * 0.14); // rounded front (roof)
  ctx.bezierCurveTo(halfRear, top + h * 0.42, halfRear, bot - h * 0.22, halfRear * 0.94, bot - h * 0.03);
  ctx.quadraticCurveTo(0, bot, -halfRear * 0.94, bot - h * 0.03); // rounded rear
  ctx.bezierCurveTo(-halfRear, bot - h * 0.22, -halfRear, top + h * 0.42, -halfFront, top + h * 0.14);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, top, 0, bot);
  body.addColorStop(0, colors.vehBodyLight);
  body.addColorStop(0.55, colors.vehBody);
  body.addColorStop(1, colors.vehBodyDark);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();

  // Clip subsequent detail to the body so nothing spills past the silhouette.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-halfFront, top + h * 0.14);
  ctx.quadraticCurveTo(0, top, halfFront, top + h * 0.14);
  ctx.bezierCurveTo(halfRear, top + h * 0.42, halfRear, bot - h * 0.22, halfRear * 0.94, bot - h * 0.03);
  ctx.quadraticCurveTo(0, bot, -halfRear * 0.94, bot - h * 0.03);
  ctx.bezierCurveTo(-halfRear, bot - h * 0.22, -halfRear, top + h * 0.42, -halfFront, top + h * 0.14);
  ctx.closePath();
  ctx.clip();

  // Rear window (dark glass), trapezoid widening toward the rear.
  ctx.beginPath();
  ctx.moveTo(-w * 0.26, top + h * 0.2);
  ctx.lineTo(w * 0.26, top + h * 0.2);
  ctx.lineTo(w * 0.32, top + h * 0.46);
  ctx.lineTo(-w * 0.32, top + h * 0.46);
  ctx.closePath();
  ctx.fillStyle = colors.vehGlass;
  ctx.fill();

  // Tail-light bar across the rear.
  ctx.fillStyle = colors.vehTail;
  roundRectPath(ctx, -w * 0.4, top + h * 0.58, w * 0.34, h * 0.07, h * 0.03);
  ctx.fill();
  roundRectPath(ctx, w * 0.06, top + h * 0.58, w * 0.34, h * 0.07, h * 0.03);
  ctx.fill();

  // Rear bumper (darker band at the very back).
  ctx.fillStyle = colors.vehBumper;
  ctx.fillRect(-w * 0.55, bot - h * 0.16, w * 1.1, h * 0.16);
  ctx.restore();

  // Tyres poking out at the rear corners.
  ctx.fillStyle = colors.vehWheel;
  roundRectPath(ctx, -halfRear - w * 0.02, bot - h * 0.3, w * 0.12, h * 0.2, w * 0.04);
  ctx.fill();
  roundRectPath(ctx, halfRear - w * 0.1, bot - h * 0.3, w * 0.12, h * 0.2, w * 0.04);
  ctx.fill();

  ctx.restore();
}

// Matches a JS number, including scientific notation with a signed exponent
// (e.g. "-6.019904491344139e-14"). The exponent sign matters: on a straight
// road the ego's world-X is ~0, so the game emits a "translate(...e-14 ...)"
// offset — a bare [\d.eE+] class would drop the exponent's minus and fail to
// match, leaving tx/ty at 0 and pushing the whole worm out of the clip box.
const NUM = String.raw`-?\d*\.?\d+(?:[eE][-+]?\d+)?`;

// Parses the worm polyline's `transform` attribute: "rotate(deg) translate(tx ty)".
function parseWormTransform(str) {
  let rot = 0;
  let tx = 0;
  let ty = 0;
  if (str) {
    const r = new RegExp(String.raw`rotate\(\s*(` + NUM + `)`).exec(str);
    if (r) rot = parseFloat(r[1]);
    const t = new RegExp(
      String.raw`translate\(\s*(` + NUM + String.raw`)[\s,]+(` + NUM + `)`,
    ).exec(str);
    if (t) {
      tx = parseFloat(t[1]);
      ty = parseFloat(t[2]);
    }
  }
  return { rot, tx, ty };
}

// Renders the live road worm into `zone` (a recessed display box). The ego
// vehicle is pinned to a fixed anchor near the bottom of the box and the road
// ahead shifts/rotates around it (so the current position never drifts — no
// dizziness). The zoom adapts (smoothed) so the whole road ahead stays visible.
// Returns true when a worm was drawn.
export function drawRoadWorm(ctx, zone, colors, state) {
  const worm = findWormSvg();
  if (!worm) return false;

  const pts = worm.line.points;
  const n = pts ? pts.numberOfItems : 0;
  if (n < 2) return false;

  // Map raw points into viewBox space ourselves. We can't trust getCTM here:
  // the HUD container is 0x0 in layout, so the browser intermittently returns an
  // identity matrix (which would leave points in raw world coords and shift the
  // road off the ego). Instead we replay the SVG transforms directly:
  //   polyline:  rotate(rot) translate(tx ty)   (keeps the ego at the origin,
  //              heading up)
  //   group:     translate(80 96) scale(-0.5 -0.5)
  // so the ego (point 0) always lands exactly at viewBox (80, 96).
  const { rot, tx, ty } = parseWormTransform(worm.line.getAttribute('transform'));
  const a = (rot * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);

  const xs = new Array(n);
  const ys = new Array(n);
  let maxAbsDx = 1; // widest sideways reach of the road from the ego point
  let upExtent = 1; // how far ahead (above the ego) the road reaches
  for (let i = 0; i < n; i++) {
    const p = pts.getItem(i);
    const X = p.x + tx;
    const Y = p.y + ty;
    const rx = ca * X - sa * Y;
    const ry = sa * X + ca * Y;
    const vx = WORM_CAR_X - 0.5 * rx;
    const vy = WORM_CAR_Y - 0.5 * ry;
    xs[i] = vx;
    ys[i] = vy;
    const dx = Math.abs(vx - WORM_CAR_X);
    if (dx > maxAbsDx) maxAbsDx = dx;
    const up = WORM_CAR_Y - vy;
    if (up > upExtent) upExtent = up;
  }

  // Recessed display box.
  const bx = zone.cx - zone.maxW / 2;
  const by = zone.top;
  const bw = zone.maxW;
  const bh = zone.maxH;
  const radius = Math.min(bw, bh) * 0.1;

  // Fixed ego anchor near the bottom; road grows upward from it.
  const carScreenX = zone.cx;
  const carScreenY = by + bh * 0.82;
  const topPad = 8;
  const sidePad = 10;

  // Scale so the road ahead fits above the ego and within the box sideways.
  // Only the zoom adapts (the ego stays put), so the road shifts/rotates around
  // a fixed current position rather than the whole worm re-centring.
  let scale = Math.min(
    (carScreenY - by - topPad) / upExtent,
    (bw / 2 - sidePad) / maxAbsDx,
  );
  scale = Math.max(0.15, Math.min(scale, 3));
  if (state) {
    const k = 0.16;
    state.s = state.s == null ? scale : state.s + (scale - state.s) * k;
    scale = state.s;
  }

  const sx = (vx) => carScreenX + (vx - WORM_CAR_X) * scale;
  const sy = (vy) => carScreenY + (vy - WORM_CAR_Y) * scale;

  ctx.save();
  // Dark recessed backing (like the clock pill), then clip the road to it.
  roundRectPath(ctx, bx, by, bw, bh, radius);
  ctx.fillStyle = colors.backdrop;
  ctx.fill();
  roundRectPath(ctx, bx, by, bw, bh, radius);
  ctx.clip();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(sx(xs[0]), sy(ys[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(sx(xs[i]), sy(ys[i]));

  // Dark casing under the bright road line (matches the HUD worm's two strokes).
  ctx.strokeStyle = colors.casing;
  ctx.lineWidth = Math.min(16, Math.max(3, 22 * scale));
  ctx.stroke();
  ctx.strokeStyle = colors.road;
  ctx.lineWidth = Math.min(9, Math.max(2, 11 * scale));
  ctx.stroke();

  // Ego vehicle silhouette at the fixed anchor.
  drawEgoVehicle(ctx, carScreenX, carScreenY, bw * 0.085, bw * 0.14, colors);

  ctx.restore();
  return true;
}

export function drawAutodriveIcon(ctx, x, y, size, active) {
  ctx.save();
  ctx.globalAlpha = active ? 1 : 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  const s = size / 24;
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Centre the icon content (waves + car span roughly x:5..19, y:-12..18)
  // on the origin so it aligns with the AUTODRIVE label below it.
  ctx.translate(-12, -3);

  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(12, 4 - i * 3, 4 + i * 3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(5, 18);
  ctx.lineTo(5, 14);
  ctx.quadraticCurveTo(5, 10, 12, 10);
  ctx.quadraticCurveTo(19, 10, 19, 14);
  ctx.lineTo(19, 18);
  ctx.lineTo(16, 18);
  ctx.lineTo(16, 15);
  ctx.lineTo(8, 15);
  ctx.lineTo(8, 18);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
