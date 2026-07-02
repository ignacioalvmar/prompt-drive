/* Instrument cluster — built from src/cluster/ */
(function () {
const COLORS = {
  background: '#34373c',
  backgroundEdge: '#26282c',
  trapezoid: '#2a2c30',
  bodyFill: '#1c1d1f',
  text: '#f4f6f8',
  muted: 'rgba(188, 193, 200, 0.85)',
  speedArc: '#40E0D0',
  throttleArc: '#3ddc84',
  arcTrack: 'rgba(255, 255, 255, 0.14)',
  // Live road-worm: a dark recessed backing (like the clock pill) with a bright
  // road line over a darker casing, mirroring the game HUD worm.
  wormBackdrop: 'rgba(0, 0, 0, 0.32)',
  wormCasing: 'rgba(8, 9, 11, 0.9)',
  wormRoad: 'rgba(236, 239, 244, 0.95)',
  // Ego-vehicle silhouette (chase-cam 3/4 rear view, shaded to read as 3D).
  vehBodyLight: '#f4f6f8',
  vehBody: '#dfe3e8',
  vehBodyDark: '#bcc2ca',
  vehGlass: '#2c3037',
  vehBumper: '#3a3e45',
  vehTail: '#5c2a2f',
  vehWheel: '#161719',
  vehEdge: 'rgba(0, 0, 0, 0.4)',
};

// Dedicated screen canvas (cluster UI only — not the full vehicle atlas).
// Aspect ratio MUST match the 3D plane below (0.42 / 0.13 = 3.2308) so the
// texture is not stretched when mapped onto the dashboard.
const SCREEN_CANVAS = {
  width: 1292,
  height: 400,
};

// 3D plane size in body-local space.
const OVERLAY = {
  width: 0.30,
  height: 0.093,
};

// How much the top edge arches up in the centre (fraction of canvas height).
// Used by both the canvas panel outline and the 3D pod outline.
const TOP_ARCH = 0.21;

const deg = (d) => (d * Math.PI) / 180;

function zonesForCanvas(width, height) {
  const sr = { x: 0, y: 0, w: width, h: height };
  const gaugeCy = height * 0.46;
  const arcRadius = height * 0.32;
  const arcWidth = Math.max(4, Math.round(height * 0.032));
  // Top edge of the odometer text — sits below the road worm, whose bottom
  // reaches the gauge-arc centre line (gaugeCy). Centred, lower in the panel.
  const gaugeTopY = height * 0.50;
  return {
    screen: sr,
    arcWidth,
    gaugeTopY,
    // Left gauge: a big arc from 7 o'clock, up the left side and over the top
    // to 3 o'clock. The cyan fill is anchored at 9 o'clock and grows UPWARD
    // (over the top) toward 3 o'clock as speed increases.
    speed: {
      cx: sr.w * 0.225,
      cy: gaugeCy,
      radius: arcRadius,
      trackStart: deg(120), // 7 o'clock
      trackEnd: deg(360), // 3 o'clock
      fillAnchor: deg(120), // 7 o'clock — start of the arc
      fillTarget: deg(360), // 3 o'clock (final)
    },
    // Right gauge: a big arc from 9 o'clock, over the top and down the right
    // side to 4 o'clock. The green fill grows from 9 o'clock clockwise toward
    // 4 o'clock as throttle increases.
    throttle: {
      cx: sr.w * 0.775,
      cy: gaugeCy,
      radius: arcRadius,
      trackStart: deg(180), // 9 o'clock
      trackEnd: deg(390), // 4 o'clock
      fillAnchor: deg(180), // 9 o'clock (initial)
      fillTarget: deg(390), // 4 o'clock (final)
    },
    center: {
      x: sr.w * 0.5,
    },
    // Road-worm display area: top-centre, in the clear column between the two
    // gauges and above the odometer. The live worm (160x120 viewBox) is
    // contain-fitted inside this box and clipped to it, so the geometry is
    // always fully visible without overlapping the gauges or leaving the panel.
    // Left gauge reaches x≈cx-r+r = 0.225w+0.32h and the right gauge starts at
    // 0.775w-0.32h; maxW stays inside that gap with margin.
    worm: {
      cx: sr.w * 0.5,
      top: height * 0.03,
      // Recessed display box (portrait-ish) that frames the upward road. Width
      // stays well inside the gap between the gauges; height stops above the
      // odometer.
      maxW: height * 0.62,
      maxH: height * 0.45,
    },
    rows: {
      autodriveIcon: height * 0.70,
      status: height * 0.84, // AUTODRIVE + AWD, below the gauges
      clock: height * 0.95, // lowest point, centred
    },
    fonts: {
      speedValue: `600 ${Math.round(height * 0.24)}px ShareTech, Arial, sans-serif`,
      speedUnit: `400 ${Math.round(height * 0.088)}px ShareTech, Arial, sans-serif`,
      odometer: `400 ${Math.round(height * 0.125)}px ShareTech, Arial, sans-serif`,
      odometerUnit: `400 ${Math.round(height * 0.075)}px ShareTech, Arial, sans-serif`,
      modeLabel: `400 ${Math.round(height * 0.070)}px ShareTech, Arial, sans-serif`,
      driveMode: `400 ${Math.round(height * 0.072)}px ShareTech, Arial, sans-serif`,
      clock: `400 ${Math.round(height * 0.098)}px ShareTech, Arial, sans-serif`,
    },
    icons: {
      lightning: Math.round(height * 0.18),
      autodrive: Math.round(height * 0.13),
    },
  };
}

function drawLightning(ctx, x, y, size, alpha = 1) {
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
function drawRoadWorm(ctx, zone, colors, state) {
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

function drawAutodriveIcon(ctx, x, y, size, active) {
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



const DASHBOARD_MESH = 'z_dashboard_Cube.009';
const INTERIOR_MESH = 'z_interior_Cube.008';
// Dashboard (2) and steering wheel (3) use higher renderOrder in the game bundle.
// Match dashboard order; the overlay is added after the dash mesh so it draws on top of it.
const CLUSTER_RENDER_ORDER = 2;

// Draws a gauge: a full track arc, plus a coloured fill that grows from
// `fillAnchor` toward `fillTarget` as value goes 0→1.
function drawGauge(ctx, z, color, lineWidth, value) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(z.cx, z.cy, z.radius, z.trackStart, z.trackEnd);
  ctx.strokeStyle = COLORS.arcTrack;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  const v = Math.max(0, Math.min(1, value));
  if (v > 0.001) {
    const to = z.fillAnchor + (z.fillTarget - z.fillAnchor) * v;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, Math.min(z.fillAnchor, to), Math.max(z.fillAnchor, to));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

// Builds the rounded panel path with an arched top (higher in the centre).
function panelPath(ctx, width, height) {
  const arch = height * TOP_ARCH;
  const r = height * 0.13;
  ctx.beginPath();
  ctx.moveTo(0, arch);
  ctx.quadraticCurveTo(width / 2, -arch, width, arch); // arched top
  ctx.lineTo(width, height - r);
  ctx.arcTo(width, height, width - r, height, r);
  ctx.lineTo(r, height);
  ctx.arcTo(0, height, 0, height - r, r);
  ctx.closePath();
}

function drawClockPill(ctx, x, y, text, font, height) {
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const padX = height * 0.022;
  const pillH = Math.round(height * 0.052);
  const pillW = metrics.width + padX * 2;
  const pillX = x - pillW / 2;
  const pillY = y - pillH + height * 0.008;
  const r = pillH / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.lineTo(pillX + pillW - r, pillY);
  ctx.arc(pillX + pillW - r, pillY + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(pillX + r, pillY + pillH);
  ctx.arc(pillX + r, pillY + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function findMeshBasicMaterial(THREE) {
  if (THREE.MeshBasicMaterial) return THREE.MeshBasicMaterial;
  if (THREE.C) return THREE.C;
  return null;
}

function findPlaneGeometry(THREE) {
  if (THREE.PlaneGeometry) return THREE.PlaneGeometry;
  if (THREE.J) return THREE.J;
  return null;
}

function findBufferGeometry(THREE) {
  if (THREE.BufferGeometry) return THREE.BufferGeometry;
  for (const k of Object.keys(THREE)) {
    const v = THREE[k];
    const p = v && v.prototype;
    if (p && typeof p.setAttribute === 'function' && typeof p.setIndex === 'function') return v;
  }
  return null;
}

function findBufferAttribute(THREE) {
  if (THREE.BufferAttribute) return THREE.BufferAttribute;
  for (const k of Object.keys(THREE)) {
    const v = THREE[k];
    const p = v && v.prototype;
    if (p && typeof p.setXYZ === 'function') return v;
  }
  return null;
}

// Extrudes a 2D outline (array of [x,y]) into a prism: front face fan, back
// face fan and side walls. Double-sided material, so winding is unimportant.
function buildPrismFromOutline(THREE, outline, depth) {
  const BufGeo = findBufferGeometry(THREE);
  const BufAttr = findBufferAttribute(THREE);
  if (!BufGeo || !BufAttr) return null;
  const N = outline.length;
  const pos = [0, 0, 0, 0, 0, -depth];
  for (const p of outline) pos.push(p[0], p[1], 0);
  for (const p of outline) pos.push(p[0], p[1], -depth);
  const FR = 2;
  const BR = 2 + N;
  const idx = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(0, FR + i, FR + j); // front fan
    idx.push(1, BR + j, BR + i); // back fan
    idx.push(FR + i, FR + j, BR + j); // wall
    idx.push(FR + i, BR + j, BR + i);
  }
  const g = new BufGeo();
  g.setAttribute('position', new BufAttr(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The recessed cluster pod: a 3D prism whose front face is a rounded rectangle
// with an arched top (higher in the centre), matching the screen panel shape.
function makeArchedPrism(THREE, w, h, depth, radius, arch, seg = 6) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(radius, hw, hh * 0.5);
  const topSideY = hh - arch;
  const outline = [];
  // Arched top: quadratic Bézier from (-hw, topSideY) → peak (0, hh) → (hw, topSideY).
  const aseg = seg * 2;
  for (let i = 0; i <= aseg; i++) {
    const t = i / aseg;
    const mt = 1 - t;
    const x = mt * mt * -hw + t * t * hw;
    const y = mt * mt * topSideY + 2 * mt * t * (hh + arch) + t * t * topSideY;
    outline.push([x, y]);
  }
  // Right edge down to the bottom-right corner.
  outline.push([hw, -hh + rr]);
  for (let i = 1; i <= seg; i++) {
    const a = -(i / seg) * (Math.PI / 2);
    outline.push([hw - rr + Math.cos(a) * rr, -hh + rr + Math.sin(a) * rr]);
  }
  // Bottom-left corner (the bottom edge is the segment between the corners).
  for (let i = 1; i <= seg; i++) {
    const a = -Math.PI / 2 - (i / seg) * (Math.PI / 2);
    outline.push([-hw + rr + Math.cos(a) * rr, -hh + rr + Math.sin(a) * rr]);
  }
  // The closing segment back to the first point forms the left edge.
  return buildPrismFromOutline(THREE, outline, depth);
}

function findMeshCtor(root, THREE) {
  let ctor = null;
  root?.traverse?.((child) => {
    if (!ctor && child?.isMesh) {
      ctor = child.constructor;
    }
  });
  return ctor || THREE.u || THREE.Mesh;
}

function createCanvasTexture(THREE, canvas) {
  if (THREE.CanvasTexture) {
    return new THREE.CanvasTexture(canvas);
  }

  for (const key of Object.keys(THREE)) {
    const val = THREE[key];
    if (typeof val === 'function' && val.prototype?.isTexture) {
      const tex = new val(canvas);
      tex.image = canvas;
      return tex;
    }
  }

  const LoaderCtor = THREE.U || THREE.TextureLoader;
  if (LoaderCtor) {
    const tempTex = new LoaderCtor().load(BLANK_PIXEL);
    const TextureCtor = tempTex.constructor;
    const texture = new TextureCtor(canvas);
    texture.image = canvas;
    tempTex.dispose();
    return texture;
  }

  throw new Error('InstrumentCluster: THREE.Texture constructor not found');
}

function configureTexture(texture, THREE) {
  texture.generateMipmaps = false;
  const linear = THREE.LinearFilter;
  if (linear !== undefined) {
    texture.minFilter = linear;
    texture.magFilter = linear;
  }
}

function findDashboardAnchor(root) {
  let mesh = null;
  let parent = null;
  root?.traverse?.((child) => {
    if (child?.isMesh && child.name === DASHBOARD_MESH) {
      mesh = child;
      parent = child.parent;
    }
  });
  return mesh && parent ? { mesh, parent } : null;
}

function findInteriorMesh(root) {
  let interior = null;
  root?.traverse?.((child) => {
    if (child?.isMesh && child.name === INTERIOR_MESH) interior = child;
  });
  return interior;
}

function dashboardRecessPlacement(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return {
    width: OVERLAY.width,
    height: OVERLAY.height,
    x: bb.min.x + 0.012,
    // Sit slightly above the wheel hub (the wheel centre is ~0 in this frame),
    // centred in the inner ring so the rim frames the cluster.
    y: bb.min.y + (bb.max.y - bb.min.y) * 0.53,
    z: (bb.min.z + bb.max.z) * 0.5,
    rotY: -Math.PI / 2,
  };
}

function interiorRecessPlacement(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return {
    width: OVERLAY.width,
    height: OVERLAY.height,
    x: bb.max.x - 0.02,
    y: bb.min.y + (bb.max.y - bb.min.y) * 0.55,
    z: (bb.min.z + bb.max.z) * 0.5,
    rotY: -Math.PI / 2,
  };
}

class InstrumentCluster {
  constructor(THREE) {
    this.THREE = THREE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_CANVAS.width;
    this.canvas.height = SCREEN_CANVAS.height;
    this.ctx = this.canvas.getContext('2d');
    const MaterialCtor = findMeshBasicMaterial(THREE);
    if (!MaterialCtor) {
      throw new Error('InstrumentCluster: MeshBasicMaterial constructor not found');
    }
    this.texture = createCanvasTexture(THREE, this.canvas);
    configureTexture(this.texture, THREE);
    this.material = new MaterialCtor({
      map: this.texture,
      transparent: true, // rounded corners — outside the panel is transparent
      side: THREE.DoubleSide ?? 2,
      depthTest: true, // so the steering wheel occludes the cluster
      depthWrite: false,
      toneMapped: false,
    });
    // Dark backing that forms the recessed pod behind the screen.
    this.podMaterial = new MaterialCtor({
      color: 0x111316,
      side: THREE.DoubleSide ?? 2,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    this.podMesh = null;
    this.overlayMesh = null;
    this._overlayParent = null;
    this._interiorMesh = null;
    this._dashboardMesh = null;
    this._placementMode = null;
    InstrumentCluster.lastInstance = this;
    this._fontsReady = false;
    document.querySelector?.('.instrument-cluster-hud')?.remove();
    this._ensureFonts();
    this._ensureWormStyle();
    this.draw({
      speedKph: 0,
      speedLerp: 0,
      odometerKm: 0,
      throttle: 0,
      autodrive: false,
      driveMode: 'AWD',
      speedUnit: 'KPH',
      distUnit: 'KM',
      clock: new Date(),
    });
  }

  _ensureFonts() {
    if (this._fontsReady || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: 'ShareTech';
        src: url('./static/media/ShareTech.8b302ac6.ttf') format('truetype');
      }
    `;
    document.head.appendChild(style);
    this._fontsReady = true;
  }

  // The road worm now lives in the cluster, so the on-screen HUD worm is hidden
  // while the cluster is active (first-person). `visibility: hidden` keeps the
  // SVG laid out so its geometry (getCTM/points) stays readable for the cluster.
  _ensureWormStyle() {
    if (this._wormStyleReady || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = `
      body.cluster-active #upcoming-container { visibility: hidden !important; }
    `;
    document.head.appendChild(style);
    this._wormStyleReady = true;
  }

  syncPlacement(_steeringPos, _sideSign = 1) {
    if (!this.overlayMesh || this._placementMode !== 'interior' || !this._interiorMesh?.geometry) {
      return;
    }
    const place = interiorRecessPlacement(this._interiorMesh.geometry);
    this.overlayMesh.position.set(place.x, place.y, place.z);
    this.overlayMesh.rotation.set(0, place.rotY, 0);
    const PlaneGeo = findPlaneGeometry(this.THREE);
    if (PlaneGeo) {
      this.overlayMesh.geometry.dispose();
      this.overlayMesh.geometry = new PlaneGeo(place.width, place.height);
    }
  }

  _resolveAnchor(root) {
    const dashboard = findDashboardAnchor(root);
    if (dashboard) {
      return {
        mode: 'dashboard',
        parent: dashboard.parent,
        geometry: dashboard.mesh.geometry,
        placement: dashboardRecessPlacement,
        // The original gray binnacle pod — hidden so the cluster screen reads
        // as a clean dark display instead of protruding from the recess.
        hideMesh: dashboard.mesh,
      };
    }

    const interior = findInteriorMesh(root);
    if (interior?.parent) {
      return {
        mode: 'interior',
        parent: interior.parent,
        geometry: interior.geometry,
        placement: interiorRecessPlacement,
      };
    }

    return null;
  }

  _ensureOverlay(root) {
    const anchor = this._resolveAnchor(root);
    if (!anchor) return false;

    this._hideMesh = anchor.hideMesh || null;

    if (
      this.overlayMesh &&
      this._overlayParent === anchor.parent &&
      this._placementMode === anchor.mode &&
      this.overlayMesh.parent === anchor.parent
    ) {
      this._dashboardMesh = anchor.mode === 'dashboard' ? anchor.geometry : null;
      this._interiorMesh = anchor.mode === 'interior' ? { geometry: anchor.geometry } : null;
      return true;
    }

    this._removeOverlay();

    const THREE = this.THREE;
    const PlaneGeo = findPlaneGeometry(THREE);
    const MeshCtor = findMeshCtor(root, THREE);
    if (!PlaneGeo || !MeshCtor) return false;

    const place = anchor.placement(anchor.geometry);

    // Recessed pod: a 3D prism with depth, rounded edges and an arched top,
    // matching the screen panel — a physical housing, not a floating texture.
    const podBezel = 0.018;
    const podW = place.width + podBezel * 2;
    const podH = place.height + podBezel * 2;
    const podArch = podH * TOP_ARCH;
    const podGeo =
      makeArchedPrism(THREE, podW, podH, 0.05, podH * 0.34, podArch, 6) ||
      new PlaneGeo(podW, podH);
    const pod = new MeshCtor(podGeo, this.podMaterial);
    pod.name = 'instrument_cluster_pod';
    // Front face sits just behind the screen (slightly away from the driver).
    pod.position.set(place.x + 0.002, place.y, place.z);
    pod.rotation.set(0, place.rotY, 0);
    pod.frustumCulled = false;
    pod.renderOrder = CLUSTER_RENDER_ORDER - 1;
    anchor.parent.add(pod);
    this.podMesh = pod;

    const plane = new MeshCtor(new PlaneGeo(place.width, place.height), this.material);
    plane.name = 'instrument_cluster_overlay';
    plane.position.set(place.x, place.y, place.z);
    plane.rotation.set(0, place.rotY, 0);
    plane.frustumCulled = false;
    plane.renderOrder = CLUSTER_RENDER_ORDER;
    anchor.parent.add(plane);

    this.overlayMesh = plane;
    this._overlayParent = anchor.parent;
    this._placementMode = anchor.mode;
    this._dashboardMesh = anchor.mode === 'dashboard' ? anchor.geometry : null;
    this._interiorMesh = anchor.mode === 'interior' ? { geometry: anchor.geometry } : null;
    return true;
  }

  _removeOverlay() {
    if (this.podMesh) {
      this.podMesh.parent?.remove(this.podMesh);
      this.podMesh.geometry?.dispose();
      this.podMesh = null;
    }
    if (!this.overlayMesh) return;
    this.overlayMesh.parent?.remove(this.overlayMesh);
    this.overlayMesh.geometry?.dispose();
    this.overlayMesh = null;
    this._overlayParent = null;
    this._interiorMesh = null;
    this._dashboardMesh = null;
    this._placementMode = null;
  }

  draw({
    speedKph = 0,
    speedLerp = 0,
    odometerKm = 0,
    throttle = 0,
    autodrive = false,
    driveMode = 'AWD',
    speedUnit = 'KPH',
    distUnit = 'KM',
    clock = new Date(),
  }) {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const zones = zonesForCanvas(width, height);
    const sr = zones.screen;

    // Dark panel with a rounded body and an arched top (higher in the centre).
    // Drawn on a transparent canvas so edges reveal the dark pod / dash behind.
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, COLORS.background);
    bg.addColorStop(1, COLORS.backgroundEdge);
    panelPath(ctx, width, height);
    ctx.fillStyle = bg;
    ctx.fill();

    const arcLine = zones.arcWidth;
    const speedZone = zones.speed;
    const throttleZone = zones.throttle;
    drawGauge(ctx, speedZone, COLORS.speedArc, arcLine, speedLerp);
    drawGauge(ctx, throttleZone, COLORS.throttleArc, arcLine, throttle);

    const cx = zones.center.x;
    const rows = zones.rows;

    // --- Left gauge: speed value centred inside the ring + unit below it ---
    const speedText = String(Math.round(speedKph));
    ctx.fillStyle = COLORS.text;
    ctx.font = zones.fonts.speedValue;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(speedText, speedZone.cx, speedZone.cy - height * 0.02);
    ctx.font = zones.fonts.speedUnit;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(speedUnit.toUpperCase(), speedZone.cx, speedZone.cy + height * 0.12);

    // --- Right gauge: power icon centred inside the ring ---
    drawLightning(ctx, throttleZone.cx, throttleZone.cy, zones.icons.lightning);

    // --- Road worm (live upcoming road geometry), top centre. Mirrors the
    // game HUD worm and its show/hide setting; draws nothing when the setting
    // hides it (so "Never" / autodrive truly show nothing here). ---
    this._wormView ||= {};
    drawRoadWorm(ctx, zones.worm, {
      backdrop: COLORS.wormBackdrop,
      casing: COLORS.wormCasing,
      road: COLORS.wormRoad,
      vehBodyLight: COLORS.vehBodyLight,
      vehBody: COLORS.vehBody,
      vehBodyDark: COLORS.vehBodyDark,
      vehGlass: COLORS.vehGlass,
      vehBumper: COLORS.vehBumper,
      vehTail: COLORS.vehTail,
      vehWheel: COLORS.vehWheel,
      vehEdge: COLORS.vehEdge,
    }, this._wormView);

    // --- Odometer: top edge aligned with the gauges' upper endpoints ---
    const odoText = String(Math.max(0, Math.floor(odometerKm))).padStart(5, '0');
    ctx.fillStyle = COLORS.text;
    ctx.font = zones.fonts.odometer;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(odoText, cx, zones.gaugeTopY);
    ctx.font = zones.fonts.odometerUnit;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(distUnit.toUpperCase(), cx, zones.gaugeTopY + height * 0.15);

    // --- Bottom status: autodrive icon + "AUTODRIVE" grouped on the right,
    // immediately to the left of the drive-mode (AWD) label, the whole group
    // centred under the right gauge. ---
    const statusY = rows.status;
    const adLabel = 'AUTODRIVE';
    const iconSize = zones.icons.autodrive;
    const gapIconLabel = iconSize * 0.45;
    const gapLabels = height * 0.05;
    ctx.textBaseline = 'middle';
    ctx.font = zones.fonts.modeLabel;
    const adW = ctx.measureText(adLabel).width;
    ctx.font = zones.fonts.driveMode;
    const dmW = ctx.measureText(driveMode).width;
    const totalW = iconSize + gapIconLabel + adW + gapLabels + dmW;
    let gx = throttleZone.cx - totalW / 2;
    drawAutodriveIcon(ctx, gx + iconSize / 2, statusY, iconSize, autodrive);
    gx += iconSize + gapIconLabel;
    ctx.textAlign = 'left';
    ctx.font = zones.fonts.modeLabel;
    ctx.fillStyle = autodrive ? COLORS.text : COLORS.muted;
    ctx.fillText(adLabel, gx, statusY);
    gx += adW + gapLabels;
    ctx.font = zones.fonts.driveMode;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(driveMode, gx, statusY);

    // --- Clock: lowest point, centred ---
    const timeStr = clock.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    drawClockPill(ctx, cx, rows.clock, timeStr, zones.fonts.clock, height);

    this.texture.needsUpdate = true;
  }

  applyToObject(root, active = true) {
    // Hide the on-screen HUD worm only while the cluster is actually shown
    // (first-person); restore it otherwise so the third-person view is unchanged.
    if (typeof document !== 'undefined') {
      document.body?.classList?.toggle('cluster-active', !!active);
    }
    if (!root) return null;

    const anchor = this._resolveAnchor(root);
    if (!anchor) {
      if (!active) {
        if (this.overlayMesh) this.overlayMesh.visible = false;
        return this.overlayMesh;
      }
      return null;
    }

    if (active) {
      if (!this._ensureOverlay(root)) return null;
      if (this.overlayMesh) this.overlayMesh.visible = true;
      if (this.podMesh) this.podMesh.visible = true;
      // Hide the gray binnacle pod while the cluster screen is shown.
      if (anchor.hideMesh) anchor.hideMesh.visible = false;
    } else {
      if (this.overlayMesh) this.overlayMesh.visible = false;
      if (this.podMesh) this.podMesh.visible = false;
      // Restore the original binnacle when the cluster screen is not shown.
      if (anchor.hideMesh) anchor.hideMesh.visible = true;
    }
    return this.overlayMesh;
  }

  dispose() {
    this._removeOverlay();
    this.texture.dispose();
    this.material.dispose();
  }
}

  if (typeof window !== 'undefined') {
    window.InstrumentCluster = InstrumentCluster;
  }
})();
