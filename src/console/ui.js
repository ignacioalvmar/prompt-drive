/**
 * Shared canvas helpers for the center-console apps: geometry, hit regions,
 * text, controls and the icon glyph set. Everything draws into the console's
 * 2D context; nothing here touches THREE or the engine.
 */

import { CONSOLE_COLORS, CONSOLE_FONT } from './config.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function font(px, weight) {
  return `${weight || 400} ${Math.round(px)}px ${CONSOLE_FONT}`;
}

// Interpolate two hex colors (#rrggbb) — used for the temperature readouts.
export function colorLerp(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r}, ${g}, ${bl})`;
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRoundRect(ctx, x, y, w, h, r, stroke, lineWidth) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth || 1;
  ctx.stroke();
}

export function drawText(ctx, text, x, y, { size = 20, weight = 400, color = CONSOLE_COLORS.text, align = 'left', baseline = 'alphabetic', maxWidth } = {}) {
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
export class HitMap {
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
export function button(ctx, hits, id, x, y, w, h, { label, icon, kind = 'dark', active = false, iconSize, textSize } = {}) {
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
export function slider(ctx, hits, id, x, y, w, frac, { height = 6, color = CONSOLE_COLORS.accent, track = 'rgba(255,255,255,0.14)', knob = true, hitPad = 14 } = {}) {
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
export function drawAvatar(ctx, cx, cy, radius, name, hue) {
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
export function iconMap(ctx, cx, cy, size, color) {
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
export function iconNav(ctx, cx, cy, size, color) {
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
export function iconAudio(ctx, cx, cy, size, color) {
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
export function iconPhone(ctx, cx, cy, size, color) {
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
export function iconComfort(ctx, cx, cy, size, color) {
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
export function iconSplit(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.strokeRect(-10, -7, 20, 14);
  ctx.beginPath();
  ctx.moveTo(3.5, -7);
  ctx.lineTo(3.5, 7);
  ctx.stroke();
  ctx.restore();
}

export function iconPlay(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.beginPath();
  ctx.moveTo(-5, -8);
  ctx.lineTo(7, 0);
  ctx.lineTo(-5, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function iconPause(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.fillRect(-6, -8, 4.4, 16);
  ctx.fillRect(1.6, -8, 4.4, 16);
  ctx.restore();
}

export function iconPrev(ctx, cx, cy, size, color) {
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

export function iconNext(ctx, cx, cy, size, color) {
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

export function iconVolume(ctx, cx, cy, size, color) {
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
export function iconPhoneUp(ctx, cx, cy, size, color) {
  iconPhone(ctx, cx, cy, size, color);
}

/** Reject/end-call handset (rotated: hang up). */
export function iconPhoneDown(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((135 * Math.PI) / 180);
  iconPhone(ctx, 0, 0, size, color);
  ctx.restore();
}

export function iconPlus(ctx, cx, cy, size, color) {
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

export function iconMinus(ctx, cx, cy, size, color) {
  glyphSetup(ctx, cx, cy, size, color);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(7, 0);
  ctx.stroke();
  ctx.restore();
}

/** Fan: three blades around a hub. */
export function iconFan(ctx, cx, cy, size, color) {
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
export function iconSeatHeat(ctx, cx, cy, size, color) {
  iconComfort(ctx, cx, cy, size, color);
}

export function iconChevron(ctx, cx, cy, size, color, dir) {
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
export function iconSwap(ctx, cx, cy, size, color) {
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
