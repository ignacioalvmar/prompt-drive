/* Center console (center stack) — built from src/console/ */
(function () {
/* --- config.js --- */
/**
 * Center-console constants: canvas geometry, theme, dock layout, storage keys
 * and the sample content (audio tracks, phone contacts, comfort zones) used by
 * the apps. Pure data — no DOM or engine access.
 */

// Dedicated screen canvas. 16:9, matching the 3D plane (SCREEN_PLANE below) so
// the texture maps 1:1 without stretching.
const CONSOLE_CANVAS = {
  width: 1280,
  height: 720,
};

// 3D plane size in dashboard-local space (metres). 16:9 like the canvas.
const SCREEN_PLANE = {
  width: 0.264,
  height: 0.1485,
};

// Black rim tightly framing the screen (metres beyond the screen on each side),
// and how deep the rim prism sinks toward the dash.
const RIM = {
  bezel: 0.011,
  depth: 0.045,
  cornerRadius: 0.014,
  color: 0x0a0b0d,
};

// Lower app dock (canvas px).
const DOCK = {
  height: 88,
  iconSize: 44,
  gap: 26,
};

// Split layout: primary pane takes 2/3 of the width, secondary 1/3.
const SPLIT = {
  divider: 2,
  primaryFrac: 2 / 3,
};
const CONSOLE_COLORS = {
  screenBg: '#0b0d10',
  panel: '#14171c',
  panelRaised: '#1c2027',
  panelSunken: '#08090b',
  divider: '#000000',
  text: '#f4f6f8',
  muted: 'rgba(188, 193, 200, 0.85)',
  faint: 'rgba(188, 193, 200, 0.4)',
  accent: '#40E0D0', // cluster cyan — keep the cockpit family consistent
  success: '#3ddc84', // cluster green
  danger: '#e5484d',
  warning: '#f5a623',
  dockBg: '#101318',
  dockActive: '#40E0D0',
  dockIdle: 'rgba(188, 193, 200, 0.7)',
  // Map app
  mapBg: '#0e1116',
  mapGrid: 'rgba(255, 255, 255, 0.045)',
  mapRoadCasing: '#05070a',
  mapRoad: '#39414c',
  mapRoadEdge: '#5a6470',
  mapCenterline: 'rgba(244, 246, 248, 0.55)',
  mapEgo: '#40E0D0',
  // Navigation app
  navBg: '#10141a',
  navRoad: '#232932',
  navShoulder: '#161a20',
  navLaneLine: 'rgba(226, 232, 238, 0.8)',
  navDivider: '#e8c14a',
  navEdgeLine: 'rgba(226, 232, 238, 0.95)',
  navEgo: '#2f9edb',
  navEgoTop: '#63bdf0',
  navActor: '#c8ced6',
  navActorTop: '#e8ecf1',
  navActorStopped: '#e5484d',
  navOncoming: '#a7742c',
};
const CONSOLE_FONT = 'ShareTech, Arial, sans-serif';

// App ids in dock order.
const APP_ORDER = ['map', 'nav', 'audio', 'phone', 'comfort'];

// localStorage keys (subsystem owns its persistence, like lanes/traffic/wheel).
const CONSOLE_STORAGE = {
  ui: 'pd-console-ui', // { layout: 'full'|'split', primary, secondary }
  audio: 'pd-console-audio', // { track, volume }
  comfort: 'pd-console-comfort', // { zones: {...} }
};

// --- Audio sample library ----------------------------------------------------
// Tracks link the repo's own shipped media (offline-safe, no new assets).
// Titles/artists are fictional; covers are drawn procedurally from `hue`.
const AUDIO_TRACKS = [
  {
    id: 'spring-meadows',
    title: 'Spring Meadows',
    artist: 'The Verge Markers',
    album: 'Open Roads',
    src: './static/media/ambiance_spring.791a03fe.mp3',
    hue: 145,
  },
  {
    id: 'summer-haze',
    title: 'Summer Haze',
    artist: 'Crossfade Fine',
    album: 'Golden Hour Drives',
    src: './static/media/ambiance_summer_low.0e101ef7.mp3',
    hue: 38,
  },
  {
    id: 'night-wind',
    title: 'Night Wind',
    artist: 'Topo Square',
    album: 'Offworld',
    src: './static/media/wind_02.deef0e2d.mp3',
    hue: 215,
  },
  {
    id: 'rolling-home',
    title: 'Rolling Home',
    artist: 'The Verge Markers',
    album: 'Open Roads',
    src: './static/media/rolling_06.ca3a3b85.mp3',
    hue: 285,
  },
];

// --- Phone sample agenda -------------------------------------------------------
const PHONE_CONTACTS = [
  { name: 'Alex Meridian', phone: '+49 151 2340 001', hue: 205 },
  { name: 'Billie Coast', phone: '+49 151 2340 002', hue: 12 },
  { name: 'Chris Junction', phone: '+49 151 2340 003', hue: 268 },
  { name: 'Dana Hillcrest', phone: '+49 151 2340 004', hue: 96 },
  { name: 'Eli Overpass', phone: '+49 151 2340 005', hue: 330 },
  { name: 'Frankie Lane', phone: '+49 151 2340 006', hue: 176 },
  { name: 'Georgie Bypass', phone: '+49 151 2340 007', hue: 52 },
  { name: 'Harper Viaduct', phone: '+49 151 2340 008', hue: 232 },
  { name: 'Izzy Roundabout', phone: '+49 151 2340 009', hue: 145 },
  { name: 'Jules Milestone', phone: '+49 151 2340 010', hue: 305 },
];

// Ring/alert sound reuses a shipped asset at low volume.
const PHONE_RINGTONE = './static/media/achievement.97104f4a.mp3';

// --- Comfort zones -------------------------------------------------------------
const COMFORT_LIMITS = {
  tempMin: 16,
  tempMax: 28,
  fanMax: 5,
  seatHeatMax: 3,
};
const COMFORT_ZONES = [
  { id: 'driver', label: 'Driver' },
  { id: 'passenger', label: 'Passenger' },
  { id: 'rear', label: 'Rear' },
];
const COMFORT_DEFAULTS = {
  driver: { tempC: 21, fan: 2, seatHeat: 0 },
  passenger: { tempC: 21, fan: 2, seatHeat: 0 },
  rear: { tempC: 21, fan: 1, seatHeat: 0 },
  auto: true,
  sync: false,
};


/* --- ui.js --- */
/**
 * Shared canvas helpers for the center-console apps: geometry, hit regions,
 * text, controls and the icon glyph set. Everything draws into the console's
 * 2D context; nothing here touches THREE or the engine.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function font(px, weight) {
  return `${weight || 400} ${Math.round(px)}px ${CONSOLE_FONT}`;
}

// Interpolate two hex colors (#rrggbb) — used for the temperature readouts.
function colorLerp(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r}, ${g}, ${bl})`;
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
function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
function strokeRoundRect(ctx, x, y, w, h, r, stroke, lineWidth) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth || 1;
  ctx.stroke();
}
function drawText(ctx, text, x, y, { size = 20, weight = 400, color = CONSOLE_COLORS.text, align = 'left', baseline = 'alphabetic', maxWidth } = {}) {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (maxWidth != null) {
    let t = String(text);
    if (ctx.measureText(t).width > maxWidth) {
      while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
      t += '…';
    }
    ctx.fillText(t, x, y);
  } else {
    ctx.fillText(text, x, y);
  }
}

/**
 * Per-frame hit-region registry. Apps call `hits.add(...)` for every
 * interactive region while drawing; the console routes pointer events by
 * querying `hits.at(x, y)`. Regions are pane-local, cleared on each draw.
 * Later additions win (drawn on top).
 */
class HitMap {
  constructor() {
    this.regions = [];
  }

  clear() {
    this.regions.length = 0;
  }

  add(id, x, y, w, h, data) {
    this.regions.push({ id, x, y, w, h, data });
  }

  at(x, y) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }
}

/**
 * Standard rounded button: draws it and registers the hit region in one call.
 * kind: 'solid' (accent), 'ghost' (outline), 'danger', 'success', 'dark'.
 * `icon` is a glyph function (ctx, cx, cy, size, color) from this module.
 */
function button(ctx, hits, id, x, y, w, h, { label, icon, kind = 'dark', active = false, iconSize, textSize } = {}) {
  const r = Math.min(14, h / 2);
  let bg = CONSOLE_COLORS.panelRaised;
  let fg = CONSOLE_COLORS.text;
  if (kind === 'solid') { bg = CONSOLE_COLORS.accent; fg = '#062421'; }
  else if (kind === 'danger') { bg = CONSOLE_COLORS.danger; fg = '#fff'; }
  else if (kind === 'success') { bg = CONSOLE_COLORS.success; fg = '#06240f'; }
  else if (kind === 'ghost') { bg = null; fg = CONSOLE_COLORS.muted; }
  if (active) { bg = CONSOLE_COLORS.accent; fg = '#062421'; }
  if (bg) fillRoundRect(ctx, x, y, w, h, r, bg);
  else strokeRoundRect(ctx, x, y, w, h, r, CONSOLE_COLORS.faint, 1.5);
  const cy = y + h / 2;
  if (icon && label) {
    const is = iconSize || h * 0.44;
    const ts = textSize || h * 0.38;
    ctx.font = font(ts, 400);
    const tw = ctx.measureText(label).width;
    const total = is + 10 + tw;
    let gx = x + w / 2 - total / 2;
    icon(ctx, gx + is / 2, cy, is, fg);
    drawText(ctx, label, gx + is + 10, cy, { size: ts, color: fg, baseline: 'middle' });
  } else if (icon) {
    icon(ctx, x + w / 2, cy, iconSize || h * 0.5, fg);
  } else if (label) {
    drawText(ctx, label, x + w / 2, cy, { size: textSize || h * 0.4, color: fg, align: 'center', baseline: 'middle' });
  }
  if (hits) hits.add(id, x, y, w, h);
}

/** Horizontal slider/progress bar; registers a generous hit strip. */
function slider(ctx, hits, id, x, y, w, frac, { height = 6, color = CONSOLE_COLORS.accent, track = 'rgba(255,255,255,0.14)', knob = true, hitPad = 14 } = {}) {
  const f = clamp(frac || 0, 0, 1);
  fillRoundRect(ctx, x, y - height / 2, w, height, height / 2, track);
  if (f > 0.001) fillRoundRect(ctx, x, y - height / 2, w * f, height, height / 2, color);
  if (knob) {
    ctx.beginPath();
    ctx.arc(x + w * f, y, height + 3, 0, Math.PI * 2);
    ctx.fillStyle = CONSOLE_COLORS.text;
    ctx.fill();
  }
  if (hits) hits.add(id, x - hitPad, y - hitPad - height / 2, w + hitPad * 2, height + hitPad * 2);
}

/** Seeded avatar "picture": colored disc, subtle shading, initials. */
function drawAvatar(ctx, cx, cy, radius, name, hue) {
  const h = hue != null ? hue : (String(name).split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360;
  const grad = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  grad.addColorStop(0, `hsl(${h}, 42%, 46%)`);
  grad.addColorStop(1, `hsl(${h}, 48%, 28%)`);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, radius * 0.05);
  ctx.stroke();
  const initials = String(name)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  drawText(ctx, initials, cx, cy + radius * 0.04, {
    size: radius * 0.82,
    weight: 600,
    color: 'rgba(255,255,255,0.92)',
    align: 'center',
    baseline: 'middle',
  });
}

// --- Icon glyph set ------------------------------------------------------------
// Every glyph: (ctx, cx, cy, size, color) — drawn centred on (cx, cy) in a
// size×size box, stroke-based, automotive-flat.

function glyphSetup(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Folded map. */
function iconMap(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-9, -7);
  ctx.lineTo(-3, -9.5);
  ctx.lineTo(3, -7);
  ctx.lineTo(9, -9.5);
  ctx.lineTo(9, 7);
  ctx.lineTo(3, 9.5);
  ctx.lineTo(-3, 7);
  ctx.lineTo(-9, 9.5);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3, -9.5);
  ctx.lineTo(-3, 7);
  ctx.moveTo(3, -7);
  ctx.lineTo(3, 9.5);
  ctx.stroke();
  ctx.restore();
}

