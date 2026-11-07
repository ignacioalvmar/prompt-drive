// Unit tests per matching rule (contract spec, "Matching and resolution rules").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolver, normalizeText, indexForms, phoneticKey, THRESHOLDS } from '../index.js';

const base = (extra) => Object.assign({
  schema_version: '1.0', pack_id: 't', pack_version: 1, locale: 'es-CO', extra_locales: ['en-US'],
  contacts: [], media: { tracks: [], artists: [], albums: [], playlists: [], stations: [], podcasts: [] },
  pois: [], designed_conditions: [],
}, extra);

const felipe = {
  id: 'c_0012', display_name: 'Felipe Rodríguez Gómez', given_name: 'Felipe', family_names: ['Rodríguez', 'Gómez'],
  aliases: ['Pipe', 'Pipe Rodríguez'], relationship: 'brother',
  numbers: [{ type: 'mobile', value: '+57 300 000 0012', default: true }, { type: 'work', value: '+57 601 000 0012' }], favorite: true,
};
const contact = (id, given, fam, extra) => Object.assign({ id, display_name: `${given} ${fam}`, given_name: given, family_names: [fam], numbers: [{ type: 'mobile', value: '+57 300 000 ' + id.slice(2) }] }, extra || {});

const pack = base({
  contacts: [
    felipe,
    contact('c_0031', 'Andrés', 'Castro'),
    contact('c_0032', 'Andrés', 'Molina'),
    contact('c_0040', 'Jessica', 'Pardo'),
    contact('c_0041', 'Camilo', 'Ríos'),
    contact('c_0050', 'Jürgen', 'Müller'),
  ],
  pois: [
    { id: 'p_0105', display_name: 'Estación Terpel Calle 80', category: 'fuel', brand: 'Terpel', aliases: ['la Terpel', 'la bomba'], location: { coord_system: 'map_local', x: 0, y: 0, road_node_id: 'n_10' }, opening_hours: '24/7' },
    { id: 'p_0106', display_name: 'Primax Norte', category: 'fuel', brand: 'Primax', location: { coord_system: 'map_local', x: 0, y: 0, road_node_id: 'n_50' }, opening_hours: 'Mo-Fr 08:00-18:00' },
    { id: 'p_0107', display_name: 'Droguería Sur', category: 'pharmacy', location: { coord_system: 'map_local', x: 0, y: 0, road_node_id: 'n_90' } },
  ],
  media: {
    artists: [{ id: 'a_1', type: 'artist', display_name: 'Los Juglares' }],
    tracks: [{ id: 't_1', type: 'track', display_name: 'Camino Lejano', artist_ids: ['a_1'], genre: ['vallenato'] }],
    albums: [], playlists: [{ id: 'pl_1', type: 'playlist', display_name: 'Para la carretera', track_ids: ['t_1'] }],
    stations: [{ id: 'st_2', type: 'station', display_name: 'Rumba', band: 'FM', frequency: '97.9' }, { id: 'st_1', type: 'station', display_name: 'Noticias', band: 'FM', frequency: '88.9' }],
    podcasts: [],
  },
});
const r = createResolver(pack);
const top = (res) => [res.status, res.candidates[0] && res.candidates[0].id, res.candidates[0] && res.candidates[0].score, res.candidates[0] && res.candidates[0].matched_on];

test('normalization: marks, case, punctuation, German forms', () => {
  assert.equal(normalizeText('  Rodríguez, GÓMEZ! '), 'rodriguez gomez');
  assert.equal(normalizeText('Calle 80-B'), 'calle 80 b');
  assert.deepEqual(indexForms('Müller'), ['muller', 'mueller']);
  assert.equal(normalizeText('Straße'), 'strasse');
});

test('phonetic keys (locale-aware)', () => {
  assert.equal(phoneticKey('yesica'), phoneticKey('jessica'));
  assert.equal(phoneticKey('baleria'), phoneticKey('valeria'));
});

test('scoring table', () => {
  assert.deepEqual(top(r.searchContacts({ query: 'Pipe' })), ['ok', 'c_0012', 1, 'alias']);
  assert.deepEqual(top(r.searchContacts({ query: 'Rodríguez' })), ['ok', 'c_0012', 0.9, 'family_name']);
  assert.deepEqual(top(r.searchContacts({ query: 'Rodriguez' })), ['ok', 'c_0012', 0.9, 'family_name']);
  assert.deepEqual(top(r.searchContacts({ query: 'Gómez Felipe' })), ['ok', 'c_0012', 0.85, 'display_name']);
  assert.deepEqual(top(r.searchContacts({ query: 'Rodri' })), ['ok', 'c_0012', 0.75, 'display_name']);
  assert.deepEqual(top(r.searchContacts({ query: 'Yesica' })), ['ok', 'c_0040', 0.7, 'phonetic']);
  const fz = r.searchContacts({ query: 'Felpe' }).candidates[0];
  assert.equal(fz.id, 'c_0012');
  assert.ok(fz.score >= 0.6 && fz.score <= 0.8);
  assert.deepEqual(top(r.searchPoi({ query: 'gasolinera' }, {})).slice(2), [0.65, 'category']);
  assert.deepEqual(top(r.searchContacts({ query: 'Mueller' })).slice(0, 3), ['ok', 'c_0050', 0.9]);
  assert.deepEqual(top(r.searchContacts({ query: 'Muller' })).slice(0, 3), ['ok', 'c_0050', 0.9]);
});

