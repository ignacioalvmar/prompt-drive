/**
 * Simulated effects of content actions (PromptDrive spec, "Simulated effects
 * and vehicle state"). Deliberately simple and identical across conditions:
 *
 *   call_contact  -> phone call screen (name + number type), ring-back, then a
 *                    short neutral per-locale voice prompt; ends after 20 s or
 *                    when the driver hangs up (service timer / phone UI)
 *   send_message  -> "Message sent to …" banner for 3 s on the center console
 *   play_media    -> now-playing (console audio app) + a royalty-free
 *                    placeholder loop at low volume
 *   navigate_to / add_waypoint -> route state, drawn by the map/nav apps and
 *                    announced with a short banner
 *
 * Everything here is best-effort UI: a missing console or blocked audio never
 * changes the logged result of an action.
 */

// Neutral call voice prompt per locale. `src` may point at a recorded clip;
// without one the browser's speech synthesis speaks `text` in that locale.
export const CALL_CLIPS = {
  'es-CO': { text: 'Hola, ¿qué tal?', lang: 'es-CO', src: null },
  'es-ES': { text: 'Hola, ¿qué tal?', lang: 'es-ES', src: null },
  'en-US': { text: 'Hi, how are you?', lang: 'en-US', src: null },
  'de-DE': { text: 'Hallo, wie geht’s?', lang: 'de-DE', src: null },
};

const RINGBACK_SRC = './static/media/achievement.97104f4a.mp3';
const RINGBACK_MS = 2600;
// Royalty-free placeholder loop shipped with the sim (no copyrighted audio).
const MEDIA_PLACEHOLDER_SRC = './static/media/ambiance_spring.791a03fe.mp3';
const MEDIA_PLACEHOLDER_VOLUME = 0.12;
const BANNER_MS = 3000;

export const CONTENT_STRINGS = {
  es: {
    messageSent: (n) => `Mensaje enviado a ${n}`,
    routeTo: (n) => `Ruta a ${n}`,
    stopAdded: (n) => `Parada añadida: ${n}`,
    arrived: 'Has llegado a tu destino',
    calling: 'Llamando…',
    numberTypes: { mobile: 'Móvil', home: 'Casa', work: 'Trabajo', other: 'Otro' },
  },
  en: {
    messageSent: (n) => `Message sent to ${n}`,
    routeTo: (n) => `Route to ${n}`,
    stopAdded: (n) => `Stop added: ${n}`,
    arrived: 'You have arrived',
    calling: 'Calling…',
    numberTypes: { mobile: 'Mobile', home: 'Home', work: 'Work', other: 'Other' },
  },
  de: {
    messageSent: (n) => `Nachricht an ${n} gesendet`,
    routeTo: (n) => `Route nach ${n}`,
    stopAdded: (n) => `Zwischenstopp: ${n}`,
    arrived: 'Sie haben Ihr Ziel erreicht',
    calling: 'Anruf…',
    numberTypes: { mobile: 'Mobil', home: 'Privat', work: 'Arbeit', other: 'Andere' },
  },
};

export function contentStrings(locale) {
  return CONTENT_STRINGS[String(locale || 'en').split('-')[0]] || CONTENT_STRINGS.en;
}

function consoleInstance() {
  if (typeof window === 'undefined') return null;
  const b = window.PromptDriveBridge;
  if (b && b.handles && b.handles.centerConsole) return b.handles.centerConsole;
  return (window.CenterConsole && window.CenterConsole.lastInstance) || null;
}

function consoleApp(id) {
  const c = consoleInstance();
  return c && c.apps ? c.apps[id] : null;
}

export class ContentEffects {
  constructor() {
    this.media = null; // HTMLAudioElement for the placeholder loop
    this.ring = null;
    this._ringTimer = null;
    this._bannerTimer = null;
    this._banner = null;
    this.gain = 1;
  }

  // ------------------------------------------------------------ banner

