/**
 * The deterministic resolver (contract spec, "Matching and resolution rules").
 * Pure functions over an immutable pack: no I/O, no clock, no randomness. The
 * vehicle-dependent inputs of POI search (network distances, route, local
 * time) come in through an explicit `ctx`, so a recorded call replays
 * byte-identically.
 *
 *   const r = createResolver(pack);
 *   r.searchContacts({ query: 'Pipe' })        -> LookupResult<ContactSummary>
 *   r.searchMedia({ query, types, limit })
 *   r.searchPoi({ query, category, scope, radius_m, open_now, limit }, ctx)
 *   r.getContact(id) / r.getMedia(id) / r.getPoi(id, ctx)   -> ItemResult
 *
 * Empty `query` is the HMI browse mode: all entries, paged, status "ok".
 * The agent schema keeps `query` required; the runtime enforces that.
 */

import {
  normalizeText, indexForms, stopWordsFor, scoringTokens, tokenize, phoneticKey,
  editSimilarity, round4,
} from './normalize.js';
import { SYNONYMS, synonymLocale, synonymsVersion } from './synonyms.js';
import { isOpenAt } from './hours.js';
import {
  RESOLVER_VERSION, THRESHOLDS, SCORES, MEDIA_TYPES, MEDIA_BUCKETS, POI_CATEGORIES,
} from './version.js';

// ---------------------------------------------------------------- indexing

function makeForm(norm, stop) {
  const tokens = scoringTokens(norm, stop);
  const joined = tokens.join(' ');
  return {
    norm,
    tokens,
    joined,
    tokenSet: new Set(tokens),
    phon: phoneticKey(joined),
    phonSet: new Set(tokenize(phoneticKey(joined))),
  };
}

function fieldsOf(kind, values, stop) {
  const out = [];
  for (const v of values) {
    if (v == null || v === '') continue;
    for (const norm of indexForms(v)) out.push({ kind, form: makeForm(norm, stop) });
  }
  return out;
}

function phraseMap(table, stop) {
  // phrase (normalized, stop-stripped) -> canonical id; plus token lists for
  // subset matching ("gasolinera cercana" contains "gasolinera").
  const list = [];
  for (const id of Object.keys(table)) {
    const phrases = [id.replace(/_/g, ' ')].concat(table[id]);
    for (const p of phrases) {
      const form = makeForm(normalizeText(p), stop);
      if (form.joined) list.push({ id, joined: form.joined, tokens: form.tokens });
    }
  }
  // Longest phrases first so "estacion de carga" beats "carga".
  list.sort((a, b) => b.tokens.length - a.tokens.length || (a.joined < b.joined ? -1 : a.joined > b.joined ? 1 : 0));
  return list;
}

function matchPhrases(list, q) {
  const hits = [];
  for (const p of list) {
    if (p.joined === q.joined || p.tokens.every((t) => q.tokenSet.has(t))) {
      if (hits.indexOf(p.id) === -1) hits.push(p.id);
    }
  }
  return hits;
}

function byId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- scoring

/** Score one query form against one indexed field. Returns {score, matched_on} or null. */
function scoreField(q, field, allowSuggestion) {
  const f = field.form;
  const kind = field.kind;
  if (!q.tokens.length || !f.tokens.length) return null;
  const isNameField = kind === 'display_name' || kind === 'alias';
  const isPartField = kind === 'given_name' || kind === 'family_name';
  const isAttrField = kind === 'brand' || kind === 'genre';

  let best = null;
  const take = (score, matched_on) => {
    if (!best || score > best.score) best = { score, matched_on };
  };

  if (kind === 'phonetic') {
    if (q.phon && q.phon === f.phon) take(SCORES.phonetic, 'phonetic');
    return best;
  }

  if (q.joined === f.joined) {
    if (isNameField) take(SCORES.exact, kind);
    else if (isPartField) take(SCORES.namePart, kind);
    else if (isAttrField) take(SCORES.category, kind);
    return best;
  }
  if (isAttrField) {
    if (q.tokens.every((t) => f.tokenSet.has(t))) take(SCORES.category, kind);
    return best;
  }

  // Token-set: all query tokens present, any order.
  if (q.tokens.every((t) => f.tokenSet.has(t))) take(SCORES.tokenSet, kind);

  // Prefix: every query token is a field token or a >=3-char prefix of one.
  if (!best) {
    let prefixUsed = false;
    const allOk = q.tokens.every((t) => {
      if (f.tokenSet.has(t)) return true;
      if (t.length >= 3 && f.tokens.some((ft) => ft.length > t.length && ft.startsWith(t))) {
        prefixUsed = true;
        return true;
      }
      return false;
    });
    if (allOk && prefixUsed) take(SCORES.prefix, kind);
  }

  // Phonetic: same key for the whole string, or every query token's key present.
  if (!best && q.phon) {
    if (q.phon === f.phon || q.phonTokens.every((t) => f.phonSet.has(t))) take(SCORES.phonetic, 'phonetic');
  }

  // Fuzzy: normalized edit similarity, whole-string or token-aligned.
  if (!best) {
    let sim = editSimilarity(q.joined, f.joined);
    let aligned = 0;
    let allTokOk = true;
    for (const t of q.tokens) {
      let m = 0;
      for (const ft of f.tokens) m = Math.max(m, editSimilarity(t, ft));
      if (m < 0.8) allTokOk = false;
      aligned += m;
    }
    aligned /= q.tokens.length;
    if (allTokOk || q.tokens.length === 1) sim = Math.max(sim, aligned);
    sim = round4(sim);
    if (sim >= 0.8) take(round4(Math.min(SCORES.fuzzyMax, sim - 0.2)), kind);
    else if (allowSuggestion && sim >= 0.6) take(round4(sim - 0.2), kind);
  }
  return best;
}

