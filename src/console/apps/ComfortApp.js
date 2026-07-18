/**
 * Comfort app: seat + climate controls for the center console. Three zones
 * (driver / passenger / rear), each with temperature, fan level and seat-heat
 * controls, plus AUTO and SYNC toggles. Zone state is a module-level singleton
 * persisted under CONSOLE_STORAGE.comfort so the programmatic controller
 * (PromptDrive.console) works even while the app is not visible; pure-UI state
 * (selected zone tab in the compact layout) lives in env.state. Every state
 * mutation emits a 'consoleComfort' event carrying the full nested snapshot.
 */

import { CONSOLE_COLORS, CONSOLE_STORAGE, COMFORT_DEFAULTS, COMFORT_ZONES, COMFORT_LIMITS } from '../config.js';
import { clamp, colorLerp, drawText, fillRoundRect, button, iconComfort, iconFan, iconMinus, iconPlus } from '../ui.js';

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

export const ComfortApp = {
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
