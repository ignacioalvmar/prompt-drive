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

import { CONSOLE_COLORS, PHONE_CONTACTS, PHONE_RINGTONE } from '../config.js';
import { clamp, font, formatTime, drawText, fillRoundRect, drawAvatar, iconPhone, iconPhoneUp, iconPhoneDown } from '../ui.js';

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

export const PhoneApp = {
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