function bestScore(q, fields) {
  let best = null;
  for (const fld of fields) {
    const s = scoreField(q, fld, true);
    if (!s) continue;
    // Prefer higher score; at equal score keep the first field (index order is
    // deterministic: display_name, aliases, name parts, phonetic, attributes).
    if (!best || s.score > best.score) best = s;
  }
  return best;
}

// ---------------------------------------------------------------- status

function finishLookup(scored, limit, compare) {
  scored.sort(compare);
  const accepted = scored.filter((c) => c.score >= THRESHOLDS.accept);
  if (!accepted.length) {
    const suggestions = scored
      .filter((c) => c.score >= THRESHOLDS.suggestion && c.score < THRESHOLDS.accept)
      .slice(0, THRESHOLDS.maxSuggestions)
      .map((c) => Object.assign({}, c.summary, { score: c.score, matched_on: c.matched_on }));
    const out = { status: 'not_found', candidates: [], total_matches: 0 };
    if (suggestions.length) out.suggestions = suggestions;
    return out;
  }
  const top = accepted[0];
  let band;
  if (accepted.length === 1 || round4(top.score - accepted[1].score) >= THRESHOLDS.ambiguityGap) band = [top];
  else band = accepted.filter((c) => round4(top.score - c.score) < THRESHOLDS.ambiguityGap);
  return {
    status: band.length > 1 ? 'ambiguous' : 'ok',
    candidates: band.slice(0, limit).map((c) => Object.assign({}, c.summary, { score: c.score, matched_on: c.matched_on })),
    total_matches: accepted.length,
  };
}

function browseLookup(entries, offset, limit) {
  const total = entries.length;
  const page = entries.slice(offset, offset + limit);
  const out = {
    status: 'ok',
    candidates: page.map((e) => Object.assign({}, e.summary, { score: 1, matched_on: 'display_name' })),
    total_matches: total,
  };
  if (offset + limit < total) out.next_offset = offset + limit;
  return out;
}

function clampLimit(limit, browse) {
  const max = browse ? THRESHOLDS.maxBrowseLimit : THRESHOLDS.maxLimit;
  if (limit == null) return browse ? THRESHOLDS.maxBrowseLimit : THRESHOLDS.defaultLimit;
  const n = Math.floor(Number(limit));
  if (!isFinite(n) || n < 1) return THRESHOLDS.defaultLimit;
  return Math.min(n, max);
}

const invalid = (message) => ({ status: 'invalid_argument', candidates: [], total_matches: 0, message });

// ---------------------------------------------------------------- resolver

