/**
 * POIs in the 3D world (PromptDrive spec, "POIs in the 3D world"): one
 * generic roadside sign per pack POI, at its slot position, labeled with
 * `display_name` and styled by category (fuel pump, café cup, parking P,
 * pharmacy cross, …). Brand names appear only as text, never as logos.
 * Locked and procedural POIs render the same way.
 *
 * Signs exist for every POI within the default search radius (3 km of network
 * distance, ahead or behind), so whatever search_poi returns near the vehicle
 * is also standing in the world; farther ones are built/disposed lazily.
 */

import { RoadGraph } from './RoadGraph.js';

const SIGN_RANGE_M = 3000; // = default search_poi radius (THRESHOLDS.defaultRadiusM)
const SIGN_UPDATE_MS = 400;
const SIGN_W = 4.2;
const SIGN_H = 2.1;
const SIGN_POST_H = 2.6;

export const CATEGORY_STYLE = {
  fuel: { color: '#d9480f', glyph: 'pump' },
  ev_charging: { color: '#2b8a3e', glyph: 'bolt' },
  parking: { color: '#1c62c4', glyph: 'P' },
  restaurant: { color: '#a61e4d', glyph: 'fork' },
  cafe: { color: '#7a4b2a', glyph: 'cup' },
  supermarket: { color: '#5f3dc4', glyph: 'cart' },
  pharmacy: { color: '#2f9e44', glyph: 'cross' },
  hospital: { color: '#c92a2a', glyph: 'H' },
  hotel: { color: '#364fc7', glyph: 'bed' },
  atm: { color: '#087f5b', glyph: '$' },
  car_service: { color: '#495057', glyph: 'wrench' },
  landmark: { color: '#795c00', glyph: 'star' },
  home: { color: '#1971c2', glyph: 'house' },
  work: { color: '#343a40', glyph: 'case' },
};

function drawGlyph(ctx, glyph, cx, cy, s) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const text = (t, size) => {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, cx, cy + s * 0.04);
  };
  switch (glyph) {
    case 'pump':
      ctx.fillRect(cx - s * 0.32, cy - s * 0.38, s * 0.4, s * 0.76);
      ctx.clearRect(cx - s * 0.24, cy - s * 0.3, s * 0.24, s * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.08, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.05);
      ctx.lineTo(cx + s * 0.3, cy + s * 0.25);
      ctx.stroke();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.08, cy - s * 0.42);
      ctx.lineTo(cx - s * 0.22, cy + s * 0.05);
      ctx.lineTo(cx, cy + s * 0.05);
      ctx.lineTo(cx - s * 0.08, cy + s * 0.42);
      ctx.lineTo(cx + s * 0.22, cy - s * 0.05);
      ctx.lineTo(cx, cy - s * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cup':
      ctx.fillRect(cx - s * 0.3, cy - s * 0.15, s * 0.44, s * 0.4);
      ctx.beginPath();
      ctx.arc(cx + s * 0.18, cy + s * 0.04, s * 0.12, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.16, cy - s * 0.38);
      ctx.quadraticCurveTo(cx - s * 0.06, cy - s * 0.3, cx - s * 0.12, cy - s * 0.22);
      ctx.moveTo(cx, cy - s * 0.38);
      ctx.quadraticCurveTo(cx + s * 0.1, cy - s * 0.3, cx + s * 0.04, cy - s * 0.22);
      ctx.stroke();
      break;
    case 'cross':
      ctx.fillRect(cx - s * 0.12, cy - s * 0.38, s * 0.24, s * 0.76);
      ctx.fillRect(cx - s * 0.38, cy - s * 0.12, s * 0.76, s * 0.24);
      break;
    case 'fork':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.18, cy - s * 0.38); ctx.lineTo(cx - s * 0.18, cy + s * 0.38);
      ctx.moveTo(cx - s * 0.3, cy - s * 0.38); ctx.lineTo(cx - s * 0.3, cy - s * 0.1); ctx.lineTo(cx - s * 0.06, cy - s * 0.1); ctx.lineTo(cx - s * 0.06, cy - s * 0.38);
      ctx.moveTo(cx + s * 0.2, cy + s * 0.38); ctx.lineTo(cx + s * 0.2, cy - s * 0.38); ctx.quadraticCurveTo(cx + s * 0.38, cy - s * 0.2, cx + s * 0.2, cy);
      ctx.stroke();
      break;
    case 'cart':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy - s * 0.3); ctx.lineTo(cx - s * 0.25, cy - s * 0.3); ctx.lineTo(cx - s * 0.12, cy + s * 0.15); ctx.lineTo(cx + s * 0.3, cy + s * 0.15); ctx.lineTo(cx + s * 0.38, cy - s * 0.18); ctx.lineTo(cx - s * 0.2, cy - s * 0.18);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - s * 0.08, cy + s * 0.32, s * 0.07, 0, Math.PI * 2); ctx.arc(cx + s * 0.24, cy + s * 0.32, s * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bed':
      ctx.fillRect(cx - s * 0.4, cy, s * 0.8, s * 0.16);
      ctx.fillRect(cx - s * 0.4, cy - s * 0.3, s * 0.08, s * 0.6);
      ctx.fillRect(cx - s * 0.1, cy - s * 0.14, s * 0.5, s * 0.14);
      ctx.beginPath(); ctx.arc(cx - s * 0.2, cy - s * 0.08, s * 0.09, 0, Math.PI * 2); ctx.fill();
      break;
    case 'wrench':
      ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy + s * 0.3); ctx.lineTo(cx + s * 0.12, cy - s * 0.12); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + s * 0.2, cy - s * 0.2, s * 0.16, Math.PI * 0.9, Math.PI * 2.6); ctx.stroke();
      break;
    case 'star': {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? s * 0.18 : s * 0.42;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'house':
      ctx.beginPath(); ctx.moveTo(cx - s * 0.38, cy); ctx.lineTo(cx, cy - s * 0.38); ctx.lineTo(cx + s * 0.38, cy); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - s * 0.26, cy, s * 0.52, s * 0.34);
      break;
    case 'case':
      ctx.fillRect(cx - s * 0.38, cy - s * 0.18, s * 0.76, s * 0.48);
      ctx.strokeRect(cx - s * 0.14, cy - s * 0.34, s * 0.28, s * 0.16);
      break;
    default:
      text(glyph, s * 0.8);
  }
  ctx.restore();
}

