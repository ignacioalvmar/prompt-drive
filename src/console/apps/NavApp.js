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

import { CONSOLE_COLORS } from '../config.js';
import { drawText, fillRoundRect, iconNav, iconChevron } from '../ui.js';

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

export const NavApp = {
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
