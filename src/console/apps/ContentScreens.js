/**
 * Content-mode screens for the Phone, Media and Navigation apps (PromptDrive
 * spec, "HMI changes"). While a content pack is loaded
 * (window.VehicleContent.active) these screens replace the apps' built-in
 * sample data: they hold NO data of their own and render only what the
 * runtime service returns. Every touch that reads or acts on content is a
 * logged vehicle-tools call with source "hmi_touch":
 *
 *   Phone  list/search -> search_contacts   detail -> get_contact
 *          call -> call_contact (number-type picker when several numbers)
 *          quick message -> send_message
 *   Media  tabs per type -> search_media (empty query = browse; stations by
 *          frequency)   search -> search_media   tap -> play_media
 *   Nav    category shortcuts / search -> search_poi (near vehicle or along
 *          route; "no route active" shown from the service)   detail ->
 *          get_poi   go -> navigate_to   add stop -> add_waypoint
 *
 * Screens re-query only on explicit actions (open, tab, search, scroll to the
 * end), never per frame, so the log mirrors what the driver did.
 */

import { CONSOLE_COLORS } from '../config.js';
import { clamp, drawText, fillRoundRect, button, drawAvatar, iconPhoneUp } from '../ui.js';

const CS_TAP_SLOP = 8;

const CS_STRINGS = {
  es: {
    phone: 'Teléfono', media: 'Medios', nav: 'Navegación', contacts: 'contactos', search: 'Buscar', cancel: 'Cancelar',
    noResults: (q) => `Sin resultados para “${q}”`, empty: 'No hay elementos', back: 'Atrás', call: 'Llamar',
    message: 'Mensaje', chooseNumber: 'Elige un número', sendQuick: 'Mensaje rápido', ambiguous: 'Varias coincidencias',
    didYouMean: '¿Quisiste decir…?', tabs: { track: 'Canciones', artist: 'Artistas', album: 'Álbumes', playlist: 'Listas', station: 'Radio', podcast: 'Podcasts' },
    nowPlaying: 'Reproduciendo', stop: 'Detener', near: 'Cerca', alongRoute: 'En la ruta', noRoute: 'No hay ruta activa',
    go: 'Ir', addStop: 'Añadir parada', brand: 'Marca', open: 'Abierto', closed: 'Cerrado', hours: 'Horario', km: 'km', m: 'm',
    route: 'Ruta', cancelRoute: 'Cancelar ruta', eta: 'Llegada', searchPlaces: 'Buscar lugares', categories: 'Categorías',
    quick: ['Voy en camino', 'Llego en 10 minutos', 'Te llamo más tarde'],
    numberTypes: { mobile: 'Móvil', home: 'Casa', work: 'Trabajo', other: 'Otro' },
    rel: { brother: 'Hermano', sister: 'Hermana', mother: 'Mamá', father: 'Papá', wife: 'Esposa', husband: 'Esposo', son: 'Hijo', daughter: 'Hija', boss: 'Jefe/a', friend: 'Amigo/a', colleague: 'Colega', cousin: 'Primo/a', uncle: 'Tío', aunt: 'Tía', grandmother: 'Abuela', grandfather: 'Abuelo', doctor: 'Médico/a' },
    cat: { fuel: 'Gasolina', ev_charging: 'Carga', parking: 'Parqueadero', restaurant: 'Restaurante', cafe: 'Café', supermarket: 'Mercado', pharmacy: 'Droguería', hospital: 'Hospital', hotel: 'Hotel', atm: 'Cajero', car_service: 'Taller', landmark: 'Lugares', home: 'Casa', work: 'Trabajo' },
  },
  en: {
    phone: 'Phone', media: 'Media', nav: 'Navigation', contacts: 'contacts', search: 'Search', cancel: 'Cancel',
    noResults: (q) => `No results for “${q}”`, empty: 'Nothing here', back: 'Back', call: 'Call',
    message: 'Message', chooseNumber: 'Choose a number', sendQuick: 'Quick message', ambiguous: 'Several matches',
    didYouMean: 'Did you mean…?', tabs: { track: 'Songs', artist: 'Artists', album: 'Albums', playlist: 'Playlists', station: 'Radio', podcast: 'Podcasts' },
    nowPlaying: 'Now playing', stop: 'Stop', near: 'Nearby', alongRoute: 'Along route', noRoute: 'No route active',
    go: 'Go', addStop: 'Add stop', brand: 'Brand', open: 'Open', closed: 'Closed', hours: 'Hours', km: 'km', m: 'm',
    route: 'Route', cancelRoute: 'Cancel route', eta: 'ETA', searchPlaces: 'Search places', categories: 'Categories',
    quick: ['On my way', 'Arriving in 10 minutes', 'I will call you later'],
    numberTypes: { mobile: 'Mobile', home: 'Home', work: 'Work', other: 'Other' },
    rel: {},
    cat: { fuel: 'Fuel', ev_charging: 'Charging', parking: 'Parking', restaurant: 'Restaurant', cafe: 'Café', supermarket: 'Grocery', pharmacy: 'Pharmacy', hospital: 'Hospital', hotel: 'Hotel', atm: 'ATM', car_service: 'Car service', landmark: 'Landmarks', home: 'Home', work: 'Work' },
  },
};

