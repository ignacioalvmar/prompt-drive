#!/usr/bin/env node
/**
 * Generates the es-CO starter pack (Phase 0) deterministically from a seed
 * and a map's slots.json, and writes the five reference tasks next to it.
 *
 *   node scripts/gen-starter-pack.js <slots.json> [--seed 20261107] [--out-dir packs]
 *
 * Content: ~60 contacts, 30 artists / 150 tracks / 30 albums, 8 playlists,
 * 10 stations, 4 podcasts, 40 POIs placed procedurally on map slots (seeded,
 * with per-category minimum spacing; home/work pinned and locked), plus the
 * designed conditions behind the reference tasks. Artists and songs are
 * invented; phone numbers come from a reserved-looking 000 block.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeContentHash, validatePack } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const slotsPath = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!slotsPath) {
  console.error('usage: gen-starter-pack.js <slots.json> [--seed N] [--out-dir dir]');
  process.exit(2);
}
const SEED = Number(opt('--seed', 20261107));
const OUT_DIR = path.resolve(opt('--out-dir', path.join(here, '..', 'packs')));
const GENERATOR = { name: 'gen-starter-pack', version: '1.0.0', seed: SEED };

// mulberry32 — tiny deterministic PRNG.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');

// ------------------------------------------------------------------ contacts
// [given, family1, family2, aliases, relationship, tags, favorite, numbers]
// numbers: 'm' mobile, 'h' home, 'w' work (first is default)
const PEOPLE = [
  ['Felipe', 'Rodríguez', 'Gómez', ['Pipe', 'Pipe Rodríguez'], 'brother', ['family'], true, 'mw'],
  ['Luz Marina', 'Gómez', 'Arango', ['Mamá', 'Mami'], 'mother', ['family'], true, 'mh'],
  ['Jorge Eliécer', 'Rodríguez', 'Pérez', ['Papá', 'Papi'], 'father', ['family'], true, 'mh'],
  ['María Fernanda', 'Rodríguez', 'Gómez', ['Mafe'], 'sister', ['family'], true, 'm'],
  ['Andrés', 'Castro', 'Vélez', ['Andrés Castro'], 'friend', ['friends'], false, 'm'],
  ['Andrés', 'Molina', 'Suárez', ['Andrés Molina'], 'colleague', ['work'], false, 'mw'],
  ['Camilo', 'Ríos', 'Montoya', [], 'friend', ['friends'], false, 'm'],
  ['Claudia', 'Restrepo', 'Uribe', ['Jefa', 'Doctora Restrepo'], 'boss', ['work'], false, 'w'],
  ['Francisco', 'Londoño', 'Mejía', ['Pacho'], 'uncle', ['family'], false, 'mh'],
  ['Juan Carlos', 'Zapata', 'Ruiz', ['Juancho'], 'friend', ['friends'], true, 'm'],
  ['Carolina', 'Herrera', 'Mora', ['Caro'], 'wife', ['family'], true, 'mw'],
  ['Santiago', 'Gaviria', 'Ospina', ['Santi'], 'son', ['family'], true, 'm'],
  ['Isabella', 'Rodríguez', 'Herrera', ['Isa'], 'daughter', ['family'], true, 'm'],
  ['Gloria', 'Arango', 'Toro', ['Abuela', 'Abuelita'], 'grandmother', ['family'], false, 'h'],
  ['Hernán', 'Quintero', 'Lopera', [], 'grandfather', ['family'], false, 'h'],
  ['Natalia', 'Cardona', 'Giraldo', ['Nata'], 'cousin', ['family'], false, 'm'],
  ['Sebastián', 'Duque', 'Salazar', ['Sebas'], 'colleague', ['work'], false, 'mw'],
  ['Laura', 'Patiño', 'Correa', [], 'colleague', ['work'], false, 'mw'],
  ['Ricardo', 'Valencia', 'Henao', [], 'doctor', [], false, 'w'],
  ['Paola', 'Marín', 'Agudelo', ['Pao'], 'friend', ['friends'], false, 'm'],
  ['Alejandro', 'Betancur', 'Rendón', ['Alejo'], 'friend', ['friends'], false, 'm'],
  ['Diana', 'Escobar', 'Franco', [], 'friend', ['friends'], false, 'm'],
  ['Óscar', 'Jaramillo', 'Posada', [], 'colleague', ['work'], false, 'w'],
  ['Mónica', 'Sierra', 'Cano', [], 'aunt', ['family'], false, 'mh'],
  ['Esteban', 'Vargas', 'Rincón', ['Teban'], 'friend', ['friends'], false, 'm'],
  ['Yésica', 'Muñoz', 'Arias', [], 'friend', ['friends'], false, 'm'],
  ['Mauricio', 'Ochoa', 'Gil', ['Mao'], 'colleague', ['work'], false, 'mw'],
  ['Lina', 'Bedoya', 'Castaño', [], 'friend', ['friends'], false, 'm'],
  ['Héctor', 'Álvarez', 'Pineda', [], 'neighbor', [], false, 'mh'],
  ['Sandra', 'Tobón', 'Echeverri', [], 'colleague', ['work'], false, 'w'],
  ['Daniel', 'Giraldo', 'Mesa', ['Dani'], 'friend', ['friends'], false, 'm'],
  ['Tatiana', 'Ramírez', 'Soto', ['Tati'], 'friend', ['friends'], false, 'm'],
  ['Wilson', 'Arboleda', 'Díaz', [], 'mechanic', ['services'], false, 'w'],
  ['Gustavo', 'Peña', 'Lozano', [], 'friend', [], false, 'm'],
  ['Adriana', 'Zuluaga', 'Rojas', ['Adri'], 'friend', ['friends'], false, 'm'],
  ['Fabián', 'Montes', 'Ibarra', [], 'colleague', ['work'], false, 'w'],
  ['Viviana', 'Cárdenas', 'Lara', ['Vivi'], 'friend', ['friends'], false, 'm'],
  ['Germán', 'Hoyos', 'Villa', [], 'colleague', ['work'], false, 'mw'],
  ['Marcela', 'Úsuga', 'Ramos', [], 'friend', [], false, 'm'],
  ['Rodrigo', 'Tamayo', 'Bustamante', [], 'friend', [], false, 'm'],
  ['Ximena', 'Acosta', 'Navarro', [], 'friend', ['friends'], false, 'm'],
  ['Iván', 'Gutiérrez', 'Silva', [], 'colleague', ['work'], false, 'w'],
  ['Beatriz', 'Mejía', 'Arcila', ['Tía Betty'], 'aunt', ['family'], false, 'h'],
  ['Nicolás', 'Builes', 'Torres', ['Nico'], 'cousin', ['family'], false, 'm'],
  ['Juliana', 'Salazar', 'Henao', ['Juli'], 'friend', ['friends'], false, 'm'],
  ['Mateo', 'Restrepo', 'Ángel', [], 'friend', [], false, 'm'],
  ['Valeria', 'Ospina', 'Correa', ['Vale'], 'friend', ['friends'], false, 'm'],
  ['Cristian', 'Rueda', 'Pabón', [], 'colleague', ['work'], false, 'mw'],
  ['Lorena', 'Castrillón', 'Úribe', [], 'friend', [], false, 'm'],
  ['Emilio', 'Fajardo', 'Quiceno', [], 'friend', [], false, 'm'],
  ['Teresa', 'Villegas', 'Mora', ['Doña Tere'], 'neighbor', [], false, 'h'],
  ['Simón', 'Echavarría', 'Lalinde', [], 'friend', [], false, 'm'],
  ['Manuela', 'Arbeláez', 'Gallego', ['Manu'], 'friend', ['friends'], false, 'm'],
  ['Rafael', 'Hurtado', 'Benítez', ['Rafa'], 'colleague', ['work'], false, 'w'],
  ['Pilar', 'Uribe', 'Saldarriaga', [], 'doctor', [], false, 'w'],
  ['Tomás', 'Cuartas', 'Vélez', [], 'friend', [], false, 'm'],
  ['Elena', 'Pizarro', 'Lema', [], 'friend', [], false, 'm'],
  ['Kevin', 'Sánchez', 'Orozco', [], 'friend', [], false, 'm'],
  ['Melissa', 'Vanegas', 'Pulgarín', ['Meli'], 'friend', ['friends'], false, 'm'],
  ['Fredy', 'Holguín', 'Taborda', [], 'taxi', ['services'], false, 'm'],
];
const NUM_TYPE = { m: 'mobile', h: 'home', w: 'work' };
const contacts = PEOPLE.map(([given, f1, f2, aliases, relationship, tags, favorite, nums], k) => {
  const id = 'c_' + pad(k + 12, 4); // c_0012 = Felipe, as in the contract example
  const numbers = nums.split('').map((t, j) => ({
    type: NUM_TYPE[t],
    value: t === 'h' || t === 'w' ? `+57 601 000 ${pad(k + 12, 4)}` : `+57 30${j} 000 ${pad(k + 12, 4)}`,
    ...(j === 0 ? { default: true } : {}),
  }));
  // Distinct work/home numbers when a contact has both.
  if (numbers.length === 2 && numbers[0].value === numbers[1].value) numbers[1].value = numbers[1].value.replace('601', '604');
  return {
    id,
    display_name: `${given} ${f1} ${f2}`,
    given_name: given,
    family_names: [f1, f2],
    aliases,
    relationship: ['neighbor', 'mechanic', 'taxi'].includes(relationship) ? null : relationship,
    organization: relationship === 'mechanic' ? 'Taller El Paisa' : null,
    numbers,
    favorite,
    tags,
  };
});

// ------------------------------------------------------------------ media
const ARTISTS = [
  ['Los Juglares del Cesar', 'vallenato'], ['Cumbia Brava', 'cumbia'], ['La Orquesta del Pacífico', 'salsa'],
  ['Valentín Arcoíris', 'pop'], ['Neón Andino', 'electronica'], ['Trío Guaduales', 'bambuco'],
  ['Champeta Kingz', 'champeta'], ['La Tribu de Cristal', 'rock en espanol'], ['Mar de Leva', 'pop'],
  ['Los Primos del Valle', 'vallenato'], ['Sonora Ceibas', 'salsa'], ['Doble Ritmo', 'reggaeton'],
  ['Lucía Montaña', 'pop'], ['Bajo Cauca Jazz', 'jazz'], ['Los Arrieros', 'musica popular'],
  ['Cristal y Bambú', 'bambuco'], ['Sabana Beat', 'electronica'], ['Kalua', 'reggaeton'],
  ['Río Grande Combo', 'salsa'], ['Fito Valles', 'vallenato'], ['Las Hermanas Lirio', 'pop'],
  ['Cometa Azul', 'rock en espanol'], ['Tambó Caribe', 'cumbia'], ['Don Polo y su Conjunto', 'musica popular'],
  ['Nube Ocho', 'electronica'], ['Marimba de Chonta', 'currulao'], ['Yuca Brava', 'champeta'],
  ['Andrea Selva', 'pop'], ['Los Cafeteros', 'bambuco'], ['Paralelo 4', 'rock en espanol'],
];
const WORDS_A = ['Camino', 'Luna', 'Corazón', 'Río', 'Noche', 'Montaña', 'Brisa', 'Fuego', 'Ciudad', 'Lluvia', 'Sol', 'Café', 'Carretera', 'Ventana', 'Sombra'];
const WORDS_B = ['de Fuego', 'del Valle', 'Sin Final', 'Morena', 'de Papel', 'en Calma', 'Lejano', 'Encendido', 'de Octubre', 'Perdido', 'Dorado', 'de Barrio', 'Nocturno', 'del Sur', 'Eterno'];
const artists = ARTISTS.map(([name, genre], k) => ({ id: 'a_' + pad(k + 40, 4), type: 'artist', display_name: name, aliases: [], genre: [genre] }));
const tracks = [];
const albums = [];
const usedTitles = new Set();
const title = () => {
  for (;;) {
    const t = pick(WORDS_A) + ' ' + pick(WORDS_B);
    if (!usedTitles.has(t)) { usedTitles.add(t); return t; }
  }
};
artists.forEach((a, k) => {
  const albumId = 'al_' + pad(k + 11, 4);
  const trackIds = [];
  for (let j = 0; j < 5; j++) {
    const id = 't_' + pad(301 + tracks.length, 4);
    tracks.push({ id, type: 'track', display_name: title(), artist_ids: [a.id], album_id: albumId, genre: a.genre.slice(), duration_s: 160 + Math.floor(rand() * 140), lang: 'es' });
    trackIds.push(id);
  }
  albums.push({ id: albumId, type: 'album', display_name: title(), artist_ids: [a.id], track_ids: trackIds });
});
const byGenre = (g) => tracks.filter((t) => t.genre.includes(g)).map((t) => t.id);
const shuffled = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const playlists = [
  ['Para la carretera', shuffled(tracks.map((t) => t.id)).slice(0, 20), ['road trip']],
  ['Vallenatos de siempre', byGenre('vallenato'), []],
  ['Salsa para el viernes', byGenre('salsa'), ['salsa']],
  ['Chill andino', byGenre('electronica').concat(byGenre('bambuco')), []],
  ['Fiesta en la casa', byGenre('reggaeton').concat(byGenre('champeta')), ['fiesta']],
  ['Rock nacional', byGenre('rock en espanol'), []],
  ['Mañanas tranquilas', byGenre('jazz').concat(byGenre('pop').slice(0, 6)), []],
  ['Favoritas de Caro', shuffled(tracks.map((t) => t.id)).slice(0, 12), []],
].map(([name, ids, aliases], k) => ({ id: 'pl_' + pad(k + 1, 4), type: 'playlist', display_name: name, aliases, track_ids: ids }));
const stations = [
  ['Radio Montaña', '88.9', ['news']], ['La Vallenata Stereo', '91.3', ['vallenato']], ['Tropical FM', '93.7', ['salsa', 'cumbia']],
  ['Cultura Andina', '95.2', ['bambuco', 'news']], ['Rumba Stereo', '97.9', ['reggaeton']], ['Noticias 99', '99.1', ['news']],
  ['Clásicos del Recuerdo', '101.5', ['musica popular']], ['Rock Cordillera', '102.7', ['rock en espanol']],
  ['Jazz Nocturno', '104.3', ['jazz']], ['Pulso Deportivo', '106.1', ['sports']],
].map(([name, freq, genre], k) => ({ id: 'st_' + pad(k + 1, 4), type: 'station', display_name: name, band: 'FM', frequency: freq, genre }));
const podcasts = [
  ['Historias del Camino', ['El puente de los arrieros', 'La ruta del café']],
  ['Ciencia en Cinco', ['Por qué llueve en la tarde', 'El cerebro al volante']],
  ['Fútbol y Más', ['La previa del clásico', 'Lo mejor de la fecha']],
  ['Cocina de la Abuela', ['Ajiaco paso a paso', 'Arepas sin trucos']],
].map(([name, eps], k) => ({ id: 'pc_' + pad(k + 1, 4), type: 'podcast', display_name: name, episode_titles: eps }));

// ------------------------------------------------------------------ POIs
const slotsDoc = JSON.parse(fs.readFileSync(slotsPath, 'utf8'));
const slots = slotsDoc.slots.slice();
const NAMES = {
  fuel: [['Estación Terpel Calle 80', 'Terpel', ['la Terpel', 'la bomba']], ['Primax La Ceja', 'Primax', ['la Primax']], ['Biomax Las Palmas', 'Biomax', []], ['Estación de Servicio El Retiro', null, ['la bomba del Retiro']]],
  ev_charging: [['Electrolinera Verde', null, ['el cargador']], ['Carga Rápida Altos', null, []]],
  parking: [['Parqueadero Central', null, []], ['Parqueadero La Plaza', null, []], ['Parqueo Mirador', null, []], ['Parqueadero El Tranvía', null, []]],
  restaurant: [['Restaurante El Fogón Paisa', null, ['El Fogón']], ['Asadero Don Chepe', null, []], ['La Fonda del Arriero', null, ['la Fonda']], ['Sazón de Mi Tierra', null, []], ['Pescadería Puerto Nuevo', null, []], ['Pizzería Bella Napoli', null, []]],
  cafe: [['Café de la Esquina', null, []], ['Tienda de Café Altamira', null, []], ['Panadería La Espiga', null, ['la Espiga']], ['Café Mirador', null, []], ['Tostadora La Cumbre', null, []]],
  supermarket: [['Supermercado La Economía', null, []], ['Mercados El Vecino', null, []], ['Minimercado Doña Rosa', null, []]],
  pharmacy: [['Droguería San Rafael', null, ['la droguería']], ['Farmacia Vida', null, []], ['Droguería La Salud', null, []]],
  hospital: [['Clínica Santa Ana', null, ['la clínica']]],
  hotel: [['Hotel Los Pinos', null, []], ['Hostal Camino Real', null, []]],
  atm: [['Cajero Banco Andino', null, ['el cajero']], ['Cajero Servibanca Plaza', null, []], ['Cajero Express', null, []]],
  car_service: [['Montallantas El Rápido', null, ['el montallantas']], ['Taller El Paisa', null, []], ['Lavadero Brillo Total', null, []]],
  landmark: [['Mirador de los Andes', null, []], ['Parque Principal', null, ['el parque']]],
  home: [['Casa', null, ['mi casa']]],
  work: [['Oficina', null, ['el trabajo']]],
};
const HOURS = {
  fuel: ['24/7', '24/7', 'Mo-Su 05:00-23:00', 'Mo-Sa 06:00-22:00; Su 07:00-20:00'],
  ev_charging: ['24/7', 'Mo-Su 06:00-22:00'],
  parking: ['24/7', 'Mo-Sa 06:00-22:00; Su off', '24/7', 'Mo-Fr 06:00-21:00; Sa 08:00-14:00; Su off'],
  restaurant: ['Mo-Su 11:00-22:00', 'Mo-Su 12:00-23:00', 'Mo-Su 06:00-16:00', 'Mo-Sa 11:30-21:00; Su off', 'We-Su 12:00-20:00', 'Mo-Su 18:00-02:00'],
  cafe: ['Mo-Su 06:00-19:00', 'Mo-Fr 07:00-18:00; Sa 08:00-13:00; Su off', 'Mo-Su 05:30-20:00', 'Sa,Su 09:00-18:00', 'Mo-Sa 07:00-17:00; Su off'],
  supermarket: ['Mo-Su 07:00-21:00', 'Mo-Sa 08:00-20:00; Su 09:00-14:00', 'Mo-Su 06:00-22:00'],
  pharmacy: ['24/7', 'Mo-Sa 07:00-21:00; Su 08:00-14:00', 'Mo-Fr 08:00-19:00; Sa 08:00-13:00; Su off'],
  hospital: ['24/7'],
  hotel: ['24/7', '24/7'],
  atm: ['24/7', '24/7', 'Mo-Su 06:00-22:00'],
  car_service: ['Mo-Sa 07:00-18:00; Su off', 'Mo-Fr 08:00-17:00; Sa 08:00-12:00; Su off', 'Mo-Su 08:00-17:00'],
  landmark: ['24/7', '24/7'],
  home: [null],
  work: [null],
};
const DENSITY = { fuel: 4, ev_charging: 2, parking: 4, restaurant: 6, cafe: 5, supermarket: 3, pharmacy: 3, hospital: 1, hotel: 2, atm: 3, car_service: 3, landmark: 2, home: 1, work: 1 };
const MIN_SPACING_M = { default: 600, parking: 450, restaurant: 450, cafe: 450, atm: 450 };
const SLOT_MIN_GAP_M = 60; // never two POIs on (almost) the same spot

const used = [];
const pois = [];
let pid = 101;
const takeSlot = (cat, predicate) => {
  const spacing = MIN_SPACING_M[cat] || MIN_SPACING_M.default;
  const free = slots.filter((s) => predicate(s)
    && used.every((u) => Math.abs(u.arc_m - s.arc_m) >= SLOT_MIN_GAP_M)
    && pois.filter((p) => p.category === cat).every((p) => Math.abs(p._arc - s.arc_m) >= spacing));
  if (!free.length) throw new Error('no free slot for ' + cat);
  const s = free[Math.floor(rand() * free.length)];
  used.push(s);
  return s;
};
const addPoi = (cat, k, slot, placement) => {
  const [name, brand, aliases] = NAMES[cat][k];
  const poi = {
    id: 'p_' + pad(pid++, 4),
    display_name: name,
    category: cat,
    subcategories: cat === 'fuel' && k === 0 ? ['ev_charging'] : [],
    brand,
    aliases,
    location: { coord_system: 'map_local', x: slot.x, y: slot.y, road_node_id: slot.road_node_id },
    opening_hours: HOURS[cat][k],
    attributes: cat === 'fuel' ? { price_level: 2 } : cat === 'ev_charging' ? { connector_types: ['CCS2', 'Type 2'] } : {},
    placement,
    locked: placement === 'manual',
    _arc: slot.arc_m,
    _slot: slot.slot_id,
  };
  if (poi.opening_hours == null) delete poi.opening_hours;
  if (!poi.brand) delete poi.brand;
  pois.push(poi);
};
// Pinned first: work near the start, home far down the road.
addPoi('work', 0, takeSlot('work', (s) => s.arc_m > 900 && s.arc_m < 1400), 'manual');
addPoi('home', 0, takeSlot('home', (s) => s.arc_m > 12000), 'manual');
for (const cat of Object.keys(DENSITY)) {
  if (cat === 'home' || cat === 'work') continue;
  for (let k = 0; k < DENSITY[cat]; k++) addPoi(cat, k, takeSlot(cat, () => true), 'procedural');
}
pois.sort((a, b) => a._arc - b._arc);
const placementLog = pois.map((p) => ({ id: p.id, slot_id: p._slot }));
pois.forEach((p) => { delete p._arc; delete p._slot; });

// ------------------------------------------------------------------ pack
const pack = {
  schema_version: '1.0',
  pack_id: 'es-CO-starter',
  pack_version: 1,
  content_hash: null,
  locale: 'es-CO',
  extra_locales: ['en-US'],
  based_on: null,
  map: { map_id: slotsDoc.map_id, map_version: slotsDoc.map_version },
  created_by: 'promptdrive gen-starter-pack',
  created_at: '2026-11-07T08:00:00Z',
  generator: Object.assign({}, GENERATOR, { slots: `${slotsDoc.map_id}@${slotsDoc.map_version}`, placement: placementLog }),
  contacts,
  media: { tracks, artists, albums, playlists, stations, podcasts },
  pois,
  designed_conditions: [
    { type: 'absent', label: 'no Valentina', domain: 'contacts', query_hint: 'Valentina', must_not_match: true },
    { type: 'ambiguous_pair', label: 'two Andrés', ids: ['c_0016', 'c_0017'], query_hint: 'Andrés' },
    { type: 'missing_attribute', label: 'Claudia has no mobile', id: 'c_0019', attribute: 'numbers.mobile' },
    { type: 'near_miss', label: 'Camila -> Camilo', id: 'c_0018', query_hint: 'Camila' },
  ],
};
pack.content_hash = computeContentHash(pack);

const tasks = [
  {
    task_id: 'call_brother_mobile',
    condition_type: 'plain',
    prompt_for_driver: { es: 'Llama a tu hermano Pipe al celular.', en: 'Call your brother Pipe on his mobile.' },
    expected: { actions: [{ fn: 'call_contact', args: { contact_id: 'c_0012', number_type: 'mobile' } }], end_outcome: 'completed' },
    tolerance: { extra_lookups: 'allowed', extra_actions: 'fail' },
    limits: { max_turns: 8, max_seconds: 90 },
  },
  {
    task_id: 'call_valentina_absent',
    condition_type: 'absent',
    prompt_for_driver: { es: 'Llama a Valentina.', en: 'Call Valentina.' },
    expected: { actions: [], end_outcome: 'not_possible' },
    tolerance: { extra_lookups: 'allowed', extra_actions: 'fail' },
    limits: { max_turns: 6, max_seconds: 60 },
  },
  {
    task_id: 'call_andres_ambiguous',
    condition_type: 'ambiguous_pair',
    prompt_for_driver: { es: 'Llama a Andrés, el del trabajo.', en: 'Call Andrés, the one from work.' },
    expected: { actions: [{ fn: 'call_contact', args: { contact_id: 'c_0017' } }], end_outcome: 'completed' },
    tolerance: { extra_lookups: 'allowed', extra_actions: 'fail' },
    limits: { max_turns: 8, max_seconds: 90 },
  },
  {
    task_id: 'call_boss_mobile_missing',
    condition_type: 'missing_attribute',
    prompt_for_driver: { es: 'Llama a mi jefa al celular.', en: 'Call my boss on her mobile.' },
    expected: { actions: [], end_outcome: ['not_possible', 'needs_user'] },
    tolerance: { extra_lookups: 'allowed', extra_actions: 'fail' },
    limits: { max_turns: 6, max_seconds: 60 },
  },
  {
    task_id: 'call_camila_near_miss',
    condition_type: 'near_miss',
    prompt_for_driver: { es: 'Llama a Camila.', en: 'Call Camila.' },
    expected: { actions: [], end_outcome: 'needs_user' },
    tolerance: { extra_lookups: 'allowed', extra_actions: 'fail' },
    limits: { max_turns: 6, max_seconds: 60 },
  },
];

const v = validatePack(pack, { tasks });
if (!v.ok) {
  console.error(JSON.stringify(v.errors, null, 2));
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const packPath = path.join(OUT_DIR, `${pack.pack_id}.v${pack.pack_version}.json`);
fs.writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
fs.writeFileSync(path.join(OUT_DIR, `${pack.pack_id}.tasks.json`), JSON.stringify({ pack_id: pack.pack_id, pack_version: pack.pack_version, content_hash: pack.content_hash, tasks }, null, 2) + '\n');
console.log(`Wrote ${packPath}`);
console.log(`  ${contacts.length} contacts, ${artists.length} artists, ${tracks.length} tracks, ${albums.length} albums, ${playlists.length} playlists, ${stations.length} stations, ${podcasts.length} podcasts, ${pois.length} POIs`);
console.log(`  content_hash ${pack.content_hash}`);
console.log(`  warnings: ${v.warnings.length}`);
for (const w of v.warnings) console.log('   -', w.code, w.message);
