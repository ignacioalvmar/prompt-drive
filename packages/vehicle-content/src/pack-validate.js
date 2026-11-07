/**
 * Content-pack validation (contract spec, "Validation"). Blocking errors and
 * warnings; designed conditions are checked by running the real resolver.
 *
 *   validatePack(pack, { roadGraph?, tasks?, checkHash? }) ->
 *     { ok, errors:[{code,message,path}], warnings:[...] }
 *
 * `roadGraph` (PromptDrive export: { map_id, map_version, nodes:[{id}],
 * reachable_from_start?:[ids] }) enables the road-node and reachability checks.
 */

import { computeContentHash } from './canonical.js';
import { createResolver } from './resolver.js';
import { normalizeText } from './normalize.js';
import { SCHEMA_VERSION, POI_CATEGORIES, MEDIA_TYPES, MEDIA_BUCKETS, NUMBER_TYPES } from './version.js';
import { parseOpeningHours } from './hours.js';

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && isFinite(v);

export function validatePack(pack, options) {
  const opts = options || {};
  const errors = [];
  const warnings = [];
  const E = (code, message, path) => errors.push({ code, message, path });
  const W = (code, message, path) => warnings.push({ code, message, path });

  if (!pack || typeof pack !== 'object') {
    E('schema', 'pack must be an object', '');
    return { ok: false, errors, warnings };
  }
  if (pack.schema_version !== SCHEMA_VERSION) E('schema', `schema_version must be "${SCHEMA_VERSION}"`, 'schema_version');
  if (!isStr(pack.pack_id)) E('schema', 'pack_id is required', 'pack_id');
  if (!Number.isInteger(pack.pack_version) || pack.pack_version < 1) E('schema', 'pack_version must be an integer >= 1', 'pack_version');
  if (!isStr(pack.locale)) E('schema', 'locale is required', 'locale');
  if (pack.extra_locales != null && !Array.isArray(pack.extra_locales)) E('schema', 'extra_locales must be an array', 'extra_locales');
  if (opts.checkHash !== false) {
    const h = computeContentHash(pack);
    if (pack.content_hash !== h) E('hash', `content_hash mismatch (declared ${pack.content_hash}, computed ${h})`, 'content_hash');
  }

  const ids = new Map();
  const entry = (e, path) => {
    if (!e || typeof e !== 'object') { E('schema', 'entry must be an object', path); return false; }
    if (!isStr(e.id)) E('schema', 'id is required', path + '.id');
    else if (ids.has(e.id)) E('duplicate_id', `duplicate id ${e.id} (also at ${ids.get(e.id)})`, path + '.id');
    else ids.set(e.id, path);
    if (!isStr(e.display_name)) E('schema', 'display_name is required', path + '.display_name');
    if (e.aliases != null && !Array.isArray(e.aliases)) E('schema', 'aliases must be an array', path + '.aliases');
    if (e.tags != null && !Array.isArray(e.tags)) E('schema', 'tags must be an array', path + '.tags');
    return true;
  };

  // ---- contacts
  if (!Array.isArray(pack.contacts)) E('schema', 'contacts must be an array', 'contacts');
  (pack.contacts || []).forEach((c, i) => {
    const p = `contacts[${i}]`;
    if (!entry(c, p)) return;
    if (c.family_names != null && !Array.isArray(c.family_names)) E('schema', 'family_names must be an array', p + '.family_names');
    if (!Array.isArray(c.numbers) || !c.numbers.length) W('no_number', `${c.id} has no phone number`, p + '.numbers');
    (c.numbers || []).forEach((n, j) => {
      if (NUMBER_TYPES.indexOf(n.type) === -1) E('schema', `number type must be one of ${NUMBER_TYPES.join(', ')}`, `${p}.numbers[${j}].type`);
      if (!isStr(n.value)) E('schema', 'number value is required', `${p}.numbers[${j}].value`);
      else if (!/0000/.test(n.value.replace(/\D/g, ''))) W('number_range', `${c.id} number ${n.value} looks outside reserved/test ranges`, `${p}.numbers[${j}].value`);
    });
  });

  // ---- media
  const media = pack.media || {};
  if (pack.media != null && typeof pack.media !== 'object') E('schema', 'media must be an object', 'media');
  for (const type of MEDIA_TYPES) {
    const bucket = MEDIA_BUCKETS[type];
    if (media[bucket] != null && !Array.isArray(media[bucket])) E('schema', `media.${bucket} must be an array`, `media.${bucket}`);
    (media[bucket] || []).forEach((m, i) => {
      const p = `media.${bucket}[${i}]`;
      entry(m, p);
      if (m.type != null && m.type !== type) E('schema', `type must be "${type}" in media.${bucket}`, p + '.type');
    });
  }
  const typeOf = (id) => {
    for (const type of MEDIA_TYPES) if ((media[MEDIA_BUCKETS[type]] || []).some((m) => m.id === id)) return type;
    return null;
  };
  (media.tracks || []).forEach((t, i) => {
    (t.artist_ids || []).forEach((a) => { if (typeOf(a) !== 'artist') E('bad_ref', `${t.id} references unknown artist ${a}`, `media.tracks[${i}].artist_ids`); });
    if (t.album_id != null && typeOf(t.album_id) !== 'album') E('bad_ref', `${t.id} references unknown album ${t.album_id}`, `media.tracks[${i}].album_id`);
  });
  ['albums', 'playlists'].forEach((b) => (media[b] || []).forEach((m, i) => {
    (m.track_ids || []).forEach((t) => { if (typeOf(t) !== 'track') E('bad_ref', `${m.id} references unknown track ${t}`, `media.${b}[${i}].track_ids`); });
    (m.artist_ids || []).forEach((a) => { if (typeOf(a) !== 'artist') E('bad_ref', `${m.id} references unknown artist ${a}`, `media.${b}[${i}].artist_ids`); });
  }));

  // ---- POIs
  if (!Array.isArray(pack.pois)) E('schema', 'pois must be an array', 'pois');
  const pois = pack.pois || [];
  if (pois.length && (!pack.map || !isStr(pack.map.map_id) || !isStr(pack.map.map_version))) {
    E('schema', 'map.map_id and map.map_version are required when the pack contains POIs', 'map');
  }
  const graph = opts.roadGraph || null;
  if (graph && pack.map && (graph.map_id !== pack.map.map_id || graph.map_version !== pack.map.map_version)) {
    E('map_mismatch', `road graph is ${graph.map_id}@${graph.map_version}, pack expects ${pack.map.map_id}@${pack.map.map_version}`, 'map');
  }
  const nodeSet = graph ? new Set((graph.nodes || []).map((n) => n.id)) : null;
  const reachable = graph && graph.reachable_from_start ? new Set(graph.reachable_from_start) : null;
  pois.forEach((poi, i) => {
    const p = `pois[${i}]`;
    if (!entry(poi, p)) return;
    if (POI_CATEGORIES.indexOf(poi.category) === -1) E('schema', `category must be one of the v1 list`, p + '.category');
    (poi.subcategories || []).forEach((s) => { if (POI_CATEGORIES.indexOf(s) === -1) E('schema', `unknown subcategory ${s}`, p + '.subcategories'); });
    const loc = poi.location || {};
    if (loc.coord_system !== 'map_local') E('schema', 'location.coord_system must be "map_local" in v1', p + '.location.coord_system');
    if (!isNum(loc.x) || !isNum(loc.y)) E('schema', 'location.x and location.y must be numbers', p + '.location');
    if (!isStr(loc.road_node_id)) E('schema', 'location.road_node_id is required', p + '.location.road_node_id');
    else if (nodeSet && !nodeSet.has(loc.road_node_id)) E('bad_road_node', `${poi.id}: road node ${loc.road_node_id} does not exist in ${graph.map_id}@${graph.map_version}`, p + '.location.road_node_id');
    else if (reachable && !reachable.has(loc.road_node_id)) E('unreachable', `${poi.id}: road node ${loc.road_node_id} is not reachable from the start position`, p + '.location.road_node_id');
    if (poi.placement != null && ['procedural', 'manual'].indexOf(poi.placement) === -1) E('schema', 'placement must be procedural or manual', p + '.placement');
    if (poi.opening_hours != null && !parseOpeningHours(poi.opening_hours)) W('opening_hours', `${poi.id}: opening_hours "${poi.opening_hours}" not understood (open_now will be unknown)`, p + '.opening_hours');
  });

  // ---- tasks: expected IDs exist
  (opts.tasks || []).forEach((t, i) => {
    const acts = (t.expected && t.expected.actions) || [];
    acts.forEach((a, j) => {
      for (const k of ['contact_id', 'item_id', 'poi_id']) {
        const v = a.args && a.args[k];
        if (v != null && typeof v === 'string' && v.indexOf('{') === -1 && !ids.has(v)) E('task_ref', `task ${t.task_id}: expected ${k} ${v} is not in the pack`, `tasks[${i}].expected.actions[${j}]`);
      }
    });
  });

  // Stop here if the structure is broken; the resolver needs a sane pack.
  if (errors.some((e) => e.code === 'schema' || e.code === 'duplicate_id')) return { ok: false, errors, warnings };

  // ---- designed conditions (run the real resolver)
  const r = createResolver(pack);
  const search = (domain, query) => {
    if (domain === 'contacts' || domain === 'phone') return r.searchContacts({ query, limit: 10 });
    if (domain === 'media') return r.searchMedia({ query, limit: 10 });
    return r.searchPoi({ query, limit: 10 }, {});
  };
  const domainOfId = (id) => {
    const d = r.domainOf(id);
    return d === 'phone' ? 'contacts' : d === 'navigation' ? 'pois' : d;
  };
  const declaredPairs = [];
  (pack.designed_conditions || []).forEach((dc, i) => {
    const p = `designed_conditions[${i}]`;
    if (dc.type === 'absent') {
      if (!isStr(dc.query_hint) || !isStr(dc.domain)) { E('schema', 'absent needs domain and query_hint', p); return; }
      const res = search(dc.domain, dc.query_hint);
      if (res.status !== 'not_found') E('designed_condition', `"${dc.label || dc.query_hint}" should be absent but "${dc.query_hint}" resolves to ${res.status} (${res.candidates.map((c) => c.id).join(', ')})`, p);
    } else if (dc.type === 'ambiguous_pair') {
      if (!Array.isArray(dc.ids) || dc.ids.length < 2) { E('schema', 'ambiguous_pair needs ids (2+)', p); return; }
      declaredPairs.push(dc.ids.slice());
      const missing = dc.ids.filter((id) => !ids.has(id));
      if (missing.length) { E('designed_condition', `ambiguous_pair references unknown ids ${missing.join(', ')}`, p); return; }
      const query = dc.query_hint || sharedQuery(r, dc.ids);
      const res = search(domainOfId(dc.ids[0]), query);
      const got = res.candidates.map((c) => c.id);
      if (res.status !== 'ambiguous' || !dc.ids.every((id) => got.indexOf(id) !== -1)) {
        E('designed_condition', `"${dc.label || query}" should be ambiguous between ${dc.ids.join(', ')} but "${query}" resolves to ${res.status} (${got.join(', ')})`, p);
      }
    } else if (dc.type === 'missing_attribute') {
      const id = dc.id || (dc.ids && dc.ids[0]);
      if (!isStr(id) || !ids.has(id)) { E('designed_condition', 'missing_attribute needs an existing id', p); return; }
      if (dc.attribute && /^numbers\./.test(dc.attribute)) {
        const want = dc.attribute.split('.')[1];
        const c = r.contactEntry(id);
        if (c && (c.numbers || []).some((n) => n.type === want)) E('designed_condition', `${id} should lack a ${want} number but has one`, p);
      }
    } else if (dc.type === 'near_miss') {
      const id = dc.id || (dc.ids && dc.ids[0]);
      if (!isStr(dc.query_hint) || !isStr(id) || !ids.has(id)) { E('designed_condition', 'near_miss needs query_hint and an existing id', p); return; }
      const res = search(domainOfId(id), dc.query_hint);
      const inCands = res.candidates.find((c) => c.id === id);
      const inSugg = (res.suggestions || []).find((c) => c.id === id);
      const hit = inCands || inSugg;
      if (!hit) E('designed_condition', `near_miss "${dc.query_hint}" does not surface ${id} (status ${res.status})`, p);
      else if (hit.score >= 0.85) E('designed_condition', `near_miss "${dc.query_hint}" matches ${id} too well (score ${hit.score})`, p);
    } else {
      E('schema', `unknown designed condition type ${dc.type}`, p);
    }
  });

  // ---- warning: undeclared collisions on own display name
  const covered = (a, b) => declaredPairs.some((ids2) => ids2.indexOf(a) !== -1 && ids2.indexOf(b) !== -1);
  const checkDomain = (list, domain) => {
    const seen = new Set();
    for (const e of list) {
      const res = search(domain, e.display_name);
      if (res.status !== 'ambiguous') continue;
      for (const c of res.candidates) {
        if (c.id === e.id) continue;
        const key = [e.id, c.id].sort().join('|');
        if (seen.has(key) || covered(e.id, c.id)) continue;
        seen.add(key);
        W('undeclared_ambiguity', `${e.id} and ${c.id} resolve to ambiguous for "${e.display_name}" but are not a declared ambiguous_pair`, '');
      }
    }
  };
  checkDomain(pack.contacts || [], 'contacts');
  checkDomain(pois, 'pois');

  return { ok: errors.length === 0, errors, warnings };
}

/** The longest name token two entries share (e.g. the given name "Andrés"). */
function sharedQuery(r, ids) {
  const names = ids.map((id) => {
    const e = r.contactEntry(id) || r.mediaEntry(id) || r.poiEntry(id);
    return e ? normalizeText([e.given_name || ''].concat(e.display_name).join(' ')).split(' ') : [];
  });
  const common = names[0].filter((t) => names.every((n) => n.indexOf(t) !== -1));
  common.sort((a, b) => b.length - a.length);
  return common[0] || '';
}