/** 2:1 sign face: category color, white glyph tile, display name. */
function paintSign(canvas, poi) {
  const style = CATEGORY_STYLE[poi.category] || { color: '#343a40', glyph: '?' };
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = style.color;
  ctx.fillRect(14, 14, W - 28, H - 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  const tile = H - 120;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(60, 60, tile, tile);
  drawGlyph(ctx, style.glyph, 60 + tile / 2, 60 + tile / 2, tile * 0.9);
  // Name, wrapped to at most 3 lines, auto-shrunk to fit.
  const textX = 60 + tile + 40;
  const maxW = W - textX - 60;
  const words = String(poi.display_name || '').split(/\s+/);
  let size = Math.round(H * 0.18);
  let lines;
  for (; size >= Math.round(H * 0.08); size -= 4) {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (ctx.measureText(next).width <= maxW || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const lh = size * 1.12;
  const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, k) => ctx.fillText(l, textX, y0 + k * lh, maxW));
}

function signThree(THREE, root) {
  const Mat = THREE.MeshBasicMaterial || THREE.C;
  const Plane = THREE.PlaneGeometry || THREE.J;
  const Group = THREE.Group || THREE.G;
  let Mesh = THREE.Mesh || null;
  if (!Mesh && root && root.traverse) {
    root.traverse((c) => { if (!Mesh && c && c.isMesh) Mesh = c.constructor; });
  }
  if (!Mesh) Mesh = THREE.B;
  return { Mat, Plane, Group, Mesh };
}

function makeTexture(THREE, canvas) {
  if (THREE.CanvasTexture) return new THREE.CanvasTexture(canvas);
  for (const key of Object.keys(THREE)) {
    const val = THREE[key];
    if (typeof val === 'function' && val.prototype && val.prototype.isTexture) {
      const tex = new val(canvas);
      tex.image = canvas;
      tex.needsUpdate = true;
      return tex;
    }
  }
  const Loader = THREE.U || THREE.TextureLoader;
  const tmp = new Loader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const tex = new tmp.constructor(canvas);
  tex.image = canvas;
  tex.needsUpdate = true;
  tmp.dispose();
  return tex;
}

export class PoiSigns {
  constructor(service) {
    this.svc = service;
    this.h = null;
    this.signs = new Map(); // poi id -> { group, pos, disposeList }
    this._last = 0;
    this._three = null;
    this.disabled = false;
    this.enabled = true;
  }

  attach(h) {
    this.h = h;
  }

  _ground(x, z, fallback) {
    try {
      const V = this.h.THREE.Vector3 || this.h.THREE.W;
      if (V && this.h.world && this.h.world.getHeight) {
        const v = new V(x, fallback, z);
        const hgt = this.h.world.getHeight(v);
        if (isFinite(hgt)) return hgt;
      }
    } catch (_e) {}
    return fallback;
  }

  _build(poi) {
    const h = this.h;
    const parent = h.world && h.world.container;
    if (!parent) return null;
    if (!this._three) this._three = signThree(h.THREE, parent);
    const T = this._three;
    if (!T.Mat || !T.Plane || !T.Mesh || !T.Group) throw new Error('PoiSigns: THREE classes not found');
    const i = RoadGraph.indexOf(poi.location.road_node_id);
    const node = this.svc.road.node(i);
    const x = poi.location.x;
    const z = poi.location.y;
    const ground = this._ground(x, z, node ? node.z : 0);

    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 384;
    paintSign(canvas, poi);
    const tex = makeTexture(h.THREE, canvas);
    const faceMat = new T.Mat({ map: tex });
    const postMat = new T.Mat({ color: 0x5b6270 });
    postMat.side = 2; // DoubleSide
    const boardGeo = new T.Plane(SIGN_W, SIGN_H);
    const postGeo = new T.Plane(0.18, SIGN_POST_H + SIGN_H / 2);

    const group = new T.Group();
    group.name = 'poi_sign_' + poi.id;
    const front = new T.Mesh(boardGeo, faceMat);
    front.position.set(0, SIGN_POST_H + SIGN_H / 2, 0.02);
    const back = new T.Mesh(boardGeo, faceMat);
    back.position.set(0, SIGN_POST_H + SIGN_H / 2, -0.02);
    back.rotation.y = Math.PI;
    for (const sx of [-SIGN_W * 0.35, SIGN_W * 0.35]) {
      const post = new T.Mesh(postGeo, postMat);
      post.position.set(sx, (SIGN_POST_H + SIGN_H / 2) / 2, 0);
      group.add(post);
    }
    group.add(front);
    group.add(back);
    // Face approaching traffic: board normal (+Z local) points back along the
    // road tangent, turned 25° toward the carriageway so it reads from the lane.
    const a = node ? node.a : 0;
    const side = node ? Math.sign((x - node.x) * -node.nx + (z - node.y) * -node.nz) || 1 : 1;
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)) + side * 0.44;
    group.rotation.y = yaw;
    group.position.set(x, ground, z);
    parent.add(group);
    return { group, pos: { x, y: z, ground }, dispose: [tex, faceMat, postMat, boardGeo, postGeo], node: i };
  }

  _dispose(rec) {
    try { if (rec.group.parent) rec.group.parent.remove(rec.group); } catch (_e) {}
    for (const d of rec.dispose) {
      try { d.dispose(); } catch (_e) {}
    }
  }

  clear() {
    for (const rec of this.signs.values()) this._dispose(rec);
    this.signs.clear();
  }

  update(nowMs) {
    if (this.disabled || !this.h || nowMs - this._last < SIGN_UPDATE_MS) return;
    this._last = nowMs;
    const svc = this.svc;
    if (!svc.active || !this.enabled) {
      if (this.signs.size) this.clear();
      return;
    }
    const v = svc.road.vehiclePosition();
    if (!v || v.arc == null) return;
    try {
      const keep = new Set();
      for (const poi of svc.resolver.allPois()) {
        const i = RoadGraph.indexOf(poi.location && poi.location.road_node_id);
        const arc = i == null ? null : svc.road.arcOf(i);
        if (arc == null) continue;
        const d = arc - v.arc;
        if (Math.abs(d) > SIGN_RANGE_M) continue;
        keep.add(poi.id);
        if (!this.signs.has(poi.id)) this.signs.set(poi.id, this._build(poi));
      }
      for (const [id, rec] of this.signs) {
        if (!keep.has(id)) {
          this._dispose(rec);
          this.signs.delete(id);
        }
      }
    } catch (e) {
      this.disabled = true;
      console.error('PoiSigns disabled:', e);
    }
  }

  /** Currently built signs (for the world-consistency acceptance check). */
  state() {
    const out = [];
    for (const [id, rec] of this.signs) {
      if (!rec) continue;
      out.push({ poi_id: id, x: Math.round(rec.pos.x * 100) / 100, y: Math.round(rec.pos.y * 100) / 100, road_node_id: RoadGraph.idOf(rec.node), visible: !!rec.group.parent });
    }
    return out;
  }
}
