/** Read-only dual-zone climate fascia. Original canvas art; no manual inputs. */
(function () {
  if (typeof CabinFeedback === "undefined") return;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function roundRectPath(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function fillRoundRect(g, x, y, w, h, r, fill) { roundRectPath(g,x,y,w,h,r); g.fillStyle=fill; g.fill(); }
function strokeRoundRect(g,x,y,w,h,r,color,width=1) { roundRectPath(g,x,y,w,h,r); g.strokeStyle=color; g.lineWidth=width; g.stroke(); }
function drawText(g,text,x,y,{size=20,color='#e7e9eb',align='left',baseline='alphabetic'}={}) {
  g.font=`400 ${size}px ShareTech, Arial, sans-serif`; g.fillStyle=color; g.textAlign=align; g.textBaseline=baseline; g.fillText(text,x,y);
}
function glyphSetup(g,cx,cy,size,color) { g.save(); g.translate(cx,cy); g.scale(size/24,size/24); g.fillStyle=color; }
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

const CLIMATE_SURFACE = { width: 0.22, height: 0.064166667 };
const CLIMATE_FIELDS = [
  'climate_temperature_driver', 'climate_temperature_passenger', 'fan_speed',
  'air_conditioning', 'air_circulation', 'fan_airflow_direction',
  'window_front_defrost', 'window_rear_defrost',
  'seat_heating_driver', 'seat_heating_passenger',
];
class ClimatePanel {
  constructor(readSnapshot, driverRight) {
    this.readSnapshot = readSnapshot;
    this.driverRight = driverRight;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1200;
    this.canvas.height = 350;
    this.ctx = this.canvas.getContext('2d');
    this.snapshot = null;
    this.from = {};
    this.changedAt = {};
    this.draw();
  }

  _read(now) {
    const next = this.readSnapshot();
    if (!next) return false;
    for (const key of CLIMATE_FIELDS) {
      if (this.snapshot && next[key] !== this.snapshot[key]) {
        this.from[key] = this._displayValue(key, now);
        this.changedAt[key] = now;
      }
    }
    this.snapshot = next;
    return true;
  }

  _reducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  _displayValue(key, now) {
    const value = this.snapshot && this.snapshot[key];
    if (typeof value !== 'number' || this._reducedMotion()) return value;
    const start = this.from[key];
    if (typeof start !== 'number') return value;
    const progress = clamp((now - (this.changedAt[key] || 0)) / 350, 0, 1);
    return start + (value - start) * (1 - Math.pow(1 - progress, 3));
  }

  _flash(key, now) {
    if (!this.changedAt[key] || this._reducedMotion()) return 0;
    return clamp(1 - (now - this.changedAt[key]) / 850, 0, 1);
  }

  _text(text, x, y, size = 22, color = '#e7e9eb') {
    drawText(this.ctx, text, x, y, { size, color, align: 'center', baseline: 'middle' });
  }

  _dial(cx, key, label, now) {
    const g = this.ctx, cy = 132, radius = 104;
    const metal = g.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    metal.addColorStop(0, '#f4f5f6'); metal.addColorStop(0.25, '#565c63');
    metal.addColorStop(0.52, '#b2b6bc'); metal.addColorStop(1, '#262a30');
    g.shadowColor = '#000'; g.shadowBlur = 18; g.shadowOffsetY = 7;
    g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.fillStyle = metal; g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = 2;
    for (let i = 0; i < 72; i++) {
      const a = i * Math.PI / 36;
      g.strokeStyle = i % 2 ? '#45494f' : '#bbc0c7';
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 97, cy + Math.sin(a) * 97);
      g.lineTo(cx + Math.cos(a) * 103, cy + Math.sin(a) * 103); g.stroke();
    }
    const face = g.createRadialGradient(cx - 25, cy - 40, 2, cx, cy, 92);
    face.addColorStop(0, '#24272b'); face.addColorStop(1, '#090b0d');
    g.beginPath(); g.arc(cx, cy, 91, 0, Math.PI * 2); g.fillStyle = face; g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#4c98d4'; g.beginPath(); g.arc(cx, cy, 83, Math.PI * 0.62, Math.PI * 1.35); g.stroke();
    g.strokeStyle = '#c85c53'; g.beginPath(); g.arc(cx, cy, 83, Math.PI * 1.65, Math.PI * 2.38); g.stroke();
    const value = this._displayValue(key, now);
    const angle = Math.PI * (0.75 + (value - 16) / 12 * 1.5);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + Math.cos(angle) * 72, cy + Math.sin(angle) * 72);
    g.lineTo(cx + Math.cos(angle) * 79, cy + Math.sin(angle) * 79); g.stroke();
    this._text(value.toFixed(1) + '°', cx, cy - 2, 49);
    this._text(label, cx, cy + 57, 13, '#aeb4bb');
    const flash = this._flash(key, now);
    if (flash > 0) {
      g.strokeStyle = `rgba(${this.snapshot[key] >= (this.from[key] || 20) ? '230,132,100' : '110,185,235'},${flash})`;
      g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 109, 0, Math.PI * 2); g.stroke();
    }
  }

  _button(id, x, label, active, key, now, glyph) {
    const g = this.ctx, y = 224, w = 102, h = 69;
    const metal = g.createLinearGradient(0, y, 0, y + h);
    metal.addColorStop(0, '#3c4249'); metal.addColorStop(0.60, '#15191e');
    metal.addColorStop(0.65, '#adb4bb'); metal.addColorStop(0.80, '#e4e8ec'); metal.addColorStop(1, '#535c65');
    fillRoundRect(g, x, y, w, h, 5, metal);
    strokeRoundRect(g, x, y, w, h, 5, '#4a5056', 1);
    const color = active ? '#fff1db' : '#d2d6da';
    if (glyph) glyph(x + w / 2, y + 23, color);
    else this._text(label, x + w / 2, y + 30, 22, color);
    if (glyph) this._text(label, x + w / 2, y + 51, 13, '#1c252d');
    fillRoundRect(g, x + 30, y + h - 8, 42, 3, 1, active ? '#edac63' : '#42484d');
    const flash = this._flash(key, now);
    if (flash) strokeRoundRect(g, x, y, w, h, 5, `rgba(255,210,160,${flash})`, 2);
  }

  _defrost(cx, cy, color, rear) {
    const g = this.ctx; g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath();
    if (rear) g.rect(cx - 21, cy - 11, 42, 25);
    else { g.moveTo(cx - 24, cy + 13); g.lineTo(cx - 17, cy - 9); g.quadraticCurveTo(cx, cy - 19, cx + 17, cy - 9); g.lineTo(cx + 24, cy + 13); g.closePath(); }
    g.stroke();
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * 11;
      g.beginPath(); g.moveTo(x, cy + 10); g.quadraticCurveTo(x + 5, cy + 3, x, cy - 4);
      g.lineTo(x, cy - 10); g.moveTo(x - 3, cy - 6); g.lineTo(x, cy - 10); g.lineTo(x + 3, cy - 6); g.stroke();
    }
  }

  _seat(cx, key, now) {
    const g = this.ctx, y = 286, level = this.snapshot[key];
    fillRoundRect(g, cx - 95, 255, 190, 72, 5, '#171b20');
    strokeRoundRect(g, cx - 95, 255, 190, 72, 5, '#4b5158', 1);
    g.strokeStyle = '#cfd4da'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 25, y - 14); g.lineTo(cx - 25, y + 13); g.quadraticCurveTo(cx - 23, y + 22, cx - 12, y + 22); g.lineTo(cx + 21, y + 22); g.stroke();
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = i < level ? '#edab65' : '#444a51';
      const x = cx - 5 + i * 12;
      const phase = this._reducedMotion() ? 0 : Math.sin(now / 350 + i) * this._flash(key, now) * 3;
      g.beginPath(); g.moveTo(x, y + 12); g.bezierCurveTo(x + 7, y + 4, x - 7, y - 4, x + phase, y - 13); g.stroke();
    }
  }

  draw(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const g = this.ctx;
    if (!this._read(now)) return;
    const s = this.snapshot;
    const reduced = this._reducedMotion();
    const signature = CLIMATE_FIELDS.map(key => s[key]).join('|') + '|' + reduced + '|' + this.driverRight();
    const moving = !reduced && (s.fan_speed > 0 || Object.values(this.changedAt).some(at => now - at < 850));
    if (signature === this._drawnSignature && !moving) return false;
    this._drawnSignature = signature;
    g.clearRect(0, 0, 1200, 350);
    const frame = g.createLinearGradient(0, 0, 0, 350);
    frame.addColorStop(0, '#bcc1c6'); frame.addColorStop(0.025, '#343a42');
    frame.addColorStop(0.065, '#191e24'); frame.addColorStop(0.93, '#12171d'); frame.addColorStop(1, '#8e979f');
    fillRoundRect(g, 0, 0, 1200, 350, 15, frame);
    strokeRoundRect(g, 3, 3, 1194, 344, 13, '#6c737b', 2);
    for (let y = 12; y < 340; y += 3) {
      g.strokeStyle = 'rgba(210,218,228,0.025)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(14, y); g.lineTo(1186, y); g.stroke();
    }
    // Follow the current vehicle seat side, including changes after startup.
    this._dial(147, this.driverRight() ? 'climate_temperature_passenger' : 'climate_temperature_driver', this.driverRight() ? 'ACOMPAÑANTE' : 'CONDUCTOR', now);
    this._dial(1053, this.driverRight() ? 'climate_temperature_driver' : 'climate_temperature_passenger', this.driverRight() ? 'CONDUCTOR' : 'ACOMPAÑANTE', now);
    fillRoundRect(g, 285, 43, 630, 152, 9, '#080b0e');
    strokeRoundRect(g, 285, 43, 630, 152, 9, '#4a5159', 2);
    this._text(s.air_conditioning ? 'A/C ON' : 'A/C OFF', 395, 67, 20, '#c9d0d7');
    this._text('2-ZONE', 815, 67, 20, '#c9d0d7');
    g.save(); g.translate(442, 111);
    if (s.fan_speed > 0 && !this._reducedMotion()) g.rotate(now / 1000 * s.fan_speed * 0.9);
    iconFan(g, 0, 0, 38, '#e3e8ed'); g.restore();
    for (let i = 0; i < 5; i++) fillRoundRect(g, 496 + i * 34, 103 - i * 3, 24, 20 + i * 3, 2, i < s.fan_speed ? '#edf2f7' : '#2a3139');
    this._text(String(s.fan_speed), 707, 112, 29);
    const dirs = [];
    if (s.fan_airflow_direction.includes('WINDSHIELD')) dirs.push('PARABRISAS');
    if (s.fan_airflow_direction.includes('HEAD')) dirs.push('CARA');
    if (s.fan_airflow_direction.includes('FEET')) dirs.push('PIES');
    this._text(dirs.join(' + '), 600, 165, 19, '#b9c7d4');
    // Small travelling airflow dots, confined to the climate display.
    if (s.fan_speed > 0) {
      const motion = this._reducedMotion() ? 0.5 : (now / (1600 / s.fan_speed)) % 1;
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `rgba(165,205,232,${0.15 + i * 0.16})`;
        g.beginPath(); g.arc(390 + motion * 30 + i * 9, 159, 2, 0, Math.PI * 2); g.fill();
      }
    }
    this._button('front', 287, 'DELANTERO', s.window_front_defrost, 'window_front_defrost', now, (x,y,c)=>this._defrost(x,y,c,false));
    this._button('rear', 391, 'TRASERO', s.window_rear_defrost, 'window_rear_defrost', now, (x,y,c)=>this._defrost(x,y,c,true));
    this._button('ac', 495, 'A/C', s.air_conditioning, 'air_conditioning', now);
    this._button('circulation', 599, s.air_circulation === 'AUTO' ? 'AUTO' : (s.air_circulation === 'RECIRCULATION' ? 'RECIRC.' : 'EXTERIOR'), s.air_circulation === 'RECIRCULATION', 'air_circulation', now);
    this._button('flow', 703, 'DIRECCIÓN', false, 'fan_airflow_direction', now, (x,y,c)=>{
      g.strokeStyle=c;g.lineWidth=2;g.beginPath();g.moveTo(x-20,y);g.lineTo(x+18,y);g.moveTo(x+9,y-8);g.lineTo(x+18,y);g.lineTo(x+9,y+8);g.stroke();
    });
    this._button('off', 807, 'OFF', s.fan_speed === 0 && !s.air_conditioning, 'fan_speed', now);
    this._seat(147, this.driverRight() ? 'seat_heating_passenger' : 'seat_heating_driver', now);
    this._seat(1053, this.driverRight() ? 'seat_heating_driver' : 'seat_heating_passenger', now);
    this._text('CLIMATE CONTROL', 600, 323, 14, '#8b949f');
    return true;
  }

}
/** Original Audi-inspired vent housings: recessed louvres and brushed trim. */