  banner(text, kind) {
    const c = consoleInstance();
    this._banner = { text, kind: kind || 'info', until: Date.now() + BANNER_MS };
    if (!c || typeof c.registerOverlay !== 'function') return;
    const self = this;
    c.registerOverlay({
      id: 'content_banner',
      layer: 'content',
      draw(ctx, rect) {
        const b = self._banner;
        if (!b) return;
        const w = Math.min(rect.w - 40, 760);
        const h = 64;
        const x = rect.x + (rect.w - w) / 2;
        const y = rect.y + 18;
        ctx.save();
        ctx.fillStyle = 'rgba(12, 16, 22, 0.94)';
        ctx.strokeStyle = b.kind === 'ok' ? '#3ddc84' : '#40E0D0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, 14);
        else ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f4f6f8';
        ctx.font = '500 26px ShareTech, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.text, x + w / 2, y + h / 2, w - 32);
        ctx.restore();
      },
    });
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this._banner = null;
      try { c.unregisterOverlay('content_banner'); } catch (_e) {}
    }, BANNER_MS);
  }

  // ------------------------------------------------------------ phone

  startCall(contact, number, locale) {
    const S = contentStrings(locale);
    const phone = consoleApp('phone');
    if (phone && phone.controller && phone.controller.contentCall) {
      phone.controller.contentCall({
        name: contact.display_name,
        label: (S.numberTypes[number.type] || number.type),
        hue: hueOf(contact.id),
      });
    }
    this._stopRing();
    try {
      this.ring = new Audio(RINGBACK_SRC);
      this.ring.loop = true;
      this.ring.volume = 0.3 * this.gain;
      const p = this.ring.play();
      if (p && p.catch) p.catch(() => {});
    } catch (_e) {
      this.ring = null;
    }
    this._ringTimer = setTimeout(() => {
      this._stopRing();
      this._speakClip(locale);
    }, RINGBACK_MS);
  }

  _stopRing() {
    clearTimeout(this._ringTimer);
    this._ringTimer = null;
    if (this.ring) {
      try { this.ring.pause(); } catch (_e) {}
      this.ring = null;
    }
  }

  _speakClip(locale) {
    const clip = CALL_CLIPS[locale] || CALL_CLIPS[Object.keys(CALL_CLIPS).find((k) => k.split('-')[0] === String(locale).split('-')[0])] || CALL_CLIPS['en-US'];
    try {
      if (clip.src) {
        const a = new Audio(clip.src);
        a.volume = 0.8 * this.gain;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        return;
      }
      if (typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
        const u = new SpeechSynthesisUtterance(clip.text);
        u.lang = clip.lang;
        u.volume = Math.max(0, Math.min(1, this.gain));
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch (_e) {}
  }

  endCall() {
    this._stopRing();
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_e) {}
    const phone = consoleApp('phone');
    if (phone && phone.controller && phone.controller.contentEnd) phone.controller.contentEnd();
  }

  messageSent(contact, locale) {
    this.banner(contentStrings(locale).messageSent(contact.display_name), 'ok');
  }

  // ------------------------------------------------------------ media

  playMedia(view) {
    const audio = consoleApp('audio');
    // The legacy sample player and the content player never play together.
    try { if (audio && audio.controller && audio.controller.status().playing) audio.controller.pause(); } catch (_e) {}
    if (!this.media) {
      try {
        this.media = new Audio(MEDIA_PLACEHOLDER_SRC);
        this.media.loop = true;
      } catch (_e) {
        this.media = null;
      }
    }
    if (this.media) {
      try {
        this.media.volume = MEDIA_PLACEHOLDER_VOLUME * this.gain;
        this.media.currentTime = 0;
        const p = this.media.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_e) {}
    }
    const c = consoleInstance();
    if (c && typeof c._requestDraw === 'function') c._requestDraw();
    return view;
  }

  stopMedia() {
    if (this.media) {
      try { this.media.pause(); } catch (_e) {}
    }
  }

  setGain(g) {
    this.gain = Math.max(0, Math.min(1, typeof g === 'number' && isFinite(g) ? g : 1));
    if (this.media) {
      try { this.media.volume = MEDIA_PLACEHOLDER_VOLUME * this.gain; } catch (_e) {}
    }
  }

  // ------------------------------------------------------------ navigation

  routeChanged(view, reason) {
    const svc = typeof window !== 'undefined' && window.VehicleContent ? window.VehicleContent.service : null;
    const S = contentStrings(svc ? svc.locale : 'en');
    if (reason === 'arrived') this.banner(S.arrived, 'ok');
    else if (view && view.stops && view.stops.length) {
      const dest = view.stops[view.stops.length - 1];
      this.banner(view.stops.length > 1 && this._lastStops === view.stops.length - 1
        ? S.stopAdded(view.stops[view.stops.length - 2].display_name)
        : S.routeTo(dest.display_name));
    }
    this._lastStops = view && view.stops ? view.stops.length : 0;
    try {
      if (window.PromptDriveBridge) window.PromptDriveBridge.emit('vehicleNavDisplay', { meta: view ? { destination: view.stops[view.stops.length - 1].display_name, distance_m: view.length_m, eta_s: view.eta_s } : null });
    } catch (_e) {}
  }

  // ------------------------------------------------------------ fail closed

  sessionError(error) {
    if (typeof document === 'undefined') return;
    try {
      if (window.PromptDriveBridge && typeof window.PromptDriveBridge.pause === 'function') window.PromptDriveBridge.pause();
    } catch (_e) {}
    let el = document.getElementById('pd-content-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pd-content-error';
      el.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;'
        + 'background:rgba(8,10,14,0.92);color:#f4f6f8;font:16px/1.45 system-ui,Segoe UI,Arial,sans-serif;';
      document.body.appendChild(el);
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    el.innerHTML = '<div style="max-width:640px;padding:28px 32px;border:2px solid #e5484d;border-radius:14px;background:#14171c">'
      + '<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#e5484d;margin-bottom:8px">Session stopped — content check failed</div>'
      + '<div style="font-size:24px;font-weight:600;margin-bottom:12px">' + esc(error.message) + '</div>'
      + '<div style="color:rgba(188,193,200,.85)">Code <code>' + esc(error.code) + '</code>. The session will not start with a wrong or partial content pack. '
      + 'Fix the session configuration (pack, map version) and reload.</div></div>';
  }

  clearSessionError() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('pd-content-error');
    if (el) el.remove();
  }
}

/** Stable avatar hue from an entry id. */
export function hueOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}