/** Navigation arrow (heading chevron). */
function iconNav(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, 9);
  ctx.lineTo(0, 5);
  ctx.lineTo(-8, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Music note. */
function iconAudio(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-2, 6);
  ctx.lineTo(-2, -8);
  ctx.lineTo(8, -10);
  ctx.lineTo(8, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-5, 6, 3.4, 2.6, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(5, 4, 3.4, 2.6, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Phone handset. */
function iconPhone(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-8.5, -5.5);
  ctx.quadraticCurveTo(-9.5, -9, -6, -9.5);
  ctx.lineTo(-3.5, -9.8);
  ctx.quadraticCurveTo(-1.5, -9.8, -1, -7.5);
  ctx.lineTo(-0.4, -4.4);
  ctx.quadraticCurveTo(0, -2.5, -1.8, -1.6);
  ctx.quadraticCurveTo(-0.5, 2.5, 2.6, 4.4);
  ctx.quadraticCurveTo(4.2, 3, 5.8, 3.8);
  ctx.lineTo(8.6, 5.4);
  ctx.quadraticCurveTo(10.3, 6.5, 9.3, 8.4);
  ctx.quadraticCurveTo(8.2, 10.2, 5.6, 9.8);
  ctx.quadraticCurveTo(-6.5, 8, -8.5, -5.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Seat with heat waves (comfort). */
function iconComfort(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  // Seat: backrest + squab.
  ctx.beginPath();
  ctx.moveTo(-6, -10);
  ctx.quadraticCurveTo(-8.5, -10, -8, -6.5);
  ctx.lineTo(-6.7, 3);
  ctx.quadraticCurveTo(-6.4, 5.5, -3.8, 5.5);
  ctx.lineTo(3.5, 5.5);
  ctx.lineTo(3.5, 9);
  ctx.lineTo(-5, 9);
  ctx.moveTo(-6, -10);
  ctx.quadraticCurveTo(-3.6, -9.6, -3.9, -6.5);
  ctx.lineTo(-4.4, 1);
  ctx.stroke();
  // Heat waves.
  for (let i = 0; i < 2; i++) {
    const x = 1.5 + i * 5;
    ctx.beginPath();
    ctx.moveTo(x, -9);
    ctx.quadraticCurveTo(x + 2.4, -6.5, x, -4);
    ctx.quadraticCurveTo(x - 2.4, -1.5, x, 1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Split-view toggle: rect divided 2/3 - 1/3. */
function iconSplit(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.strokeRect(-10, -7, 20, 14);
  ctx.beginPath();
  ctx.moveTo(3.5, -7);
  ctx.lineTo(3.5, 7);
  ctx.stroke();
  ctx.restore();
}
function iconPlay(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-5, -8);
  ctx.lineTo(7, 0);
  ctx.lineTo(-5, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function iconPause(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.fillRect(-6, -8, 4.4, 16);
  ctx.fillRect(1.6, -8, 4.4, 16);
  ctx.restore();
}
function iconPrev(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.fillRect(-8, -7, 2.6, 14);
  ctx.beginPath();
  ctx.moveTo(8, -7);
  ctx.lineTo(-3, 0);
  ctx.lineTo(8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function iconNext(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.fillRect(5.4, -7, 2.6, 14);
  ctx.beginPath();
  ctx.moveTo(-8, -7);
  ctx.lineTo(3, 0);
  ctx.lineTo(-8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function iconVolume(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-8, -3.5);
  ctx.lineTo(-4, -3.5);
  ctx.lineTo(1, -8);
  ctx.lineTo(1, 8);
  ctx.lineTo(-4, 3.5);
  ctx.lineTo(-8, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(2, 0, 6, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
  ctx.restore();
}

/** Accept-call handset (points up-right). */
function iconPhoneUp(ctx, cx, cy, size, color) {
  iconPhone(ctx, cx, cy, size, color);
}

/** Reject/end-call handset (rotated: hang up). */
function iconPhoneDown(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((135 * Math.PI) / 180);
  iconPhone(ctx, 0, 0, size, color);
  ctx.restore();
}
function iconPlus(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(7, 0);
  ctx.moveTo(0, -7);
  ctx.lineTo(0, 7);
  ctx.stroke();
  ctx.restore();
}
function iconMinus(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(7, 0);
  ctx.stroke();
  ctx.restore();
}

/** Fan: three blades around a hub. */
function iconFan(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * 2 * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(6.5, -9, 2.2, -10.5);
    ctx.quadraticCurveTo(-2.5, -11.5, -2.3, -5);
    ctx.quadraticCurveTo(-2.2, -2.8, 0, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Seat-heat: seat side profile with N wave marks handled by app (levels). */
function iconSeatHeat(ctx, cx, cy, size, color) {
  iconComfort(ctx, cx, cy, size, color);
}
function iconChevron(ctx, cx, cy, size, color, dir) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.rotate(dir === 'up' ? Math.PI : dir === 'left' ? Math.PI / 2 : dir === 'right' ? -Math.PI / 2 : 0);
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.lineTo(0, 4);
  ctx.lineTo(7, -3);
  ctx.stroke();
  ctx.restore();
}

/** Swap arrows (for split-pane swapping). */
function iconSwap(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-9, -4);
  ctx.lineTo(6, -4);
  ctx.moveTo(2, -8);
  ctx.lineTo(6, -4);
  ctx.lineTo(2, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9, 4);
  ctx.lineTo(-6, 4);
  ctx.moveTo(-2, 0);
  ctx.lineTo(-6, 4);
  ctx.lineTo(-2, 8);
  ctx.stroke();
  ctx.restore();
}


/* --- apps/MapApp.js --- */
/**
 * Map app: bird's-eye view of the road ahead, following the vehicle's
 * orientation (heading-up, ego pinned near the bottom). Drawn straight from
 * the engine's road nodes (via the bridge handles), so it works regardless of
 * the HUD worm visibility setting. Nodes behind the ego are trimmed by the
 * engine, so the app keeps its own short trail of passed centreline points.
 */




const MAP_ZOOMS = [0.55, 1, 1.8, 3.2]; // relative zoom steps
const MAP_BASE_AHEAD = 420; // metres visible ahead of the ego at zoom 1

// World → screen for a heading-up view anchored at (ax, ay):
//   fwd  = dx*sin(h) + dz*cos(h)   (metres ahead of the ego)
//   left = dx*cos(h) - dz*sin(h)   (metres to the vehicle's left)
function mapW2S(wx, wz, ego, k, ax, ay) {
  const dx = wx - ego.x;
  const dz = wz - ego.z;
  const fwd = dx * ego.sin + dz * ego.cos;
  const left = dx * ego.cos - dz * ego.sin;
  return [ax - left * k, ay - fwd * k];
}

// Road ahead only: the trail buffer covers the road behind the ego (the
// engine trims passed nodes anyway, and mixing the two sources would zigzag
// the polyline where they overlap).
function mapRoadNodes(handles, maxAheadM) {
  const rs = handles && handles.roadState;
  if (!rs || !rs.vehicleNode) return null;
  const pts = [];
  let node = rs.vehicleNode;
  let dist = 0;
  while (node && dist * 10 < maxAheadM) {
    pts.push(node);
    node = node.next;
    dist++;
  }
  return pts.length >= 2 ? pts : null;
}
const MapApp = {
  id: 'map',
  label: 'Map',
  drawIcon: iconMap,

  init(_facade) {},

  draw(ctx, rect, env) {
    const s = env.state;
    if (s.zoom == null) s.zoom = 1;
    const d = env.data;
    const h = d.handles;

    // Background.
    ctx.fillStyle = CONSOLE_COLORS.mapBg;
    ctx.fillRect(0, 0, rect.w, rect.h);

    const anchorX = rect.w / 2;
    const anchorY = rect.h * 0.72;
    const k = (rect.h * 0.68) / (MAP_BASE_AHEAD / MAP_ZOOMS[s.zoom]); // px per metre
    const ego = { x: d.egoX, z: d.egoZ, sin: Math.sin(d.heading), cos: Math.cos(d.heading) };

    // Passed-road trail (engine trims nodes behind the ego).
    if (!s.trail) s.trail = [];
    const lastT = s.trail[s.trail.length - 1];
    if (!lastT || Math.hypot(d.egoX - lastT.x, d.egoZ - lastT.z) > 8) {
      s.trail.push({ x: d.egoX, z: d.egoZ, w: (h && h.roadState && h.roadState.vehicleNode && h.roadState.vehicleNode.w) || 4 });
      if (s.trail.length > 48) s.trail.shift();
    }

    // Subtle world-aligned grid (rotates with the vehicle — orientation cue).
    this._drawGrid(ctx, rect, ego, k, anchorX, anchorY);

    const nodes = h ? mapRoadNodes(h, (MAP_BASE_AHEAD / MAP_ZOOMS[s.zoom]) * 1.3) : null;
    if (!nodes) {
      drawText(ctx, 'Waiting for road data…', rect.w / 2, rect.h / 2, {
        size: rect.compact ? 16 : 20, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle',
      });
    } else {
      // Combined polyline: own trail (behind) + engine nodes (ahead).
      const px = [];
      const py = [];
      const widths = [];
      for (const t of s.trail.slice(0, -1)) {
        const p = mapW2S(t.x, t.z, ego, k, anchorX, anchorY);
        if (p[1] > anchorY + 4) { px.push(p[0]); py.push(p[1]); widths.push(t.w); }
      }
      for (const n of nodes) {
        const p = mapW2S(n.p.x, n.p.z, ego, k, anchorX, anchorY);
        px.push(p[0]);
        py.push(p[1]);
        widths.push(n.w || 4);
      }
      if (px.length >= 2) {
        const roadW = Math.max(4, 2 * (widths[Math.floor(widths.length / 2)] || 4) * k);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px[0], py[0]);
        for (let i = 1; i < px.length; i++) ctx.lineTo(px[i], py[i]);
        ctx.strokeStyle = CONSOLE_COLORS.mapRoadCasing;
        ctx.lineWidth = roadW + Math.max(2, roadW * 0.18);
        ctx.stroke();
        ctx.strokeStyle = CONSOLE_COLORS.mapRoad;
        ctx.lineWidth = roadW;
        ctx.stroke();
        // Centreline dashes.
        ctx.setLineDash([Math.max(4, 2.4 * k), Math.max(4, 2.4 * k)]);
        ctx.strokeStyle = CONSOLE_COLORS.mapCenterline;
        ctx.lineWidth = Math.max(1, roadW * 0.045);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Ego marker: accent chevron pinned at the anchor, pointing up.
    this._drawEgo(ctx, anchorX, anchorY, Math.max(14, Math.min(24, rect.h * 0.035)), env.now);

    // Chrome: speed chip, compass, scale bar, zoom buttons.
    this._drawSpeedChip(ctx, rect, d);
    this._drawCompass(ctx, rect, d.heading);
    this._drawScaleBar(ctx, rect, k);

    const bs = rect.compact ? 44 : 52;
    const bx = rect.w - bs - 14;
    let by = rect.h - bs * 2 - 26;
    fillRoundRect(ctx, bx, by, bs, bs, 10, CONSOLE_COLORS.panelRaised);
    iconPlus(ctx, bx + bs / 2, by + bs / 2, bs * 0.42, s.zoom < MAP_ZOOMS.length - 1 ? CONSOLE_COLORS.text : CONSOLE_COLORS.faint);
    env.hits.add('zoom-in', bx - 6, by - 6, bs + 12, bs + 12);
    by += bs + 12;
    fillRoundRect(ctx, bx, by, bs, bs, 10, CONSOLE_COLORS.panelRaised);
    iconMinus(ctx, bx + bs / 2, by + bs / 2, bs * 0.42, s.zoom > 0 ? CONSOLE_COLORS.text : CONSOLE_COLORS.faint);
    env.hits.add('zoom-out', bx - 6, by - 6, bs + 12, bs + 12);
  },

  _drawGrid(ctx, rect, ego, k, ax, ay) {
    const spacing = 100; // metres
    if (spacing * k < 14) return;
    const radius = Math.hypot(rect.w, rect.h) / k / 2 + spacing;
    ctx.strokeStyle = CONSOLE_COLORS.mapGrid;
    ctx.lineWidth = 1;
    const x0 = Math.floor((ego.x - radius) / spacing) * spacing;
    const z0 = Math.floor((ego.z - radius) / spacing) * spacing;
    ctx.beginPath();
    for (let gx = x0; gx <= ego.x + radius; gx += spacing) {
      const a = mapW2S(gx, ego.z - radius, ego, k, ax, ay);
      const b = mapW2S(gx, ego.z + radius, ego, k, ax, ay);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    for (let gz = z0; gz <= ego.z + radius; gz += spacing) {
      const a = mapW2S(ego.x - radius, gz, ego, k, ax, ay);
      const b = mapW2S(ego.x + radius, gz, ego, k, ax, ay);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  },

  _drawEgo(ctx, cx, cy, size, now) {
    // Soft pulse ring.
    const pulse = 0.5 + 0.5 * Math.sin(now / 480);
    ctx.beginPath();
    ctx.arc(cx, cy, size * (1.25 + pulse * 0.45), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(64, 224, 208, 0.10)';
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.72, size * 0.85);
    ctx.lineTo(0, size * 0.45);
    ctx.lineTo(-size * 0.72, size * 0.85);
    ctx.closePath();
    ctx.fillStyle = CONSOLE_COLORS.mapEgo;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  },

  _drawSpeedChip(ctx, rect, d) {
    const w = rect.compact ? 96 : 116;
    const h = rect.compact ? 44 : 52;
    fillRoundRect(ctx, 14, 14, w, h, 12, 'rgba(8, 10, 13, 0.78)');
    drawText(ctx, String(Math.round(d.speedDisplay)), 14 + w * 0.42, 14 + h / 2, {
      size: h * 0.52, weight: 600, color: CONSOLE_COLORS.text, align: 'center', baseline: 'middle',
    });
    drawText(ctx, d.speedUnit, 14 + w * 0.78, 14 + h / 2 + 1, {
      size: h * 0.28, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle',
    });
  },

  _drawCompass(ctx, rect, heading) {
    const r = rect.compact ? 20 : 24;
    const cx = rect.w - r - 16;
    const cy = r + 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 10, 13, 0.78)';
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    // World +Z is "north"; its screen direction rotates with the heading.
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62);
    ctx.lineTo(r * 0.3, r * 0.28);
    ctx.lineTo(0, r * 0.05);
    ctx.closePath();
    ctx.fillStyle = CONSOLE_COLORS.danger;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62);
    ctx.lineTo(-r * 0.3, r * 0.28);
    ctx.lineTo(0, r * 0.05);
    ctx.closePath();
    ctx.fillStyle = 'rgba(244, 246, 248, 0.85)';
    ctx.fill();
    ctx.restore();
    drawText(ctx, 'N', cx, cy + r + 11, { size: 12, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle' });
  },

  _drawScaleBar(ctx, rect, k) {
    // Pick a nice round distance that fits ~110 px.
    const target = 110 / k;
    const steps = [10, 20, 50, 100, 200, 500, 1000];
    let m = steps[0];
    for (const st of steps) { if (st <= target) m = st; }
    const px = m * k;
    const x = 18;
    const y = rect.h - 22;
    ctx.strokeStyle = CONSOLE_COLORS.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + px, y - 5);
    ctx.lineTo(x + px, y + 5);
    ctx.stroke();
    drawText(ctx, m >= 1000 ? `${m / 1000} km` : `${m} m`, x + px / 2, y - 10, {
      size: 12, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle',
    });
  },

  onPointer(type, x, y, rect, env) {
    if (type !== 'down') return false;
    const hit = env.hits.at(x, y);
    if (!hit) return false;
    const s = env.state;
    if (hit.id === 'zoom-in') s.zoom = clamp((s.zoom == null ? 1 : s.zoom) + 1, 0, MAP_ZOOMS.length - 1);
    if (hit.id === 'zoom-out') s.zoom = clamp((s.zoom == null ? 1 : s.zoom) - 1, 0, MAP_ZOOMS.length - 1);
    return false;
  },
};


/* --- apps/NavApp.js --- */
/**
 * Navigation app: a close-follow bird view of the ego vehicle with a
 * simplified representation of the road's lanes. The road surface, lane
 * boundaries and edges are rebuilt every frame from the engine's road nodes
 * (fine Bézier sub-samples near the ego), and other road actors are drawn as
 * pseudo-3D boxes at their live world poses.
 *
 * Sign conventions (from the traffic subsystem): positive lateral offsets are
 * the ego/forward side (visually LEFT of travel) and are applied along MINUS
 * the node normal; lane stamps live per node (laneTotal/laneWidth/laneDivRatio).
 */




const NAV_AHEAD_M = 48; // metres from the ego to the top of the pane
const NAV_BEHIND_NODES = 2;
const NAV_AHEAD_NODES = 9;

function navSamples(handles) {
  const rs = handles && handles.roadState;
  if (!rs || !rs.vehicleNode) return null;
  let start = rs.vehicleNode;
  for (let i = 0; i < NAV_BEHIND_NODES && start.prev; i++) start = start.prev;
  const samples = [];
  let node = start;
  for (let n = 0; n < NAV_BEHIND_NODES + NAV_AHEAD_NODES && node; n++) {
    const stamps = {
      w: node.w || 4,
      total: node.laneTotal || 2,
      laneW: node.laneWidth || ((node.w || 4) * 2) / (node.laneTotal || 2),
      divRatio: node.laneDivRatio != null ? node.laneDivRatio : 0,
    };
    if (node.ps && node.ps.length > 1 && node.ns && node.ns.length === node.ps.length) {
      for (let i = 0; i < node.ps.length - 1; i++) {
        samples.push({ x: node.ps[i].x, z: node.ps[i].z, nx: node.ns[i].x, nz: node.ns[i].z, s: stamps });
      }
    } else if (node.next) {
      for (let i = 0; i < 5; i++) {
        const t = i / 5;
        samples.push({
          x: node.p.x + (node.next.p.x - node.p.x) * t,
          z: node.p.z + (node.next.p.z - node.p.z) * t,
          nx: node.n.x + (node.next.n.x - node.n.x) * t,
          nz: node.n.z + (node.next.n.z - node.n.z) * t,
          s: stamps,
        });
      }
    }
    node = node.next;
  }
  // Normalise the interpolated normals.
  for (const p of samples) {
    const l = Math.hypot(p.nx, p.nz) || 1;
    p.nx /= l;
    p.nz /= l;
  }
  return samples.length >= 4 ? samples : null;
}

// Signed-lat point: positive lat = ego/forward side, applied along -n.
function navLatPoint(sample, lat) {
  return { x: sample.x - sample.nx * lat, z: sample.z - sample.nz * lat };
}

// Integer lane counts from a node's stamps (fractional mid-taper).
function navLaneCounts(stamps) {
  const total = Math.max(1, Math.round(stamps.total));
  const bwd = Math.max(0, Math.min(total, Math.round((total * (1 + stamps.divRatio)) / 2)));
  return { fwd: total - bwd, bwd };
}

function navW2S(wx, wz, view) {
  const dx = wx - view.x;
  const dz = wz - view.z;
  const fwd = dx * view.sin + dz * view.cos;
  const left = dx * view.cos - dz * view.sin;
  return [view.ax - left * view.k, view.ay - fwd * view.k];
}

function navHexColor(intColor, lighten) {
  if (typeof intColor !== 'number') return null;
  let r = (intColor >> 16) & 255;
  let g = (intColor >> 8) & 255;
  let b = intColor & 255;
  if (lighten) {
    r = Math.min(255, Math.round(r + (255 - r) * lighten));
    g = Math.min(255, Math.round(g + (255 - g) * lighten));
    b = Math.min(255, Math.round(b + (255 - b) * lighten));
  }
  return `rgb(${r}, ${g}, ${b})`;
}
const NavApp = {
  id: 'nav',
  label: 'Nav',
  drawIcon: iconNav,

  init(_facade) {},

  draw(ctx, rect, env) {
    const d = env.data;
    const h = d.handles;

    ctx.fillStyle = CONSOLE_COLORS.navBg;
    ctx.fillRect(0, 0, rect.w, rect.h);

    const view = {
      x: d.egoX,
      z: d.egoZ,
      sin: Math.sin(d.heading),
      cos: Math.cos(d.heading),
      ax: rect.w / 2,
      ay: rect.h * 0.74,
      h: rect.h,
      k: (rect.h * 0.74) / NAV_AHEAD_M,
    };

    const samples = h ? navSamples(h) : null;
    if (!samples) {
      drawText(ctx, 'Waiting for road data…', rect.w / 2, rect.h / 2, {
        size: rect.compact ? 16 : 20, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle',
      });
      this._drawEgoBox(ctx, view, h, d);
      return;
    }

    this._drawRoad(ctx, samples, view);
    this._drawLaneLines(ctx, samples, view);
    this._drawActors(ctx, view, d);
    this._drawEgoBox(ctx, view, h, d);
    this._drawHeadway(ctx, view, d, rect);
    this._drawBanner(ctx, rect, h);
    this._drawStatusStrip(ctx, rect, d, samples);
  },

  _drawRoad(ctx, samples, view) {
    // Shoulder (slightly wider), then the road surface polygon.
    for (const pass of [
      { extra: 1.4, color: CONSOLE_COLORS.navShoulder },
      { extra: 0, color: CONSOLE_COLORS.navRoad },
    ]) {
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const e = navLatPoint(samples[i], samples[i].s.w + pass.extra);
        const p = navW2S(e.x, e.z, view);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      for (let i = samples.length - 1; i >= 0; i--) {
        const e = navLatPoint(samples[i], -(samples[i].s.w + pass.extra));
        const p = navW2S(e.x, e.z, view);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fillStyle = pass.color;
      ctx.fill();
    }
  },

  _drawLaneLines(ctx, samples, view) {
    // Lane counts from the stamps under the ego (middle sample). Stamps can be
    // fractional mid-taper during a live lane change — round for line/count
    // purposes; the road EDGES are always drawn at the true half-width ±w.
    const mid = samples[Math.floor(samples.length / 2)].s;
    const counts = navLaneCounts(mid);
    const fwd = counts.fwd;
    const bwd = counts.bwd;

    const strokeBoundary = (latOf, style) => {
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const sm = samples[i];
        const e = navLatPoint(sm, latOf(sm));
        const p = navW2S(e.x, e.z, view);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
      ctx.setLineDash(style.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const k = view.k;
    const edgeStyle = { color: CONSOLE_COLORS.navEdgeLine, width: Math.max(1.5, 0.14 * k) };
    const laneStyle = { color: CONSOLE_COLORS.navLaneLine, width: Math.max(1, 0.11 * k), dash: [1.8 * k, 2.6 * k] };
    const dividerStyle = { color: CONSOLE_COLORS.navDivider, width: Math.max(1.5, 0.15 * k) };
    const divOf = (sm) => sm.s.divRatio * sm.s.w;

    // Road edges at the true half-width (robust to fractional stamps and
    // one-way layouts where a lane count is 0).
    strokeBoundary((sm) => sm.s.w, edgeStyle);
    strokeBoundary((sm) => -sm.s.w, edgeStyle);
    // Center divider between directions.
    if (fwd > 0 && bwd > 0) strokeBoundary(divOf, dividerStyle);
    // Interior same-direction boundaries.
    for (let j = 1; j < fwd; j++) {
      strokeBoundary((sm) => divOf(sm) + j * sm.s.laneW, laneStyle);
    }
    for (let j = 1; j < bwd; j++) {
      strokeBoundary((sm) => divOf(sm) - j * sm.s.laneW, laneStyle);
    }
  },

  /** Pseudo-3D box: dark base, extruded side walls, lit top face. */
  _drawBox(ctx, px, py, rel, wMeters, lMeters, view, colors) {
    const w = Math.max(4, wMeters * view.k);
    const l = Math.max(6, lMeters * view.k);
    const e = Math.max(3, Math.min(10, view.k * 1.1)); // extrusion height, px
    const cosR = Math.cos(rel);
    const sinR = Math.sin(rel);
    const corner = (cx, cy) => [px + cx * cosR - cy * sinR, py + cx * sinR + cy * cosR];
    const base = [corner(-w / 2, -l / 2), corner(w / 2, -l / 2), corner(w / 2, l / 2), corner(-w / 2, l / 2)];
    const top = base.map((c) => [c[0], c[1] - e]);

    ctx.beginPath();
    for (let i = 0; i < 4; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, base[i][0], base[i][1]);
    ctx.closePath();
    ctx.fillStyle = colors.base;
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      ctx.beginPath();
      ctx.moveTo(base[i][0], base[i][1]);
      ctx.lineTo(base[j][0], base[j][1]);
      ctx.lineTo(top[j][0], top[j][1]);
      ctx.lineTo(top[i][0], top[i][1]);
      ctx.closePath();
      ctx.fillStyle = colors.side;
      ctx.fill();
    }
    ctx.beginPath();
    for (let i = 0; i < 4; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, top[i][0], top[i][1]);
    ctx.closePath();
    ctx.fillStyle = colors.top;
    ctx.fill();
    // Windshield hint on the top face (front third).
    const wf = 0.62;
    const glass = [
      corner(-w * 0.32 * 1, -l * 0.44), corner(w * 0.32, -l * 0.44),
      corner(w * 0.30 * wf / 0.62, -l * 0.18), corner(-w * 0.30, -l * 0.18),
    ].map((c) => [c[0], c[1] - e]);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, glass[i][0], glass[i][1]);
    ctx.closePath();
    ctx.fillStyle = colors.glass || 'rgba(20, 26, 34, 0.65)';
    ctx.fill();
    if (colors.outline) {
      ctx.beginPath();
      for (let i = 0; i < 4; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, top[i][0], top[i][1]);
      ctx.closePath();
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  },

  _drawActors(ctx, view, d) {
    const mgr = d.traffic;
    if (!mgr || !mgr.vehicles) return;
    for (const v of mgr.vehicles) {
      if (!v || !v.ready || !v.group) continue;
      const p = v.group.position;
      const sp = navW2S(p.x, p.z, view);
      if (sp[0] < -60 || sp[0] > view.ax * 2 + 60 || sp[1] < -80 || sp[1] > view.h + 80) continue;
      const rel = d.heading - v.group.rotation.y;
      const stopped = v.mode === 'stopped' || v.mode === 'crashed';
      const bodyTop = navHexColor(v.color, 0.35) || CONSOLE_COLORS.navActorTop;
      const bodySide = navHexColor(v.color, 0) || CONSOLE_COLORS.navActor;
      this._drawBox(ctx, sp[0], sp[1], rel, v.width || 1.6, v.length || 4, view, {
        base: 'rgba(0, 0, 0, 0.45)',
        side: bodySide,
        top: bodyTop,
        outline: stopped ? CONSOLE_COLORS.navActorStopped : null,
      });
    }
  },

  _drawEgoBox(ctx, view, h, d) {
    let w = 1.56;
    let l = 3.95;
    try {
      if (h && h.ego && h.ego.wheels) {
        w = (h.ego.wheels.width || 1.36) + 2 * (h.ego.wheels.tyreWidth || 0.1);
        l = (h.ego.wheels.length || 2.75) + 1.2;
      }
    } catch (_e) {}
    this._drawBox(ctx, view.ax, view.ay, 0, w, l, view, {
      base: 'rgba(0, 0, 0, 0.5)',
      side: CONSOLE_COLORS.navEgo,
      top: CONSOLE_COLORS.navEgoTop,
      outline: d.autodrive ? CONSOLE_COLORS.accent : null,
    });
  },

  _drawHeadway(ctx, view, d, rect) {
    const mgr = d.traffic;
    if (!mgr || typeof mgr.egoLead !== 'function') return;
    let lead = null;
    try { lead = mgr.egoLead(); } catch (_e) {}
    if (!lead || lead.gap == null || lead.gap > 90) return;
    const chipW = 86;
    const y = Math.max(14, view.ay - lead.gap * view.k - 46);
    fillRoundRect(ctx, view.ax - chipW / 2, y, chipW, 28, 8, 'rgba(8, 10, 13, 0.8)');
    drawText(ctx, `↑ ${Math.round(lead.gap)} m`, view.ax, y + 14, {
      size: 15, color: CONSOLE_COLORS.accent, align: 'center', baseline: 'middle',
    });
  },

  /** Guidance banner: upcoming curve direction/distance from node curvature. */
  _drawBanner(ctx, rect, h) {
    let text = 'Follow the road';
    let dir = 0; // -1 right, +1 left
    try {
      const rs = h && h.roadState;
      if (rs && rs.vehicleNode) {
        let node = rs.vehicleNode.next;
        let sum = 0;
        let firstIdx = -1;
        for (let i = 1; i <= 14 && node; i++, node = node.next) {
          sum += node.da || 0;
          if (firstIdx < 0 && Math.abs(node.da || 0) > 0.012) firstIdx = i;
        }
        if (Math.abs(sum) > 0.14 && firstIdx > 0) {
          dir = sum > 0 ? 1 : -1; // node.a = prev.a - da; heading rises with +da => left
          const distM = firstIdx * 10;
          text = `Curve ${dir > 0 ? 'left' : 'right'} · ${distM} m`;
        }
      }
    } catch (_e) {}
    const w = Math.min(rect.w - 24, rect.compact ? 240 : 300);
    const x = rect.w / 2 - w / 2;
    fillRoundRect(ctx, x, 12, w, 42, 12, 'rgba(8, 10, 13, 0.8)');
    if (dir !== 0) {
      iconChevron(ctx, x + 30, 33, 22, CONSOLE_COLORS.accent, dir > 0 ? 'left' : 'right');
      drawText(ctx, text, x + 50, 33, { size: 17, color: CONSOLE_COLORS.text, baseline: 'middle', maxWidth: w - 62 });
    } else {
      drawText(ctx, text, x + w / 2, 33, {
        size: 17, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle', maxWidth: w - 24,
      });
    }
  },

  _drawStatusStrip(ctx, rect, d, samples) {
    const mid = samples[Math.floor(samples.length / 2)].s;
    const counts = navLaneCounts(mid);
    const fwd = counts.fwd;
    const bwd = counts.bwd;
    const y = rect.h - 34;
    fillRoundRect(ctx, 12, y, rect.w - 24, 26, 8, 'rgba(8, 10, 13, 0.65)');
    drawText(ctx, `${fwd} + ${bwd} lanes`, 26, y + 13, { size: 14, color: CONSOLE_COLORS.muted, baseline: 'middle' });
    drawText(ctx, `${Math.round(d.speedDisplay)} ${d.speedUnit}`, rect.w / 2, y + 13, {
      size: 14, color: CONSOLE_COLORS.text, align: 'center', baseline: 'middle',
    });
    if (d.autodrive) {
      drawText(ctx, 'AUTODRIVE', rect.w - 26, y + 13, {
        size: 13, color: CONSOLE_COLORS.accent, align: 'right', baseline: 'middle',
      });
    }
  },

  onPointer(_type, _x, _y, _rect, _env) {
    return false;
  },
};


/* --- apps/AudioApp.js --- */
/**
 * Audio app for the center console: a compact media player over the repo's
 * shipped ambience tracks (AUDIO_TRACKS). A module-level singleton owns the
 * single HTMLAudioElement (created lazily on first play) so playback survives
 * app/layout switches; album art is drawn procedurally per track and cached.
 * Persists { track, volume } under CONSOLE_STORAGE.audio and emits
 * 'consoleAudio' on every state mutation.
 */




// Icon ink on the accent play circle (matches the button() 'solid' foreground).
const audioAccentInk = '#062421';

// --- Module-level player singleton -------------------------------------------
// Controller state lives here (NOT in env.state) because the integration API
// can drive the player while the app is not visible.

const audioPlayerState = {
  el: null, // HTMLAudioElement, created lazily on first play
  index: 0,
  playing: false, // playback intent (stays true while blocked awaiting a gesture)
  volume: 0.7,
  waitingForGesture: false, // play() was rejected by the autoplay policy
  gestureArmed: false, // one-time document pointerdown retry listener armed
  persistedLoaded: false,
  console: null, // console facade, stored in init()
  gain: 1, // engine master gain (AudioLevel × pause/blur mute), set by the core
};

// element volume = the user's volume × the engine master gain.
function audioEffectiveVolume() {
  const st = audioPlayerState;
  return clamp(st.volume * (typeof st.gain === 'number' ? st.gain : 1), 0, 1);
}

const audioCoverCache = {}; // track.id -> 360x360 offscreen canvas
const audioTrackDurations = {}; // track.id -> seconds, learned from metadata

function audioLoadPersisted() {
  const st = audioPlayerState;
  if (st.persistedLoaded) return;
  st.persistedLoaded = true;
  try {
    const raw = localStorage.getItem(CONSOLE_STORAGE.audio);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    const idx = AUDIO_TRACKS.findIndex((t) => t.id === saved.track);
    if (idx >= 0) st.index = idx;
    if (typeof saved.volume === 'number' && isFinite(saved.volume)) {
      st.volume = clamp(saved.volume, 0, 1);
    }
  } catch (e) {
    // Corrupted or unavailable storage — keep defaults.
  }
}

function audioPersistState() {
  try {
    localStorage.setItem(
      CONSOLE_STORAGE.audio,
      JSON.stringify({ track: AUDIO_TRACKS[audioPlayerState.index].id, volume: audioPlayerState.volume })
    );
  } catch (e) {
    // Storage may be unavailable (private mode) — playback still works.
  }
}

function audioEmitStatus() {
  const st = audioPlayerState;
  if (!st.console) return;
  try {
    st.console.emit('consoleAudio', audioController.status());
  } catch (e) {
    // Never let a listener error break playback.
  }
}

function audioEnsureElement() {
  const st = audioPlayerState;
  if (st.el) return st.el;
  if (typeof Audio === 'undefined') return null;
  audioLoadPersisted();
  try {
    const el = new Audio();
    el.loop = false;
    el.preload = 'metadata';
    el.volume = audioEffectiveVolume();
    el.addEventListener('loadedmetadata', () => {
      const t = AUDIO_TRACKS[audioPlayerState.index];
      if (t && isFinite(el.duration) && el.duration > 0) audioTrackDurations[t.id] = el.duration;
    });
    el.addEventListener('ended', () => {
      audioStep(1); // auto-advance (wraps); intent stays playing
    });
    el.src = AUDIO_TRACKS[st.index].src;
    st.el = el;
    return el;
  } catch (e) {
    return null;
  }
}

function audioArmGestureRetry() {
  const st = audioPlayerState;
  if (st.gestureArmed || typeof document === 'undefined') return;
  st.gestureArmed = true;
  try {
    document.addEventListener(
      'pointerdown',
      () => {
        st.gestureArmed = false;
        if (st.playing) audioTryPlay();
      },
      { capture: true, once: true }
    );
  } catch (e) {
    st.gestureArmed = false;
  }
}

function audioTryPlay() {
  const st = audioPlayerState;
  st.playing = true;
  const el = audioEnsureElement();
  if (!el) return;
  let p = null;
  try {
    p = el.play();
  } catch (e) {
    st.waitingForGesture = true;
    audioArmGestureRetry();
    return;
  }
  if (p && typeof p.then === 'function') {
    p.then(
      () => {
        st.waitingForGesture = false;
      },
      () => {
        // Autoplay policy blocked us — retry on the next real user gesture.
        st.waitingForGesture = true;
        audioArmGestureRetry();
      }
    );
  } else {
    st.waitingForGesture = false;
  }
}

function audioResolveTrackIndex(v) {
  if (typeof v === 'number' && isFinite(v)) {
    const i = Math.floor(v);
    return i >= 0 && i < AUDIO_TRACKS.length ? i : -1;
  }
  if (typeof v === 'string') return AUDIO_TRACKS.findIndex((t) => t.id === v);
  return -1;
}

function audioSetIndex(index) {
  const st = audioPlayerState;
  st.index = index;
  if (st.el) {
    try {
      st.el.src = AUDIO_TRACKS[index].src;
    } catch (e) {
      // Ignore — the element keeps its previous source.
    }
  }
  audioPersistState();
}

function audioStep(delta) {
  const st = audioPlayerState;
  audioLoadPersisted();
  const n = AUDIO_TRACKS.length;
  audioSetIndex((((st.index + delta) % n) + n) % n);
  if (st.playing) audioTryPlay();
  audioEmitStatus();
}

// Live (mid-drag) volume: applies without persisting or emitting; the
// controller's volume() finishes the gesture with persist + emit.
function audioApplyVolumeLive(v01) {
  const st = audioPlayerState;
  st.volume = clamp(v01, 0, 1);
  if (st.el) {
    try {
      st.el.volume = audioEffectiveVolume();
    } catch (e) {
      // Ignore.
    }
  }
}

// --- Programmatic API (PromptDrive.console.audio.*) ---------------------------

const audioController = {
  play(indexOrId) {
    const st = audioPlayerState;
    audioLoadPersisted();
    if (indexOrId != null) {
      const idx = audioResolveTrackIndex(indexOrId);
      if (idx >= 0 && idx !== st.index) audioSetIndex(idx);
    }
    audioTryPlay();
    audioEmitStatus();
  },

  pause() {
    const st = audioPlayerState;
    st.playing = false;
    st.waitingForGesture = false;
    if (st.el) {
      try {
        st.el.pause();
      } catch (e) {
        // Ignore.
      }
    }
    audioEmitStatus();
  },

  toggle() {
    if (audioPlayerState.playing) audioController.pause();
    else audioController.play();
  },

  next() {
    audioStep(1);
  },

  prev() {
    audioStep(-1);
  },

  seek(frac) {
    const st = audioPlayerState;
    const f = clamp(typeof frac === 'number' && isFinite(frac) ? frac : 0, 0, 1);
    if (st.el && isFinite(st.el.duration) && st.el.duration > 0) {
      try {
        st.el.currentTime = f * st.el.duration;
      } catch (e) {
        // Ignore — seeking before the media is ready is a no-op.
      }
    }
    audioEmitStatus();
  },

  volume(v01) {
    audioLoadPersisted();
    audioApplyVolumeLive(typeof v01 === 'number' && isFinite(v01) ? v01 : 0);
    audioPersistState();
    audioEmitStatus();
  },

  status() {
    const st = audioPlayerState;
    audioLoadPersisted();
    const t = AUDIO_TRACKS[st.index];
    let positionSec = 0;
    let durationSec = 0;
    if (st.el) {
      positionSec = isFinite(st.el.currentTime) ? st.el.currentTime : 0;
      durationSec = isFinite(st.el.duration) ? st.el.duration : 0; // NaN before metadata -> 0
    }
    return {
      index: st.index,
      track: { id: t.id, title: t.title, artist: t.artist, album: t.album },
      playing: st.playing,
      positionSec,
      durationSec,
      volume: st.volume,
    };
  },
};

// --- Procedural album art ------------------------------------------------------
// 360x360 offscreen canvas per track, cached by id: an hsl gradient from
// track.hue plus a geometric motif picked by track index, sheen and vignette.

function audioMakeCover(track, index) {
  const cached = audioCoverCache[track.id];
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  let c;
  let g;
  try {
    c = document.createElement('canvas');
    c.width = 360;
    c.height = 360;
    g = c.getContext('2d');
  } catch (e) {
    return null;
  }
  if (!g) return null;
  const hue = track.hue || 0;

  const base = g.createLinearGradient(0, 0, 360, 360);
  base.addColorStop(0, `hsl(${hue}, 55%, 40%)`);
  base.addColorStop(0.55, `hsl(${hue}, 50%, 24%)`);
  base.addColorStop(1, `hsl(${(hue + 40) % 360}, 45%, 15%)`);
  g.fillStyle = base;
  g.fillRect(0, 0, 360, 360);

  const motif = index % 4;
  if (motif === 0) {
    // Concentric vinyl grooves around an off-centre spindle.
    const vcx = 252 + ((hue % 40) - 20);
    const vcy = 118;
    for (let rr = 24; rr <= 320; rr += 14) {
      const emph = rr % 42 < 14;
      const a0 = rr * 0.11 + hue * 0.01;
      g.beginPath();
      g.arc(vcx, vcy, rr, a0, a0 + Math.PI * (1.05 + (rr % 42) / 42));
      g.strokeStyle = `hsla(${hue}, 62%, 80%, ${emph ? 0.26 : 0.1})`;
      g.lineWidth = emph ? 2.6 : 1.4;
      g.stroke();
    }
    g.beginPath();
    g.arc(vcx, vcy, 15, 0, Math.PI * 2);
    g.fillStyle = `hsla(${hue}, 55%, 82%, 0.85)`;
    g.fill();
    g.beginPath();
    g.arc(vcx, vcy, 4.5, 0, Math.PI * 2);
    g.fillStyle = `hsl(${hue}, 50%, 16%)`;
    g.fill();
  } else if (motif === 1) {
    // Diagonal ridge lines of varying weight.
    g.save();
    g.translate(180, 180);
    g.rotate(-Math.PI / 5 - (hue % 30) * 0.004);
    for (let i = -13; i <= 13; i++) {
      const yy = i * 23;
      g.beginPath();
      g.moveTo(-290, yy);
      g.lineTo(290, yy);
      g.strokeStyle = `hsla(${hue}, 62%, ${i % 2 ? 78 : 66}%, ${0.06 + 0.11 * Math.abs(Math.sin(i * 1.31 + hue))})`;
      g.lineWidth = 2 + (Math.abs(i) % 3) * 2.4;
      g.stroke();
    }
    g.restore();
  } else if (motif === 2) {
    // Dot matrix with a sine-modulated radius field.
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const t = Math.abs(Math.sin(col * 0.93 + row * 0.57 + hue * 0.03));
        g.beginPath();
        g.arc(20 + col * 35.5, 20 + row * 35.5, 2 + 6.8 * t, 0, Math.PI * 2);
        g.fillStyle = `hsla(${hue}, 58%, 78%, ${0.08 + 0.18 * t})`;
        g.fill();
      }
    }
  } else {
    // Layered mountain silhouettes under a glowing sun.
    const sunX = 118 + (hue % 90);
    const glow = g.createRadialGradient(sunX, 96, 4, sunX, 96, 64);
    glow.addColorStop(0, `hsla(${hue}, 75%, 88%, 0.95)`);
    glow.addColorStop(0.4, `hsla(${hue}, 75%, 80%, 0.3)`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 360, 250);
    g.beginPath();
    g.arc(sunX, 96, 22, 0, Math.PI * 2);
    g.fillStyle = `hsla(${hue}, 70%, 86%, 0.95)`;
    g.fill();
    for (let layer = 0; layer < 3; layer++) {
      const baseY = 205 + layer * 42;
      const seed = hue * 0.11 + layer * 6.7;
      g.beginPath();
      g.moveTo(0, 360);
      for (let px = 0; px <= 360; px += 12) {
        const yy = baseY - layer * 8 + 30 * Math.sin(px * 0.021 + seed) + 14 * Math.sin(px * 0.053 + seed * 1.9);
        g.lineTo(px, yy);
      }
      g.lineTo(360, 360);
      g.closePath();
      g.fillStyle = `hsl(${(hue + 12 * layer) % 360}, 42%, ${19 - layer * 5}%)`;
      g.fill();
    }
  }

  // Sheen and vignette so it reads like printed sleeve art.
  const sheen = g.createLinearGradient(0, 0, 0, 360);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
  sheen.addColorStop(0.3, 'rgba(255, 255, 255, 0.02)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, 360, 360);
  const vig = g.createRadialGradient(180, 168, 120, 180, 186, 300);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.44)');
  g.fillStyle = vig;
  g.fillRect(0, 0, 360, 360);

  audioCoverCache[track.id] = c;
  return c;
}

function audioDrawCoverArt(ctx, track, index, x, y, size, radius, shadow) {
  if (shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = size * 0.1;
    ctx.shadowOffsetY = size * 0.035;
    fillRoundRect(ctx, x, y, size, size, radius, '#0d0f13');
    ctx.restore();
  }
  const art = audioMakeCover(track, index);
  if (art) {
    ctx.save();
    roundRectPath(ctx, x, y, size, size, radius);
    ctx.clip();
    ctx.drawImage(art, x, y, size, size);
    ctx.restore();
  } else {
    fillRoundRect(ctx, x, y, size, size, radius, CONSOLE_COLORS.panelRaised);
    iconAudio(ctx, x + size / 2, y + size / 2, size * 0.4, CONSOLE_COLORS.faint);
  }
  strokeRoundRect(ctx, x, y, size, size, radius, 'rgba(255, 255, 255, 0.08)', 1);
}

// --- Pane rendering --------------------------------------------------------------

// Animated 3-bar equalizer marking the playing row.
function audioDrawEq(ctx, now, x, cy) {
  ctx.fillStyle = CONSOLE_COLORS.accent;
  for (let b = 0; b < 3; b++) {
    const bh = 5 + 11 * (0.5 + 0.5 * Math.sin((now / 1000) * (5.1 + b * 1.4) + b * 2.1));
    ctx.fillRect(x + b * 7, cy + 9 - bh, 4, bh);
  }
}

// Prev / play-pause (accent circle) / next, centred on (cx, cy).
function audioDrawTransport(ctx, hits, cx, cy, big, playing) {
  const r = big ? 44 : 34;
  const bw = big ? 76 : 62;
  const bh = big ? 58 : 50;
  const gap = big ? 34 : 24;
  button(ctx, hits, 'prev', cx - r - gap - bw, cy - bh / 2, bw, bh, { icon: iconPrev, iconSize: bh * 0.42 });
  button(ctx, hits, 'next', cx + r + gap, cy - bh / 2, bw, bh, { icon: iconNext, iconSize: bh * 0.42 });
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = CONSOLE_COLORS.accent;
  ctx.fill();
  const glyph = playing ? iconPause : iconPlay;
  glyph(ctx, cx + (playing ? 0 : r * 0.07), cy, r * 0.82, audioAccentInk);
  hits.add('toggle', cx - r, cy - r, r * 2, r * 2);
}

function audioDrawFull(ctx, rect, env, track, positionSec, durationSec, frac, waiting) {
  const st = audioPlayerState;
  const hits = env.hits;
  const pad = 28;
  const contentW = Math.min(rect.w - pad * 2, 980);
  const x0 = Math.round((rect.w - contentW) / 2);
  const coverSize = 300;
  const coverY = pad;

  audioDrawCoverArt(ctx, track, st.index, x0, coverY, coverSize, 14, true);

  const rx = x0 + coverSize + 40;
  const rw = x0 + contentW - rx;

  drawText(ctx, String(track.album).toUpperCase(), rx, coverY + 22, { size: 15, color: CONSOLE_COLORS.faint, maxWidth: rw });
  drawText(ctx, track.title, rx, coverY + 64, { size: 36, weight: 600, maxWidth: rw });
  drawText(ctx, track.artist, rx, coverY + 96, { size: 20, color: CONSOLE_COLORS.muted, maxWidth: rw });
  if (waiting) {
    drawText(ctx, 'sound starts on your next tap', rx, coverY + 122, { size: 13, color: CONSOLE_COLORS.faint, maxWidth: rw });
  }

  // Seekable progress bar with times at the ends.
  const py = coverY + 150;
  drawText(ctx, formatTime(positionSec), rx, py + 5, { size: 15, color: CONSOLE_COLORS.muted });
  drawText(ctx, formatTime(durationSec), rx + rw, py + 5, { size: 15, color: CONSOLE_COLORS.muted, align: 'right' });
  const sx = rx + 58;
  const sw = rw - 116;
  slider(ctx, null, 'seek', sx, py, sw, frac, { height: 7 });
  hits.add('seek', sx - 16, py - 20, sw + 32, 40, { x: sx, w: sw });

  audioDrawTransport(ctx, hits, rx + rw / 2, coverY + 222, true, st.playing);

  // Volume row.
  const vy = coverY + 290;
  iconVolume(ctx, rx + 13, vy, 24, CONSOLE_COLORS.muted);
  const vx = rx + 44;
  const vw = rw - 52;
  slider(ctx, null, 'vol', vx, vy, vw, st.volume, { height: 6 });
  hits.add('vol', vx - 16, vy - 18, vw + 32, 36, { x: vx, w: vw });

  // Track list (4 rows — fits without scrolling).
  const listY = coverY + coverSize + 24;
  drawText(ctx, 'LIBRARY', x0 + 2, listY + 4, { size: 13, color: CONSOLE_COLORS.faint });
  let ry = listY + 14;
  const rowH = 54;
  const rowGap = 6;
  for (let i = 0; i < AUDIO_TRACKS.length; i++) {
    const t = AUDIO_TRACKS[i];
    const active = i === st.index;
    fillRoundRect(ctx, x0, ry, contentW, rowH, 10, active ? CONSOLE_COLORS.panelRaised : CONSOLE_COLORS.panel);
    if (active) fillRoundRect(ctx, x0, ry + 8, 4, rowH - 16, 2, CONSOLE_COLORS.accent);
    audioDrawCoverArt(ctx, t, i, x0 + 14, ry + 5, 44, 6, false);
    const tx = x0 + 72;
    const tw = contentW - 72 - 140;
    drawText(ctx, t.title, tx, ry + 23, { size: 18, maxWidth: tw });
    drawText(ctx, t.artist, tx, ry + 43, { size: 14, color: CONSOLE_COLORS.muted, maxWidth: tw });
    const known = audioTrackDurations[t.id];
    if (known) {
      drawText(ctx, formatTime(known), x0 + contentW - 18, ry + rowH / 2 + 5, { size: 15, color: CONSOLE_COLORS.faint, align: 'right' });
    }
    if (active && st.playing && !st.waitingForGesture) audioDrawEq(ctx, env.now, x0 + contentW - 92, ry + rowH / 2);
    hits.add('track', x0, ry, contentW, rowH, { index: i });
    ry += rowH + rowGap;
  }
}

function audioDrawCompact(ctx, rect, env, track, positionSec, durationSec, frac, waiting) {
  const st = audioPlayerState;
  const hits = env.hits;
  const w = rect.w;
  const coverSize = Math.min(200, w - 140);
  const coverY = 24;
  audioDrawCoverArt(ctx, track, st.index, (w - coverSize) / 2, coverY, coverSize, 12, true);

  const cx = w / 2;
  const ty = coverY + coverSize + 42;
  drawText(ctx, track.title, cx, ty, { size: 23, weight: 600, align: 'center', maxWidth: w - 44 });
  drawText(ctx, track.artist, cx, ty + 28, { size: 16, color: CONSOLE_COLORS.muted, align: 'center', maxWidth: w - 44 });
  if (waiting) {
    drawText(ctx, 'sound starts on your next tap', cx, ty + 52, { size: 12, color: CONSOLE_COLORS.faint, align: 'center' });
  }

  // Thin progress bar with times below the ends.
  const py = ty + 76;
  const sx = 30;
  const sw = w - 60;
  slider(ctx, null, 'seek', sx, py, sw, frac, { height: 5 });
  hits.add('seek', sx - 14, py - 18, sw + 28, 36, { x: sx, w: sw });
  drawText(ctx, formatTime(positionSec), sx, py + 26, { size: 13, color: CONSOLE_COLORS.muted });
  drawText(ctx, formatTime(durationSec), sx + sw, py + 26, { size: 13, color: CONSOLE_COLORS.muted, align: 'right' });

  audioDrawTransport(ctx, hits, cx, py + 96, false, st.playing);

  const nextTrack = AUDIO_TRACKS[(st.index + 1) % AUDIO_TRACKS.length];
  drawText(ctx, `Up next  ·  ${nextTrack.title} — ${nextTrack.artist}`, cx, rect.h - 20, {
    size: 13,
    color: CONSOLE_COLORS.faint,
    align: 'center',
    maxWidth: w - 40,
  });
}

function audioDrawApp(ctx, rect, env) {
  audioLoadPersisted();
  const st = audioPlayerState;
  const track = AUDIO_TRACKS[st.index];
  const el = st.el;

  ctx.fillStyle = CONSOLE_COLORS.screenBg;
  ctx.fillRect(0, 0, rect.w, rect.h);

  // Live position/duration each frame (cheap property reads).
  let durationSec = el && isFinite(el.duration) && el.duration > 0 ? el.duration : audioTrackDurations[track.id] || 0;
  let positionSec = el && isFinite(el.currentTime) ? el.currentTime : 0;
  let frac = durationSec > 0 ? clamp(positionSec / durationSec, 0, 1) : 0;
  if (env.state.drag && env.state.drag.kind === 'seek' && env.state.scrubFrac != null) {
    frac = env.state.scrubFrac;
    if (durationSec > 0) positionSec = frac * durationSec;
  }
  const waiting = st.playing && st.waitingForGesture;

  if (rect.compact || rect.w < 500) {
    audioDrawCompact(ctx, rect, env, track, positionSec, durationSec, frac, waiting);
  } else {
    audioDrawFull(ctx, rect, env, track, positionSec, durationSec, frac, waiting);
  }
}

function audioOnPointer(type, x, y, rect, env) {
  const ui = env.state;
  if (type === 'down') {
    const hit = env.hits.at(x, y);
    if (!hit) return false;
    if (hit.id === 'seek' && hit.data) {
      ui.drag = { kind: 'seek', x: hit.data.x, w: hit.data.w };
      ui.scrubFrac = clamp((x - hit.data.x) / hit.data.w, 0, 1);
      return true; // capture: scrub on move, commit on up
    }
    if (hit.id === 'vol' && hit.data) {
      ui.drag = { kind: 'vol', x: hit.data.x, w: hit.data.w };
      audioApplyVolumeLive((x - hit.data.x) / hit.data.w);
      return true; // capture: live volume on move, persist+emit on up
    }
    if (hit.id === 'toggle') {
      audioController.toggle();
      return false;
    }
    if (hit.id === 'prev') {
      audioController.prev();
      return false;
    }
    if (hit.id === 'next') {
      audioController.next();
      return false;
    }
    if (hit.id === 'track' && hit.data) {
      audioController.play(hit.data.index);
      return false;
    }
    return false;
  }
  if (!ui.drag) return false;
  const frac = clamp((x - ui.drag.x) / ui.drag.w, 0, 1);
  if (type === 'move') {
    if (ui.drag.kind === 'seek') ui.scrubFrac = frac;
    else audioApplyVolumeLive(frac);
    return true;
  }
  if (type === 'up') {
    if (ui.drag.kind === 'seek') {
      ui.scrubFrac = null;
      audioController.seek(frac);
    } else {
      audioController.volume(frac);
    }
    ui.drag = null;
    return true;
  }
  return false;
}

// --- App module --------------------------------------------------------------------
const AudioApp = {
  id: 'audio',
  label: 'Audio',
  drawIcon: iconAudio,

  init(consoleFacade) {
    audioPlayerState.console = consoleFacade || null;
    audioLoadPersisted();
  },

  draw(ctx, rect, env) {
    audioDrawApp(ctx, rect, env);
  },

  onPointer(type, x, y, rect, env) {
    return audioOnPointer(type, x, y, rect, env);
  },

  /** Engine master gain (AudioLevel × pause-mute), pushed by the console core. */
  onAudioGain(gain) {
    const st = audioPlayerState;
    st.gain = clamp(typeof gain === 'number' && isFinite(gain) ? gain : 1, 0, 1);
    if (st.el) {
      try {
        st.el.volume = audioEffectiveVolume();
      } catch (e) {
        // Ignore.
      }
    }
  },

  controller: audioController,
};


/* --- apps/PhoneApp.js --- */
/**
 * Phone app for the center console: a scrollable contact agenda with one-tap
 * outgoing calls, plus a full incoming-call flow (pulsing avatar, ringtone,
 * accept/reject, 30 s auto-miss) and an active-call screen showing the
 * caller's picture with a live duration timer.
 *
 * The call state machine is a module-level singleton so the programmatic
 * controller (PhoneApp.controller) keeps working while the pane is hidden;
 * only pure UI state (agenda scroll / drag tracking) lives in env.state.
 * Every transition emits a 'consolePhone' event with the status() shape.
 */




const PHONE_RING_TIMEOUT_MS = 30000;
const PHONE_TAP_SLOP_PX = 8;

// Module-level call state (survives pane switches; the controller mutates it
// even while the app is not visible).
const phoneStore = {
  phase: 'idle', // 'idle' | 'incoming' | 'active'
  caller: null, // { name, phone, hue? } | null
  callStartMs: 0,
  ringStartMs: 0,
  facade: null, // console facade stored in init()
  ringAudio: null, // lazily created HTMLAudioElement (false when unavailable)
  ringRetryArmed: false,
  missTimer: null,
  gain: 1, // engine master gain (AudioLevel × pause-mute), set by the core
};

const PHONE_RING_VOLUME = 0.35;

function phoneApplyRingVolume() {
  const audio = phoneStore.ringAudio;
  if (!audio) return;
  try {
    audio.volume = clamp(PHONE_RING_VOLUME * (typeof phoneStore.gain === 'number' ? phoneStore.gain : 1), 0, 1);
  } catch (e) {
    // ignore
  }
}

function phoneNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// --- Ringtone (lazy, best-effort: autoplay rejection retried once on the
// next user gesture, same pattern as the audio app) --------------------------

function phoneEnsureRingtone() {
  if (phoneStore.ringAudio !== null) return phoneStore.ringAudio;
  try {
    const audio = new Audio(PHONE_RINGTONE);
    audio.loop = true;
    phoneStore.ringAudio = audio;
    phoneApplyRingVolume();
  } catch (e) {
    phoneStore.ringAudio = false; // Audio unavailable; don't retry construction
  }
  return phoneStore.ringAudio;
}

function phonePlayRingtone() {
  const audio = phoneEnsureRingtone();
  if (!audio) return;
  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        if (phoneStore.ringRetryArmed || typeof window === 'undefined') return;
        phoneStore.ringRetryArmed = true;
        try {
          // Capture phase: the console core stopPropagation()s taps it
          // consumes, which would starve a bubble-phase retry (the user's
          // next tap is usually ON the console — e.g. the Accept button).
          window.addEventListener(
            'pointerdown',
            () => {
              phoneStore.ringRetryArmed = false;
              if (phoneStore.phase === 'incoming') phonePlayRingtone();
            },
            { once: true, capture: true }
          );
        } catch (e) {
          phoneStore.ringRetryArmed = false;
        }
      });
    }
  } catch (e) {
    // Ringtone is best-effort; the call flow must not break without sound.
  }
}

function phoneStopRingtone() {
  const audio = phoneStore.ringAudio;
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (e) {
    // ignore
  }
}

// --- State machine helpers ---------------------------------------------------

function phoneClearMissTimer() {
  if (phoneStore.missTimer != null) {
    try {
      clearTimeout(phoneStore.missTimer);
    } catch (e) {
      // ignore
    }
    phoneStore.missTimer = null;
  }
}

/**
 * Resolve a ring()/call() argument to a caller. Numbers index into
 * PHONE_CONTACTS, strings match by case-insensitive name substring, no
 * argument picks a random contact, anything unknown becomes a one-off caller.
 */
function phoneResolveContact(nameOrIndex) {
  if (typeof nameOrIndex === 'number' && isFinite(nameOrIndex)) {
    const i = Math.floor(nameOrIndex);
    if (i >= 0 && i < PHONE_CONTACTS.length) return PHONE_CONTACTS[i];
  } else if (nameOrIndex != null) {
    const q = String(nameOrIndex).trim().toLowerCase();
    for (let i = 0; i < PHONE_CONTACTS.length; i++) {
      if (PHONE_CONTACTS[i].name.toLowerCase().indexOf(q) !== -1) return PHONE_CONTACTS[i];
    }
  }
  if (nameOrIndex == null) {
    return PHONE_CONTACTS[Math.floor(Math.random() * PHONE_CONTACTS.length)];
  }
  return { name: String(nameOrIndex), phone: '' }; // one-off caller
}

function phoneStatus() {
  const now = phoneNow();
  return {
    phase: phoneStore.phase,
    caller: phoneStore.caller ? { name: phoneStore.caller.name, phone: phoneStore.caller.phone || '' } : null,
    callSec: phoneStore.phase === 'active' ? Math.max(0, Math.floor((now - phoneStore.callStartMs) / 1000)) : 0,
    ringSec: phoneStore.phase === 'incoming' ? Math.max(0, Math.floor((now - phoneStore.ringStartMs) / 1000)) : 0,
    contactCount: PHONE_CONTACTS.length,
  };
}

function phoneEmit(payloadOverride) {
  const facade = phoneStore.facade;
  if (!facade) return;
  try {
    facade.emit('consolePhone', payloadOverride || phoneStatus());
    if (facade.requestDraw) facade.requestDraw();
  } catch (e) {
    // The facade is best-effort; never let eventing break the call flow.
  }
}

function phoneOpenSelf() {
  if (!phoneStore.facade) return;
  try {
    phoneStore.facade.open('phone');
  } catch (e) {
    // ignore
  }
}

/** 30 s without an answer: back to idle, reported as a missed call. */
function phoneAutoMiss() {
  if (phoneStore.phase !== 'incoming') return;
  const missed = phoneStore.caller;
  const ringSec = Math.max(0, Math.floor((phoneNow() - phoneStore.ringStartMs) / 1000));
  phoneClearMissTimer();
  phoneStopRingtone();
  phoneStore.phase = 'idle';
  phoneStore.caller = null;
  const payload = phoneStatus();
  payload.phase = 'missed';
  payload.caller = missed ? { name: missed.name, phone: missed.phone || '' } : null;
  payload.ringSec = ringSec;
  phoneEmit(payload);
}

// --- Controller (programmatic API; works while the pane is hidden) -----------

const phoneController = {
  /** List the agenda as plain {name, phone} copies. */
  contacts() {
    return PHONE_CONTACTS.map((c) => ({ name: c.name, phone: c.phone }));
  },

  /** Trigger an incoming call; no argument picks a random contact. */
  ring(nameOrIndex) {
    if (phoneStore.phase === 'active') return phoneStatus(); // never drop a live call
    phoneClearMissTimer();
    phoneStore.caller = phoneResolveContact(nameOrIndex);
    phoneStore.phase = 'incoming';
    phoneStore.ringStartMs = phoneNow();
    phonePlayRingtone();
    phoneStore.missTimer = setTimeout(phoneAutoMiss, PHONE_RING_TIMEOUT_MS);
    phoneOpenSelf(); // surface the call even when another app is up
    phoneEmit();
    return phoneStatus();
  },

  accept() {
    if (phoneStore.phase !== 'incoming') return phoneStatus();
    phoneClearMissTimer();
    phoneStopRingtone();
    phoneStore.phase = 'active';
    phoneStore.callStartMs = phoneNow();
    phoneEmit();
    return phoneStatus();
  },

  reject() {
    if (phoneStore.phase !== 'incoming') return phoneStatus();
    phoneClearMissTimer();
    phoneStopRingtone();
    phoneStore.phase = 'idle';
    phoneStore.caller = null;
    phoneEmit();
    return phoneStatus();
  },

  /** End works for both phases: reject while ringing, hang up while active. */
  end() {
    if (phoneStore.phase === 'incoming') return phoneController.reject();
    if (phoneStore.phase !== 'active') return phoneStatus();
    phoneStopRingtone();
    phoneStore.phase = 'idle';
    phoneStore.caller = null;
    phoneEmit();
    return phoneStatus();
  },

  /** Outgoing call: goes directly to the active phase. */
  call(nameOrIndex) {
    if (phoneStore.phase === 'incoming') {
      phoneClearMissTimer();
      phoneStopRingtone();
    }
    phoneStore.caller = phoneResolveContact(nameOrIndex);
    phoneStore.phase = 'active';
    phoneStore.callStartMs = phoneNow();
    phoneOpenSelf();
    phoneEmit();
    return phoneStatus();
  },

  status() {
    return phoneStatus();
  },
};

// --- Drawing -----------------------------------------------------------------

/** Big circular action button (HitMap is rect-based; a padded square is fine). */
function phoneRoundButton(ctx, hits, id, cx, cy, r, bg, glyph, fg, label, compact) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  glyph(ctx, cx, cy, r * 0.92, fg);
  if (label) {
    drawText(ctx, label, cx, cy + r + (compact ? 20 : 26), {
      size: compact ? 14 : 16,
      color: CONSOLE_COLORS.muted,
      align: 'center',
    });
  }
  hits.add(id, cx - r - 8, cy - r - 8, r * 2 + 16, r * 2 + 16);
}

function phoneDrawIdle(ctx, rect, env) {
  const w = rect.w;
  const h = rect.h;
  const compact = !!rect.compact;
  const pad = compact ? 18 : 28;
  const headerH = compact ? 62 : 80;

  drawText(ctx, 'Phone', pad, headerH * 0.62, { size: compact ? 26 : 32, weight: 600 });
  drawText(ctx, PHONE_CONTACTS.length + ' contacts', w - pad, headerH * 0.62, {
    size: compact ? 15 : 18,
    color: CONSOLE_COLORS.muted,
    align: 'right',
  });
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(pad, headerH, w - pad * 2, 1);

  const listTop = headerH + (compact ? 6 : 10);
  const listBottom = h - (compact ? 8 : 12);
  const listH = listBottom - listTop;
  const rowH = compact ? 62 : 78;
  const contentH = PHONE_CONTACTS.length * rowH;
  const maxScroll = Math.max(0, contentH - listH);
  const st = env.state;
  st.scroll = clamp(st.scroll || 0, 0, maxScroll);
  st.maxScroll = maxScroll; // read back by onPointer while dragging

  // Whole list drags (registered first so rows/buttons win the hit test).
  env.hits.add('phoneList', 0, listTop, w, listH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, listTop, w, listH);
  ctx.clip();

  const showNumber = w >= 460;
  const avatarR = compact ? 19 : 22;
  const btnD = compact ? 50 : 56;
  const first = Math.max(0, Math.floor(st.scroll / rowH));
  const last = Math.min(PHONE_CONTACTS.length - 1, Math.ceil((st.scroll + listH) / rowH));
  for (let i = first; i <= last; i++) {
    const c = PHONE_CONTACTS[i];
    const rowY = listTop + i * rowH - st.scroll;
    const cy = rowY + rowH / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(pad, rowY + rowH - 1, w - pad * 2, 1);

    drawAvatar(ctx, pad + avatarR, cy, avatarR, c.name, c.hue);
    const textX = pad + avatarR * 2 + (compact ? 12 : 16);
    const btnX = w - pad - btnD / 2;
    const nameMaxW = btnX - btnD / 2 - 14 - textX;
    if (showNumber) {
      drawText(ctx, c.name, textX, cy - 5, { size: compact ? 19 : 22, maxWidth: nameMaxW });
      drawText(ctx, c.phone, textX, cy + 19, { size: compact ? 14 : 16, color: CONSOLE_COLORS.muted, maxWidth: nameMaxW });
    } else {
      drawText(ctx, c.name, textX, cy, { size: compact ? 19 : 22, baseline: 'middle', maxWidth: nameMaxW });
    }

    ctx.beginPath();
    ctx.arc(btnX, cy, btnD / 2, 0, Math.PI * 2);
    ctx.fillStyle = CONSOLE_COLORS.success;
    ctx.fill();
    iconPhoneUp(ctx, btnX, cy, btnD * 0.42, '#06240f');

    // Hit regions clipped to the visible list so half-scrolled rows don't
    // swallow taps on the header.
    const hy = Math.max(rowY, listTop);
    const hh = Math.min(rowY + rowH, listBottom) - hy;
    if (hh > 0) {
      env.hits.add('phoneRow', 0, hy, w, hh, { contact: i });
      const by = Math.max(cy - btnD / 2 - 4, listTop);
      const bh = Math.min(cy + btnD / 2 + 4, listBottom) - by;
      if (bh > 0) env.hits.add('phoneCall', btnX - btnD / 2 - 4, by, btnD + 8, bh, { contact: i });
    }
  }
  ctx.restore();

  if (maxScroll > 0) {
    const thumbH = Math.max(28, listH * (listH / contentH));
    const ty = listTop + (st.scroll / maxScroll) * (listH - thumbH);
    fillRoundRect(ctx, w - 6, ty, 3, thumbH, 1.5, 'rgba(255, 255, 255, 0.22)');
  }
}

function phoneDrawIncoming(ctx, rect, env) {
  // Backup for the miss timer (timers can be throttled in background tabs).
  if (env.now - phoneStore.ringStartMs > PHONE_RING_TIMEOUT_MS) {
    phoneAutoMiss();
    return;
  }
  const w = rect.w;
  const h = rect.h;
  const compact = !!rect.compact;
  const c = phoneStore.caller || { name: 'Unknown', phone: '' };
  const cx = w / 2;
  const avatarR = compact ? 62 : 90;
  const avatarY = compact ? h * 0.3 : h * 0.34;
  const t = Math.max(0, env.now - phoneStore.ringStartMs);

  // Slow concentric pulse rings expanding out of the avatar.
  ctx.save();
  ctx.strokeStyle = CONSOLE_COLORS.success;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 2; i++) {
    const p = (t / 1800 + i * 0.5) % 1;
    ctx.globalAlpha = (1 - p) * 0.4;
    ctx.beginPath();
    ctx.arc(cx, avatarY, avatarR + 6 + p * avatarR * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  drawAvatar(ctx, cx, avatarY, avatarR, c.name, c.hue);

  const nameY = avatarY + avatarR + (compact ? 42 : 56);
  drawText(ctx, c.name, cx, nameY, { size: compact ? 28 : 38, weight: 600, align: 'center', maxWidth: w - 48 });
  drawText(ctx, c.phone || 'Unknown number', cx, nameY + (compact ? 26 : 32), {
    size: compact ? 15 : 18,
    color: CONSOLE_COLORS.muted,
    align: 'center',
  });

  // 'Incoming call' with an animated ellipsis; the base text stays centred and
  // the dots grow to its right so the line doesn't jitter.
  const stateSize = compact ? 17 : 20;
  const stateY = nameY + (compact ? 54 : 68);
  ctx.font = font(stateSize, 400);
  const baseW = ctx.measureText('Incoming call').width;
  const dots = '.'.repeat(1 + (Math.floor(t / 450) % 3));
  drawText(ctx, 'Incoming call', cx, stateY, { size: stateSize, color: CONSOLE_COLORS.muted, align: 'center' });
  drawText(ctx, dots, cx + baseW / 2 + 3, stateY, { size: stateSize, color: CONSOLE_COLORS.muted });

  const btnR = compact ? 44 : 48; // >= 88 px diameter
  const btnY = h - (compact ? 96 : 118);
  const gap = compact ? 92 : 150;
  phoneRoundButton(ctx, env.hits, 'phoneReject', cx - gap, btnY, btnR, CONSOLE_COLORS.danger, iconPhoneDown, '#ffffff', 'Decline', compact);
  phoneRoundButton(ctx, env.hits, 'phoneAccept', cx + gap, btnY, btnR, CONSOLE_COLORS.success, iconPhoneUp, '#06240f', 'Accept', compact);
}

function phoneDrawActive(ctx, rect, env) {
  const w = rect.w;
  const h = rect.h;
  const compact = !!rect.compact;
  const c = phoneStore.caller || { name: 'Unknown', phone: '' };
  const cx = w / 2;
  const avatarR = compact ? 54 : 76;
  const avatarY = compact ? h * 0.28 : h * 0.32;

  drawAvatar(ctx, cx, avatarY, avatarR, c.name, c.hue);

  const nameY = avatarY + avatarR + (compact ? 38 : 50);
  drawText(ctx, c.name, cx, nameY, { size: compact ? 26 : 34, weight: 600, align: 'center', maxWidth: w - 48 });
  drawText(ctx, c.phone || 'Unknown number', cx, nameY + (compact ? 24 : 30), {
    size: compact ? 14 : 17,
    color: CONSOLE_COLORS.muted,
    align: 'center',
  });

  const callSec = Math.max(0, (env.now - phoneStore.callStartMs) / 1000);
  const timerY = nameY + (compact ? 62 : 82);
  drawText(ctx, formatTime(callSec), cx, timerY, { size: compact ? 30 : 40, align: 'center' });

  // Subtle 'connected' accent dot, gently breathing.
  const label = 'Connected';
  const labelSize = compact ? 13 : 15;
  ctx.font = font(labelSize, 400);
  const lw = ctx.measureText(label).width;
  const dotR = 4;
  const sx = cx - (dotR * 2 + 8 + lw) / 2;
  const ly = timerY + (compact ? 26 : 32);
  ctx.save();
  ctx.globalAlpha = 0.7 + 0.3 * Math.sin(env.now / 500);
  ctx.beginPath();
  ctx.arc(sx + dotR, ly - labelSize * 0.32, dotR, 0, Math.PI * 2);
  ctx.fillStyle = CONSOLE_COLORS.success;
  ctx.fill();
  ctx.restore();
  drawText(ctx, label, sx + dotR * 2 + 8, ly, { size: labelSize, color: CONSOLE_COLORS.muted });

  const btnR = compact ? 42 : 48;
  const btnY = h - (compact ? 92 : 114);
  phoneRoundButton(ctx, env.hits, 'phoneEnd', cx, btnY, btnR, CONSOLE_COLORS.danger, iconPhoneDown, '#ffffff', 'End call', compact);
}

// --- App object ----------------------------------------------------------------
const PhoneApp = {
  id: 'phone',
  label: 'Phone',
  drawIcon: iconPhone,

  init(consoleFacade) {
    this._console = consoleFacade || null;
    phoneStore.facade = consoleFacade || null;
  },

  /** Engine master gain (AudioLevel × pause-mute), pushed by the console core. */
  onAudioGain(gain) {
    phoneStore.gain = clamp(typeof gain === 'number' && isFinite(gain) ? gain : 1, 0, 1);
    phoneApplyRingVolume();
  },

  draw(ctx, rect, env) {
    ctx.fillStyle = CONSOLE_COLORS.screenBg;
    ctx.fillRect(0, 0, rect.w, rect.h);
    if (phoneStore.phase === 'incoming') phoneDrawIncoming(ctx, rect, env);
    else if (phoneStore.phase === 'active') phoneDrawActive(ctx, rect, env);
    else phoneDrawIdle(ctx, rect, env);
  },

  onPointer(type, x, y, rect, env) {
    if (phoneStore.phase === 'idle') {
      // Touch-list behavior: capture on down, scroll on move, and treat an
      // up with < PHONE_TAP_SLOP_PX total movement as a tap on the row.
      const st = env.state;
      if (type === 'down') {
        const hit = env.hits.at(x, y);
        if (!hit || (hit.id !== 'phoneList' && hit.id !== 'phoneRow' && hit.id !== 'phoneCall')) return false;
        st.drag = { lastX: x, lastY: y, moved: 0 };
        return true;
      }
      if (type === 'move' && st.drag) {
        const dy = y - st.drag.lastY;
        st.drag.moved += Math.abs(x - st.drag.lastX) + Math.abs(dy);
        st.drag.lastX = x;
        st.drag.lastY = y;
        st.scroll = clamp((st.scroll || 0) - dy, 0, st.maxScroll || 0);
        return true;
      }
      if (type === 'up' && st.drag) {
        const wasTap = st.drag.moved < PHONE_TAP_SLOP_PX;
        st.drag = null;
        if (wasTap) {
          const hit = env.hits.at(x, y);
          if (hit && hit.data && hit.data.contact != null) phoneController.call(hit.data.contact);
        }
        return true;
      }
      return false;
    }

    // In-call screens: act immediately on down for a car-touchscreen feel.
    if (type !== 'down') return false;
    const hit = env.hits.at(x, y);
    if (!hit) return false;
    if (phoneStore.phase === 'incoming') {
      if (hit.id === 'phoneAccept') phoneController.accept();
      else if (hit.id === 'phoneReject') phoneController.reject();
    } else if (phoneStore.phase === 'active') {
      if (hit.id === 'phoneEnd') phoneController.end();
    }
    return false;
  },

  controller: phoneController,
};


/* --- apps/ComfortApp.js --- */
/**
 * Comfort app: seat + climate controls for the center console. Three zones
 * (driver / passenger / rear), each with temperature, fan level and seat-heat
 * controls, plus AUTO and SYNC toggles. Zone state is a module-level singleton
 * persisted under CONSOLE_STORAGE.comfort so the programmatic controller
 * (PromptDrive.console) works even while the app is not visible; pure-UI state
 * (selected zone tab in the compact layout) lives in env.state. Every state
 * mutation emits a 'consoleComfort' event carrying the full nested snapshot.
 */




// Temperature readout gradient endpoints (cold -> hot).
const COMFORT_TEMP_COLD = '#4aa8e0';
const COMFORT_TEMP_HOT = '#e05a4a';
const COMFORT_BAR_OFF = 'rgba(255, 255, 255, 0.12)';

// --- State singleton (module level: controller works while app is hidden) -----

let comfortState = null; // lazily loaded { driver, passenger, rear, auto, sync }

function comfortCloneZone(z) {
  return { tempC: z.tempC, fan: z.fan, seatHeat: z.seatHeat };
}

function comfortClone(s) {
  return {
    driver: comfortCloneZone(s.driver),
    passenger: comfortCloneZone(s.passenger),
    rear: comfortCloneZone(s.rear),
    auto: !!s.auto,
    sync: !!s.sync,
  };
}

// Clamp helpers: temperature snaps to the UI's 0.5° grid, fan/seat to integers.
function comfortSnapTemp(v) {
  return clamp(Math.round(v * 2) / 2, COMFORT_LIMITS.tempMin, COMFORT_LIMITS.tempMax);
}

function comfortSnapFan(v) {
  return clamp(Math.round(v), 0, COMFORT_LIMITS.fanMax);
}

function comfortSnapSeat(v) {
  return clamp(Math.round(v), 0, COMFORT_LIMITS.seatHeatMax);
}

function comfortIsZoneId(id) {
  for (let i = 0; i < COMFORT_ZONES.length; i++) {
    if (COMFORT_ZONES[i].id === id) return true;
  }
  return false;
}

function comfortLoad() {
  if (comfortState) return comfortState;
  const data = comfortClone(COMFORT_DEFAULTS);
  try {
    const raw = localStorage.getItem(CONSOLE_STORAGE.comfort);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const zones = parsed.zones && typeof parsed.zones === 'object' ? parsed.zones : parsed;
        for (let i = 0; i < COMFORT_ZONES.length; i++) {
          const id = COMFORT_ZONES[i].id;
          const src = zones[id];
          if (src && typeof src === 'object') {
            if (typeof src.tempC === 'number' && isFinite(src.tempC)) data[id].tempC = comfortSnapTemp(src.tempC);
            if (typeof src.fan === 'number' && isFinite(src.fan)) data[id].fan = comfortSnapFan(src.fan);
            if (typeof src.seatHeat === 'number' && isFinite(src.seatHeat)) data[id].seatHeat = comfortSnapSeat(src.seatHeat);
          }
        }
        if ('auto' in parsed) data.auto = !!parsed.auto;
        if ('sync' in parsed) data.sync = !!parsed.sync;
      }
    }
  } catch (e) {
    // Corrupted or unavailable storage: fall back to defaults.
  }
  comfortState = data;
  return data;
}

function comfortSave() {
  if (!comfortState) return;
  try {
    localStorage.setItem(CONSOLE_STORAGE.comfort, JSON.stringify({
      zones: {
        driver: comfortState.driver,
        passenger: comfortState.passenger,
        rear: comfortState.rear,
      },
      auto: comfortState.auto,
      sync: comfortState.sync,
    }));
  } catch (e) {
    // localStorage may be unavailable (private mode); state stays in-memory.
  }
}

/** Copy driver tempC/fan (never seatHeat) to passenger + rear. Returns changed. */
function comfortCopyDriver(s) {
  let changed = false;
  const targets = [s.passenger, s.rear];
  for (let i = 0; i < targets.length; i++) {
    if (targets[i].tempC !== s.driver.tempC) { targets[i].tempC = s.driver.tempC; changed = true; }
    if (targets[i].fan !== s.driver.fan) { targets[i].fan = s.driver.fan; changed = true; }
  }
  return changed;
}

/** Persist + emit after a state mutation (never throws into callers). */
function comfortCommit() {
  comfortSave();
  const facade = comfortController._console;
  if (facade) {
    try {
      facade.emit('consoleComfort', comfortController.get());
      if (facade.requestDraw) facade.requestDraw();
    } catch (e) {
      // The facade must never break a state mutation.
    }
  }
}

// --- UI mutations (single taps; each commits + emits once) ---------------------

function comfortAdjustTemp(zoneId, delta) {
  const s = comfortLoad();
  const z = s[zoneId];
  if (!z) return;
  const next = comfortSnapTemp(z.tempC + delta);
  if (next === z.tempC) return;
  z.tempC = next;
  if (zoneId === 'driver' && s.sync) comfortCopyDriver(s);
  comfortCommit();
}

function comfortSetFan(zoneId, level) {
  const s = comfortLoad();
  const z = s[zoneId];
  if (!z) return;
  const next = comfortSnapFan(level);
  if (next === z.fan) return;
  z.fan = next;
  if (zoneId === 'driver' && s.sync) comfortCopyDriver(s);
  comfortCommit();
}

function comfortAdjustFan(zoneId, delta) {
  const s = comfortLoad();
  const z = s[zoneId];
  if (!z) return;
  comfortSetFan(zoneId, z.fan + delta);
}

function comfortCycleSeat(zoneId) {
  const s = comfortLoad();
  const z = s[zoneId];
  if (!z) return;
  z.seatHeat = (z.seatHeat + 1) % (COMFORT_LIMITS.seatHeatMax + 1);
  if (zoneId === 'driver' && s.sync) comfortCopyDriver(s);
  comfortCommit();
}

function comfortToggleFlag(key) {
  const s = comfortLoad();
  s[key] = !s[key];
  // Enabling sync aligns passenger/rear with the driver zone once, immediately.
  if (key === 'sync' && s.sync) comfortCopyDriver(s);
  comfortCommit();
}

// --- Controller (programmatic API; callable while the app is hidden) -----------

/** Validate one zone key into `changes`; returns an error result or null. */
function comfortStageZoneKey(changes, key, value) {
  if (key !== 'tempC' && key !== 'fan' && key !== 'seatHeat') {
    return { ok: false, error: 'unknown_key', key: key };
  }
  if (typeof value !== 'number' || !isFinite(value)) {
    return { ok: false, error: 'invalid_value', key: key };
  }
  if (key === 'tempC') changes.tempC = comfortSnapTemp(value);
  else if (key === 'fan') changes.fan = comfortSnapFan(value);
  else changes.seatHeat = comfortSnapSeat(value);
  return null;
}

const comfortController = {
  _console: null,

  /** Deep copy of the full comfort state. */
  get() {
    return comfortClone(comfortLoad());
  },

  /**
   * Apply a partial update. Accepts the nested shape
   * `{ driver: { tempC, fan, seatHeat }, ..., auto, sync }` or the flat
   * convenience `{ zone: 'driver', tempC, fan, seatHeat }`. Input is validated
   * before anything mutates: unknown keys/zones and non-numeric values return
   * an `{ ok: false, error }` result and leave state untouched. On success the
   * updated state (deep copy) is returned and 'consoleComfort' is emitted.
   */
  set(partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      return { ok: false, error: 'invalid_payload' };
    }
    const s = comfortLoad();
    const stagedZones = {};
    let stagedAuto = null;
    let stagedSync = null;

    if ('zone' in partial) {
      // Flat convenience shape.
      if (!comfortIsZoneId(partial.zone)) {
        return { ok: false, error: 'unknown_zone', zone: partial.zone };
      }
      const changes = {};
      const keys = Object.keys(partial);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === 'zone') continue;
        const err = comfortStageZoneKey(changes, keys[i], partial[keys[i]]);
        if (err) return err;
      }
      stagedZones[partial.zone] = changes;
    } else {
      // Nested shape.
      const keys = Object.keys(partial);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (comfortIsZoneId(k)) {
          const zonePartial = partial[k];
          if (!zonePartial || typeof zonePartial !== 'object' || Array.isArray(zonePartial)) {
            return { ok: false, error: 'invalid_value', key: k };
          }
          const changes = {};
          const zKeys = Object.keys(zonePartial);
          for (let j = 0; j < zKeys.length; j++) {
            const err = comfortStageZoneKey(changes, zKeys[j], zonePartial[zKeys[j]]);
            if (err) return err;
          }
          stagedZones[k] = changes;
        } else if (k === 'auto') {
          stagedAuto = !!partial.auto;
        } else if (k === 'sync') {
          stagedSync = !!partial.sync;
        } else {
          return { ok: false, error: 'unknown_key', key: k };
        }
      }
    }

    // Everything validated — apply atomically.
    const prevSync = !!s.sync;
    let touched = false;
    let driverTouched = false;
    if (stagedAuto !== null && stagedAuto !== s.auto) { s.auto = stagedAuto; touched = true; }
    if (stagedSync !== null && stagedSync !== s.sync) { s.sync = stagedSync; touched = true; }
    const zoneIds = Object.keys(stagedZones);
    for (let i = 0; i < zoneIds.length; i++) {
      const zid = zoneIds[i];
      const changes = stagedZones[zid];
      const cKeys = Object.keys(changes);
      for (let j = 0; j < cKeys.length; j++) {
        const k = cKeys[j];
        if (s[zid][k] !== changes[k]) {
          s[zid][k] = changes[k];
          touched = true;
          if (zid === 'driver') driverTouched = true;
        }
      }
    }
    const syncJustEnabled = !prevSync && s.sync;
    if (s.sync && (syncJustEnabled || driverTouched)) {
      if (comfortCopyDriver(s)) touched = true;
    }
    if (touched) comfortCommit();
    return comfortClone(s);
  },

  /** Restore COMFORT_DEFAULTS, persist and emit. Returns the new state. */
  reset() {
    comfortState = comfortClone(COMFORT_DEFAULTS);
    comfortCommit();
    return comfortClone(comfortState);
  },
};

// --- Drawing --------------------------------------------------------------------

/** Vertical heat wave (seat-heat level indicator), centred on (cx, cy). */
function comfortDrawHeatWave(ctx, cx, cy, h, color, lineWidth) {
  const a = h * 0.26;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.quadraticCurveTo(cx + a, cy - h / 4, cx, cy);
  ctx.quadraticCurveTo(cx - a, cy + h / 4, cx, cy + h / 2);
  ctx.stroke();
}

/**
 * One zone's stacked controls (temp / fan / seat heat) laid out in the given
 * box. Shared by the full-layout cards and the compact single-zone pane; at
 * narrow widths (< 300px) the fan -/+ buttons are dropped and the tappable
 * segment bars carry the interaction alone.
 */
function comfortDrawZoneControls(ctx, env, s, zoneId, x, y, w, h) {
  const zone = s[zoneId];
  if (!zone) return;
  const lim = COMFORT_LIMITS;
  const pad = clamp(Math.round(w * 0.05), 10, 20);

  // --- Temperature: big lerped readout flanked by -/+ buttons.
  const tcy = y + h * 0.18;
  const btnW = w < 300 ? 52 : 56;
  const btnH = 64;
  const atMin = zone.tempC <= lim.tempMin;
  const atMax = zone.tempC >= lim.tempMax;
  button(ctx, env.hits, 'cf:temp-:' + zoneId, x + pad, tcy - btnH / 2, btnW, btnH, {
    icon: iconMinus, kind: atMin ? 'ghost' : 'dark', iconSize: 26,
  });
  button(ctx, env.hits, 'cf:temp+:' + zoneId, x + w - pad - btnW, tcy - btnH / 2, btnW, btnH, {
    icon: iconPlus, kind: atMax ? 'ghost' : 'dark', iconSize: 26,
  });
  const tFrac = clamp((zone.tempC - lim.tempMin) / (lim.tempMax - lim.tempMin), 0, 1);
  const tColor = colorLerp(COMFORT_TEMP_COLD, COMFORT_TEMP_HOT, tFrac);
  drawText(ctx, zone.tempC.toFixed(1) + '°', x + w / 2, tcy, {
    size: Math.min(60, w * 0.19), weight: 600, color: tColor, align: 'center', baseline: 'middle',
  });
  // Slim range track under the readout.
  const trW = Math.min(w * 0.4, 170);
  const trX = x + w / 2 - trW / 2;
  const trY = y + h * 0.315;
  fillRoundRect(ctx, trX, trY, trW, 5, 2.5, COMFORT_BAR_OFF);
  if (tFrac > 0.01) fillRoundRect(ctx, trX, trY, trW * tFrac, 5, 2.5, tColor);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(x + pad, Math.round(y + h * 0.4), w - pad * 2, 1);

  // --- Fan: spinning glyph + 5 tappable segment bars (+ -/+ when roomy).
  drawText(ctx, 'FAN', x + pad, y + h * 0.4 + 26, { size: 14, weight: 600, color: CONSOLE_COLORS.faint });
  const fcy = y + h * 0.555;
  const showFanBtns = w >= 300;
  let fLeft = x + pad;
  let fRight = x + w - pad;
  if (showFanBtns) {
    button(ctx, env.hits, 'cf:fan-:' + zoneId, fLeft, fcy - 28, 52, 56, {
      icon: iconMinus, kind: zone.fan <= 0 ? 'ghost' : 'dark', iconSize: 22,
    });
    button(ctx, env.hits, 'cf:fan+:' + zoneId, fRight - 52, fcy - 28, 52, 56, {
      icon: iconPlus, kind: zone.fan >= lim.fanMax ? 'ghost' : 'dark', iconSize: 22,
    });
    fLeft += 66;
    fRight -= 66;
  }
  const fanColor = zone.fan > 0 ? CONSOLE_COLORS.accent : CONSOLE_COLORS.muted;
  const fanIconX = fLeft + 15;
  if (zone.fan > 0) {
    ctx.save();
    ctx.translate(fanIconX, fcy);
    ctx.rotate(((env.now || 0) / 1000) * (0.8 + zone.fan * 0.5) * Math.PI);
    iconFan(ctx, 0, 0, 30, fanColor);
    ctx.restore();
  } else {
    iconFan(ctx, fanIconX, fcy, 30, fanColor);
  }
  const segX0 = fanIconX + 29;
  const segGap = 6;
  const segW = (fRight - segX0 - segGap * (lim.fanMax - 1)) / lim.fanMax;
  const segMaxH = 38;
  const segMinH = 16;
  for (let i = 0; i < lim.fanMax; i++) {
    const sh = segMinH + (segMaxH - segMinH) * (i / (lim.fanMax - 1));
    const sx = segX0 + i * (segW + segGap);
    fillRoundRect(ctx, sx, fcy + segMaxH / 2 - sh, segW, sh, 3, zone.fan > i ? CONSOLE_COLORS.accent : COMFORT_BAR_OFF);
    env.hits.add('cf:seg:' + zoneId, sx - segGap / 2, fcy - 30, segW + segGap, 60, { level: i + 1 });
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(x + pad, Math.round(y + h * 0.7), w - pad * 2, 1);

  // --- Seat heat: seat glyph + 3 waves; a tap anywhere on the row cycles it.
  drawText(ctx, 'SEAT HEAT', x + pad, y + h * 0.7 + 26, { size: 14, weight: 600, color: CONSOLE_COLORS.faint });
  const scy = y + h * 0.845;
  const seatOn = zone.seatHeat > 0;
  iconComfort(ctx, x + pad + 20, scy, 38, seatOn ? CONSOLE_COLORS.warning : CONSOLE_COLORS.muted);
  for (let i = 0; i < lim.seatHeatMax; i++) {
    comfortDrawHeatWave(ctx, x + pad + 56 + i * 24, scy, 34, zone.seatHeat > i ? CONSOLE_COLORS.warning : COMFORT_BAR_OFF, 3.5);
  }
  drawText(ctx, seatOn ? 'LVL ' + zone.seatHeat : 'OFF', x + w - pad, scy, {
    size: 18, color: seatOn ? CONSOLE_COLORS.warning : CONSOLE_COLORS.faint, align: 'right', baseline: 'middle',
  });
  env.hits.add('cf:seat:' + zoneId, x + pad - 6, scy - 32, w - pad * 2 + 12, 64);
}

/** Full / split-primary layout: three zone cards + AUTO/SYNC footer pills. */
function comfortDrawFull(ctx, rect, env) {
  const s = comfortLoad();
  const pad = 24;
  const gap = 18;
  const pillH = 56;
  const cardY = pad;
  const cardH = rect.h - pad * 2 - pillH - gap;
  const cardW = (rect.w - pad * 2 - gap * 2) / 3;
  for (let i = 0; i < COMFORT_ZONES.length; i++) {
    const z = COMFORT_ZONES[i];
    const cx = pad + i * (cardW + gap);
    fillRoundRect(ctx, cx, cardY, cardW, cardH, 18, CONSOLE_COLORS.panel);
    drawText(ctx, z.label.toUpperCase(), cx + cardW / 2, cardY + 40, {
      size: 20, weight: 600, color: CONSOLE_COLORS.muted, align: 'center',
    });
    if (s.sync && z.id !== 'driver') {
      drawText(ctx, 'SYNCED', cx + cardW / 2, cardY + 62, { size: 13, color: CONSOLE_COLORS.accent, align: 'center' });
    }
    comfortDrawZoneControls(ctx, env, s, z.id, cx + 10, cardY + 70, cardW - 20, cardH - 84);
  }
  const pillW = Math.min(210, (rect.w - pad * 2 - gap) / 2);
  const pillY = rect.h - pad - pillH;
  drawText(ctx, 'CLIMATE', pad, pillY + pillH / 2, { size: 17, color: CONSOLE_COLORS.faint, baseline: 'middle' });
  button(ctx, env.hits, 'cf:auto', rect.w / 2 - pillW - gap / 2, pillY, pillW, pillH, {
    label: 'AUTO', active: !!s.auto, textSize: 19,
  });
  button(ctx, env.hits, 'cf:sync', rect.w / 2 + gap / 2, pillY, pillW, pillH, {
    label: 'SYNC', active: !!s.sync, textSize: 19,
  });
}

/** Compact (split-secondary) layout: zone tabs, one stacked zone, footer pills. */
function comfortDrawCompact(ctx, rect, env) {
  const s = comfortLoad();
  const pad = 16;
  const gap = 10;
  const tabH = 56;
  const pillH = 56;
  if (!env.state.zone || !s[env.state.zone]) env.state.zone = 'driver';
  const zoneId = env.state.zone;
  const tabW = (rect.w - pad * 2 - gap * 2) / 3;
  for (let i = 0; i < COMFORT_ZONES.length; i++) {
    const z = COMFORT_ZONES[i];
    button(ctx, env.hits, 'cf:tab:' + z.id, pad + i * (tabW + gap), pad, tabW, tabH, {
      label: z.label, active: z.id === zoneId, textSize: 16,
    });
  }
  const boxY = pad + tabH + 12;
  const boxH = rect.h - boxY - pad - pillH - 12;
  fillRoundRect(ctx, pad, boxY, rect.w - pad * 2, boxH, 16, CONSOLE_COLORS.panel);
  if (s.sync && zoneId !== 'driver') {
    drawText(ctx, 'SYNCED TO DRIVER', rect.w / 2, boxY + 24, { size: 13, color: CONSOLE_COLORS.accent, align: 'center' });
  }
  comfortDrawZoneControls(ctx, env, s, zoneId, pad + 12, boxY + 14, rect.w - pad * 2 - 24, boxH - 26);
  const pillW = (rect.w - pad * 2 - gap) / 2;
  const pillY = rect.h - pad - pillH;
  button(ctx, env.hits, 'cf:auto', pad, pillY, pillW, pillH, { label: 'AUTO', active: !!s.auto, textSize: 18 });
  button(ctx, env.hits, 'cf:sync', pad + pillW + gap, pillY, pillW, pillH, { label: 'SYNC', active: !!s.sync, textSize: 18 });
}

// --- App object -------------------------------------------------------------------
const ComfortApp = {
  id: 'comfort',
  label: 'Comfort',
  drawIcon: iconComfort,

  init(consoleFacade) {
    comfortController._console = consoleFacade;
  },

  draw(ctx, rect, env) {
    if (rect.compact) comfortDrawCompact(ctx, rect, env);
    else comfortDrawFull(ctx, rect, env);
  },

  onPointer(type, x, y, rect, env) {
    if (type !== 'down') return false;
    const hit = env.hits.at(x, y);
    if (!hit || typeof hit.id !== 'string' || hit.id.slice(0, 3) !== 'cf:') return false;
    const parts = hit.id.split(':');
    const action = parts[1];
    const zoneId = parts[2];
    switch (action) {
      case 'tab': env.state.zone = zoneId; break;
      case 'temp-': comfortAdjustTemp(zoneId, -0.5); break;
      case 'temp+': comfortAdjustTemp(zoneId, 0.5); break;
      case 'fan-': comfortAdjustFan(zoneId, -1); break;
      case 'fan+': comfortAdjustFan(zoneId, 1); break;
      case 'seg': {
        const level = hit.data && hit.data.level ? hit.data.level : 1;
        const zone = comfortLoad()[zoneId];
        // Tapping the currently-set segment steps it off; any other sets it.
        if (zone) comfortSetFan(zoneId, level === zone.fan ? level - 1 : level);
        break;
      }
      case 'seat': comfortCycleSeat(zoneId); break;
      case 'auto': comfortToggleFlag('auto'); break;
      case 'sync': comfortToggleFlag('sync'); break;
      default: return false;
    }
    if (env.console && env.console.requestDraw) env.console.requestDraw();
    return false;
  },

  controller: comfortController,
};


/* --- CenterConsole.js --- */
/**
 * Center console (center stack): a 16:9 touchscreen with a tight black rim,
 * mounted on the lateral center of the dashboard in the in-cabin view.
 *
 * Follows the InstrumentCluster pattern: a 2D canvas drawn ~30 Hz becomes a
 * CanvasTexture on a plane mesh inside the ego group (`Ae.geo`), gated on the
 * first-person observable. The engine creates one instance in the controller's
 * initialise (see the `CenterConsole` patches in scripts/build-main.js) and
 * calls `frame(Ae.geo, Js.value)` from updateUI.
 *
 * Interaction comes from two sides:
 *  - pointer events on the game canvas, hand-raycast onto the screen plane
 *    (this THREE build has no Raycaster — we unproject + intersect ourselves);
 *  - the integration API (`PromptDrive.console.*`), which drives the same app
 *    controllers and can synthesize taps via `tap(u, v)`.
 */









// The full-width dashboard surface is part of this mesh in the Roadster body
// OBJ (roadster-07-int); coords below are body-OBJ-local (+X forward, +Y up,
// +Z vehicle right). The dash top's rear edge sits at (x 1.9242, y 0.8672),
// laterally centred at z ≈ 0. The console is a tablet-style display standing
// on that edge, leaning back slightly toward the windscreen — low enough not
// to block the road, high enough that the whole screen (including the icon
// dock on its lower side) stays inside the first-person camera's view.
const INTERIOR_MESH = 'z_interior_Cube.008';
const MOUNT = {
  base: { x: 1.9242, y: 0.8672 }, // dash-top rear edge (screen bottom sits here)
  tilt: 0.21, // rad, lean-back from vertical (top toward the windscreen)
  sink: 0.008, // metres the rim bottom sinks into the dash (seated look)
};

// Match the binnacle/dash render order (2); rim just behind the screen.
const CONSOLE_RENDER_ORDER = 2;

// --- minified-THREE constructor discovery (cluster idiom) -------------------

function ccFindMaterial(THREE) {
  if (THREE.MeshBasicMaterial) return THREE.MeshBasicMaterial;
  if (THREE.C) return THREE.C;
  return null;
}

function ccFindPlaneGeometry(THREE) {
  if (THREE.PlaneGeometry) return THREE.PlaneGeometry;
  if (THREE.J) return THREE.J;
  return null;
}

function ccFindBufferGeometry(THREE) {
  if (THREE.BufferGeometry) return THREE.BufferGeometry;
  for (const k of Object.keys(THREE)) {
    const p = THREE[k] && THREE[k].prototype;
    if (p && typeof p.setAttribute === 'function' && typeof p.setIndex === 'function') return THREE[k];
  }
  return null;
}

function ccFindBufferAttribute(THREE) {
  if (THREE.BufferAttribute) return THREE.BufferAttribute;
  for (const k of Object.keys(THREE)) {
    const p = THREE[k] && THREE[k].prototype;
    if (p && typeof p.setXYZ === 'function') return THREE[k];
  }
  return null;
}

function ccFindVector3(THREE) {
  if (THREE.Vector3) return THREE.Vector3;
  if (THREE.W) return THREE.W;
  for (const k of Object.keys(THREE)) {
    const p = THREE[k] && THREE[k].prototype;
    if (p && typeof p.setFromMatrixPosition === 'function' && typeof p.unproject === 'function') return THREE[k];
  }
  return null;
}

function ccFindMeshCtor(root, THREE) {
  // Prefer a real Mesh from the scene (THREE.u is InstancedMesh in this build).
  let ctor = null;
  root?.traverse?.((child) => {
    if (!ctor && child?.isMesh) ctor = child.constructor;
  });
  return ctor || THREE.B || THREE.Mesh;
}

const CC_BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function ccCreateCanvasTexture(THREE, canvas) {
  if (THREE.CanvasTexture) return new THREE.CanvasTexture(canvas);
  for (const key of Object.keys(THREE)) {
    const val = THREE[key];
    if (typeof val === 'function' && val.prototype?.isTexture) {
      const tex = new val(canvas);
      tex.image = canvas;
      return tex;
    }
  }
  // Tree-shaken build: recover the Texture ctor through a TextureLoader, the
  // same way the instrument cluster does.
  const LoaderCtor = THREE.U || THREE.TextureLoader;
  if (LoaderCtor) {
    const tempTex = new LoaderCtor().load(CC_BLANK_PIXEL);
    const TextureCtor = tempTex.constructor;
    const texture = new TextureCtor(canvas);
    texture.image = canvas;
    tempTex.dispose();
    return texture;
  }
  throw new Error('CenterConsole: THREE.Texture constructor not found');
}

// Rounded-rectangle outline (counter-clockwise) for the rim prism.
function ccRoundedRectOutline(w, h, r, seg = 5) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(hw - rr, hh - rr, 0);
  corner(-hw + rr, hh - rr, Math.PI / 2);
  corner(-hw + rr, -hh + rr, Math.PI);
  corner(hw - rr, -hh + rr, Math.PI * 1.5);
  return pts;
}

// Extrude a 2D outline into a prism (front/back fans + walls), like the
// cluster pod. Double-sided material, so winding is unimportant.
function ccBuildPrism(THREE, outline, depth) {
  const BufGeo = ccFindBufferGeometry(THREE);
  const BufAttr = ccFindBufferAttribute(THREE);
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
    idx.push(0, FR + i, FR + j);
    idx.push(1, BR + j, BR + i);
    idx.push(FR + i, FR + j, BR + j);
    idx.push(FR + i, BR + j, BR + i);
  }
  const g = new BufGeo();
  g.setAttribute('position', new BufAttr(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
class CenterConsole {
  constructor(THREE) {
    this.THREE = THREE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONSOLE_CANVAS.width;
    this.canvas.height = CONSOLE_CANVAS.height;
    this.ctx = this.canvas.getContext('2d');

    const MaterialCtor = ccFindMaterial(THREE);
    if (!MaterialCtor) throw new Error('CenterConsole: MeshBasicMaterial not found');
    this.texture = ccCreateCanvasTexture(THREE, this.canvas);
    this.texture.generateMipmaps = false;
    if (THREE.LinearFilter !== undefined) {
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
    }
    this.material = new MaterialCtor({
      map: this.texture,
      side: THREE.DoubleSide ?? 2,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.rimMaterial = new MaterialCtor({
      color: RIM.color,
      side: THREE.DoubleSide ?? 2,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });

    this.screenMesh = null;
    this.rimMesh = null;
    this._overlayParent = null;
    this._active = false;
    this._data = this._emptyData();

    // Apps: dock order matches APP_ORDER.
    this.apps = { map: MapApp, nav: NavApp, audio: AudioApp, phone: PhoneApp, comfort: ComfortApp };
    this._env = {};
    for (const id of APP_ORDER) {
      this._env[id] = { state: {}, hits: new HitMap(), data: this._data, now: 0, console: null };
    }
    this._dockHits = new HitMap();

    // Status-strip overlays (Cabina Abierta seam): drawers that paint into a
    // band reserved at the top of the screen, above the app panes. Each entry
    // is { id, height, draw(ctx, rect, now, data) }; the band is as tall as the
    // tallest registered overlay and disappears when none is registered.
    this._overlays = [];

    // Layout: fullscreen primary, or 2/3 + 1/3 split.
    this.layout = this._loadLayout();

    // Pointer capture: { appId, role } while an app holds a drag.
    this._capture = null;
    this._pointerArmed = false;

    // Facade handed to apps (and used by the API namespace).
    const facade = {
      open: (id) => this.open(id),
      split: (a, b) => this.split(a, b),
      layout: () => Object.assign({}, this.layout),
      emit: (name, payload) => this._emit(name, payload),
      requestDraw: () => this._requestDraw(),
      registerOverlay: (spec) => this.registerOverlay(spec),
      unregisterOverlay: (id) => this.unregisterOverlay(id),
    };
    this._facade = facade;
    for (const id of APP_ORDER) {
      this._env[id].console = facade;
      try { this.apps[id].init?.(facade); } catch (e) { console.error('CenterConsole app init failed', id, e); }
    }

    this._inputLocked = false; // benchmark mode: swallow screen taps, no routing
    this._ensureFonts();
    this._armPointer();
    this._wireEngineAudio();
    CenterConsole.lastInstance = this;
    this.draw(); // first paint so the texture is never black
  }

  /**
   * The console's HTMLAudio elements (music, ringtone) live outside the
   * engine's WebAudio graph, so they must mirror the master volume (KeyM
   * mute = AudioLevel 0) and the pause/blur auto-mute themselves. The core
   * computes one gain and pushes it to every app exposing onAudioGain(gain).
   */
  _wireEngineAudio() {
    const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
    if (!b || typeof b.whenAttached !== 'function') return;
    b.whenAttached((h) => {
      const push = () => {
        let gain = 1;
        try {
          const paused = !!(h.ticker && (h.ticker.paused || h.ticker.blurred));
          const level = (h.units && typeof h.units.AudioLevel === 'number') ? h.units.AudioLevel : 1;
          gain = paused ? 0 : level;
        } catch (_e) {}
        for (const id of APP_ORDER) {
          const app = this.apps[id];
          if (app && typeof app.onAudioGain === 'function') {
            try { app.onAudioGain(gain); } catch (_e) {}
          }
        }
      };
      try { h.units && h.units.addListener && h.units.addListener('AudioLevel', push); } catch (_e) {}
      try { h.ticker && h.ticker.addStateListener && h.ticker.addStateListener(push); } catch (_e) {}
      try { h.ticker && h.ticker.addBlurListener && h.ticker.addBlurListener(push); } catch (_e) {}
      push();
    });
  }

  _emptyData() {
    return {
      speedKph: 0, speedDisplay: 0, speedUnit: 'KPH', heading: 0,
      egoX: 0, egoZ: 0, autodrive: false, paused: false,
      clock: new Date(), handles: null, lanes: null, laneApplied: null, traffic: null,
    };
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

  // --- layout state ----------------------------------------------------------

  _loadLayout() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CONSOLE_STORAGE.ui) || 'null'); } catch (_e) {}
    const ok = (id) => APP_ORDER.indexOf(id) >= 0;
    const layout = {
      mode: saved && saved.mode === 'split' ? 'split' : 'full',
      primary: saved && ok(saved.primary) ? saved.primary : 'map',
      secondary: saved && ok(saved.secondary) ? saved.secondary : 'audio',
    };
    if (layout.secondary === layout.primary) layout.secondary = layout.primary === 'audio' ? 'map' : 'audio';
    return layout;
  }

  _saveLayout() {
    try { localStorage.setItem(CONSOLE_STORAGE.ui, JSON.stringify(this.layout)); } catch (_e) {}
  }

  _layoutChanged() {
    this._saveLayout();
    this._emit('consoleLayout', Object.assign({}, this.layout));
    this._requestDraw();
  }

  /**
   * Coalesced out-of-band redraw, for state changes that happen outside the
   * engine's updateUI tick (API calls, taps while the sim is paused). The
   * renderer only presents the texture on the next rendered frame, but this
   * keeps the canvas current so resume/screenshot never shows stale UI.
   */
  _requestDraw() {
    if (this._drawQueued) return;
    this._drawQueued = true;
    setTimeout(() => {
      this._drawQueued = false;
      try { this.draw(); } catch (_e) {}
    }, 0);
  }

  /** Bring an app to the primary pane (kept in the current full/split mode). */
  open(id) {
    if (APP_ORDER.indexOf(id) < 0) return { ok: false, error: 'unknown_app', app: id };
    if (this.layout.primary !== id) {
      if (this.layout.mode === 'split') {
        // The old primary steps aside into the 1/3 pane.
        this.layout.secondary = this.layout.primary === id ? this.layout.secondary : this.layout.primary;
      }
      this.layout.primary = id;
      if (this.layout.secondary === id) this.layout.secondary = null;
      if (this.layout.mode === 'split' && !this.layout.secondary) this.layout.mode = 'full';
      this._layoutChanged();
    }
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  /** Split view: primary takes 2/3, secondary 1/3. */
  split(primary, secondary) {
    const p = primary || this.layout.primary;
    if (APP_ORDER.indexOf(p) < 0) return { ok: false, error: 'unknown_app', app: p };
    let s = secondary || (this.layout.secondary !== p ? this.layout.secondary : null) ||
      (this.layout.primary !== p ? this.layout.primary : null) ||
      APP_ORDER.find((a) => a !== p);
    if (APP_ORDER.indexOf(s) < 0) return { ok: false, error: 'unknown_app', app: s };
    if (s === p) return { ok: false, error: 'bad_value', message: 'primary and secondary must differ' };
    this.layout.mode = 'split';
    this.layout.primary = p;
    this.layout.secondary = s;
    this._layoutChanged();
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  setLayoutMode(mode) {
    if (mode !== 'full' && mode !== 'split') return { ok: false, error: 'bad_value', message: "mode must be 'full' or 'split'" };
    if (mode === 'split') return this.split(this.layout.primary, this.layout.secondary);
    this.layout.mode = 'full';
    this._layoutChanged();
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  swap() {
    if (this.layout.mode !== 'split' || !this.layout.secondary) return { ok: false, error: 'not_split' };
    const p = this.layout.primary;
    this.layout.primary = this.layout.secondary;
    this.layout.secondary = p;
    this._layoutChanged();
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  /** Pane rectangles in canvas px. Secondary reserves a small swap header. */
  // --- status-strip overlays (feedback seam) ----------------------------------

  /**
   * Register a drawer for the status strip at the top of the screen.
   * spec: { id: string, height: number (px, canvas space, default 56),
   *         draw(ctx, rect, now, data) } — `rect` is { x, y, w, h } in canvas
   * coordinates (not translated); `data` is the console's refreshed data.
   * Returns an unregister function. Overlays only draw; they never receive
   * pointer events (taps on the strip are swallowed like empty screen).
   */
  registerOverlay(spec) {
    if (!spec || typeof spec.id !== 'string' || typeof spec.draw !== 'function') return () => {};
    this.unregisterOverlay(spec.id);
    this._overlays.push({ id: spec.id, height: Math.max(0, spec.height || 56), draw: spec.draw });
    this._requestDraw();
    return () => this.unregisterOverlay(spec.id);
  }

  unregisterOverlay(id) {
    const i = this._overlays.findIndex((o) => o.id === id);
    if (i >= 0) { this._overlays.splice(i, 1); this._requestDraw(); }
  }

  _overlayHeight() {
    let h = 0;
    for (const o of this._overlays) if (o.height > h) h = o.height;
    return h;
  }

  _drawOverlays(now) {
    const h = this._overlayHeight();
    if (!h) return;
    const ctx = this.ctx;
    const rect = { x: 0, y: 0, w: this.canvas.width, h };
    for (const o of this._overlays) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      try { o.draw(ctx, rect, now, this._data); }
      catch (e) { if (!o._errorLogged) { o._errorLogged = true; console.error('CenterConsole overlay draw failed', o.id, e); } }
      ctx.restore();
    }
  }

  _paneRects() {
    const W = this.canvas.width;
    const top = this._overlayHeight();
    const contentH = this.canvas.height - DOCK.height - top;
    if (this.layout.mode !== 'split' || !this.layout.secondary) {
      return { primary: { x: 0, y: top, w: W, h: contentH }, secondary: null, header: null };
    }
    const pw = Math.round(W * SPLIT.primaryFrac) - SPLIT.divider;
    const sx = pw + SPLIT.divider * 2;
    const headerH = 36;
    return {
      primary: { x: 0, y: top, w: pw, h: contentH },
      header: { x: sx, y: top, w: W - sx, h: headerH },
      secondary: { x: sx, y: top + headerH, w: W - sx, h: contentH - headerH },
    };
  }

  // --- engine integration -----------------------------------------------------

  /**
   * Whether the console is turned on in the vehicle settings
   * (`VehicleConfig.showConsole`, the "Interior: Show center console" toggle).
   * Defaults to on when the handle isn't available yet. When off, the console
   * never renders and the API rejects console calls.
   */
  enabled() {
    const h = this._handles();
    try {
      if (h && h.vehicleConfig && h.vehicleConfig.value) {
        return h.vehicleConfig.value.showConsole !== false;
      }
    } catch (_e) {}
    return true;
  }

  /** Per-tick entry point (patched into updateUI): attach/show + redraw. */
  frame(root, active) {
    // Gate on the vehicle-config toggle as well as the cabin view, so turning
    // the console off in settings removes it even in first-person.
    const show = !!active && this.enabled();
    this.applyToObject(root, show);
    if (!this._active || !this.screenMesh) return;
    this._refreshData();
    this.draw();
  }

  /** Attach the screen+rim into the vehicle group; toggle with the cabin view. */
  applyToObject(root, active) {
    this._active = !!active;
    if (!this._active && this._capture) {
      // Leaving the cabin view mid-drag: close out the gesture so the app
      // isn't left waiting for an 'up' that can never arrive.
      const last = this._lastDragPt;
      this._routePoint('up', last ? last.x : -1, last ? last.y : -1);
      this._capture = null;
      this._lastDragPt = null;
    }
    if (!root) return null;
    if (active && !this._ensureMeshes(root)) return null;
    if (this.screenMesh) this.screenMesh.visible = this._active && this.screenMesh.parent != null;
    if (this.rimMesh) this.rimMesh.visible = this._active && this.rimMesh.parent != null;
    return this.screenMesh;
  }

  /** Called by the engine patch before Ae.geo is purged on a vehicle change. */
  resetForVehicleChange() {
    this._removeMeshes();
  }

  _findAnchor(root) {
    let mesh = null;
    root?.traverse?.((child) => {
      if (!mesh && child?.isMesh && child.name === INTERIOR_MESH) mesh = child;
    });
    return mesh && mesh.parent ? { mesh, parent: mesh.parent } : null;
  }

  _ensureMeshes(root) {
    const anchor = this._findAnchor(root);
    if (!anchor) return false;
    if (this.screenMesh && this.screenMesh.parent === anchor.parent) return true;
    this._removeMeshes();

    const THREE = this.THREE;
    const PlaneGeo = ccFindPlaneGeometry(THREE);
    const MeshCtor = ccFindMeshCtor(root, THREE);
    if (!PlaneGeo || !MeshCtor) return false;

    // Placement: display standing on the dash-top rear edge, tilted back.
    // The plane's up direction after rotation is (sin tilt, cos tilt, 0), and
    // its normal (-cos tilt, +sin tilt, 0) — facing the cabin, slightly up.
    const tilt = MOUNT.tilt;
    const rimH = SCREEN_PLANE.height + RIM.bezel * 2;
    const rimW = SCREEN_PLANE.width + RIM.bezel * 2;
    const lift = rimH / 2 - MOUNT.sink;
    const mid = {
      x: MOUNT.base.x + Math.sin(tilt) * lift,
      y: MOUNT.base.y + Math.cos(tilt) * lift,
    };
    const nx = -Math.cos(tilt); // screen normal (rearward, toward the driver)
    const ny = Math.sin(tilt);
    let zc = 0;
    try {
      anchor.mesh.geometry.computeBoundingBox();
      const bb = anchor.mesh.geometry.boundingBox;
      zc = (bb.min.z + bb.max.z) / 2; // lateral center of the cabin (~0)
    } catch (_e) {}

    // Rim: rounded-rect prism tightly framing the screen — the tablet body.
    const rimGeo = ccBuildPrism(THREE, ccRoundedRectOutline(rimW, rimH, RIM.cornerRadius), RIM.depth) ||
      new PlaneGeo(rimW, rimH);
    const rim = new MeshCtor(rimGeo, this.rimMaterial);
    rim.name = 'center_console_rim';
    rim.rotation.order = 'YXZ';
    rim.rotation.set(-tilt, -Math.PI / 2, 0);
    rim.position.set(mid.x - nx * 0.002, mid.y - ny * 0.002, zc);
    rim.frustumCulled = false;
    rim.renderOrder = CONSOLE_RENDER_ORDER - 1;
    anchor.parent.add(rim);
    this.rimMesh = rim;

    const screen = new MeshCtor(new PlaneGeo(SCREEN_PLANE.width, SCREEN_PLANE.height), this.material);
    screen.name = 'center_console_screen';
    screen.rotation.order = 'YXZ';
    screen.rotation.set(-tilt, -Math.PI / 2, 0);
    screen.position.set(mid.x + nx * 0.003, mid.y + ny * 0.003, zc);
    screen.frustumCulled = false;
    screen.renderOrder = CONSOLE_RENDER_ORDER;
    anchor.parent.add(screen);
    this.screenMesh = screen;
    this._overlayParent = anchor.parent;
    return true;
  }

  _removeMeshes() {
    if (this.rimMesh) {
      this.rimMesh.parent?.remove(this.rimMesh);
      this.rimMesh.geometry?.dispose();
      this.rimMesh = null;
    }
    if (this.screenMesh) {
      this.screenMesh.parent?.remove(this.screenMesh);
      this.screenMesh.geometry?.dispose();
      this.screenMesh = null;
    }
    this._overlayParent = null;
  }

  _handles() {
    const b = typeof window !== 'undefined' ? window.PromptDriveBridge : null;
    return (b && b.handles) || null;
  }

  _refreshData() {
    const d = this._data;
    const h = this._handles();
    d.handles = h;
    d.clock = new Date();
    if (h && h.ego) {
      const units = h.units && h.units.Units;
      const factor = units === 1 ? 3.59999 : 2.23694;
      d.speedKph = (h.ego.speed || 0) * 3.6;
      d.speedDisplay = Math.max(0, (h.ego.speed || 0) * factor);
      d.speedUnit = units === 1 ? 'KPH' : 'MPH';
      d.heading = h.ego.heading || 0;
      d.egoX = h.ego.position ? h.ego.position.x : 0;
      d.egoZ = h.ego.position ? h.ego.position.z : 0;
      d.autodrive = !!(h.autodrive && h.autodrive.value);
      d.paused = !!(h.ticker && h.ticker.paused);
    }
    try {
      d.lanes = (typeof window !== 'undefined' && window.LaneRoads) ? window.LaneRoads._resolved : null;
      d.laneApplied = (typeof window !== 'undefined' && window.LaneRoads && window.LaneRoads.applied) ? window.LaneRoads.applied() : null;
    } catch (_e) { d.lanes = null; }
    try {
      d.traffic = (typeof window !== 'undefined' && window.RoadTraffic && window.RoadTraffic._engineAttached)
        ? window.RoadTraffic._manager : null;
    } catch (_e) { d.traffic = null; }
  }

  _emit(name, payload) {
    try {
      if (typeof window !== 'undefined' && window.PromptDriveBridge) {
        window.PromptDriveBridge.emit(name, payload);
      }
    } catch (_e) { /* best-effort */ }
  }

  // --- drawing ----------------------------------------------------------------

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    ctx.fillStyle = CONSOLE_COLORS.screenBg;
    ctx.fillRect(0, 0, W, H);

    const rects = this._paneRects();
    this._drawPane(this.layout.primary, rects.primary, now);
    if (rects.secondary) {
      // Divider + secondary header (label + swap affordance), owned by the core.
      ctx.fillStyle = CONSOLE_COLORS.divider;
      ctx.fillRect(rects.primary.w, rects.primary.y, rects.secondary.x - rects.primary.w, H - DOCK.height - rects.primary.y);
      this._drawSecondaryHeader(rects.header, now);
      this._drawPane(this.layout.secondary, rects.secondary, now);
    }
    this._drawOverlays(now);
    this._drawDock(now);
    this.texture.needsUpdate = true;
  }

  _drawPane(appId, rect, now) {
    const app = this.apps[appId];
    const env = this._env[appId];
    if (!app || !env) return;
    env.hits.clear();
    env.data = this._data;
    env.now = now;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.translate(rect.x, rect.y);
    try {
      app.draw(ctx, { w: rect.w, h: rect.h, compact: rect.w < 500 }, env);
    } catch (e) {
      ctx.fillStyle = CONSOLE_COLORS.panel;
      ctx.fillRect(0, 0, rect.w, rect.h);
      drawText(ctx, `${app.label || appId} unavailable`, rect.w / 2, rect.h / 2, {
        size: 22, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle',
      });
      if (!env._drawErrorLogged) {
        env._drawErrorLogged = true;
        console.error('CenterConsole app draw failed', appId, e);
      }
    }
    ctx.restore();
  }

  _drawSecondaryHeader(rect, _now) {
    const ctx = this.ctx;
    const app = this.apps[this.layout.secondary];
    ctx.fillStyle = CONSOLE_COLORS.dockBg;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    drawText(ctx, (app && app.label) || '', rect.x + 16, rect.y + rect.h / 2, {
      size: 16, color: CONSOLE_COLORS.muted, baseline: 'middle',
    });
    iconSwap(ctx, rect.x + rect.w - 26, rect.y + rect.h / 2, 18, CONSOLE_COLORS.muted);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.h - 0.5);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h - 0.5);
    ctx.stroke();
  }

  _drawDock(_now) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const top = H - DOCK.height;
    this._dockHits.clear();

    ctx.fillStyle = CONSOLE_COLORS.dockBg;
    ctx.fillRect(0, top, W, DOCK.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(W, top + 0.5);
    ctx.stroke();

    const n = APP_ORDER.length;
    const slot = DOCK.iconSize + DOCK.gap;
    const total = n * slot - DOCK.gap;
    let x = (W - total) / 2;
    const cy = top + DOCK.height / 2 - 7;
    for (const id of APP_ORDER) {
      const app = this.apps[id];
      const cx = x + DOCK.iconSize / 2;
      const active = id === this.layout.primary || (this.layout.mode === 'split' && id === this.layout.secondary);
      const isPrimary = id === this.layout.primary;
      if (isPrimary) {
        fillRoundRect(ctx, cx - DOCK.iconSize / 2 - 8, top + 8, DOCK.iconSize + 16, DOCK.height - 16, 12, CONSOLE_COLORS.panelRaised);
      }
      const color = active ? CONSOLE_COLORS.dockActive : CONSOLE_COLORS.dockIdle;
      try { app.drawIcon(ctx, cx, cy, DOCK.iconSize * 0.62, color); } catch (_e) {}
      drawText(ctx, app.label, cx, top + DOCK.height - 14, { size: 12, color, align: 'center', baseline: 'middle' });
      // Generous touch target, full dock height.
      this._dockHits.add(`app:${id}`, cx - slot / 2, top, slot, DOCK.height);
      x += slot;
    }

    // Split toggle, far right.
    const st = { w: 56, h: 56 };
    const sx = W - st.w - 22;
    const sy = top + (DOCK.height - st.h) / 2;
    if (this.layout.mode === 'split') {
      fillRoundRect(ctx, sx, sy, st.w, st.h, 12, CONSOLE_COLORS.panelRaised);
    }
    iconSplit(ctx, sx + st.w / 2, sy + st.h / 2, 26, this.layout.mode === 'split' ? CONSOLE_COLORS.dockActive : CONSOLE_COLORS.dockIdle);
    this._dockHits.add('split', sx - 8, top, st.w + 16, DOCK.height);

    // Clock, far left of the dock.
    const t = this._data.clock;
    const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    drawText(ctx, timeStr, 24, top + DOCK.height / 2, { size: 20, color: CONSOLE_COLORS.muted, baseline: 'middle' });
  }

  // --- pointer input -----------------------------------------------------------

  _armPointer() {
    if (this._pointerArmed || typeof document === 'undefined') return;
    // Capture-phase listeners on the document: the game's UI overlays cover
    // the render canvas (e.g. #game-ui-backing), and the engine's own input
    // singleton listens on #game-main in the bubble phase — capturing here
    // sees every pointer first and can stop the ones the console consumes.
    this._onDown = (e) => this._pointerEvent('down', e);
    this._onMove = (e) => this._pointerEvent('move', e);
    this._onUp = (e) => this._pointerEvent('up', e);
    document.addEventListener('pointerdown', this._onDown, true);
    document.addEventListener('pointermove', this._onMove, true);
    document.addEventListener('pointerup', this._onUp, true);
    document.addEventListener('pointercancel', this._onUp, true);
    this._pointerArmed = true;
  }

  /** The game's WebGL canvas (for pointer→NDC conversion). */
  _renderCanvas() {
    if (!this._gameCanvas || !this._gameCanvas.isConnected) {
      this._gameCanvas = (typeof document !== 'undefined') ? document.getElementById('render-canvas') : null;
    }
    return this._gameCanvas;
  }

  /** Project a pointer event onto the screen plane; route when it hits. */
  _pointerEvent(type, e) {
    if (!this._active || !this.screenMesh || !this.screenMesh.visible) return;
    if (type !== 'down' && !this._capture) return;
    // While the sim is paused nothing renders and hit regions go stale under
    // the PAUSED overlay — don't accept (or swallow) screen taps.
    const h = this._handles();
    if (h && h.ticker && h.ticker.paused) return;
    // Only intercept pointers aimed at the game surface itself. Clicks on the
    // game's own DOM controls (menu buttons, panels) layered above the canvas
    // must keep working even where they overlap the projected screen.
    const t = e.target;
    if (t && t.closest) {
      const ui = t.closest('#game-ui');
      if (ui && t.id !== 'game-ui-backing') return;
      if (!ui && t.id !== 'render-canvas' && !t.closest('#game-main')) return;
    }
    const pt = this._project(e);
    if (!pt) {
      // Drag released/moved past the plane edge: finish at the last on-screen
      // point instead of a bogus origin (a seek bar must not snap to 0).
      if (type === 'up' && this._capture) {
        const last = this._lastDragPt;
        this._routePoint('up', last ? last.x : -1, last ? last.y : -1);
        this._lastDragPt = null;
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (this._inputLocked) {
      // Benchmark mode (car-bench): the pointer hit the screen, so swallow it
      // (never leak a tap to the game) but do NOT route it to any app — the
      // vehicle state is Python-authoritative. Report the blocked attempt.
      e.preventDefault();
      e.stopPropagation();
      if (type === 'down') this._emitBlocked(pt);
      return;
    }
    if (this._capture) this._lastDragPt = pt;
    const consumed = this._routePoint(type, pt.x, pt.y);
    if (!this._capture) this._lastDragPt = null;
    if (consumed || this._capture) {
      // Keep the tap away from the game (in Mouse input mode a click is
      // throttle). preventDefault also suppresses the compat mouse events;
      // stopPropagation keeps it from the game's #game-main handlers.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Hand-rolled picking (no Raycaster in this THREE build): unproject the
   * pointer's NDC point, then intersect the ray with the screen plane in the
   * mesh's local frame (plane z=0). Returns canvas px or null.
   */
  _project(e) {
    const h = this._handles();
    const camera = h && h.camera;
    const canvas = this._renderCanvas();
    if (!camera || !canvas) return null;
    const V3 = ccFindVector3(this.THREE);
    if (!V3) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    try {
      const origin = new V3().setFromMatrixPosition(camera.matrixWorld);
      const target = new V3(ndcX, ndcY, 0.5).unproject(camera);
      // Ray endpoints into the mesh's local frame.
      const oLocal = this.screenMesh.worldToLocal(origin.clone ? origin.clone() : new V3(origin.x, origin.y, origin.z));
      const tLocal = this.screenMesh.worldToLocal(target);
      const dx = tLocal.x - oLocal.x;
      const dy = tLocal.y - oLocal.y;
      const dz = tLocal.z - oLocal.z;
      if (Math.abs(dz) < 1e-8) return null;
      const t = -oLocal.z / dz;
      if (t <= 0) return null;
      const lx = oLocal.x + dx * t;
      const ly = oLocal.y + dy * t;
      const hw = SCREEN_PLANE.width / 2;
      const hh = SCREEN_PLANE.height / 2;
      const pad = this._capture ? 0.03 : 0; // forgiving while dragging
      if (Math.abs(lx) > hw + pad || Math.abs(ly) > hh + pad) return null;
      const u = (lx + hw) / SCREEN_PLANE.width;
      const v = (hh - ly) / SCREEN_PLANE.height;
      return { x: u * this.canvas.width, y: v * this.canvas.height };
    } catch (_e) {
      return null;
    }
  }

  /** Route a canvas-space point to the dock or the owning pane. */
  _routePoint(type, cx, cy) {
    // Active drag: deliver to the captured pane regardless of where we are.
    if (this._capture) {
      const rect = this._captureRect();
      if (rect) {
        const env = this._env[this._capture.appId];
        try {
          this.apps[this._capture.appId].onPointer(type, cx - rect.x, cy - rect.y, { w: rect.w, h: rect.h, compact: rect.w < 500 }, env);
        } catch (_e) {}
      }
      if (type === 'up') this._capture = null;
      return true;
    }
    if (type !== 'down') return false;

    // Dock.
    const dockHit = this._dockHits.at(cx, cy);
    if (dockHit) {
      if (dockHit.id === 'split') {
        if (this.layout.mode === 'split') this.setLayoutMode('full');
        else this.split(this.layout.primary, this.layout.secondary);
      } else if (dockHit.id.indexOf('app:') === 0) {
        this.open(dockHit.id.slice(4));
        this._emit('consoleApp', { app: this.layout.primary, layout: Object.assign({}, this.layout) });
      }
      return true;
    }

    const rects = this._paneRects();
    // Secondary header: swap panes.
    if (rects.header && this._inRect(cx, cy, rects.header)) {
      this.swap();
      return true;
    }
    for (const role of ['primary', 'secondary']) {
      const rect = rects[role];
      if (!rect || !this._inRect(cx, cy, rect)) continue;
      const appId = this.layout[role];
      const app = this.apps[appId];
      const env = this._env[appId];
      if (!app || !env) return true;
      let capture = false;
      try {
        capture = !!app.onPointer('down', cx - rect.x, cy - rect.y, { w: rect.w, h: rect.h, compact: rect.w < 500 }, env);
      } catch (_e) {}
      if (capture) this._capture = { appId, role };
      return true;
    }
    return cy < this.canvas.height; // anywhere on the screen still swallows the tap
  }

  _captureRect() {
    if (!this._capture) return null;
    const rects = this._paneRects();
    if (this._capture.role === 'secondary' && !rects.secondary) { this._capture = null; return null; }
    const rect = this._capture.role === 'secondary' ? rects.secondary : rects.primary;
    if (this.layout[this._capture.role] !== this._capture.appId) { this._capture = null; return null; }
    return rect;
  }

  _inRect(x, y, r) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  /**
   * Benchmark-mode input lock (car-bench-compat-plan.md §4.5, lock #4). When
   * locked, screen taps are swallowed but not routed, and tap() is refused —
   * programmatic controller access (e.g. comfort.controller.set, VehicleState's
   * own projection path) stays open.
   */
  setInputLocked(locked) {
    this._inputLocked = !!locked;
    return { ok: true, value: { locked: this._inputLocked } };
  }

  _emitBlocked(pt) {
    try {
      const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
      if (b) b.emit('consoleInputBlocked', { u: pt.x / this.canvas.width, v: pt.y / this.canvas.height });
    } catch (_e) { /* no bridge yet — nothing to report to */ }
  }

  /** Synthetic tap for the API: u, v normalized 0..1 across the screen. */
  tap(u, v) {
    if (this._inputLocked) return { ok: false, error: 'locked' };
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return { ok: false, error: 'bad_value', message: 'u and v must be 0..1' };
    const x = u * this.canvas.width;
    const y = v * this.canvas.height;
    this._routePoint('down', x, y);
    this._routePoint('up', x, y);
    return { ok: true, value: { x: Math.round(x), y: Math.round(y) } };
  }

  // --- state for the API --------------------------------------------------------

  state() {
    let audio = null;
    let phone = null;
    let comfort = null;
    try { audio = AudioApp.controller ? AudioApp.controller.status() : null; } catch (_e) {}
    try { phone = PhoneApp.controller ? PhoneApp.controller.status() : null; } catch (_e) {}
    try { comfort = ComfortApp.controller ? ComfortApp.controller.get() : null; } catch (_e) {}
    return {
      enabled: this.enabled(),
      visible: !!(this._active && this.screenMesh && this.screenMesh.visible),
      layout: Object.assign({}, this.layout),
      apps: APP_ORDER.slice(),
      audio,
      phone,
      comfort,
    };
  }

  dispose() {
    this._removeMeshes();
    this.texture.dispose();
    this.material.dispose();
    this.rimMaterial.dispose();
    if (typeof document !== 'undefined' && this._onDown) {
      document.removeEventListener('pointerdown', this._onDown, true);
      document.removeEventListener('pointermove', this._onMove, true);
      document.removeEventListener('pointerup', this._onUp, true);
      document.removeEventListener('pointercancel', this._onUp, true);
    }
  }
}

  if (typeof window !== 'undefined') {
    window.CenterConsole = CenterConsole;
  }
})();