const AIR_VENTS_SURFACE = { width: 0.25, height: 0.036 };
const SIDE_VENT_SURFACE = { width: 0.098, height: 0.052 };
const VENT_FASCIA_SURFACE = { width: 0.266, height: 0.112 };

function ventGradient(g, x1, y1, x2, y2, stops) {
  const gradient = g.createLinearGradient(x1, y1, x2, y2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function housingPath(g, w, h, side) {
  g.beginPath();
  if (side) {
    // The side outlet tapers toward the door, like the reference's trapezoid.
    g.moveTo(27, 5); g.lineTo(w - 70, 5);
    g.quadraticCurveTo(w - 48, 5, w - 38, 28);
    g.lineTo(w - 5, h - 33); g.quadraticCurveTo(w + 1, h - 5, w - 25, h - 5);
    g.lineTo(25, h - 5); g.quadraticCurveTo(5, h - 5, 5, h - 25);
    g.lineTo(5, 28); g.quadraticCurveTo(5, 5, 27, 5);
  } else {
    g.moveTo(26, 5); g.lineTo(w - 26, 5);
    g.quadraticCurveTo(w - 4, 5, w - 4, 26);
    g.lineTo(w - 12, h - 31); g.quadraticCurveTo(w - 13, h - 5, w - 36, h - 5);
    g.lineTo(36, h - 5); g.quadraticCurveTo(13, h - 5, 12, h - 31);
    g.lineTo(4, 26); g.quadraticCurveTo(4, 5, 26, 5);
  }
  g.closePath();
}

function drawVentBank(g, x, y, w, h, { wheel = false, slats = 4 } = {}) {
  // Bevel, then a deep unlit cavity. The grid stays behind horizontal blades.
  fillRoundRect(g, x - 5, y - 5, w + 10, h + 10, 8,
    ventGradient(g, 0, y - 5, 0, y + h + 5, [[0, '#4e565f'], [0.1, '#242b32'], [0.85, '#10151b'], [1, '#68717a']]));
  fillRoundRect(g, x, y, w, h, 5, '#040608');
  const bankW = w - (wheel ? 48 : 0);
  g.save(); g.beginPath(); g.rect(x + 3, y + 3, bankW - 6, h - 6); g.clip();
  for (let i = 1; i < 6; i++) fillRoundRect(g, x + i * bankW / 6, y + 4, 5, h - 8, 1, '#141a20');
  const pitch = (h - 14) / slats;
  for (let i = 0; i < slats; i++) {
    const by = y + 6 + i * pitch, bh = pitch * 0.53;
    g.shadowColor = 'rgba(0,0,0,0.95)'; g.shadowBlur = 8; g.shadowOffsetY = 7;
    fillRoundRect(g, x + 1, by, bankW - 2, bh, 2,
      ventGradient(g, 0, by, 0, by + bh, [[0, '#59636e'], [0.08, '#444d57'], [0.35, '#303943'], [0.8, '#171e26'], [1, '#080d13']]));
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.fillStyle = 'rgba(164,176,189,0.35)'; g.fillRect(x + 5, by, bankW - 10, 1.5);
    g.fillStyle = '#070b10'; g.fillRect(x + 2, by + bh - 2, bankW - 4, 2);
  }
  // Sculpted adjustment paddle, with a chrome lower lip and cast shadow.
  const tw = Math.min(114, bankW * 0.22), tx = x + bankW * 0.52 - tw / 2;
  const ty = y + h * 0.48, th = Math.min(30, pitch * 0.86);
  g.shadowColor = '#000'; g.shadowBlur = 9; g.shadowOffsetY = 8;
  fillRoundRect(g, tx - 5, ty - 3, tw + 10, th + 8, 7, '#0a1016');
  fillRoundRect(g, tx, ty, tw, th, 6,
    ventGradient(g, 0, ty, 0, ty + th, [[0, '#6c747e'], [0.2, '#3b444d'], [0.6, '#1c252f'], [0.76, '#a6afb9'], [0.9, '#e1e6ec'], [1, '#586574']]));
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  strokeRoundRect(g, tx, ty, tw, th, 6, '#111921', 1.5);
  g.restore();
  if (wheel) {
    const wx = x + w - 34;
    fillRoundRect(g, wx - 5, y + 5, 31, h - 10, 9, '#080d12');
    fillRoundRect(g, wx, y + 9, 20, h - 18, 5,
      ventGradient(g, wx, 0, wx + 20, 0, [[0, '#19212a'], [0.5, '#6b7580'], [1, '#131b24']]));
    for (let by = y + 15; by < y + h - 13; by += 8) {
      g.fillStyle = '#151e27'; g.fillRect(wx + 1, by, 18, 3);
      g.fillStyle = '#8d99a5'; g.fillRect(wx + 2, by, 16, 1);
    }
    fillRoundRect(g, wx + 3, y + h * 0.37, 14, 5, 2, '#e1e8ee');
  }
}

function createAirVentsCanvas(side = false) {
  const canvas = document.createElement('canvas');
  canvas.width = side ? 720 : 1600;
  canvas.height = side ? 382 : 230;
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  // Moulded graphite surround, fine upper bevel and brushed aluminium below.
  housingPath(g, w, h, side);
  g.fillStyle = ventGradient(g, 0, 0, 0, h, [[0, '#484e56'], [0.08, '#262c33'], [0.7, '#151b22'], [1, '#080f16']]);
  g.fill(); g.save(); g.clip();
  for (let y = 8; y < h - 16; y += 3) {
    g.strokeStyle = y % 2 ? 'rgba(208,216,224,0.023)' : 'rgba(0,0,0,0.15)';
    g.lineWidth = 1; g.beginPath(); g.moveTo(9, y); g.lineTo(w - 9, y); g.stroke();
  }
  const metalY = side ? h - 42 : h - 36;
  g.fillStyle = ventGradient(g, 0, metalY, 0, h, [[0, '#b9c0c8'], [0.05, '#e3e7ec'], [0.18, '#8d98a4'], [0.5, '#a7b1bc'], [1, '#49535f']]);
  g.fillRect(0, metalY, w, h - metalY);
  for (let y = metalY + 4; y < h; y += 2) {
    g.fillStyle = 'rgba(235,241,247,0.15)'; g.fillRect(0, y, w, 0.6);
  }
  if (side) {
    g.strokeStyle = '#c0c8d1'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(27, h - 54); g.lineTo(27, 42);
    g.quadraticCurveTo(27, 23, 46, 23); g.lineTo(w - 86, 23);
    g.lineTo(w - 33, h - 58); g.stroke();
    drawVentBank(g, 48, 47, w - 135, h - 113, { wheel: true, slats: 5 });
  } else {
    drawVentBank(g, 29, 32, 707, 149);
    drawVentBank(g, 864, 32, 707, 149, { wheel: true });
    fillRoundRect(g, 757, 23, 86, 168, 7,
      ventGradient(g, 757, 0, 843, 0, [[0, '#535d68'], [0.08, '#303944'], [0.35, '#1b232d'], [0.82, '#242d38'], [1, '#515c68']]));
    strokeRoundRect(g, 767, 34, 66, 147, 4, '#0b121a', 2);
    fillRoundRect(g, 777, 45, 46, 125, 3, '#252e39');
  }
  g.restore();
  housingPath(g, w, h, side); g.strokeStyle = '#0b1118'; g.lineWidth = 5; g.stroke();
  return canvas;
}

function ventFasciaPath(g, w, h) {
  g.beginPath(); g.moveTo(21, 4); g.lineTo(w - 21, 4);
  g.quadraticCurveTo(w - 3, 4, w - 5, 24);
  g.lineTo(w - 43, h - 27); g.quadraticCurveTo(w - 45, h - 4, w - 67, h - 4);
  g.lineTo(67, h - 4); g.quadraticCurveTo(45, h - 4, 43, h - 27);
  g.lineTo(5, 24); g.quadraticCurveTo(3, 4, 21, 4); g.closePath();
}

/** Continuous brushed insert surrounding the central vents and climate unit. */
function createVentFasciaCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 674;
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ventFasciaPath(g, w, h);
  g.fillStyle = ventGradient(g, 0, 0, 0, h, [[0, '#424c57'], [0.32, '#28333e'], [0.36, '#bfc6cd'], [0.42, '#8e99a5'], [0.75, '#74818e'], [1, '#374450']]);
  g.fill(); g.save(); g.clip();
  // Fine diagonal brushed grain, subtle enough to avoid a grille-like pattern.
  for (let x = -h; x < w; x += 5) {
    g.strokeStyle = 'rgba(231,237,244,0.07)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke();
  }
  g.restore(); ventFasciaPath(g, w, h);
  g.strokeStyle = '#161f28'; g.lineWidth = 5; g.stroke();
  return canvas;
}

  let ctx = null, snapshot = null, panel = null, surfaces = [], frame = null, lastDraw = 0;
  function driverRight() {
    const side = ctx.handles()?.vehicleConfig?.value?.side;
    return side == null ? ctx.config.side === 'right' : Number(side) === 0;
  }
  function surface(console, name, canvas, size, x, y, z) {
    const mesh = new console.screenMesh.constructor(new console.screenMesh.geometry.constructor(size.width, size.height), console.material.clone());
    // Texture.clone() shares its Source; assigning image would replace the
    // original console texture as well. Construct an independent source.
    const texture = new console.texture.constructor(canvas); texture.needsUpdate = true;
    texture.generateMipmaps = false;
    texture.minFilter = console.texture.minFilter; texture.magFilter = console.texture.magFilter;
    mesh.material.map = texture; mesh.material.transparent = true; mesh.material.depthWrite = false;
    mesh.name = name; mesh.rotation.order = 'YXZ'; mesh.rotation.set(-0.12, -Math.PI / 2, 0);
    mesh.position.set(x,y,z); mesh.renderOrder = name === 'climate_fascia_feedback' ? 1 : 2; mesh.frustumCulled = false;
    console.screenMesh.parent.add(mesh);
    const result = {mesh, texture, canvas}; surfaces.push(result); return result;
  }
  function release() {
    for (const s of surfaces) { s.mesh.parent?.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.texture.dispose(); }
    surfaces = [];
  }
  CabinFeedback.register({
    id: 'climate_panel', title: 'Climatizador de dos zonas', fields: CLIMATE_FIELDS,
    init(context) {
      ctx = context; snapshot = ctx.snapshot(); panel = new ClimatePanel(() => snapshot, driverRight);
      const tick = now => {
        const console = ctx.handles()?.centerConsole;
        if (console?.screenMesh?.parent) {
          if (surfaces.length && surfaces[0].mesh.parent !== console.screenMesh.parent) release();
          if (!surfaces.length) {
            const z = console.screenMesh.position.z;
            surface(console, 'climate_feedback_panel', panel.canvas, CLIMATE_SURFACE, 1.79, .832, z);
            surface(console, 'climate_feedback_vents', createAirVentsCanvas(), AIR_VENTS_SURFACE, 1.79, .889, z);
            surface(console, 'climate_feedback_side_vent', createAirVentsCanvas(true), SIDE_VENT_SURFACE, 1.79, .86, z + .57);
            surface(console, 'climate_fascia_feedback', createVentFasciaCanvas(), VENT_FASCIA_SURFACE, 1.801, .85, z);
          }
          const visible = CabinFeedback._enabled && console.screenMesh.visible;
          for (const s of surfaces) s.mesh.visible = visible;
          if (visible && now - lastDraw >= 33) {
            lastDraw = now;
            if (panel.draw(now)) surfaces[0].texture.needsUpdate = true;
          }
        } else if (surfaces.length) release();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    onChange(changed, state) { snapshot = state; },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      release(); ctx = snapshot = panel = frame = null; lastDraw = 0;
    },
  });
})();
