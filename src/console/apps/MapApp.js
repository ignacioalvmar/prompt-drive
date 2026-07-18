/**
 * Map app: bird's-eye view of the road ahead, following the vehicle's
 * orientation (heading-up, ego pinned near the bottom). Drawn straight from
 * the engine's road nodes (via the bridge handles), so it works regardless of
 * the HUD worm visibility setting. Nodes behind the ego are trimmed by the
 * engine, so the app keeps its own short trail of passed centreline points.
 */

import { CONSOLE_COLORS } from '../config.js';
import { clamp, drawText, fillRoundRect, iconPlus, iconMinus, iconMap } from '../ui.js';

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

export const MapApp = {
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