test('stop words are dropped for scoring: "la Terpel" == "Terpel"', () => {
  assert.deepEqual(top(r.searchPoi({ query: 'la Terpel' }, {})), ['ok', 'p_0105', 1, 'alias']);
  assert.deepEqual(top(r.searchPoi({ query: 'Terpel' }, {})).slice(0, 2), ['ok', 'p_0105']);
});

test('relationship synonyms in both pack locales', () => {
  assert.deepEqual(top(r.searchContacts({ query: 'llama a mi hermano' })).slice(0, 2), ['ok', 'c_0012']);
  assert.deepEqual(top(r.searchContacts({ query: 'my brother' })).slice(0, 2), ['ok', 'c_0012']);
});

test('thresholds: ambiguous band, not_found with suggestions', () => {
  const a = r.searchContacts({ query: 'Andrés' });
  assert.equal(a.status, 'ambiguous');
  assert.deepEqual(a.candidates.map((c) => c.id), ['c_0031', 'c_0032']);
  assert.equal(a.total_matches, 2);
  const n = r.searchContacts({ query: 'Valentina' });
  assert.equal(n.status, 'not_found');
  assert.equal(n.candidates.length, 0);
  const s = r.searchContacts({ query: 'Anders' });
  assert.equal(s.status, 'not_found');
  assert.ok(s.suggestions.length >= 1 && s.suggestions.length <= THRESHOLDS.maxSuggestions);
  assert.ok(s.suggestions.every((x) => x.score >= 0.4 && x.score < 0.6));
});

test('tie-break orders but never turns ambiguous into ok (POIs by distance)', () => {
  const dist = { n_10: 900, n_50: 200, n_90: 50 };
  const ctx = { distanceTo: (p) => dist[p.location.road_node_id], now: { day: 'Sa', minutes: 600 } };
  const res = r.searchPoi({ category: 'fuel' }, ctx);
  assert.equal(res.status, 'ambiguous');
  assert.deepEqual(res.candidates.map((c) => [c.id, c.distance_m, c.open_now]), [['p_0106', 200, false], ['p_0105', 900, true]]);
  const open = r.searchPoi({ category: 'fuel', open_now: true }, ctx);
  assert.deepEqual([open.status, open.candidates.map((c) => c.id)], ['ok', ['p_0105']]);
  const near = r.searchPoi({ category: 'fuel', radius_m: 500 }, ctx);
  assert.deepEqual(near.candidates.map((c) => c.id), ['p_0106']);
});

test('search_poi argument rules', () => {
  assert.equal(r.searchPoi({}, {}).status, 'invalid_argument');
  const nr = r.searchPoi({ category: 'fuel', scope: 'along_route' }, { routeActive: false });
  assert.deepEqual([nr.status, nr.message], ['invalid_argument', 'No route active']);
  const ar = r.searchPoi({ category: 'pharmacy', scope: 'along_route' }, { routeActive: true, routeCorridorDistance: () => 120 });
  assert.equal(ar.status, 'ok');
});

test('HMI browse mode: empty query returns all, paged, sorted', () => {
  const b = r.searchContacts({ query: '', limit: 4 });
  assert.equal(b.status, 'ok');
  assert.equal(b.total_matches, 6);
  assert.equal(b.next_offset, 4);
  assert.deepEqual(b.candidates.map((c) => c.display_name), ['Andrés Castro', 'Andrés Molina', 'Camilo Ríos', 'Felipe Rodríguez Gómez']);
  const st = r.searchMedia({ query: '', types: ['station'] });
  assert.deepEqual(st.candidates.map((c) => c.frequency), ['88.9', '97.9']);
});

test('media: types order, station frequency, genre', () => {
  assert.deepEqual(top(r.searchMedia({ query: '97.9' })).slice(0, 2), ['ok', 'st_2']);
  assert.deepEqual(top(r.searchMedia({ query: 'vallenato' })).slice(2), [0.65, 'genre']);
  assert.deepEqual(r.playableTracks('a_1'), ['t_1']);
  assert.deepEqual(r.playableTracks('pl_1'), ['t_1']);
});

test('get_contact masks numbers by default; not_found for unknown ids', () => {
  const g = r.getContact('c_0012');
  assert.equal(g.status, 'ok');
  assert.deepEqual(g.item.numbers.map((n) => n.value), ['+57 300 *** **12', '+57 601 *** **12']);
  assert.equal(createResolver(pack, { maskNumbers: false }).getContact('c_0012').item.numbers[0].value, '+57 300 000 0012');
  assert.equal(r.getContact('nope').status, 'not_found');
});

test('determinism: same query, same pack -> identical results', () => {
  const queries = ['Pipe', 'Andrés', 'Felpe', 'Valentina', 'mi hermano', 'Rodri'];
  const a = queries.map((q) => JSON.stringify(createResolver(pack).searchContacts({ query: q })));
  const b = queries.map((q) => JSON.stringify(createResolver(JSON.parse(JSON.stringify(pack))).searchContacts({ query: q })));
  assert.deepEqual(a, b);
});