const CS_MEDIA_TABS = ['track', 'artist', 'album', 'playlist', 'station', 'podcast'];
const CS_NAV_CATS = ['fuel', 'ev_charging', 'parking', 'restaurant', 'cafe', 'supermarket', 'pharmacy', 'atm', 'car_service', 'hotel', 'hospital', 'home', 'work', 'landmark'];

export function contentLive() {
  return typeof window !== 'undefined' && !!window.VehicleContent && window.VehicleContent.active;
}

function csVC() {
  return window.VehicleContent;
}

function csS() {
  const loc = csVC() ? csVC().locale() : 'en';
  return CS_STRINGS[String(loc).split('-')[0]] || CS_STRINGS.en;
}

/** One logged HMI call. */
function csCall(fn, args) {
  try {
    return csVC().call(fn, args || {}, { source: 'hmi_touch' });
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

function csFmtDist(m, S) {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} ${S.km}` : `${Math.round(m / 10) * 10} ${S.m}`;
}

function csFmtEta(s) {
  if (s == null) return '';
  const min = Math.max(1, Math.round(s / 60));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// --------------------------------------------------------------- keyboard

const CS_KB_ROWS = ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'];

/** On-screen keyboard; returns its top y. Hit id 'kb' with data.key. */
function csDrawKeyboard(ctx, hits, rect, query, S) {
  const w = rect.w;
  const kh = rect.compact ? 46 : 54;
  const gap = 6;
  const rows = CS_KB_ROWS.length + 1;
  const top = rect.h - rows * (kh + gap) - 8;
  // Query field.
  const fy = top - (rect.compact ? 54 : 64);
  fillRoundRect(ctx, 16, fy, w - 32, rect.compact ? 44 : 52, 12, CONSOLE_COLORS.panelRaised);
  drawText(ctx, (query || '') + (Math.floor(Date.now() / 500) % 2 ? '|' : ''), 32, fy + (rect.compact ? 22 : 26), { size: rect.compact ? 20 : 24, baseline: 'middle', maxWidth: w - 64 });
  const keyW = (w - 32 - gap * 9) / 10;
  CS_KB_ROWS.forEach((row, r) => {
    const y = top + r * (kh + gap);
    const rowW = row.length * keyW + (row.length - 1) * gap;
    let x = (w - rowW) / 2 - (r === 2 ? keyW * 0.75 : 0);
    for (const ch of row) {
      button(ctx, hits, 'kb', x, y, keyW, kh, { label: ch.toUpperCase(), textSize: kh * 0.42 });
      hits.regions[hits.regions.length - 1].data = { key: ch };
      x += keyW + gap;
    }
    if (r === 2) {
      button(ctx, hits, 'kb', x, y, keyW * 1.5, kh, { label: '⌫', textSize: kh * 0.42 });
      hits.regions[hits.regions.length - 1].data = { key: 'back' };
    }
  });
  const y = top + 3 * (kh + gap);
  const bw = (w - 32 - gap * 2) / 4;
  button(ctx, hits, 'kb', 16, y, bw, kh, { label: S.cancel, kind: 'ghost', textSize: kh * 0.36 });
  hits.regions[hits.regions.length - 1].data = { key: 'cancel' };
  button(ctx, hits, 'kb', 16 + bw + gap, y, bw * 2, kh, { label: '␣', textSize: kh * 0.42 });
  hits.regions[hits.regions.length - 1].data = { key: ' ' };
  button(ctx, hits, 'kb', 16 + bw * 3 + gap * 2, y, bw, kh, { label: S.search, kind: 'solid', textSize: kh * 0.36 });
  hits.regions[hits.regions.length - 1].data = { key: 'enter' };
  return fy;
}

/** Apply a key to st.query; returns 'enter' | 'cancel' | null. */
function csKey(st, key) {
  if (key === 'enter' || key === 'cancel') return key;
  if (key === 'back') st.query = (st.query || '').slice(0, -1);
  else st.query = ((st.query || '') + key).slice(0, 40);
  return null;
}

// --------------------------------------------------------------- list

/**
 * Scrollable list. rows: array; drawRow(ctx, row, x, y, w, h, i, hits).
 * Registers 'csList' (drag) then per-row hits added by drawRow (clipped).
 */
function csDrawList(ctx, env, x, top, w, bottom, rows, rowH, drawRow) {
  const st = env.state.cs;
  const listH = bottom - top;
  const maxScroll = Math.max(0, rows.length * rowH - listH);
  st.scroll = clamp(st.scroll || 0, 0, maxScroll);
  st.maxScroll = maxScroll;
  env.hits.add('csList', x, top, w, listH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, w, listH);
  ctx.clip();
  const first = Math.max(0, Math.floor(st.scroll / rowH));
  const last = Math.min(rows.length - 1, Math.ceil((st.scroll + listH) / rowH));
  for (let i = first; i <= last; i++) {
    const y = top + i * rowH - st.scroll;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 16, y + rowH - 1, w - 32, 1);
    const before = env.hits.regions.length;
    drawRow(ctx, rows[i], x, y, w, rowH, i, env.hits);
    // Clip the new hit regions to the visible list.
    for (let k = before; k < env.hits.regions.length; k++) {
      const r = env.hits.regions[k];
      const y0 = Math.max(r.y, top);
      const y1 = Math.min(r.y + r.h, bottom);
      r.y = y0;
      r.h = Math.max(0, y1 - y0);
    }
  }
  ctx.restore();
  if (maxScroll > 0) {
    const thumbH = Math.max(28, listH * (listH / (rows.length * rowH)));
    fillRoundRect(ctx, x + w - 6, top + (st.scroll / maxScroll) * (listH - thumbH), 3, thumbH, 1.5, 'rgba(255,255,255,0.22)');
  }
  return maxScroll;
}

function csHeader(ctx, rect, env, title, sub, opts) {
  const o = opts || {};
  const pad = rect.compact ? 16 : 24;
  const hh = rect.compact ? 60 : 74;
  let tx = pad;
  if (o.back) {
    button(ctx, env.hits, 'csBack', pad, hh / 2 - 22, 44, 44, { label: '‹', textSize: 30 });
    tx += 56;
  }
  drawText(ctx, title, tx, hh * 0.62, { size: rect.compact ? 24 : 30, weight: 600, maxWidth: rect.w - tx - 200 });
  let rx = rect.w - pad;
  if (o.search) {
    button(ctx, env.hits, 'csSearch', rx - 120, hh / 2 - 22, 120, 44, { label: '⌕ ' + csS().search, textSize: 18 });
    rx -= 132;
  }
  if (sub) drawText(ctx, sub, rx, hh * 0.62, { size: rect.compact ? 14 : 17, color: CONSOLE_COLORS.muted, align: 'right', maxWidth: 260 });
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, hh, rect.w - pad * 2, 1);
  return hh + 4;
}

function csMessage(ctx, rect, y, text, color) {
  drawText(ctx, text, rect.w / 2, y, { size: rect.compact ? 17 : 21, color: color || CONSOLE_COLORS.muted, align: 'center', maxWidth: rect.w - 48 });
}

/** Shared pointer handling: drag-scroll lists, tap on up; returns the tapped hit. */
function csPointer(type, x, y, env, onTap) {
  const st = env.state.cs;
  if (type === 'down') {
    const hit = env.hits.at(x, y);
    if (!hit) return false;
    st.drag = { lastY: y, lastX: x, moved: 0, hit };
    return true;
  }
  if (type === 'move' && st.drag) {
    const dy = y - st.drag.lastY;
    st.drag.moved += Math.abs(dy) + Math.abs(x - st.drag.lastX);
    st.drag.lastY = y;
    st.drag.lastX = x;
    if (st.drag.moved > CS_TAP_SLOP) st.scroll = clamp((st.scroll || 0) - dy, 0, st.maxScroll || 0);
    return true;
  }
  if (type === 'up' && st.drag) {
    const tap = st.drag.moved < CS_TAP_SLOP;
    st.drag = null;
    if (tap) {
      const hit = env.hits.at(x, y);
      if (hit) onTap(hit);
    }
    return true;
  }
  return false;
}

function csState(env) {
  if (!env.state.cs) env.state.cs = { screen: 'list', query: '', results: null, scroll: 0 };
  return env.state.cs;
}

// ================================================================= PHONE

function csPhoneLoad(st, query) {
  st.lastQuery = query || '';
  st.results = csCall('search_contacts', query ? { query, limit: 10 } : { query: '' });
  st.scroll = 0;
  st.screen = 'list';
}

export const ContentPhone = {
  draw(ctx, rect, env) {
    const S = csS();
    const st = csState(env);
    ctx.fillStyle = CONSOLE_COLORS.screenBg;
    ctx.fillRect(0, 0, rect.w, rect.h);
    if (!st.results) csPhoneLoad(st, '');
    if (st.screen === 'search') {
      const top = csHeader(ctx, rect, env, S.search, null, { back: true });
      void top;
      csDrawKeyboard(ctx, env.hits, rect, st.query, S);
      return;
    }
    if (st.screen === 'detail' && st.contact) return this._drawDetail(ctx, rect, env, st, S);
    if (st.screen === 'picker' && st.pickRow) return this._drawPicker(ctx, rect, env, st, S);

    const r = st.results || { status: 'not_found', candidates: [] };
    const sub = st.lastQuery ? `“${st.lastQuery}”` : `${r.total_matches || 0} ${S.contacts}`;
    const top = csHeader(ctx, rect, env, S.phone, sub, { search: true, back: !!st.lastQuery });
    let rows = r.candidates || [];
    let note = null;
    if (r.status === 'not_found') {
      note = S.noResults(st.lastQuery);
      rows = r.suggestions || [];
    } else if (r.status === 'ambiguous') note = S.ambiguous;
    let listTop = top;
    if (note) {
      csMessage(ctx, rect, top + 30, note + (rows.length && r.status === 'not_found' ? ' · ' + S.didYouMean : ''));
      listTop += 50;
    }
    const rowH = rect.compact ? 64 : 78;
    csDrawList(ctx, env, 0, listTop, rect.w, rect.h - 8, rows, rowH, (c, row, x, y, w, h, i, hits) => {
      const cy = y + h / 2;
      const ar = rect.compact ? 19 : 23;
      drawAvatar(c, 24 + ar, cy, ar, row.display_name, csVC().hueOf(row.id));
      const tx = 24 + ar * 2 + 16;
      const rel = row.relationship ? (S.rel[row.relationship] || row.relationship) : '';
      drawText(c, row.display_name, tx, rel ? cy - 5 : cy, { size: rect.compact ? 19 : 22, baseline: rel ? 'alphabetic' : 'middle', maxWidth: w - tx - 100 });
      if (rel) drawText(c, rel, tx, cy + 19, { size: rect.compact ? 14 : 16, color: CONSOLE_COLORS.muted });
      hits.add('csRow', 0, y, w, h, { i });
      const bx = w - 24 - 28;
      c.beginPath();
      c.arc(bx, cy, 26, 0, Math.PI * 2);
      c.fillStyle = CONSOLE_COLORS.success;
      c.fill();
      iconPhoneUp(c, bx, cy, 22, '#06240f');
      hits.add('csQuickCall', bx - 30, cy - 30, 60, 60, { i });
    });
  },

  /** Number-type picker straight from the search summary (no extra lookup,
   * so a touch call logs the same sequence as an agent: search -> call). */
  _drawPicker(ctx, rect, env, st, S) {
    const row = st.pickRow;
    const top = csHeader(ctx, rect, env, row.display_name, S.chooseNumber, { back: true });
    const x0 = 24;
    const bw = rect.w - 48;
    let y = top + 24;
    for (const t of row.number_types || []) {
      button(ctx, env.hits, 'csPick', x0, y, bw, 64, { label: (S.numberTypes[t] || t) + '  ·  ' + S.call, kind: 'success', textSize: 22 });
      env.hits.regions[env.hits.regions.length - 1].data = { type: t };
      y += 76;
    }
  },

  _drawDetail(ctx, rect, env, st, S) {
    const c = st.contact;
    const top = csHeader(ctx, rect, env, c.display_name, c.relationship ? (S.rel[c.relationship] || c.relationship) : '', { back: true });
    const pad = 24;
    const cx = rect.compact ? rect.w / 2 : 120;
    drawAvatar(ctx, cx, top + 70, rect.compact ? 40 : 56, c.display_name, csVC().hueOf(c.id));
    const x0 = rect.compact ? pad : 220;
    let y = rect.compact ? top + 140 : top + 24;
    drawText(ctx, S.call, x0, y + 20, { size: 18, color: CONSOLE_COLORS.muted });
    y += 34;
    const bw = rect.w - x0 - pad;
    for (const n of c.numbers || []) {
      fillRoundRect(ctx, x0, y, bw, 58, 12, CONSOLE_COLORS.panelRaised);
      drawText(ctx, S.numberTypes[n.type] || n.type, x0 + 18, y + 25, { size: 20, weight: 600 });
      drawText(ctx, n.value, x0 + 18, y + 47, { size: 15, color: CONSOLE_COLORS.muted });
      button(ctx, env.hits, 'csDial', x0 + bw - 236, y + 8, 110, 42, { label: S.call, kind: 'success', textSize: 17 });
      env.hits.regions[env.hits.regions.length - 1].data = { type: n.type };
      button(ctx, env.hits, 'csMsgOpen', x0 + bw - 118, y + 8, 110, 42, { label: S.message, textSize: 17 });
      env.hits.regions[env.hits.regions.length - 1].data = { type: n.type };
      y += 68;
    }
    if (st.msgType) {
      drawText(ctx, S.sendQuick, x0, y + 24, { size: 18, color: CONSOLE_COLORS.muted });
      y += 36;
      for (const q of S.quick) {
        button(ctx, env.hits, 'csQuick', x0, y, bw, 48, { label: q, textSize: 18 });
        env.hits.regions[env.hits.regions.length - 1].data = { text: q };
        y += 56;
      }
    }
  },

  onPointer(type, x, y, rect, env) {
    const st = csState(env);
    if (st.screen === 'search' && type === 'down') {
      const hit = env.hits.at(x, y);
      if (!hit) return false;
      if (hit.id === 'csBack') { st.screen = 'list'; return false; }
      if (hit.id === 'kb') {
        const k = csKey(st, hit.data.key);
        if (k === 'cancel') st.screen = 'list';
        if (k === 'enter') csPhoneLoad(st, st.query.trim());
      }
      return false;
    }
    return csPointer(type, x, y, env, (hit) => {
      const rows = st.results ? (st.results.status === 'not_found' ? st.results.suggestions || [] : st.results.candidates || []) : [];
      if (hit.id === 'csBack') {
        if (st.screen === 'detail' || st.screen === 'picker') { st.screen = 'list'; st.contact = null; st.pickRow = null; st.msgType = null; }
        else csPhoneLoad(st, '');
      } else if (hit.id === 'csSearch') {
        st.screen = 'search';
        st.query = '';
      } else if (hit.id === 'csRow' || hit.id === 'csQuickCall') {
        const row = rows[hit.data.i];
        if (!row) return;
        if (hit.id === 'csQuickCall') {
          if (row.number_types && row.number_types.length > 1) {
            st.pickRow = row; // several numbers -> number-type picker
            st.screen = 'picker';
          } else {
            csCall('call_contact', { contact_id: row.id });
          }
          return;
        }
        const r = csCall('get_contact', { contact_id: row.id });
        if (r.status === 'ok') {
          st.contact = r.item;
          st.msgType = null;
          st.screen = 'detail';
        }
      } else if (hit.id === 'csPick' && st.pickRow) {
        csCall('call_contact', { contact_id: st.pickRow.id, number_type: hit.data.type });
        st.screen = 'list';
        st.pickRow = null;
      } else if (hit.id === 'csDial' && st.contact) {
        csCall('call_contact', { contact_id: st.contact.id, number_type: hit.data.type });
      } else if (hit.id === 'csMsgOpen') {
        st.msgType = hit.data.type;
      } else if (hit.id === 'csQuick' && st.contact) {
        csCall('send_message', { contact_id: st.contact.id, text: hit.data.text, number_type: st.msgType || undefined });
        st.msgType = null;
      }
    });
  },
};

// ================================================================= MEDIA

function csMediaLoad(st) {
  st.scroll = 0;
  if (st.lastQuery) st.results = csCall('search_media', { query: st.lastQuery, limit: 10 });
  else st.results = csCall('search_media', { query: '', types: [st.tab] });
}

export const ContentMedia = {
  draw(ctx, rect, env) {
    const S = csS();
    const st = csState(env);
    if (!st.tab) st.tab = 'track';
    ctx.fillStyle = CONSOLE_COLORS.screenBg;
    ctx.fillRect(0, 0, rect.w, rect.h);
    if (!st.results) csMediaLoad(st);
    if (st.screen === 'search') {
      csHeader(ctx, rect, env, S.search, null, { back: true });
      csDrawKeyboard(ctx, env.hits, rect, st.query, S);
      return;
    }
    const r = st.results || { candidates: [] };
    const top = csHeader(ctx, rect, env, S.media, st.lastQuery ? `“${st.lastQuery}”` : `${r.total_matches || 0}`, { search: true, back: !!st.lastQuery });
    let y = top;
    if (!st.lastQuery) {
      // Tabs per media type.
      const tabs = CS_MEDIA_TABS;
      const tw = (rect.w - 32) / tabs.length;
      tabs.forEach((t, k) => {
        button(ctx, env.hits, 'csTab', 16 + k * tw + 3, y + 6, tw - 6, rect.compact ? 36 : 42, { label: S.tabs[t], active: st.tab === t, textSize: rect.compact ? 13 : 16 });
        env.hits.regions[env.hits.regions.length - 1].data = { tab: t };
      });
      y += rect.compact ? 50 : 58;
    }
    let rows = r.candidates || [];
    if (r.status === 'not_found') {
      csMessage(ctx, rect, y + 28, S.noResults(st.lastQuery));
      rows = r.suggestions || [];
      y += 46;
    } else if (!rows.length) {
      csMessage(ctx, rect, y + 28, S.empty);
    }
    const np = csVC().nowPlaying();
    const barH = np ? (rect.compact ? 70 : 82) : 0;
    const rowH = rect.compact ? 58 : 68;
    csDrawList(ctx, env, 0, y, rect.w, rect.h - barH - 6, rows, rowH, (c, row, x, yy, w, h, i, hits) => {
      const cy = yy + h / 2;
      const hue = csVC().hueOf(row.id);
      fillRoundRect(c, 20, cy - 22, 44, 44, 8, `hsl(${hue}, 55%, 38%)`);
      drawText(c, row.type === 'station' ? (row.frequency || '') : S.tabs[row.type].slice(0, 1), 42, cy, { size: row.type === 'station' ? 13 : 20, align: 'center', baseline: 'middle', weight: 600 });
      const sub = row.type === 'station' ? `${row.band || ''} ${row.frequency || ''}` : (row.artist_names || []).join(', ') || S.tabs[row.type];
      drawText(c, row.display_name, 80, cy - 4, { size: rect.compact ? 18 : 21, maxWidth: w - 120 });
      drawText(c, sub, 80, cy + 18, { size: rect.compact ? 13 : 15, color: CONSOLE_COLORS.muted, maxWidth: w - 120 });
      if (np && np.item_id === row.id) drawText(c, '♪', w - 36, cy, { size: 24, color: CONSOLE_COLORS.accent, baseline: 'middle', align: 'center' });
      hits.add('csPlay', 0, yy, w, h, { i });
    });
    if (np) {
      const by = rect.h - barH;
      fillRoundRect(ctx, 12, by + 4, rect.w - 24, barH - 10, 14, CONSOLE_COLORS.panelRaised);
      drawText(ctx, S.nowPlaying + (np.context ? ' · ' + np.context : ''), 32, by + 26, { size: 14, color: CONSOLE_COLORS.accent, maxWidth: rect.w - 220 });
      drawText(ctx, np.title + (np.subtitle ? ' — ' + np.subtitle : ''), 32, by + (rect.compact ? 52 : 58), { size: rect.compact ? 18 : 22, maxWidth: rect.w - 220 });
      button(ctx, env.hits, 'csStop', rect.w - 150, by + barH / 2 - 24, 120, 44, { label: '■ ' + S.stop, textSize: 17 });
    }
  },

  onPointer(type, x, y, rect, env) {
    const st = csState(env);
    if (st.screen === 'search' && type === 'down') {
      const hit = env.hits.at(x, y);
      if (!hit) return false;
      if (hit.id === 'csBack') { st.screen = 'list'; return false; }
      if (hit.id === 'kb') {
        const k = csKey(st, hit.data.key);
        if (k === 'cancel') st.screen = 'list';
        if (k === 'enter' && st.query.trim()) { st.lastQuery = st.query.trim(); st.screen = 'list'; csMediaLoad(st); }
      }
      return false;
    }
    return csPointer(type, x, y, env, (hit) => {
      if (hit.id === 'csTab') { st.tab = hit.data.tab; st.lastQuery = ''; csMediaLoad(st); }
      else if (hit.id === 'csBack') { st.lastQuery = ''; csMediaLoad(st); }
      else if (hit.id === 'csSearch') { st.screen = 'search'; st.query = ''; }
      else if (hit.id === 'csStop') csVC().stopPlayback();
      else if (hit.id === 'csPlay') {
        const r = st.results || {};
        const rows = r.status === 'not_found' ? r.suggestions || [] : r.candidates || [];
        const row = rows[hit.data.i];
        if (row) csCall('play_media', { item_id: row.id });
      }
    });
  },
};

// ================================================================= NAV

function csNavSearch(st, args) {
  st.lastArgs = args;
  st.results = csCall('search_poi', Object.assign({ limit: 10 }, args, st.scope === 'along_route' ? { scope: 'along_route' } : {}));
  st.scroll = 0;
  st.screen = 'results';
}

export const ContentNav = {
  /** Route banner + search button drawn over the bird view (NavApp). */
  drawOverlay(ctx, rect, env) {
    const S = csS();
    const rv = csVC().routeView();
    const pad = 14;
    button(ctx, env.hits, 'csNavOpen', rect.w - pad - 150, pad, 150, 48, { label: '⌕ ' + S.search, kind: 'solid', textSize: 18 });
    if (rv && rv.stops.length) {
      const dest = rv.stops[rv.stops.length - 1];
      const w = Math.min(rect.w - 200, 620);
      fillRoundRect(ctx, pad, pad, w, rect.compact ? 74 : 84, 14, 'rgba(12,16,22,0.92)');
      drawText(ctx, dest.display_name, pad + 18, pad + 32, { size: rect.compact ? 19 : 23, weight: 600, maxWidth: w - 160 });
      const via = rv.stops.length > 1 ? ` · ${rv.stops.length - 1} ⊙` : '';
      drawText(ctx, `${csFmtDist(rv.length_m, S)} · ${S.eta} ${csFmtEta(rv.eta_s)}${via}`, pad + 18, pad + (rect.compact ? 58 : 64), { size: rect.compact ? 15 : 18, color: CONSOLE_COLORS.accent });
      button(ctx, env.hits, 'csNavCancel', pad + w - 120, pad + 16, 104, 44, { label: '✕', textSize: 20 });
    }
  },

  /** Full-pane search UI (categories, keyboard, results, detail). */
  draw(ctx, rect, env) {
    const S = csS();
    const st = csState(env);
    ctx.fillStyle = CONSOLE_COLORS.screenBg;
    ctx.fillRect(0, 0, rect.w, rect.h);
    if (!st.scope) st.scope = 'near_vehicle';
    if (st.screen === 'search') {
      csHeader(ctx, rect, env, S.searchPlaces, null, { back: true });
      csDrawKeyboard(ctx, env.hits, rect, st.query, S);
      return;
    }
    if (st.screen === 'detail' && st.poi) return this._drawDetail(ctx, rect, env, st, S);
    const top = csHeader(ctx, rect, env, S.nav, null, { back: true, search: true });
    // Scope toggle.
    const sw = 170;
    button(ctx, env.hits, 'csScope', 20, top + 8, sw, 40, { label: S.near, active: st.scope === 'near_vehicle', textSize: 16 });
    env.hits.regions[env.hits.regions.length - 1].data = { scope: 'near_vehicle' };
    button(ctx, env.hits, 'csScope', 28 + sw, top + 8, sw, 40, { label: S.alongRoute, active: st.scope === 'along_route', textSize: 16 });
    env.hits.regions[env.hits.regions.length - 1].data = { scope: 'along_route' };
    let y = top + 58;
    if (st.screen !== 'results') {
      // Category shortcuts.
      const cols = rect.compact ? 3 : 5;
      const gw = (rect.w - 40) / cols;
      const gh = rect.compact ? 64 : 76;
      CS_NAV_CATS.forEach((cat, k) => {
        const gx = 20 + (k % cols) * gw;
        const gy = y + Math.floor(k / cols) * (gh + 8);
        const style = csVC().categoryStyle[cat] || { color: '#444' };
        fillRoundRect(ctx, gx + 4, gy, gw - 8, gh, 12, CONSOLE_COLORS.panelRaised);
        fillRoundRect(ctx, gx + 14, gy + gh / 2 - 14, 28, 28, 7, style.color);
        drawText(ctx, S.cat[cat] || cat, gx + 52, gy + gh / 2, { size: rect.compact ? 15 : 18, baseline: 'middle', maxWidth: gw - 64 });
        env.hits.add('csCat', gx + 4, gy, gw - 8, gh, { cat });
      });
      return;
    }
    const r = st.results || { candidates: [] };
    let rows = r.candidates || [];
    if (r.status === 'invalid_argument') {
      csMessage(ctx, rect, y + 40, r.message === 'No route active' ? S.noRoute : r.message, CONSOLE_COLORS.warning);
      return;
    }
    if (r.status === 'not_found') {
      csMessage(ctx, rect, y + 28, S.noResults(st.lastArgs.query || S.cat[st.lastArgs.category] || ''));
      rows = r.suggestions || [];
      y += 46;
    } else if (r.status === 'ambiguous' && rows.length > 1) {
      // fine: show the list
    }
    const rowH = rect.compact ? 62 : 72;
    csDrawList(ctx, env, 0, y, rect.w, rect.h - 8, rows, rowH, (c, row, x, yy, w, h, i, hits) => {
      const cy = yy + h / 2;
      const style = csVC().categoryStyle[row.category] || { color: '#444' };
      fillRoundRect(c, 20, cy - 18, 36, 36, 8, style.color);
      drawText(c, row.display_name, 70, cy - 4, { size: rect.compact ? 18 : 21, maxWidth: w - 260 });
      drawText(c, S.cat[row.category] || row.category, 70, cy + 18, { size: 14, color: CONSOLE_COLORS.muted });
      drawText(c, csFmtDist(row.distance_m, S), w - 120, cy - 4, { size: 18, align: 'right' });
      if (row.open_now != null) drawText(c, row.open_now ? S.open : S.closed, w - 120, cy + 18, { size: 14, align: 'right', color: row.open_now ? CONSOLE_COLORS.success : CONSOLE_COLORS.danger });
      hits.add('csPoi', 0, yy, w, h, { i });
    });
  },

  _drawDetail(ctx, rect, env, st, S) {
    const p = st.poi;
    const top = csHeader(ctx, rect, env, p.display_name, S.cat[p.category] || p.category, { back: true });
    const x0 = 28;
    let y = top + 36;
    const line = (label, value) => {
      if (value == null || value === '') return;
      drawText(ctx, label, x0, y, { size: 16, color: CONSOLE_COLORS.muted });
      drawText(ctx, String(value), x0 + 170, y, { size: 20, maxWidth: rect.w - x0 - 200 });
      y += 36;
    };
    line('↔', csFmtDist(p.distance_m, S));
    line(S.hours, p.opening_hours || '—');
    if (p.open_now != null) line('', p.open_now ? S.open : S.closed);
    if (p.brand) line(S.brand, p.brand);
    y += 10;
    const bw = Math.min(260, (rect.w - 72) / 2);
    button(ctx, env.hits, 'csGo', x0, y, bw, 56, { label: S.go, kind: 'solid', textSize: 22 });
    button(ctx, env.hits, 'csStopAdd', x0 + bw + 16, y, bw, 56, { label: S.addStop, textSize: 20 });
    if (st.actionMsg) csMessage(ctx, rect, y + 100, st.actionMsg, CONSOLE_COLORS.warning);
  },

  onPointer(type, x, y, rect, env, close) {
    const st = csState(env);
    const S = csS();
    if (st.screen === 'search' && type === 'down') {
      const hit = env.hits.at(x, y);
      if (!hit) return false;
      if (hit.id === 'csBack') { st.screen = 'home'; return false; }
      if (hit.id === 'kb') {
        const k = csKey(st, hit.data.key);
        if (k === 'cancel') st.screen = 'home';
        if (k === 'enter' && st.query.trim()) csNavSearch(st, { query: st.query.trim() });
      }
      return false;
    }
    return csPointer(type, x, y, env, (hit) => {
      if (hit.id === 'csBack') {
        if (st.screen === 'detail') st.screen = 'results';
        else if (st.screen === 'results') st.screen = 'home';
        else close();
      } else if (hit.id === 'csSearch') { st.screen = 'search'; st.query = ''; }
      else if (hit.id === 'csScope') {
        st.scope = hit.data.scope;
        if (st.screen === 'results' && st.lastArgs) csNavSearch(st, st.lastArgs);
      } else if (hit.id === 'csCat') csNavSearch(st, { category: hit.data.cat });
      else if (hit.id === 'csPoi') {
        const r = st.results || {};
        const rows = r.status === 'not_found' ? r.suggestions || [] : r.candidates || [];
        const row = rows[hit.data.i];
        if (!row) return;
        const g = csCall('get_poi', { poi_id: row.id });
        if (g.status === 'ok') { st.poi = g.item; st.actionMsg = null; st.screen = 'detail'; }
      } else if (hit.id === 'csGo' && st.poi) {
        const r = csCall('navigate_to', { poi_id: st.poi.id });
        if (r.status === 'ok') { st.screen = 'home'; close(); } else st.actionMsg = r.error_code;
      } else if (hit.id === 'csStopAdd' && st.poi) {
        const r = csCall('add_waypoint', { poi_id: st.poi.id });
        if (r.status === 'ok') { st.screen = 'home'; close(); } else st.actionMsg = r.error_code === 'no_route' ? S.noRoute : r.error_code;
      }
    });
  },
};

// ================================================================= MAP overlay

/** Route highlight + POI pins on the map app. project(x, z) -> [sx, sy]. */
export function contentMapOverlay(ctx, rect, project, k) {
  const VC = csVC();
  const svc = VC.service;
  const road = svc.road;
  const v = road.vehiclePosition();
  const rv = VC.routeView();
  if (rv && v && rv.stops.length) {
    const last = rv.stops[rv.stops.length - 1].i;
    const step = last >= v.i ? 1 : -1;
    ctx.beginPath();
    let started = false;
    for (let i = v.i; step > 0 ? i <= last : i >= last; i += step) {
      const n = road.node(i);
      if (!n) continue;
      const p = project(n.x, n.y);
      if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
      if (p[1] < -200 || p[1] > rect.h + 200) { if (started && Math.abs(i - v.i) > 50) break; }
    }
    ctx.strokeStyle = 'rgba(64,224,208,0.85)';
    ctx.lineWidth = Math.max(4, 6 * Math.min(1.5, k * 4));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  // POI pins within view.
  for (const p of svc.resolver.allPois()) {
    const s = project(p.location.x, p.location.y);
    if (s[0] < -20 || s[0] > rect.w + 20 || s[1] < -20 || s[1] > rect.h + 20) continue;
    const style = VC.categoryStyle[p.category] || { color: '#666' };
    const isStop = rv && rv.stops.some((x) => x.poi_id === p.id);
    ctx.beginPath();
    ctx.arc(s[0], s[1], isStop ? 11 : 7, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.lineWidth = isStop ? 3 : 1.5;
    ctx.strokeStyle = isStop ? CONSOLE_COLORS.accent : '#ffffff';
    ctx.stroke();
    if (isStop || k > 0.6) drawText(ctx, p.display_name, s[0] + 14, s[1] + 5, { size: 14, color: CONSOLE_COLORS.text, maxWidth: 220 });
  }
}