export function createResolver(pack, options) {
  const opts = Object.assign({ maskNumbers: true }, options || {});
  const locales = [pack.locale].concat(pack.extra_locales || []).filter(Boolean);
  const stop = stopWordsFor(locales);

  const catTable = {};
  const relTable = {};
  for (const loc of locales) {
    const s = synonymLocale(loc);
    if (!s) continue;
    for (const [k, v] of Object.entries(SYNONYMS[s].categories)) catTable[k] = (catTable[k] || []).concat(v);
    for (const [k, v] of Object.entries(SYNONYMS[s].relationships)) relTable[k] = (relTable[k] || []).concat(v);
  }
  for (const c of POI_CATEGORIES) if (!catTable[c]) catTable[c] = [];
  const categoryPhrases = phraseMap(catTable, stop);
  const relationshipPhrases = phraseMap(relTable, stop);

  const queryForm = (s) => {
    const f = makeForm(normalizeText(s), stop);
    f.phonTokens = tokenize(f.phon);
    return f;
  };

  // ---- contacts
  const contacts = (pack.contacts || []).map((c) => {
    const fields = []
      .concat(fieldsOf('display_name', [c.display_name], stop))
      .concat(fieldsOf('alias', c.aliases || [], stop))
      .concat(fieldsOf('given_name', [c.given_name], stop))
      .concat(fieldsOf('family_name', c.family_names || [], stop))
      .concat(fieldsOf('phonetic', c.phonetic ? [c.phonetic] : [], stop));
    const summary = {
      id: c.id,
      display_name: c.display_name,
      relationship: c.relationship || null,
      number_types: (c.numbers || []).map((n) => n.type),
    };
    return { entry: c, fields, summary, sortKey: normalizeText(c.display_name) };
  });
  const contactById = new Map(contacts.map((c) => [c.entry.id, c]));

  // ---- media
  const media = [];
  const mediaById = new Map();
  const artistName = (id) => {
    const a = (pack.media && pack.media.artists || []).find((x) => x.id === id);
    return a ? a.display_name : null;
  };
  for (const type of MEDIA_TYPES) {
    const bucket = (pack.media && pack.media[MEDIA_BUCKETS[type]]) || [];
    for (const m of bucket) {
      const artists = (m.artist_ids || []).map(artistName).filter(Boolean);
      const extra = type === 'station' && m.frequency ? [m.frequency, (m.band || '') + ' ' + m.frequency] : [];
      const fields = []
        .concat(fieldsOf('display_name', [m.display_name], stop))
        .concat(fieldsOf('alias', (m.aliases || []).concat(extra), stop))
        .concat(fieldsOf('phonetic', m.phonetic ? [m.phonetic] : [], stop))
        .concat(fieldsOf('genre', m.genre || [], stop));
      const summary = { id: m.id, type, display_name: m.display_name, artist_names: artists };
      if (type === 'station') {
        summary.band = m.band || null;
        summary.frequency = m.frequency || null;
      }
      const rec = { entry: Object.assign({ type }, m), type, fields, summary, sortKey: normalizeText(m.display_name) };
      media.push(rec);
      mediaById.set(m.id, rec);
    }
  }

  // ---- POIs
  const pois = (pack.pois || []).map((p) => {
    const fields = []
      .concat(fieldsOf('display_name', [p.display_name], stop))
      .concat(fieldsOf('alias', p.aliases || [], stop))
      .concat(fieldsOf('phonetic', p.phonetic ? [p.phonetic] : [], stop))
      .concat(fieldsOf('brand', p.brand ? [p.brand] : [], stop));
    return { entry: p, fields, sortKey: normalizeText(p.display_name) };
  });
  const poiById = new Map(pois.map((p) => [p.entry.id, p]));

  const poiSummary = (rec, ctx) => {
    const p = rec.entry;
    let dist = null;
    try { dist = ctx && ctx.distanceTo ? ctx.distanceTo(p) : null; } catch (_e) { dist = null; }
    return {
      id: p.id,
      display_name: p.display_name,
      category: p.category,
      brand: p.brand || null,
      distance_m: dist == null ? null : Math.round(dist),
      open_now: ctx && ctx.now ? isOpenAt(p.opening_hours, ctx.now) : null,
    };
  };

  // ---------------------------------------------------------------- contacts
  function searchContacts(args) {
    const a = args || {};
    const filter = a.filter || {};
    let filterRel = null;
    if (filter.relationship) {
      const rq = queryForm(filter.relationship);
      filterRel = matchPhrases(relationshipPhrases, rq)[0] || normalizeText(filter.relationship);
    }
    let pool = contacts.filter((c) => {
      if (filterRel && c.entry.relationship !== filterRel) return false;
      if (filter.tag && (c.entry.tags || []).indexOf(filter.tag) === -1) return false;
      if (filter.favorite != null && !!c.entry.favorite !== !!filter.favorite) return false;
      return true;
    });
    const query = a.query == null ? '' : String(a.query);
    const browse = !normalizeText(query);
    const limit = clampLimit(a.limit, browse);
    if (browse) {
      pool = pool.slice().sort((x, y) => byId(x.sortKey, y.sortKey) || byId(x.entry.id, y.entry.id));
      return browseLookup(pool, Math.max(0, Math.floor(a.offset || 0)), limit);
    }
    const q = queryForm(query);
    const rels = matchPhrases(relationshipPhrases, q);
    const scored = [];
    for (const c of pool) {
      let s = bestScore(q, c.fields);
      if (rels.length && c.entry.relationship && rels.indexOf(c.entry.relationship) !== -1) {
        if (!s || SCORES.category > s.score) s = { score: SCORES.category, matched_on: 'category' };
      }
      if (s) scored.push({ score: s.score, matched_on: s.matched_on, summary: c.summary, fav: c.entry.favorite ? 1 : 0, id: c.entry.id });
    }
    return finishLookup(scored, limit, (x, y) => y.score - x.score || y.fav - x.fav || byId(x.id, y.id));
  }

  function maskNumber(v) {
    const s = String(v || '');
    const digits = s.replace(/\D/g, '');
    if (digits.length <= 4) return s;
    let seen = 0;
    const keepFrom = digits.length - 2;
    const prefixKeep = Math.min(5, digits.length - 4);
    return s.replace(/\d/g, (d) => {
      const i = seen++;
      return i < prefixKeep || i >= keepFrom ? d : '*';
    });
  }

  function getContact(id) {
    const c = contactById.get(id);
    if (!c) return { status: 'not_found' };
    const e = c.entry;
    const item = {
      id: e.id,
      display_name: e.display_name,
      given_name: e.given_name || null,
      family_names: (e.family_names || []).slice(),
      aliases: (e.aliases || []).slice(),
      relationship: e.relationship || null,
      organization: e.organization || null,
      favorite: !!e.favorite,
      tags: (e.tags || []).slice(),
      numbers: (e.numbers || []).map((n) => ({
        type: n.type,
        value: opts.maskNumbers ? maskNumber(n.value) : n.value,
        default: !!n.default,
      })),
    };
    return { status: 'ok', item };
  }

  // ---------------------------------------------------------------- media
  function searchMedia(args) {
    const a = args || {};
    const types = Array.isArray(a.types) && a.types.length ? a.types.filter((t) => MEDIA_TYPES.indexOf(t) !== -1) : null;
    let pool = types ? media.filter((m) => types.indexOf(m.type) !== -1) : media.slice();
    const query = a.query == null ? '' : String(a.query);
    const browse = !normalizeText(query);
    const limit = clampLimit(a.limit, browse);
    const typeRank = (t) => (types ? types.indexOf(t) : 0);
    if (browse) {
      const freq = (m) => {
        const f = parseFloat(m.entry.frequency);
        return isFinite(f) ? f : Infinity;
      };
      pool.sort((x, y) => {
        if (x.type === 'station' && y.type === 'station') return freq(x) - freq(y) || byId(x.entry.id, y.entry.id);
        return typeRank(x.type) - typeRank(y.type) || byId(x.sortKey, y.sortKey) || byId(x.entry.id, y.entry.id);
      });
      return browseLookup(pool, Math.max(0, Math.floor(a.offset || 0)), limit);
    }
    const q = queryForm(query);
    const scored = [];
    for (const m of pool) {
      const s = bestScore(q, m.fields);
      if (s) scored.push({ score: s.score, matched_on: s.matched_on, summary: m.summary, rank: typeRank(m.type), id: m.entry.id });
    }
    return finishLookup(scored, limit, (x, y) => y.score - x.score || x.rank - y.rank || byId(x.id, y.id));
  }

  function getMedia(id) {
    const m = mediaById.get(id);
    if (!m) return { status: 'not_found' };
    const item = JSON.parse(JSON.stringify(m.entry));
    item.artist_names = m.summary.artist_names.slice();
    if (m.type === 'album' || m.type === 'playlist') {
      item.track_count = (item.track_ids || []).length;
    }
    return { status: 'ok', item };
  }

  /** Tracks a media item would play, in order (artist/album/playlist expand). */
  function playableTracks(id) {
    const m = mediaById.get(id);
    if (!m) return [];
    const tracks = (pack.media && pack.media.tracks) || [];
    if (m.type === 'track') return [m.entry.id];
    if (m.type === 'playlist') return (m.entry.track_ids || []).slice();
    if (m.type === 'album') {
      if (m.entry.track_ids) return m.entry.track_ids.slice();
      return tracks.filter((t) => t.album_id === id).map((t) => t.id);
    }
    if (m.type === 'artist') return tracks.filter((t) => (t.artist_ids || []).indexOf(id) !== -1).map((t) => t.id).sort(byId);
    return [];
  }

  // ---------------------------------------------------------------- POIs
  function searchPoi(args, ctx) {
    const a = args || {};
    const c = ctx || {};
    const query = a.query == null ? '' : String(a.query);
    const hasQuery = !!normalizeText(query);
    const category = a.category || null;
    if (!hasQuery && !category && !a._browse) return invalid('search_poi needs query or category');
    if (category && POI_CATEGORIES.indexOf(category) === -1) return invalid('Unknown category: ' + category);
    const scope = a.scope || 'near_vehicle';
    if (['near_vehicle', 'along_route', 'near_destination'].indexOf(scope) === -1) return invalid('Unknown scope: ' + scope);
    if ((scope === 'along_route' || scope === 'near_destination') && !c.routeActive) return invalid('No route active');
    const radius = a.radius_m == null ? THRESHOLDS.defaultRadiusM : Number(a.radius_m);
    if (!isFinite(radius) || radius <= 0) return invalid('radius_m must be a positive number');

    const summaries = new Map();
    const sum = (rec) => {
      if (!summaries.has(rec.entry.id)) summaries.set(rec.entry.id, poiSummary(rec, c));
      return summaries.get(rec.entry.id);
    };
    let pool = pois.filter((rec) => {
      const p = rec.entry;
      if (category && p.category !== category && (p.subcategories || []).indexOf(category) === -1) return false;
      if (scope === 'near_vehicle') {
        const d = sum(rec).distance_m;
        if (d != null && d > radius) return false;
      } else if (scope === 'along_route') {
        const d = c.routeCorridorDistance ? c.routeCorridorDistance(p) : null;
        if (d == null || d > THRESHOLDS.alongRouteM) return false;
      } else if (scope === 'near_destination') {
        const d = c.destinationDistance ? c.destinationDistance(p) : null;
        if (d == null || d > radius) return false;
      }
      if (a.open_now && sum(rec).open_now !== true) return false;
      return true;
    });

    const browse = !hasQuery && !category;
    const limit = clampLimit(a.limit, browse);
    const dist = (s) => (s.distance_m == null ? Infinity : s.distance_m);
    const order = (x, y) => y.score - x.score || dist(x.summary) - dist(y.summary)
      || (y.summary.open_now === true ? 1 : 0) - (x.summary.open_now === true ? 1 : 0) || byId(x.id, y.id);
    if (browse) {
      const recs = pool.map((rec) => ({ summary: sum(rec), score: 1, id: rec.entry.id }));
      recs.sort(order);
      return browseLookup(recs, Math.max(0, Math.floor(a.offset || 0)), limit);
    }

    const q = hasQuery ? queryForm(query) : null;
    const qCats = q ? matchPhrases(categoryPhrases, q) : [];
    const scored = [];
    for (const rec of pool) {
      const p = rec.entry;
      let s = q ? bestScore(q, rec.fields) : null;
      const catHit = (cat) => p.category === cat || (p.subcategories || []).indexOf(cat) !== -1;
      if (q && qCats.some(catHit) && (!s || SCORES.category > s.score)) s = { score: SCORES.category, matched_on: 'category' };
      if (!q && category) s = { score: SCORES.category, matched_on: 'category' };
      if (s) scored.push({ score: s.score, matched_on: s.matched_on, summary: sum(rec), id: p.id });
    }
    return finishLookup(scored, limit, order);
  }

  function getPoi(id, ctx) {
    const rec = poiById.get(id);
    if (!rec) return { status: 'not_found' };
    const item = JSON.parse(JSON.stringify(rec.entry));
    const s = poiSummary(rec, ctx);
    item.distance_m = s.distance_m;
    item.open_now = s.open_now;
    return { status: 'ok', item };
  }

  return {
    meta: {
      resolver_version: RESOLVER_VERSION,
      synonyms_version: synonymsVersion(locales),
      locales: locales.slice(),
    },
    searchContacts,
    getContact,
    searchMedia,
    getMedia,
    playableTracks,
    searchPoi,
    getPoi,
    // Raw lookups for the runtime (actions validate IDs, effects need names).
    contactEntry: (id) => (contactById.get(id) || {}).entry || null,
    mediaEntry: (id) => (mediaById.get(id) || {}).entry || null,
    poiEntry: (id) => (poiById.get(id) || {}).entry || null,
    allPois: () => pois.map((p) => p.entry),
    /** The reference query used by the labeler: display name, then aliases. */
    referenceQueries: (id) => {
      const e = (contactById.get(id) || mediaById.get(id) || poiById.get(id) || {}).entry;
      return e ? [e.display_name].concat(e.aliases || []) : [];
    },
    domainOf: (id) => (contactById.has(id) ? 'phone' : mediaById.has(id) ? 'media' : poiById.has(id) ? 'navigation' : null),
  };
}
