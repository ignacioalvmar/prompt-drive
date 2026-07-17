/**
 * Audio app for the center console: a compact media player over the repo's
 * shipped ambience tracks (AUDIO_TRACKS). A module-level singleton owns the
 * single HTMLAudioElement (created lazily on first play) so playback survives
 * app/layout switches; album art is drawn procedurally per track and cached.
 * Persists { track, volume } under CONSOLE_STORAGE.audio and emits
 * 'consoleAudio' on every state mutation.
 */

import { AUDIO_TRACKS, CONSOLE_COLORS, CONSOLE_STORAGE } from '../config.js';
import { clamp, formatTime, drawText, fillRoundRect, roundRectPath, strokeRoundRect, button, slider, iconAudio, iconPlay, iconPause, iconPrev, iconNext, iconVolume } from '../ui.js';

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

export const AudioApp = {
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
