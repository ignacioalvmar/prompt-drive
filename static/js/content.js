/* Content layer (vehicle-tools/1.0) — built from packages/vehicle-content + src/content/ */
(function () {
  'use strict';
  const __defs = {};
  const __cache = {};
  function __def(id, fn) { __defs[id] = fn; }
  function __req(id) {
    if (__cache[id]) return __cache[id];
    const ex = (__cache[id] = {});
    __defs[id](ex, __req);
    return ex;
  }
/* --- packages/vehicle-content/src/version.js --- */
__def("packages/vehicle-content/src/version.js", function (__exports, __req) {
/**
 * Version constants of the shared contract. Every one of these is written into
 * the session header so a log can be replayed against the exact same rules.
 *
 * Versioning policy (contract spec, "Open decisions"): additive changes bump
 * the minor version; any change to existing behavior or thresholds bumps the
 * major version. Thresholds below are frozen within 1.x.
 */

const PACKAGE_VERSION = '1.0.0';
const SCHEMA_VERSION = '1.0';
const TOOLS_VERSION = 'vehicle-tools/1.0';
const SUPPORTED_TOOLS_VERSIONS = ['vehicle-tools/1.0'];
const RESOLVER_VERSION = '1.0.0';

const THRESHOLDS = Object.freeze({
  accept: 0.6, // entries below are not candidates
  ambiguityGap: 0.15, // top must lead the 2nd by this much for `ok`
  suggestion: 0.4, // near misses returned with not_found
  maxSuggestions: 3,
  alongRouteM: 300, // along_route corridor, network metres
  defaultRadiusM: 3000,
  defaultLimit: 5,
  maxLimit: 10,
  maxBrowseLimit: 50, // HMI-only empty-query paging
});

const SCORES = Object.freeze({
  exact: 1.0,
  namePart: 0.9,
  tokenSet: 0.85,
  prefix: 0.75,
  phonetic: 0.7,
  fuzzyMin: 0.6,
  fuzzyMax: 0.8,
  category: 0.65,
});

const POI_CATEGORIES = Object.freeze([
  'fuel', 'ev_charging', 'parking', 'restaurant', 'cafe', 'supermarket', 'pharmacy',
  'hospital', 'hotel', 'atm', 'car_service', 'landmark', 'home', 'work',
]);

const MEDIA_TYPES = Object.freeze(['track', 'artist', 'album', 'playlist', 'station', 'podcast']);
const MEDIA_BUCKETS = Object.freeze({
  track: 'tracks', artist: 'artists', album: 'albums', playlist: 'playlists', station: 'stations', podcast: 'podcasts',
});
const NUMBER_TYPES = Object.freeze(['mobile', 'home', 'work', 'other']);
const END_OUTCOMES = Object.freeze(['completed', 'not_possible', 'needs_user']);
const SOURCES = Object.freeze(['agent', 'hmi_touch', 'hmi_voice']);

  Object.defineProperty(__exports, "PACKAGE_VERSION", { enumerable: true, get: () => PACKAGE_VERSION });
  Object.defineProperty(__exports, "SCHEMA_VERSION", { enumerable: true, get: () => SCHEMA_VERSION });
  Object.defineProperty(__exports, "TOOLS_VERSION", { enumerable: true, get: () => TOOLS_VERSION });
  Object.defineProperty(__exports, "SUPPORTED_TOOLS_VERSIONS", { enumerable: true, get: () => SUPPORTED_TOOLS_VERSIONS });
  Object.defineProperty(__exports, "RESOLVER_VERSION", { enumerable: true, get: () => RESOLVER_VERSION });
  Object.defineProperty(__exports, "THRESHOLDS", { enumerable: true, get: () => THRESHOLDS });
  Object.defineProperty(__exports, "SCORES", { enumerable: true, get: () => SCORES });
  Object.defineProperty(__exports, "POI_CATEGORIES", { enumerable: true, get: () => POI_CATEGORIES });
  Object.defineProperty(__exports, "MEDIA_TYPES", { enumerable: true, get: () => MEDIA_TYPES });
  Object.defineProperty(__exports, "MEDIA_BUCKETS", { enumerable: true, get: () => MEDIA_BUCKETS });
  Object.defineProperty(__exports, "NUMBER_TYPES", { enumerable: true, get: () => NUMBER_TYPES });
  Object.defineProperty(__exports, "END_OUTCOMES", { enumerable: true, get: () => END_OUTCOMES });
  Object.defineProperty(__exports, "SOURCES", { enumerable: true, get: () => SOURCES });
});

/* --- packages/vehicle-content/src/sha256.js --- */
__def("packages/vehicle-content/src/sha256.js", function (__exports, __req) {
/**
 * Synchronous SHA-256 over a UTF-8 string, in plain JS so the same code hashes
 * identically in Node, the browser and a WorlDrive worker (no async
 * crypto.subtle, no Buffer). Returns lowercase hex.
 */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function sha256Hex(str) {
  const msg = utf8Bytes(String(str));
  const bitLen = msg.length * 8;
  const total = ((msg.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // 64-bit big-endian length (high word fits for any realistic input).
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 255; buf[total - 7] = (hi >>> 16) & 255;
  buf[total - 6] = (hi >>> 8) & 255; buf[total - 5] = hi & 255;
  buf[total - 4] = (lo >>> 24) & 255; buf[total - 3] = (lo >>> 16) & 255;
  buf[total - 2] = (lo >>> 8) & 255; buf[total - 1] = lo & 255;

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let hex = '';
  for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, '0');
  return hex;
}

  Object.defineProperty(__exports, "sha256Hex", { enumerable: true, get: () => sha256Hex });
});

/* --- packages/vehicle-content/src/canonical.js --- */
__def("packages/vehicle-content/src/canonical.js", function (__exports, __req) {
/**
 * Canonical JSON + content hash (contract spec, "Envelope"): sorted keys, no
 * whitespace, computed over the whole pack except `content_hash` and
 * `created_at`. Both repos must use exactly this function.
 */

const { sha256Hex } = __req("packages/vehicle-content/src/sha256.js");

const HASH_EXCLUDED_KEYS = ['content_hash', 'created_at'];

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !isFinite(value)) throw new Error('canonicalJson: non-finite number');
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function computeContentHash(pack) {
  const copy = {};
  for (const k of Object.keys(pack || {})) {
    if (HASH_EXCLUDED_KEYS.indexOf(k) === -1) copy[k] = pack[k];
  }
  return 'sha256:' + sha256Hex(canonicalJson(copy));
}

/** Verify a pack's own content_hash (and optionally an expected one). */
function verifyContentHash(pack, expected) {
  const actual = computeContentHash(pack);
  const declared = pack && pack.content_hash;
  if (declared !== actual) return { ok: false, actual, declared, reason: 'declared_mismatch' };
  if (expected != null && expected !== actual) return { ok: false, actual, expected, reason: 'expected_mismatch' };
  return { ok: true, actual };
}

  Object.defineProperty(__exports, "canonicalJson", { enumerable: true, get: () => canonicalJson });
  Object.defineProperty(__exports, "computeContentHash", { enumerable: true, get: () => computeContentHash });
  Object.defineProperty(__exports, "verifyContentHash", { enumerable: true, get: () => verifyContentHash });
});

/* --- packages/vehicle-content/src/normalize.js --- */
__def("packages/vehicle-content/src/normalize.js", function (__exports, __req) {
/**
 * Normalization (contract spec, "Matching and resolution rules"), applied to
 * queries and to every indexed field:
 *   1. Unicode NFKD, strip combining marks ("Rodríguez" == "Rodriguez").
 *   2. Lowercase, collapse whitespace, drop punctuation except digits.
 *   3. German ü→ue, ö→oe, ä→ae, ß→ss indexed as an extra form.
 *   4. Locale stop words removed for scoring only.
 * Also: phonetic keys (locale-aware, deterministic) and edit similarity.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

function normalizeText(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** German transliteration form, or null when the input has no umlaut/ß. */
function germanForm(s) {
  if (s == null || !/[üöäÜÖÄß]/.test(String(s))) return null;
  return normalizeText(
    String(s)
      .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
      .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
      .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
      .replace(/ß/g, 'ss'),
  );
}

/** All normalized forms a field value is indexed under. */
function indexForms(s) {
  const out = [];
  const base = normalizeText(s);
  if (base) out.push(base);
  const de = germanForm(s);
  if (de && de !== base) out.push(de);
  return out;
}

const STOP_WORDS = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'mi', 'mis', 'un', 'una', 'y', 'en', 'por', 'para', 'con'],
  en: ['the', 'a', 'an', 'my', 'of', 'to', 'and', 'in', 'on', 'for', 'with'],
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'zum', 'zur', 'mein', 'meine', 'meinen', 'und', 'von', 'zu', 'im', 'am'],
};

function stopWordsFor(locales) {
  const set = new Set();
  for (const loc of locales || []) {
    const lang = String(loc || '').toLowerCase().split('-')[0];
    for (const w of STOP_WORDS[lang] || []) set.add(w);
  }
  return set;
}

function tokenize(norm) {
  return norm ? norm.split(' ').filter(Boolean) : [];
}

/** Tokens with stop words removed; if that empties the list, keep the original. */
function scoringTokens(norm, stop) {
  const all = tokenize(norm);
  const kept = all.filter((t) => !stop.has(t));
  return kept.length ? kept : all;
}

/**
 * Phonetic key: a small, deterministic Spanish/English/German-aware reduction
 * ("Yesica" == "Jessica", "Baleria" == "Valeria", "Kathy" == "Cathy").
 * Applied per token on the normalized form.
 */
function phoneticToken(tok) {
  let s = tok;
  if (!s || /^[0-9]+$/.test(s)) return s;
  s = s
    .replace(/sch/g, 's')
    .replace(/ch/g, 'x')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/qu/g, 'k')
    .replace(/ll/g, 'y')
    .replace(/tz/g, 's')
    .replace(/ei/g, 'ai')
    .replace(/ie/g, 'i')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/g(?=[eiy])/g, 'y')
    .replace(/[cq]/g, 'k')
    .replace(/j/g, 'y')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/w/g, 'b')
    .replace(/x/g, 'ks')
    .replace(/h/g, '')
    .replace(/y(?=$|[^aeiou])/g, 'i'); // trailing/consonant-adjacent y acts as a vowel
  s = s.replace(/(.)\1+/g, '$1'); // collapse doubles
  return s;
}

function phoneticKey(norm) {
  return tokenize(norm).map(phoneticToken).join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/** Normalized edit similarity in [0,1]. */
function editSimilarity(a, b) {
  const m = Math.max(a.length, b.length);
  if (!m) return 1;
  return 1 - levenshtein(a, b) / m;
}

/** Round to 4 decimals so floating error never changes ordering across engines. */
function round4(x) {
  return Math.round(x * 10000) / 10000;
}

  Object.defineProperty(__exports, "normalizeText", { enumerable: true, get: () => normalizeText });
  Object.defineProperty(__exports, "germanForm", { enumerable: true, get: () => germanForm });
  Object.defineProperty(__exports, "indexForms", { enumerable: true, get: () => indexForms });
  Object.defineProperty(__exports, "STOP_WORDS", { enumerable: true, get: () => STOP_WORDS });
  Object.defineProperty(__exports, "stopWordsFor", { enumerable: true, get: () => stopWordsFor });
  Object.defineProperty(__exports, "tokenize", { enumerable: true, get: () => tokenize });
  Object.defineProperty(__exports, "scoringTokens", { enumerable: true, get: () => scoringTokens });
  Object.defineProperty(__exports, "phoneticToken", { enumerable: true, get: () => phoneticToken });
  Object.defineProperty(__exports, "phoneticKey", { enumerable: true, get: () => phoneticKey });
  Object.defineProperty(__exports, "levenshtein", { enumerable: true, get: () => levenshtein });
  Object.defineProperty(__exports, "editSimilarity", { enumerable: true, get: () => editSimilarity });
  Object.defineProperty(__exports, "round4", { enumerable: true, get: () => round4 });
});

/* --- packages/vehicle-content/src/synonyms.js --- */
__def("packages/vehicle-content/src/synonyms.js", function (__exports, __req) {
/**
 * Fixed, versioned synonym files per locale (contract spec, "Scoring"): POI
 * category and contact relationship synonyms. Shipped with the tool version,
 * never with a pack. Values are canonical category / relationship ids; keys
 * are raw phrases (normalized at index time).
 *
 * Bump a locale's `version` on ANY edit — it is written into the session
 * header as `synonyms_version` (e.g. "es-CO@1").
 */

const SYNONYMS = {
  'es-CO': {
    version: 1,
    categories: {
      fuel: ['gasolinera', 'bomba', 'bomba de gasolina', 'estacion de servicio', 'estacion de gasolina', 'gasolina', 'tanquear', 'combustible'],
      ev_charging: ['cargador', 'electrolinera', 'estacion de carga', 'punto de carga', 'cargar el carro'],
      parking: ['parqueadero', 'estacionamiento', 'parqueo', 'donde parquear'],
      restaurant: ['restaurante', 'comida', 'almorzar', 'comer', 'corrientazo'],
      cafe: ['cafe', 'cafeteria', 'tinto', 'tomar un tinto', 'panaderia'],
      supermarket: ['supermercado', 'mercado', 'tienda', 'minimercado'],
      pharmacy: ['farmacia', 'drogueria', 'drogas'],
      hospital: ['hospital', 'clinica', 'urgencias'],
      hotel: ['hotel', 'hostal', 'alojamiento'],
      atm: ['cajero', 'cajero automatico', 'sacar plata'],
      car_service: ['taller', 'mecanico', 'montallantas', 'lavadero', 'lavautos'],
      landmark: ['monumento', 'parque', 'plaza', 'mirador'],
      home: ['casa', 'mi casa', 'la casa'],
      work: ['trabajo', 'oficina', 'la oficina'],
    },
    relationships: {
      brother: ['hermano'], sister: ['hermana'],
      mother: ['mama', 'madre', 'mami', 'cucha'], father: ['papa', 'padre', 'papi', 'cucho'],
      wife: ['esposa', 'senora', 'mujer'], husband: ['esposo', 'marido'],
      girlfriend: ['novia'], boyfriend: ['novio'], partner: ['pareja'],
      son: ['hijo'], daughter: ['hija'],
      grandmother: ['abuela', 'abuelita'], grandfather: ['abuelo', 'abuelito'],
      uncle: ['tio'], aunt: ['tia'], cousin: ['primo', 'prima'],
      friend: ['amigo', 'amiga', 'parcero', 'parcera', 'parce'],
      colleague: ['colega', 'companero de trabajo', 'companera de trabajo'],
      boss: ['jefe', 'jefa'], doctor: ['medico', 'medica', 'doctor', 'doctora'],
    },
  },
  'en-US': {
    version: 1,
    categories: {
      fuel: ['gas station', 'petrol station', 'gas', 'fuel', 'filling station'],
      ev_charging: ['charging station', 'charger', 'ev charger', 'charging point'],
      parking: ['parking', 'parking lot', 'car park', 'parking garage'],
      restaurant: ['restaurant', 'food', 'somewhere to eat', 'lunch', 'dinner'],
      cafe: ['cafe', 'coffee', 'coffee shop'],
      supermarket: ['supermarket', 'grocery', 'grocery store'],
      pharmacy: ['pharmacy', 'drugstore', 'chemist'],
      hospital: ['hospital', 'emergency room', 'clinic'],
      hotel: ['hotel', 'motel', 'lodging'],
      atm: ['atm', 'cash machine', 'cash point'],
      car_service: ['car service', 'mechanic', 'garage', 'car wash', 'tire shop'],
      landmark: ['landmark', 'monument', 'park', 'square'],
      home: ['home', 'my house'],
      work: ['work', 'office', 'the office'],
    },
    relationships: {
      brother: ['brother'], sister: ['sister'],
      mother: ['mother', 'mom', 'mum', 'mommy'], father: ['father', 'dad', 'daddy'],
      wife: ['wife'], husband: ['husband'], girlfriend: ['girlfriend'], boyfriend: ['boyfriend'], partner: ['partner'],
      son: ['son'], daughter: ['daughter'],
      grandmother: ['grandmother', 'grandma'], grandfather: ['grandfather', 'grandpa'],
      uncle: ['uncle'], aunt: ['aunt'], cousin: ['cousin'],
      friend: ['friend', 'buddy'], colleague: ['colleague', 'coworker'], boss: ['boss', 'manager'], doctor: ['doctor'],
    },
  },
  'de-DE': {
    version: 1,
    categories: {
      fuel: ['tankstelle', 'tanken'],
      ev_charging: ['ladestation', 'ladesaeule', 'laden'],
      parking: ['parkplatz', 'parkhaus', 'parken'],
      restaurant: ['restaurant', 'essen', 'gaststaette'],
      cafe: ['cafe', 'kaffee', 'baeckerei'],
      supermarket: ['supermarkt', 'einkaufen', 'lebensmittel'],
      pharmacy: ['apotheke'],
      hospital: ['krankenhaus', 'klinik', 'notaufnahme'],
      hotel: ['hotel', 'pension', 'unterkunft'],
      atm: ['geldautomat', 'bankautomat'],
      car_service: ['werkstatt', 'autowerkstatt', 'waschanlage'],
      landmark: ['sehenswuerdigkeit', 'denkmal', 'park', 'platz'],
      home: ['nach hause', 'zuhause', 'heim'],
      work: ['arbeit', 'buero', 'zur arbeit'],
    },
    relationships: {
      brother: ['bruder'], sister: ['schwester'], mother: ['mutter', 'mama'], father: ['vater', 'papa'],
      wife: ['frau', 'ehefrau'], husband: ['mann', 'ehemann'], girlfriend: ['freundin'], boyfriend: ['freund'],
      partner: ['partner', 'partnerin'], son: ['sohn'], daughter: ['tochter'],
      grandmother: ['oma', 'grossmutter'], grandfather: ['opa', 'grossvater'],
      uncle: ['onkel'], aunt: ['tante'], cousin: ['cousin', 'cousine'],
      friend: ['kumpel'], colleague: ['kollege', 'kollegin'], boss: ['chef', 'chefin'], doctor: ['arzt', 'aerztin'],
    },
  },
};

// Language-only fallbacks so "es-ES" or "en-GB" still pick a synonym file.
const LANG_FALLBACK = { es: 'es-CO', en: 'en-US', de: 'de-DE' };

function synonymLocale(locale) {
  if (SYNONYMS[locale]) return locale;
  const lang = String(locale || '').split('-')[0];
  return LANG_FALLBACK[lang] || null;
}

/** "es-CO@1" style version string for the locales a pack matches over. */
function synonymsVersion(locales) {
  const seen = [];
  for (const l of locales || []) {
    const s = synonymLocale(l);
    if (s && seen.indexOf(s) === -1) seen.push(s);
  }
  return seen.map((s) => s + '@' + SYNONYMS[s].version).join(',');
}

  Object.defineProperty(__exports, "SYNONYMS", { enumerable: true, get: () => SYNONYMS });
  Object.defineProperty(__exports, "synonymLocale", { enumerable: true, get: () => synonymLocale });
  Object.defineProperty(__exports, "synonymsVersion", { enumerable: true, get: () => synonymsVersion });
});

/* --- packages/vehicle-content/src/hours.js --- */
__def("packages/vehicle-content/src/hours.js", function (__exports, __req) {
/**
 * Minimal opening-hours evaluation for `open_now`. Supported forms (an
 * OSM-like subset):
 *   "24/7"
 *   "06:00-22:00"                         daily
 *   "Mo-Fr 08:00-20:00; Sa 09:00-14:00"   day ranges / lists, ";" separated
 *   "Mo,We 10:00-12:00,15:00-18:00"       several time spans
 *   "Su off"                              closed
 *   "18:00-02:00"                         spans past midnight
 * Unknown or missing hours evaluate to `null` (unknown), never to open.
 *
 * Time comes from the caller (`{ day: 'Fr', minutes: 600 }`), never from the
 * wall clock, so the resolver stays deterministic.
 */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]);
    const b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === b) break;
    }
  }
  return out;
}

function parseSpans(spec) {
  const spans = [];
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    spans.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
  }
  return spans;
}

/** Parse into [{ days:Set<0..6>, spans:[[from,to]] | 'off' }] or null if invalid. */
function parseOpeningHours(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (s === '24/7') return [{ days: new Set([0, 1, 2, 3, 4, 5, 6]), spans: [[0, 1440]] }];
  const rules = [];
  for (const raw of s.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = rule.match(/^([A-Za-z,\- ]+?)\s+(.+)$/);
    let days;
    let rest;
    if (m && /^(Mo|Tu|We|Th|Fr|Sa|Su)/.test(m[1])) {
      days = parseDays(m[1].replace(/\s+/g, ''));
      rest = m[2].trim();
    } else {
      days = new Set([0, 1, 2, 3, 4, 5, 6]);
      rest = rule;
    }
    if (!days) return null;
    if (rest === 'off' || rest === 'closed') {
      rules.push({ days, spans: 'off' });
      continue;
    }
    const spans = parseSpans(rest);
    if (!spans) return null;
    rules.push({ days, spans });
  }
  return rules.length ? rules : null;
}

/** true / false, or null when hours are missing or unparseable. */
function isOpenAt(hours, now) {
  const rules = parseOpeningHours(hours);
  if (!rules || !now) return null;
  const day = DAYS.indexOf(now.day);
  if (day < 0) return null;
  const min = now.minutes;
  const prevDay = (day + 6) % 7;
  let open = false;
  for (const r of rules) {
    if (r.spans === 'off') {
      if (r.days.has(day)) open = false; // later rules override earlier ones
      continue;
    }
    for (const [from, to] of r.spans) {
      if (from <= to) {
        if (r.days.has(day) && min >= from && min < to) open = true;
      } else {
        // past midnight: today's evening part, or yesterday's spill-over
        if (r.days.has(day) && min >= from) open = true;
        if (r.days.has(prevDay) && min < to) open = true;
      }
    }
  }
  return open;
}

/** "Fr 10:30" -> { day:'Fr', minutes:630 }; null when invalid. */
function parseLocalTime(str) {
  const m = String(str || '').trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { day: m[1], minutes: +m[2] * 60 + +m[3] };
}

/** Advance a local time by `seconds` (wraps the week). */
function addSeconds(t, seconds) {
  const total = DAYS.indexOf(t.day) * 1440 + t.minutes + Math.floor(seconds / 60);
  const wrapped = ((total % 10080) + 10080) % 10080;
  return { day: DAYS[Math.floor(wrapped / 1440)], minutes: wrapped % 1440 };
}

  Object.defineProperty(__exports, "DAYS", { enumerable: true, get: () => DAYS });
  Object.defineProperty(__exports, "parseOpeningHours", { enumerable: true, get: () => parseOpeningHours });
  Object.defineProperty(__exports, "isOpenAt", { enumerable: true, get: () => isOpenAt });
  Object.defineProperty(__exports, "parseLocalTime", { enumerable: true, get: () => parseLocalTime });
  Object.defineProperty(__exports, "addSeconds", { enumerable: true, get: () => addSeconds });
});

/* --- packages/vehicle-content/src/resolver.js --- */
__def("packages/vehicle-content/src/resolver.js", function (__exports, __req) {
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

const { normalizeText, indexForms, stopWordsFor, scoringTokens, tokenize, phoneticKey, editSimilarity, round4 } = __req("packages/vehicle-content/src/normalize.js");
const { SYNONYMS, synonymLocale, synonymsVersion } = __req("packages/vehicle-content/src/synonyms.js");
const { isOpenAt } = __req("packages/vehicle-content/src/hours.js");
const { RESOLVER_VERSION, THRESHOLDS, SCORES, MEDIA_TYPES, MEDIA_BUCKETS, POI_CATEGORIES } = __req("packages/vehicle-content/src/version.js");

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

function createResolver(pack, options) {
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

  Object.defineProperty(__exports, "createResolver", { enumerable: true, get: () => createResolver });
});

/* --- packages/vehicle-content/src/tools.js --- */
__def("packages/vehicle-content/src/tools.js", function (__exports, __req) {
/**
 * vehicle-tools/1.0 — the frozen set of 12 functions (contract spec, "v1.0
 * API"). One JSON Schema per function is the single source of truth; provider
 * formats (OpenAI-compatible `tools`, Gemini function declarations) are
 * generated from it (adapters.js) and checked for drift by the test suite.
 *
 * Names, parameter names AND descriptions are part of the frozen version:
 * changing a description changes agent behavior, so it requires a version bump.
 */

const { POI_CATEGORIES, MEDIA_TYPES, NUMBER_TYPES, END_OUTCOMES, TOOLS_VERSION, THRESHOLDS } = __req("packages/vehicle-content/src/version.js");

const id = (what) => ({ type: 'string', description: `ID of the ${what}, as returned by a search function.` });

const TOOL_SCHEMAS = [
  {
    name: 'search_contacts',
    domain: 'phone',
    kind: 'lookup',
    description: 'Search the driver\'s phone contacts by name, nickname or relationship (e.g. "Pipe", "my brother"). Returns candidates with IDs and the number types each contact has. Does not call anyone.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Name, nickname or relationship as the driver said it.' },
        filter: {
          type: 'object',
          description: 'Optional filters applied before matching.',
          properties: {
            relationship: { type: 'string', description: 'Relationship, e.g. "brother", "mother", "boss".' },
            tag: { type: 'string', description: 'Contact tag, e.g. "family" or "work".' },
            favorite: { type: 'boolean', description: 'Only favorites when true.' },
          },
          additionalProperties: false,
        },
        limit: { type: 'integer', minimum: 1, maximum: THRESHOLDS.maxLimit, description: 'Maximum candidates to return (default 5, max 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_contact',
    domain: 'phone',
    kind: 'lookup',
    description: 'Get the full record of one contact by ID, including its phone number types.',
    parameters: {
      type: 'object',
      properties: { contact_id: id('contact') },
      required: ['contact_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'call_contact',
    domain: 'phone',
    kind: 'action',
    description: 'Start a phone call to a contact by ID. Resolve the contact with search_contacts first. If number_type is omitted the contact\'s default number is used.',
    parameters: {
      type: 'object',
      properties: {
        contact_id: id('contact'),
        number_type: { type: 'string', enum: NUMBER_TYPES.slice(), description: 'Which of the contact\'s numbers to call.' },
      },
      required: ['contact_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_message',
    domain: 'phone',
    kind: 'action',
    description: 'Send a text message to a contact by ID. Resolve the contact with search_contacts first.',
    parameters: {
      type: 'object',
      properties: {
        contact_id: id('contact'),
        text: { type: 'string', minLength: 1, description: 'Message text, as dictated by the driver.' },
        number_type: { type: 'string', enum: NUMBER_TYPES.slice(), description: 'Which of the contact\'s numbers to use (default: mobile, else the default number).' },
      },
      required: ['contact_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_media',
    domain: 'media',
    kind: 'lookup',
    description: 'Search the car\'s media library (songs, artists, albums, playlists, radio stations, podcasts) by title, name, frequency or genre. Returns candidates with IDs. Does not play anything.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Title, artist, station name or frequency, or genre as the driver said it.' },
        types: {
          type: 'array',
          items: { type: 'string', enum: MEDIA_TYPES.slice() },
          description: 'Restrict to these media types, in order of preference.',
        },
        limit: { type: 'integer', minimum: 1, maximum: THRESHOLDS.maxLimit, description: 'Maximum candidates to return (default 5, max 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'play_media',
    domain: 'media',
    kind: 'action',
    description: 'Play a media item by ID (track, artist, album, playlist, station or podcast). Resolve the item with search_media first.',
    parameters: {
      type: 'object',
      properties: {
        item_id: id('media item'),
        options: {
          type: 'object',
          properties: { shuffle: { type: 'boolean', description: 'Shuffle the items of an artist, album or playlist.' } },
          additionalProperties: false,
        },
      },
      required: ['item_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_playback_state',
    domain: 'media',
    kind: 'lookup',
    description: 'Get what is currently playing, if anything.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_poi',
    domain: 'navigation',
    kind: 'lookup',
    description: 'Search points of interest (places) by name, brand or category, near the vehicle, along the active route, or near the destination. Needs at least one of query or category. Returns candidates with IDs, network distance in meters and whether they are open now.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Place name, brand or kind of place as the driver said it.' },
        category: { type: 'string', enum: POI_CATEGORIES.slice(), description: 'Restrict to one place category.' },
        scope: {
          type: 'string',
          enum: ['near_vehicle', 'along_route', 'near_destination'],
          description: 'Where to search (default near_vehicle). along_route and near_destination need an active route.',
        },
        radius_m: { type: 'number', exclusiveMinimum: 0, description: 'Search radius in meters along the road network (default 3000).' },
        open_now: { type: 'boolean', description: 'Only places that are open now.' },
        limit: { type: 'integer', minimum: 1, maximum: THRESHOLDS.maxLimit, description: 'Maximum candidates to return (default 5, max 10).' },
      },
      anyOf: [{ required: ['query'] }, { required: ['category'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'get_poi',
    domain: 'navigation',
    kind: 'lookup',
    description: 'Get the full record of one point of interest by ID, including opening hours and attributes.',
    parameters: {
      type: 'object',
      properties: { poi_id: id('point of interest') },
      required: ['poi_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'navigate_to',
    domain: 'navigation',
    kind: 'action',
    description: 'Start route guidance to a point of interest by ID, replacing any active route. Resolve the place with search_poi first.',
    parameters: {
      type: 'object',
      properties: { poi_id: id('point of interest') },
      required: ['poi_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_waypoint',
    domain: 'navigation',
    kind: 'action',
    description: 'Add a stop at a point of interest (by ID) to the active route, before the destination. Fails with no_route when no route is active.',
    parameters: {
      type: 'object',
      properties: { poi_id: id('point of interest') },
      required: ['poi_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'end_task',
    domain: 'session',
    kind: 'session',
    description: 'End the current task. Use completed when the request was carried out, not_possible when it cannot be fulfilled (for example the contact, item or place does not exist), and needs_user when you hand control back to the driver.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: END_OUTCOMES.slice(), description: 'How the task ended.' },
        reason: { type: 'string', description: 'Short reason, e.g. "No contact named Camila".' },
      },
      required: ['outcome'],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name);

function toolSchema(name) {
  return TOOL_SCHEMAS.find((t) => t.name === name) || null;
}

/**
 * The fixed, versioned system-prompt block describing the tool contract
 * (PromptDrive spec, "System prompt"). Logged by version in the header.
 */
const SYSTEM_PROMPT_VERSION = TOOLS_VERSION + '#prompt-1';
const SYSTEM_PROMPT_BLOCK = [
  `Vehicle tools (${TOOLS_VERSION}):`,
  '- The car\'s contacts, media and places are only reachable through these tools. Never invent IDs, names, numbers or places.',
  '- Search first, then act: call_contact, send_message, play_media, navigate_to and add_waypoint take IDs only, from a search result.',
  '- status "ok": act on the returned candidate.',
  '- status "ambiguous": several entries match equally well. Ask the driver which one they mean; do not pick one yourself.',
  '- status "not_found": nothing matches. Tell the driver it is not available. Suggestions are only near misses; confirm with the driver before using one.',
  '- status "invalid_argument": your call was malformed; fix the arguments.',
  '- An action that returns status "error" did not happen; tell the driver (error_code says why).',
  '- Call end_task when the request is done (completed), cannot be fulfilled (not_possible), or you hand back to the driver (needs_user).',
].join('\n');

  Object.defineProperty(__exports, "TOOL_SCHEMAS", { enumerable: true, get: () => TOOL_SCHEMAS });
  Object.defineProperty(__exports, "TOOL_NAMES", { enumerable: true, get: () => TOOL_NAMES });
  Object.defineProperty(__exports, "toolSchema", { enumerable: true, get: () => toolSchema });
  Object.defineProperty(__exports, "SYSTEM_PROMPT_VERSION", { enumerable: true, get: () => SYSTEM_PROMPT_VERSION });
  Object.defineProperty(__exports, "SYSTEM_PROMPT_BLOCK", { enumerable: true, get: () => SYSTEM_PROMPT_BLOCK });
});

/* --- packages/vehicle-content/src/adapters.js --- */
__def("packages/vehicle-content/src/adapters.js", function (__exports, __req) {
/**
 * Provider adapters generated from TOOL_SCHEMAS. Names, parameter names and
 * descriptions are passed through unchanged; only the envelope differs.
 *
 *   toOpenAITools()          -> [{ type:'function', function:{ name, description, parameters } }]
 *   toGeminiDeclarations()   -> [{ name, description, parameters }]  (OpenAPI 3.0 subset)
 */

const { TOOL_SCHEMAS } = __req("packages/vehicle-content/src/tools.js");

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function toOpenAITools(schemas) {
  return (schemas || TOOL_SCHEMAS).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: clone(t.parameters) },
  }));
}

// Gemini's function-declaration schema is an OpenAPI 3.0 subset: upper-case
// types, no additionalProperties / anyOf / exclusiveMinimum / minLength.
const GEMINI_TYPE = { object: 'OBJECT', string: 'STRING', integer: 'INTEGER', number: 'NUMBER', boolean: 'BOOLEAN', array: 'ARRAY' };

function toGeminiSchema(s) {
  const out = {};
  if (s.type) out.type = GEMINI_TYPE[s.type] || s.type.toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum.slice();
  if (s.minimum != null) out.minimum = s.minimum;
  if (s.maximum != null) out.maximum = s.maximum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = {};
    for (const k of Object.keys(s.properties)) out.properties[k] = toGeminiSchema(s.properties[k]);
  }
  if (s.required && s.required.length) out.required = s.required.slice();
  return out;
}

function toGeminiDeclarations(schemas) {
  return (schemas || TOOL_SCHEMAS).map((t) => {
    const params = toGeminiSchema(t.parameters);
    const decl = { name: t.name, description: t.description };
    // Gemini rejects an OBJECT with no properties; omit parameters instead.
    if (params.properties && Object.keys(params.properties).length) decl.parameters = params;
    return decl;
  });
}

/** The provider-neutral listing (what the shared package exports). */
function toJsonSchemaList(schemas) {
  return (schemas || TOOL_SCHEMAS).map((t) => ({ name: t.name, description: t.description, parameters: clone(t.parameters) }));
}

function toolDefinitions(format) {
  if (format === 'openai') return toOpenAITools();
  if (format === 'gemini') return toGeminiDeclarations();
  return toJsonSchemaList();
}

  Object.defineProperty(__exports, "toOpenAITools", { enumerable: true, get: () => toOpenAITools });
  Object.defineProperty(__exports, "toGeminiDeclarations", { enumerable: true, get: () => toGeminiDeclarations });
  Object.defineProperty(__exports, "toJsonSchemaList", { enumerable: true, get: () => toJsonSchemaList });
  Object.defineProperty(__exports, "toolDefinitions", { enumerable: true, get: () => toolDefinitions });
});

/* --- packages/vehicle-content/src/validate-args.js --- */
__def("packages/vehicle-content/src/validate-args.js", function (__exports, __req) {
/**
 * Argument validation for tool calls against their JSON Schema (the subset
 * TOOL_SCHEMAS uses: type, enum, required, properties, additionalProperties,
 * items, minimum/maximum/exclusiveMinimum, minLength, anyOf-of-required).
 * Returns a list of human-readable problems; empty means valid. Invalid calls
 * are answered with status "invalid_argument" instead of throwing.
 */

const { toolSchema } = __req("packages/vehicle-content/src/tools.js");

function typeOk(type, v) {
  switch (type) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'number': return typeof v === 'number' && isFinite(v);
    case 'integer': return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
    default: return true;
  }
}

function check(schema, v, path, out) {
  if (schema.type && !typeOk(schema.type, v)) {
    out.push(`${path || 'arguments'} must be ${schema.type}`);
    return;
  }
  if (schema.enum && schema.enum.indexOf(v) === -1) out.push(`${path} must be one of ${schema.enum.join(', ')}`);
  if (schema.minLength != null && typeof v === 'string' && v.trim().length < schema.minLength) out.push(`${path} must not be empty`);
  if (schema.minimum != null && typeof v === 'number' && v < schema.minimum) out.push(`${path} must be >= ${schema.minimum}`);
  if (schema.maximum != null && typeof v === 'number' && v > schema.maximum) out.push(`${path} must be <= ${schema.maximum}`);
  if (schema.exclusiveMinimum != null && typeof v === 'number' && v <= schema.exclusiveMinimum) out.push(`${path} must be > ${schema.exclusiveMinimum}`);
  if (schema.type === 'array' && schema.items) v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, out));
  if (schema.type === 'object') {
    const props = schema.properties || {};
    for (const r of schema.required || []) if (v[r] === undefined) out.push(`${path ? path + '.' : ''}${r} is required`);
    for (const k of Object.keys(v)) {
      if (props[k]) {
        if (v[k] !== undefined) check(props[k], v[k], path ? `${path}.${k}` : k, out);
      } else if (schema.additionalProperties === false) {
        out.push(`${path ? path + '.' : ''}${k} is not a known parameter`);
      }
    }
    if (schema.anyOf && !schema.anyOf.some((alt) => (alt.required || []).every((r) => v[r] !== undefined))) {
      out.push('needs at least one of ' + schema.anyOf.map((a) => (a.required || []).join('+')).join(' or '));
    }
  }
}

function validateToolArgs(name, args) {
  const t = toolSchema(name);
  if (!t) return ['unknown function: ' + name];
  const out = [];
  check(t.parameters, args == null ? {} : args, '', out);
  return out;
}

  Object.defineProperty(__exports, "validateToolArgs", { enumerable: true, get: () => validateToolArgs });
});

/* --- packages/vehicle-content/src/pack-validate.js --- */
__def("packages/vehicle-content/src/pack-validate.js", function (__exports, __req) {
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

const { computeContentHash } = __req("packages/vehicle-content/src/canonical.js");
const { createResolver } = __req("packages/vehicle-content/src/resolver.js");
const { normalizeText } = __req("packages/vehicle-content/src/normalize.js");
const { SCHEMA_VERSION, POI_CATEGORIES, MEDIA_TYPES, MEDIA_BUCKETS, NUMBER_TYPES } = __req("packages/vehicle-content/src/version.js");
const { parseOpeningHours } = __req("packages/vehicle-content/src/hours.js");

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && isFinite(v);

function validatePack(pack, options) {
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

  Object.defineProperty(__exports, "validatePack", { enumerable: true, get: () => validatePack });
});

/* --- packages/vehicle-content/src/labeler.js --- */
__def("packages/vehicle-content/src/labeler.js", function (__exports, __req) {
/**
 * Failure labeler (contract spec, "Failure taxonomy"). One primary label per
 * finished task, computed from the per-call log records and the task
 * definition. Deterministic; `query_error` replays the target's reference
 * queries (display name + aliases) against the same pack and resolver.
 *
 *   labelTask({ task, calls, end, pack }) -> { label, detail }
 *
 *   task  : { task_id, expected:{ actions:[{fn,args}], end_outcome }, tolerance?, condition_type? }
 *   calls : per-call records for this task in log order
 *           ({ fn, args, status, candidates?, error_code?, state? })
 *   end   : task_end record ({ outcome, ended_by })
 */

const { createResolver } = __req("packages/vehicle-content/src/resolver.js");
const { toolSchema } = __req("packages/vehicle-content/src/tools.js");

const TARGET_KEYS = ['contact_id', 'item_id', 'poi_id'];

const targetOf = (args) => {
  for (const k of TARGET_KEYS) if (args && args[k] != null) return args[k];
  return null;
};

const isAction = (fn) => {
  const t = toolSchema(fn);
  return !!t && t.kind === 'action';
};
const domainOfFn = (fn) => {
  const t = toolSchema(fn);
  return t ? t.domain : null;
};

/** Expected args are a subset of the effective args (call args + resolved state). */
function argsMatch(expected, call) {
  const eff = Object.assign({}, call.state || {}, call.args || {});
  if (call.state && call.state.number_type && !(call.args && call.args.number_type)) eff.number_type = call.state.number_type;
  for (const k of Object.keys(expected || {})) {
    if (JSON.stringify(expected[k]) !== JSON.stringify(eff[k])) return false;
  }
  return true;
}

function outcomeOk(expected, actual) {
  if (expected == null) return true;
  return Array.isArray(expected) ? expected.indexOf(actual) !== -1 : expected === actual;
}

function labelTask(input) {
  const task = input.task || {};
  const calls = input.calls || [];
  const end = input.end || {};
  const expected = task.expected || {};
  const expActions = expected.actions || [];
  const tolerance = Object.assign({ extra_lookups: 'allowed', extra_actions: 'fail' }, task.tolerance || {});
  const timedOut = end.ended_by === 'timeout' || end.ended_by === 'next_task' || end.outcome === 'timeout';
  const endOutcome = end.ended_by === 'end_task' ? end.outcome : null;

  const okActions = calls.filter((c) => isAction(c.fn) && c.status === 'ok');
  const failedActions = calls.filter((c) => isAction(c.fn) && c.status === 'error');

  // ---------------------------------------------------- tasks with no action
  if (!expActions.length) {
    // Designed absence: the entry is missing (absent) or only a similar one
    // exists (near_miss). Acting on a near miss without confirmation is
    // "content_absence_mishandled" (contract example: called Camilo).
    const absent = task.condition_type === 'absent' || task.condition_type === 'near_miss'
      || (task.condition_type == null && expected.end_outcome === 'not_possible');
    if (okActions.length) return { label: absent ? 'content_absence_mishandled' : 'intent_error', detail: { acted_on: okActions.map((c) => c.fn + ':' + targetOf(c.args)) } };
    if (endOutcome && outcomeOk(expected.end_outcome, endOutcome)) {
      return { label: task.condition_type === 'absent' || (absent && task.condition_type == null) ? 'content_absence_handled' : 'success', detail: {} };
    }
    if (endOutcome === 'completed') return { label: absent ? 'content_absence_mishandled' : 'false_completion', detail: { end_outcome: endOutcome } };
    if (timedOut) return { label: 'timeout', detail: {} };
    return { label: absent ? 'content_absence_mishandled' : 'intent_error', detail: { end_outcome: endOutcome } };
  }

  // ---------------------------------------------------- success
  const matchedIdx = new Set();
  let allMatched = true;
  for (const ea of expActions) {
    let found = -1;
    if (tolerance.extra_actions === 'allowed') {
      // Final state only: the LAST ok call of that function must match.
      for (let i = okActions.length - 1; i >= 0; i--) {
        if (okActions[i].fn === ea.fn) { found = argsMatch(ea.args, okActions[i]) ? i : -1; break; }
      }
    } else {
      found = okActions.findIndex((c, i) => !matchedIdx.has(i) && c.fn === ea.fn && argsMatch(ea.args, c));
    }
    if (found === -1) allMatched = false;
    else matchedIdx.add(found);
  }
  const illegalExtra = tolerance.extra_actions !== 'allowed' && okActions.some((_c, i) => !matchedIdx.has(i));
  const endMatches = endOutcome != null ? outcomeOk(expected.end_outcome, endOutcome) : !expected.end_outcome || timedOut === false;
  if (allMatched && !illegalExtra && endOutcome != null && endMatches) return { label: 'success', detail: {} };
  if (allMatched && !illegalExtra && endOutcome == null && !timedOut) return { label: 'success', detail: { note: 'no end_task' } };

  // ---------------------------------------------------- failure analysis
  const ea = expActions[0];
  const domain = domainOfFn(ea.fn);
  const target = targetOf(ea.args);
  const inDomain = calls.filter((c) => domainOfFn(c.fn) === domain);
  const wrongDomainAction = okActions.find((c) => domainOfFn(c.fn) !== domain);
  if (!inDomain.length || wrongDomainAction) {
    return { label: 'intent_error', detail: { wrong_domain_action: wrongDomainAction ? wrongDomainAction.fn : null } };
  }

  const surfaced = target != null && calls.some((c) => (c.candidates || []).some((x) => x.id === target));
  const wrongId = okActions.find((c) => c.fn === ea.fn && targetOf(c.args) !== target);
  if (wrongId && surfaced) return { label: 'grounding_error', detail: { used: targetOf(wrongId.args), expected: target } };

  if (target != null && !surfaced && input.pack) {
    const r = createResolver(input.pack);
    const refHit = r.referenceQueries(target).some((q) => {
      const res = domain === 'phone' ? r.searchContacts({ query: q, limit: 10 })
        : domain === 'media' ? r.searchMedia({ query: q, limit: 10 })
          : r.searchPoi({ query: q, limit: 10 }, {});
      return res.candidates.some((x) => x.id === target);
    });
    if (refHit) return { label: 'query_error', detail: { queries: calls.filter((c) => c.args && c.args.query != null).map((c) => c.args.query) } };
  }
  if (wrongId) return { label: 'grounding_error', detail: { used: targetOf(wrongId.args), expected: target, surfaced: false } };

  const failedOnTarget = failedActions.filter((c) => targetOf(c.args) === target);
  if (failedOnTarget.length) {
    const last = failedOnTarget[failedOnTarget.length - 1];
    return { label: 'execution_error', detail: { error_code: last.error_code || null } };
  }
  if (endOutcome === 'completed') return { label: 'false_completion', detail: {} };
  if (timedOut) return { label: 'timeout', detail: {} };
  if (allMatched && illegalExtra) return { label: 'grounding_error', detail: { note: 'extra actions' } };
  return { label: 'execution_error', detail: { note: 'no action taken', end_outcome: endOutcome } };
}

  Object.defineProperty(__exports, "labelTask", { enumerable: true, get: () => labelTask });
});

/* --- packages/vehicle-content/index.js --- */
__def("packages/vehicle-content/index.js", function (__exports, __req) {
/**
 * @hcis/vehicle-content — the one shared copy of the content-layer contract
 * used by PromptDrive (runtime) and WorlDrive (authoring/validation/analysis).
 * Plain ES modules, no dependencies, no I/O.
 *
 * PromptDrive bundles these modules into static/js/content.js
 * (scripts/build-content.js); WorlDrive imports this folder as a git
 * dependency pinned to an exact version.
 */














  Object.defineProperty(__exports, "PACKAGE_VERSION", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").PACKAGE_VERSION });
  Object.defineProperty(__exports, "SCHEMA_VERSION", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").SCHEMA_VERSION });
  Object.defineProperty(__exports, "TOOLS_VERSION", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").TOOLS_VERSION });
  Object.defineProperty(__exports, "SUPPORTED_TOOLS_VERSIONS", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").SUPPORTED_TOOLS_VERSIONS });
  Object.defineProperty(__exports, "RESOLVER_VERSION", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").RESOLVER_VERSION });
  Object.defineProperty(__exports, "THRESHOLDS", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").THRESHOLDS });
  Object.defineProperty(__exports, "SCORES", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").SCORES });
  Object.defineProperty(__exports, "POI_CATEGORIES", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").POI_CATEGORIES });
  Object.defineProperty(__exports, "MEDIA_TYPES", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").MEDIA_TYPES });
  Object.defineProperty(__exports, "MEDIA_BUCKETS", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").MEDIA_BUCKETS });
  Object.defineProperty(__exports, "NUMBER_TYPES", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").NUMBER_TYPES });
  Object.defineProperty(__exports, "END_OUTCOMES", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").END_OUTCOMES });
  Object.defineProperty(__exports, "SOURCES", { enumerable: true, get: () => __req("packages/vehicle-content/src/version.js").SOURCES });
  Object.defineProperty(__exports, "sha256Hex", { enumerable: true, get: () => __req("packages/vehicle-content/src/sha256.js").sha256Hex });
  Object.defineProperty(__exports, "canonicalJson", { enumerable: true, get: () => __req("packages/vehicle-content/src/canonical.js").canonicalJson });
  Object.defineProperty(__exports, "computeContentHash", { enumerable: true, get: () => __req("packages/vehicle-content/src/canonical.js").computeContentHash });
  Object.defineProperty(__exports, "verifyContentHash", { enumerable: true, get: () => __req("packages/vehicle-content/src/canonical.js").verifyContentHash });
  Object.defineProperty(__exports, "normalizeText", { enumerable: true, get: () => __req("packages/vehicle-content/src/normalize.js").normalizeText });
  Object.defineProperty(__exports, "indexForms", { enumerable: true, get: () => __req("packages/vehicle-content/src/normalize.js").indexForms });
  Object.defineProperty(__exports, "phoneticKey", { enumerable: true, get: () => __req("packages/vehicle-content/src/normalize.js").phoneticKey });
  Object.defineProperty(__exports, "phoneticToken", { enumerable: true, get: () => __req("packages/vehicle-content/src/normalize.js").phoneticToken });
  Object.defineProperty(__exports, "editSimilarity", { enumerable: true, get: () => __req("packages/vehicle-content/src/normalize.js").editSimilarity });
  Object.defineProperty(__exports, "SYNONYMS", { enumerable: true, get: () => __req("packages/vehicle-content/src/synonyms.js").SYNONYMS });
  Object.defineProperty(__exports, "synonymsVersion", { enumerable: true, get: () => __req("packages/vehicle-content/src/synonyms.js").synonymsVersion });
  Object.defineProperty(__exports, "parseOpeningHours", { enumerable: true, get: () => __req("packages/vehicle-content/src/hours.js").parseOpeningHours });
  Object.defineProperty(__exports, "isOpenAt", { enumerable: true, get: () => __req("packages/vehicle-content/src/hours.js").isOpenAt });
  Object.defineProperty(__exports, "parseLocalTime", { enumerable: true, get: () => __req("packages/vehicle-content/src/hours.js").parseLocalTime });
  Object.defineProperty(__exports, "addSeconds", { enumerable: true, get: () => __req("packages/vehicle-content/src/hours.js").addSeconds });
  Object.defineProperty(__exports, "createResolver", { enumerable: true, get: () => __req("packages/vehicle-content/src/resolver.js").createResolver });
  Object.defineProperty(__exports, "TOOL_SCHEMAS", { enumerable: true, get: () => __req("packages/vehicle-content/src/tools.js").TOOL_SCHEMAS });
  Object.defineProperty(__exports, "TOOL_NAMES", { enumerable: true, get: () => __req("packages/vehicle-content/src/tools.js").TOOL_NAMES });
  Object.defineProperty(__exports, "toolSchema", { enumerable: true, get: () => __req("packages/vehicle-content/src/tools.js").toolSchema });
  Object.defineProperty(__exports, "SYSTEM_PROMPT_BLOCK", { enumerable: true, get: () => __req("packages/vehicle-content/src/tools.js").SYSTEM_PROMPT_BLOCK });
  Object.defineProperty(__exports, "SYSTEM_PROMPT_VERSION", { enumerable: true, get: () => __req("packages/vehicle-content/src/tools.js").SYSTEM_PROMPT_VERSION });
  Object.defineProperty(__exports, "toOpenAITools", { enumerable: true, get: () => __req("packages/vehicle-content/src/adapters.js").toOpenAITools });
  Object.defineProperty(__exports, "toGeminiDeclarations", { enumerable: true, get: () => __req("packages/vehicle-content/src/adapters.js").toGeminiDeclarations });
  Object.defineProperty(__exports, "toJsonSchemaList", { enumerable: true, get: () => __req("packages/vehicle-content/src/adapters.js").toJsonSchemaList });
  Object.defineProperty(__exports, "toolDefinitions", { enumerable: true, get: () => __req("packages/vehicle-content/src/adapters.js").toolDefinitions });
  Object.defineProperty(__exports, "validateToolArgs", { enumerable: true, get: () => __req("packages/vehicle-content/src/validate-args.js").validateToolArgs });
  Object.defineProperty(__exports, "validatePack", { enumerable: true, get: () => __req("packages/vehicle-content/src/pack-validate.js").validatePack });
  Object.defineProperty(__exports, "labelTask", { enumerable: true, get: () => __req("packages/vehicle-content/src/labeler.js").labelTask });
});

/* --- src/content/RoadGraph.js --- */
__def("src/content/RoadGraph.js", function (__exports, __req) {
/**
 * Stable road graph for content (POIs, routes, network distances).
 *
 * The engine's road is ONE procedurally generated midline: a linked list of
 * nodes (`roadState.head … vehicleNode … tail`) with an integer index `i`
 * counted from the generation origin (node 0), ~1500 nodes of look-ahead, and
 * nodes behind the vehicle retired. With the same scene config (seed, scene,
 * topography) the generator is a pure function of `i`, so `road_node_id =
 * "n_<i>"` is stable within a map version. Map identity is not trusted on
 * faith: maps.js pins a geometry fingerprint that is compared against the
 * live road before any pack is accepted (fail closed).
 *
 * This recorder copies node geometry as nodes become FINAL (more than
 * ROAD_FINAL_LAG nodes behind the generator tail — the engine may still
 * retract/regenerate the newest nodes) into an index-keyed table, so the graph
 * survives node retirement and can be exported as JSON. Map-local coordinates
 * are (x, y) = (world x, world z); the road graph is a chain, so the network
 * distance between two nodes is the arc length between them.
 */

const ROAD_FINAL_LAG = 520; // > engine retract window (vt = 500 nodes)
const ROAD_POLL_MS = 250;
const ROAD_TOLERANCE_M = 0.5; // live vs committed geometry

class RoadGraph {
  constructor() {
    this.h = null;
    this.nodes = new Map(); // i -> { i, x, y, z, a, w, nx, nz, bridge }
    this.minI = null;
    this.maxI = null; // highest contiguous index known (seeded or recorded)
    this.liveMaxI = null; // highest contiguous index recorded from the live road
    this.seeded = null; // { map_id, map_version } when seeded from an export
    this.mismatches = []; // live nodes that disagree with the seeded graph
    this.live = new Map(); // i -> [x, y] as recorded from the live road
    this._arc = null; // Float64Array cumulative arc from minI (lazy)
    this._arcMax = null;
    this._lastPoll = 0;
    this._listeners = [];
  }

  attach(h) {
    this.h = h;
  }

  get ready() {
    return this.maxI != null;
  }

  onGrow(fn) {
    this._listeners.push(fn);
  }

  /** Called every frame by the engine seam; throttled internally. */
  poll(nowMs) {
    const rs = this.h && this.h.roadState;
    if (!rs || !rs.head || !rs.tail) return;
    if (nowMs - this._lastPoll < ROAD_POLL_MS) return;
    this._lastPoll = nowMs;
    const finalUpTo = rs.tail.i - ROAD_FINAL_LAG;
    if (this.liveMaxI != null && finalUpTo <= this.liveMaxI) return;
    let n = rs.head;
    const start = this.liveMaxI == null ? 0 : this.liveMaxI + 1;
    while (n && n.i < start) n = n.next;
    let grew = false;
    while (n && n.i <= finalUpTo) {
      if (n.i >= 0 && n.p) {
        if (this.liveMaxI != null && n.i !== this.liveMaxI + 1) break; // keep contiguous
        const rec = {
          i: n.i,
          x: n.p.x,
          y: n.p.z,
          z: n.p.y,
          a: typeof n.a === 'number' ? n.a : 0,
          w: typeof n.w === 'number' ? n.w : 4,
          nx: n.n ? n.n.x : 0,
          nz: n.n ? n.n.z : 0,
          bridge: !!n.bridge,
        };
        this.live.set(n.i, [rec.x, rec.y]);
        const known = this.nodes.get(n.i);
        if (known && this.seeded) {
          // Continuous map verification against the committed export.
          if (Math.abs(known.x - rec.x) > ROAD_TOLERANCE_M || Math.abs(known.y - rec.y) > ROAD_TOLERANCE_M) {
            if (this.mismatches.length < 50) this.mismatches.push({ i: n.i, expected: [known.x, known.y], live: [rec.x, rec.y] });
          }
          known.z = rec.z;
        } else if (!known) {
          if (this.maxI == null || n.i === this.maxI + 1) {
            this.nodes.set(n.i, rec);
            if (this.minI == null) this.minI = n.i;
            this.maxI = n.i;
            grew = true;
          }
        }
        this.liveMaxI = n.i;
      }
      n = n.next;
    }
    if (grew) {
      this._arc = null;
      for (const fn of this._listeners) {
        try { fn(this); } catch (_e) {}
      }
    }
  }

  /** Seed the authoritative geometry from a committed road-graph export. */
  seed(graph) {
    if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return false;
    const live = this.nodes;
    this.nodes = new Map();
    for (const nd of graph.nodes) {
      const i = typeof nd.i === 'number' ? nd.i : RoadGraph.indexOf(nd.id);
      if (i == null) continue;
      const l = live.get(i);
      this.nodes.set(i, {
        i,
        x: nd.x,
        y: nd.y,
        z: l ? l.z : 0,
        a: nd.heading || 0,
        w: nd.half_width || 4,
        nx: nd.normal ? nd.normal[0] : 0,
        nz: nd.normal ? nd.normal[1] : 0,
        bridge: !!nd.bridge,
      });
    }
    const idx = Array.from(this.nodes.keys()).sort((a, b) => a - b);
    this.minI = idx[0];
    this.maxI = idx[idx.length - 1];
    this.seeded = { map_id: graph.map_id, map_version: graph.map_version };
    this.mismatches = [];
    // Re-check everything recorded so far against the seed.
    for (const [i, rec] of live) {
      const known = this.nodes.get(i);
      if (known && (Math.abs(known.x - rec.x) > ROAD_TOLERANCE_M || Math.abs(known.y - rec.y) > ROAD_TOLERANCE_M)) {
        if (this.mismatches.length < 50) this.mismatches.push({ i, expected: [known.x, known.y], live: [rec.x, rec.y] });
      }
    }
    this._arc = null;
    for (const fn of this._listeners) {
      try { fn(this); } catch (_e) {}
    }
    return true;
  }

  /** Has the live recorder reached node i yet? */
  liveHas(i) {
    return this.liveMaxI != null && i <= this.liveMaxI;
  }

  // ------------------------------------------------------------ geometry

  _ensureArc() {
    if (this._arc && this._arcMax === this.maxI) return;
    const n = this.maxI - this.minI + 1;
    const arc = new Float64Array(n);
    for (let k = 1; k < n; k++) {
      const a = this.nodes.get(this.minI + k - 1);
      const b = this.nodes.get(this.minI + k);
      arc[k] = arc[k - 1] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    this._arc = arc;
    this._arcMax = this.maxI;
  }

  /** Arc length (m) of node i from the graph origin, or null if unknown. */
  arcOf(i) {
    if (!this.ready || i < this.minI || i > this.maxI) return null;
    this._ensureArc();
    return this._arc[i - this.minI];
  }

  node(i) {
    return this.nodes.get(i) || null;
  }

  static idOf(i) {
    return 'n_' + i;
  }

  static indexOf(id) {
    const m = /^n_(-?\d+)$/.exec(String(id || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  /** Live vehicle position on the road: { i, t, arc, x, y, road_node_id }. */
  vehiclePosition() {
    const h = this.h;
    const rs = h && h.roadState;
    const ego = h && h.ego;
    if (!rs || !rs.vehicleNode || !ego || !ego.position) return null;
    const node = rs.vehicleNode;
    let t = 0;
    const nx = node.next;
    if (nx && nx.p && node.p) {
      const dx = nx.p.x - node.p.x;
      const dz = nx.p.z - node.p.z;
      const len2 = dx * dx + dz * dz;
      if (len2 > 1e-6) {
        t = ((ego.position.x - node.p.x) * dx + (ego.position.z - node.p.z) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
      }
    }
    const base = this.arcOf(node.i);
    const next = this.arcOf(node.i + 1);
    let arc = null;
    if (base != null) arc = next != null ? base + (next - base) * t : base;
    return {
      i: node.i,
      t,
      arc,
      x: ego.position.x,
      y: ego.position.z,
      road_node_id: RoadGraph.idOf(t >= 0.5 ? node.i + 1 : node.i),
    };
  }

  /** Network distance (m) from the vehicle to node `i`; null when unknown. */
  distanceFromVehicle(i) {
    const v = this.vehiclePosition();
    const target = this.arcOf(i);
    if (!v || v.arc == null || target == null) return null;
    return Math.abs(target - v.arc);
  }

  /** Network distance between two nodes; null when unknown. */
  distanceBetween(i, j) {
    const a = this.arcOf(i);
    const b = this.arcOf(j);
    if (a == null || b == null) return null;
    return Math.abs(a - b);
  }

  // ------------------------------------------------------------ export

  /** LIVE geometry fingerprint at fixed indices (used by maps.js); null until recorded. */
  fingerprint(indices) {
    const out = [];
    for (const i of indices) {
      const n = this.live.get(i);
      if (!n) return null;
      out.push([i, Math.round(n[0] * 100) / 100, Math.round(n[1] * 100) / 100]);
    }
    return out;
  }

  /** JSON road graph (nodes, chain edges with lengths) for WorlDrive / CLIs. */
  exportGraph(meta) {
    if (!this.ready) return null;
    this._ensureArc();
    const nodes = [];
    const edges = [];
    for (let i = this.minI; i <= this.maxI; i++) {
      const n = this.nodes.get(i);
      nodes.push({
        id: RoadGraph.idOf(i),
        i,
        x: Math.round(n.x * 100) / 100,
        y: Math.round(n.y * 100) / 100,
        heading: Math.round(n.a * 10000) / 10000,
        half_width: Math.round(n.w * 100) / 100,
        normal: [Math.round(n.nx * 10000) / 10000, Math.round(n.nz * 10000) / 10000],
        bridge: n.bridge || undefined,
        arc_m: Math.round(this._arc[i - this.minI] * 100) / 100,
      });
      if (i > this.minI) {
        edges.push({
          from: RoadGraph.idOf(i - 1),
          to: RoadGraph.idOf(i),
          length_m: Math.round((this._arc[i - this.minI] - this._arc[i - 1 - this.minI]) * 100) / 100,
        });
      }
    }
    return Object.assign(
      {
        format: 'promptdrive-road-graph/1',
        coord_system: 'map_local',
        topology: 'chain',
        directed: false,
        node_id_scheme: 'n_<midline index>',
      },
      meta || {},
      { nodes, edges },
    );
  }
}

  Object.defineProperty(__exports, "RoadGraph", { enumerable: true, get: () => RoadGraph });
});

/* --- src/content/EventLog.js --- */
__def("src/content/EventLog.js", function (__exports, __req) {
/**
 * Session event log for the content layer (PromptDrive spec, "Event logging").
 *
 * - Clock: `t` is seconds since session start from ONE monotonic clock
 *   (performance.now). Wall-clock time is written once, in the header. Across
 *   a page reload the clock resumes from the last persisted `t` so it never
 *   runs backwards.
 * - Buffer: every event is appended to a localStorage-backed queue first, so a
 *   reload or a network cut loses nothing; batches are sent in order and only
 *   dropped from the queue once acknowledged.
 * - Transport: HTTP POST to a configured endpoint (2xx = ack), or — the
 *   default inside WorlDrive — a `contentLogBatch` event on the PromptDrive
 *   bridge that the parent acknowledges with `content.log.ack(batch_id)`.
 *   Unacknowledged batches are re-sent (same batch_id; receivers dedupe).
 * - A session is `complete` only when its final batch is acknowledged.
 */

const LOG_STORAGE_KEY = 'pd-content-log';
const LOG_BATCH_MAX = 50;
const LOG_FLUSH_MS = 2000;
const LOG_RESEND_MS = 8000;

function logNowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

class EventLog {
  constructor(emit) {
    this.emit = emit || (() => {});
    this.endpoint = null;
    this.headers = null;
    this.state = null; // persisted: { session_id, t_offset, seq, batch_seq, queue, inflight, final, complete }
    this.all = []; // full in-memory copy of this page's events (for download/inspection)
    this._t0 = logNowMs();
    this._timer = null;
    this._sending = false;
    this._restore();
  }

  // ------------------------------------------------------------ persistence

  _restore() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOG_STORAGE_KEY) : null;
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || !s.session_id) return;
      s.inflight = null; // resend whatever was in flight
      this.state = s;
      this._t0 = logNowMs();
      this._startTimer();
    } catch (_e) {
      this.state = null;
    }
  }

  _persist() {
    if (!this.state) return;
    try {
      this.state.t_offset = this.t();
      this._t0 = logNowMs();
      if (typeof localStorage !== 'undefined') localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(this.state));
    } catch (_e) {
      // Storage full/blocked: events stay in memory and still flush.
    }
  }

  // ------------------------------------------------------------ clock

  /** Seconds since session start (monotonic, 3 decimals). */
  t() {
    if (!this.state) return 0;
    const t = (this.state.t_offset || 0) + (logNowMs() - this._t0) / 1000;
    return Math.round(t * 1000) / 1000;
  }

  get sessionId() {
    return this.state ? this.state.session_id : null;
  }

  // ------------------------------------------------------------ lifecycle

  /** Start a new session log. Pending events of an older session are flushed first by the caller. */
  begin(sessionId) {
    if (this.state && this.state.session_id === sessionId && !this.state.final) {
      return false; // same session resumed after a reload
    }
    this.state = { session_id: sessionId, t_offset: 0, seq: 0, batch_seq: 0, queue: [], inflight: null, final: false, complete: false };
    this.all = [];
    this._t0 = logNowMs();
    this._persist();
    this._startTimer();
    return true;
  }

  configure(opts) {
    const o = opts || {};
    if (o.endpoint !== undefined) this.endpoint = o.endpoint || null;
    if (o.headers !== undefined) this.headers = o.headers || null;
    return { endpoint: this.endpoint };
  }

  /** Append one event; returns the stored record. */
  append(type, fields) {
    if (!this.state) return null;
    // Envelope fields win over payload fields of the same name.
    const rec = Object.assign({ type: null, t: null, seq: null, session_id: null }, fields || {}, { type, t: this.t(), seq: ++this.state.seq, session_id: this.state.session_id });
    this.state.queue.push(rec);
    this.all.push(rec);
    this._persist();
    this.emit('contentEvent', rec);
    if (this.state.queue.length >= LOG_BATCH_MAX) this.flush();
    return rec;
  }

  /** Mark the session finished; the final flush makes it complete once acked. */
  finish() {
    if (!this.state) return;
    this.state.final = true;
    this._persist();
    this.flush();
  }

  // ------------------------------------------------------------ transport

  _startTimer() {
    if (this._timer || typeof setInterval === 'undefined') return;
    this._timer = setInterval(() => this.flush(), LOG_FLUSH_MS);
  }

  flush() {
    const s = this.state;
    if (!s || s.complete) return;
    if (s.inflight) {
      if (logNowMs() - (s.inflight._sentAt || 0) > LOG_RESEND_MS) this._send(s.inflight); // re-send, same id
      return;
    }
    if (!s.queue.length && !(s.final && !s.complete)) return;
    const events = s.queue.slice(0, LOG_BATCH_MAX);
    const isFinal = s.final && events.length === s.queue.length;
    const batch = {
      batch_id: s.session_id + ':' + (++s.batch_seq),
      session_id: s.session_id,
      seq_from: events.length ? events[0].seq : null,
      seq_to: events.length ? events[events.length - 1].seq : null,
      final: isFinal,
      events,
    };
    s.inflight = batch;
    this._persist();
    this._send(batch);
  }

  _send(batch) {
    batch._sentAt = logNowMs();
    const wire = Object.assign({}, batch);
    delete wire._sentAt;
    if (this.endpoint && typeof fetch === 'function') {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, this.headers || {});
      fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(wire), keepalive: wire.final })
        .then((res) => { if (res && res.ok) this.ack(batch.batch_id); })
        .catch(() => { /* offline: retried by the timer */ });
    } else {
      this.emit('contentLogBatch', wire);
    }
  }

  /** Acknowledge a batch (HTTP 2xx, or the parent via content.log.ack). */
  ack(batchId) {
    const s = this.state;
    if (!s || !s.inflight || s.inflight.batch_id !== batchId) return { acked: false, batch_id: batchId };
    const n = s.inflight.events.length;
    const wasFinal = s.inflight.final;
    s.queue.splice(0, n);
    s.inflight = null;
    if (wasFinal) {
      s.complete = true;
      this.emit('contentSessionComplete', { session_id: s.session_id });
    }
    this._persist();
    if (!s.complete && (s.queue.length || s.final)) this.flush();
    return { acked: true, batch_id: batchId, complete: !!s.complete, pending: s.queue.length };
  }

  status() {
    const s = this.state;
    if (!s) return { session_id: null };
    return {
      session_id: s.session_id,
      t: this.t(),
      seq: s.seq,
      pending: s.queue.length,
      inflight: s.inflight ? s.inflight.batch_id : null,
      final: !!s.final,
      complete: !!s.complete,
      transport: this.endpoint ? 'http' : 'bridge',
    };
  }

  /** Drop a completed session's persisted state (keeps unacked data otherwise). */
  clearIfComplete() {
    if (this.state && this.state.complete) {
      try { localStorage.removeItem(LOG_STORAGE_KEY); } catch (_e) {}
      return true;
    }
    return false;
  }
}

  Object.defineProperty(__exports, "EventLog", { enumerable: true, get: () => EventLog });
});

/* --- src/content/maps.js --- */
__def("src/content/maps.js", function (__exports, __req) {
/**
 * Synthetic map registry (PromptDrive spec, "Stable road graph and map
 * versions"). A map is a pinned scene configuration plus the geometry it
 * produces. `map_version` changes whenever road geometry changes (new seed,
 * scene, topography, or an engine change to the midline generator).
 *
 * The fingerprint is a handful of live node positions captured from the real
 * sim; a pack is only accepted when the loaded scene reproduces them within
 * tolerance (fail closed). The committed road graph lives at
 * maps/<map_id>/<map_version>/road-graph.json, slots at .../slots.json.
 *
 * To add or re-version a map: load the sim with the scene below, run
 * `PromptDrive.content.map.exportGraph()` in the console (or the API), save the
 * JSON under maps/, run `node scripts/content/export-slots.js`, and paste the
 * printed fingerprint here.
 */

const CONTENT_MAPS = [
  {
    map_id: 'synth-town-01',
    map_version: '2026.11',
    label: 'Synthetic town 01 (Hills, normal topography, seed b4e6eba7)',
    // Static scene config that reproduces this map (applied via config.set).
    scene: { seed: 'b4e6eba7', sceneName: 'Hills', topography: 'normal', startNode: 0 },
    // The engine places the ego 5 nodes past the generation head.
    start_node: 'n_5',
    // Captured 2026-11-07 from two independent loads (identical to the cm).
    // Indices stay <= 900 so the check passes at every view-LOD look-ahead;
    // nodes beyond are verified continuously against road-graph.json.
    fingerprint: {
      tolerance_m: 0.5,
      points: [
        [0, 0, 0], [50, -106.47, 460.45], [100, -3.14, 756.58], [200, -310.28, 1679.99],
        [300, -800.73, 2302.35], [500, -1763.99, 3774.95], [750, -3797.09, 3883.28], [900, -3892.58, 4641.46],
      ],
    },
  },
];

function mapsPath(entry, file) {
  return `./maps/${entry.map_id}/${entry.map_version}/${file}`;
}

function findContentMap(mapId, mapVersion) {
  return CONTENT_MAPS.find((m) => m.map_id === mapId && (mapVersion == null || m.map_version === mapVersion)) || null;
}

/** Compare the live scene config + road against a registry entry. */
function checkLiveMap(entry, handles, roadGraph) {
  if (!entry) return { ok: false, code: 'map_unknown', message: 'Map not in this build\'s registry' };
  const h = handles || {};
  let live = null;
  try {
    const v = h.sceneConfig && h.sceneConfig.value;
    live = v ? { seed: v.seed, sceneName: v.sceneName, topography: v.topography } : null;
  } catch (_e) {
    live = null;
  }
  if (!live) return { ok: false, code: 'map_not_loaded', message: 'No map loaded yet' };
  for (const k of ['seed', 'sceneName', 'topography']) {
    if (entry.scene[k] != null && String(live[k]) !== String(entry.scene[k])) {
      return {
        ok: false,
        code: 'map_mismatch',
        message: `Map ${entry.map_id} ${entry.map_version} expected (${k} "${entry.scene[k]}"), loaded ${k} "${live[k]}"`,
      };
    }
  }
  const pts = entry.fingerprint.points || [];
  if (!pts.length) return { ok: false, code: 'map_unpinned', message: `Map ${entry.map_id} ${entry.map_version} has no geometry fingerprint in this build` };
  const fp = roadGraph.fingerprint(pts.map((p) => p[0]));
  if (!fp) return { ok: false, code: 'map_pending', message: 'Road geometry not generated yet' };
  const tol = entry.fingerprint.tolerance_m || 0.5;
  for (let k = 0; k < pts.length; k++) {
    if (Math.abs(fp[k][1] - pts[k][1]) > tol || Math.abs(fp[k][2] - pts[k][2]) > tol) {
      return {
        ok: false,
        code: 'map_mismatch',
        message: `Map ${entry.map_id} ${entry.map_version} expected, loaded road differs at node n_${pts[k][0]}`,
        detail: { node: pts[k][0], expected: pts[k].slice(1), live: fp[k].slice(1) },
      };
    }
  }
  if (roadGraph.mismatches && roadGraph.mismatches.length) {
    return { ok: false, code: 'map_mismatch', message: `Map ${entry.map_id} ${entry.map_version} expected, live road differs from the committed graph`, detail: roadGraph.mismatches[0] };
  }
  return { ok: true };
}

/** Which registry map (if any) is live right now. */
function identifyLiveMap(handles, roadGraph) {
  for (const m of CONTENT_MAPS) {
    const r = checkLiveMap(m, handles, roadGraph);
    if (r.ok) return { map_id: m.map_id, map_version: m.map_version };
  }
  return null;
}

  Object.defineProperty(__exports, "CONTENT_MAPS", { enumerable: true, get: () => CONTENT_MAPS });
  Object.defineProperty(__exports, "mapsPath", { enumerable: true, get: () => mapsPath });
  Object.defineProperty(__exports, "findContentMap", { enumerable: true, get: () => findContentMap });
  Object.defineProperty(__exports, "checkLiveMap", { enumerable: true, get: () => checkLiveMap });
  Object.defineProperty(__exports, "identifyLiveMap", { enumerable: true, get: () => identifyLiveMap });
});

/* --- src/content/ContentService.js --- */
__def("src/content/ContentService.js", function (__exports, __req) {
/**
 * Content runtime service (PromptDrive spec, "Runtime modules"). Sits between
 * the content pack and every client: the agent (over the PromptDrive API) and
 * the HMI screens (center console) call it; it alone owns the resolver, the
 * content-related vehicle state (call, messages, playback, route) and logging.
 *
 *   load({ session, pack?, pack_url? })   -> Promise<{ ok, header | error }>
 *   call(fn, args, { source, turn, call_id })  -> envelope (sync)
 *   taskStart(def) / currentTask() / logUtterance() / logAgentReply() / end()
 *
 * Fail closed: any pack/map/tools mismatch leaves the service in phase
 * "failed" — no tools, no tasks, no HMI content — with a session_error logged.
 */

const { createResolver, computeContentHash, validateToolArgs, toolSchema, labelTask, TOOLS_VERSION, SUPPORTED_TOOLS_VERSIONS, RESOLVER_VERSION, PACKAGE_VERSION, SOURCES, SYSTEM_PROMPT_VERSION, parseLocalTime, addSeconds, isOpenAt } = __req("packages/vehicle-content/index.js");
const { RoadGraph } = __req("src/content/RoadGraph.js");
const { EventLog } = __req("src/content/EventLog.js");
const { findContentMap, checkLiveMap, mapsPath } = __req("src/content/maps.js");

const CALL_MAX_S = 20; // a simulated call ends on its own after 20 s
const ARRIVAL_M = 25; // within this network distance of a stop = arrived
const MIN_ETA_SPEED = 50 / 3.6; // ETA floor speed (m/s) when stopped/slow
const MAP_WAIT_MS = 90000;
const PACK_CACHE_PREFIX = 'pd-content-pack:';
const DEFAULT_LOCAL_TIME = 'Fr 10:00';

function svcNowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ContentService {
  constructor(bridgeEmit) {
    this.emit = (ev, payload) => {
      try { if (bridgeEmit) bridgeEmit(ev, payload); } catch (_e) {}
    };
    this.road = new RoadGraph();
    this.log = new EventLog(this.emit);
    this.h = null;
    this.phase = 'idle'; // idle | loading | ready | failed | ended
    this.error = null;
    this.session = null;
    this.pack = null;
    this.resolver = null;
    this.header = null;
    this.mapEntry = null;
    this.localTime0 = parseLocalTime(DEFAULT_LOCAL_TIME);
    this.vstate = this._emptyState();
    this.task = null;
    this.tasksDone = [];
    this.actionSeq = 0;
    this.effects = null; // set by VehicleContent (UI side effects)
    this._participantNames = []; // normalized display names/aliases to redact
    this._listeners = [];
  }

  _emptyState() {
    return { active_call: null, messages: [], playback: null, route: null };
  }

  attach(h) {
    this.h = h;
    this.road.attach(h);
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  }

  _changed(what) {
    for (const fn of this._listeners) {
      try { fn(what, this); } catch (_e) {}
    }
    this.emit('contentState', { what, state: this.publicState() });
  }

  get active() {
    return this.phase === 'ready';
  }

  get locale() {
    return (this.pack && this.pack.locale) || 'en-US';
  }

  // ================================================================ loading

  async load(opts) {
    const o = opts || {};
    const s = o.session || {};
    if (this.phase === 'loading') return { ok: false, error: { code: 'busy', message: 'A pack is already loading' } };
    if (this.phase === 'ready') return { ok: false, error: { code: 'already_loaded', message: 'A pack is loaded; packs are read-only for the session. End the session first.' } };
    this.phase = 'loading';
    this.error = null;
    this.session = Object.assign({}, s);
    this._changed('phase');
    try {
      for (const k of ['session_id', 'pack_id', 'pack_version', 'content_hash', 'tools_version']) {
        if (s[k] == null || s[k] === '') return this._fail('bad_session_config', `Session configuration is missing ${k}`);
      }
      // 1-2. Fetch the pack (explicit object, URL, browser cache, or local file).
      const pack = await this._fetchPack(o, s);
      if (!pack) return this._fail('pack_unavailable', `Pack ${s.pack_id} v${s.pack_version} not found`);
      if (pack.pack_id !== s.pack_id || pack.pack_version !== s.pack_version) {
        return this._fail('pack_mismatch', `Pack ${s.pack_id} v${s.pack_version} expected, got ${pack.pack_id} v${pack.pack_version}`);
      }
      // 3. Recompute the hash with the shared canonicalization.
      const hash = computeContentHash(pack);
      if (hash !== s.content_hash || hash !== pack.content_hash) {
        return this._fail('hash_mismatch', 'Pack hash mismatch', { expected: s.content_hash, declared: pack.content_hash, computed: hash });
      }
      // 4. Tools version + map identity.
      if (SUPPORTED_TOOLS_VERSIONS.indexOf(s.tools_version) === -1) {
        return this._fail('tools_version_unsupported', `Tools version ${s.tools_version} not supported (this build: ${SUPPORTED_TOOLS_VERSIONS.join(', ')})`);
      }
      const needsMap = (pack.pois || []).length > 0 || s.map_id != null;
      if (needsMap) {
        const pm = pack.map || {};
        if (s.map_id !== pm.map_id || s.map_version !== pm.map_version) {
          return this._fail('map_mismatch', `Pack is for map ${pm.map_id} ${pm.map_version}, session expects ${s.map_id} ${s.map_version}`);
        }
        const entry = findContentMap(s.map_id, s.map_version);
        if (!entry) {
          const other = findContentMap(s.map_id);
          return this._fail('map_mismatch', other
            ? `Map version ${s.map_version} expected, this build has ${other.map_version}`
            : `Map ${s.map_id} is not available in this build`);
        }
        const graph = await this._fetchJson(mapsPath(entry, 'road-graph.json'));
        if (!graph || graph.map_id !== entry.map_id || graph.map_version !== entry.map_version) {
          return this._fail('road_graph_missing', `Road graph for ${entry.map_id} ${entry.map_version} not found`);
        }
        const live = await this._waitForMap(entry);
        if (!live.ok) return this._fail(live.code === 'map_pending' || live.code === 'map_not_loaded' ? 'map_not_loaded' : 'map_mismatch', live.message, live.detail);
        this.road.seed(graph);
        const again = checkLiveMap(entry, this.h, this.road);
        if (!again.ok) return this._fail('map_mismatch', again.message, again.detail);
        this.mapEntry = entry;
      }
      // 5. Build the resolver index once.
      this.pack = pack;
      this.resolver = createResolver(pack, { maskNumbers: s.mask_numbers !== false });
      this._participantNames = this._collectParticipantNames(pack);
      this.localTime0 = parseLocalTime(s.local_time || DEFAULT_LOCAL_TIME) || parseLocalTime(DEFAULT_LOCAL_TIME);
      this.vstate = this._emptyState();
      this.task = null;
      this.tasksDone = [];
      this._cachePack(pack);
      // 6. Session header before the first task.
      this.log.begin(s.session_id);
      this.header = {
        session_id: s.session_id,
        study_id: s.study_id || null,
        condition: s.condition || null,
        participant_pseudonym: s.participant_pseudonym || null,
        actor: s.actor || 'agent',
        model: s.model || null,
        tools_version: TOOLS_VERSION,
        resolver_version: RESOLVER_VERSION,
        synonyms_version: this.resolver.meta.synonyms_version,
        package_version: PACKAGE_VERSION,
        system_prompt_version: SYSTEM_PROMPT_VERSION,
        pack_id: pack.pack_id,
        pack_version: pack.pack_version,
        content_hash: hash,
        map_id: this.mapEntry ? this.mapEntry.map_id : null,
        map_version: this.mapEntry ? this.mapEntry.map_version : null,
        start_node: this.mapEntry ? this.mapEntry.start_node : null,
        local_time_start: s.local_time || DEFAULT_LOCAL_TIME,
        wall_clock_start: new Date().toISOString(),
        clock: 'seconds since session start (monotonic, sim)',
      };
      this.log.append('session_header', this.header);
      this.phase = 'ready';
      this._changed('phase');
      this.emit('contentSession', { phase: 'ready', header: this.header });
      return { ok: true, header: this.header };
    } catch (e) {
      return this._fail('load_failed', String((e && e.message) || e));
    }
  }

  _fail(code, message, detail) {
    this.phase = 'failed';
    this.error = { code, message, detail: detail || null };
    this.pack = null;
    this.resolver = null;
    if (this.session && this.session.session_id) {
      this.log.begin(this.session.session_id);
      this.log.append('session_error', { code, message, detail: detail || null });
    }
    this._changed('phase');
    this.emit('contentSession', { phase: 'failed', error: this.error });
    if (this.effects) this.effects.sessionError(this.error);
    return { ok: false, error: this.error };
  }

  async _fetchJson(url) {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  async _fetchPack(o, s) {
    if (o.pack && typeof o.pack === 'object') return JSON.parse(JSON.stringify(o.pack));
    const url = o.pack_url || s.pack_url || null;
    if (url) {
      const p = await this._fetchJson(url);
      if (p) return p;
    }
    const cached = this._cachedPack(s.pack_id, s.pack_version);
    if (cached) return cached;
    if (!url) return this._fetchJson(`./packages/vehicle-content/packs/${s.pack_id}.v${s.pack_version}.json`);
    return null;
  }

  // Offline use: packs can be pre-fetched into the browser; the hash check
  // still runs against the cached copy.
  _cachedPack(id, version) {
    try {
      const raw = localStorage.getItem(PACK_CACHE_PREFIX + id + '@' + version);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }

  _cachePack(pack) {
    try { localStorage.setItem(PACK_CACHE_PREFIX + pack.pack_id + '@' + pack.pack_version, JSON.stringify(pack)); } catch (_e) {}
  }

  async prefetch(list) {
    const out = [];
    for (const item of list || []) {
      const url = typeof item === 'string' ? item : item && item.url;
      const p = url ? await this._fetchJson(url) : (item && item.pack) || null;
      if (p && p.pack_id) {
        this._cachePack(p);
        out.push({ pack_id: p.pack_id, pack_version: p.pack_version, content_hash: p.content_hash, cached: true });
      } else {
        out.push({ url, cached: false });
      }
    }
    return out;
  }

  async _waitForMap(entry) {
    const t0 = svcNowMs();
    let last = null;
    while (svcNowMs() - t0 < MAP_WAIT_MS) {
      last = checkLiveMap(entry, this.h, this.road);
      if (last.ok || (last.code !== 'map_pending' && last.code !== 'map_not_loaded')) return last;
      await sleep(250);
    }
    return last || { ok: false, code: 'map_not_loaded', message: 'Map did not load in time' };
  }

  _collectParticipantNames(pack) {
    const out = [];
    for (const c of pack.contacts || []) {
      if (c.participant_entered || (c.tags || []).indexOf('participant') !== -1) {
        for (const n of [c.display_name, c.given_name].concat(c.aliases || [], c.family_names || [])) {
          if (n) out.push({ id: c.id, name: String(n) });
        }
      }
    }
    out.sort((a, b) => b.name.length - a.name.length);
    return out;
  }

  /** Privacy: participant-entered contact names never reach the log as text. */
  _redact(text) {
    if (typeof text !== 'string' || !this._participantNames.length) return text;
    let s = text;
    for (const { id, name } of this._participantNames) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(esc, 'gi'), '[' + id + ']');
    }
    return s;
  }

  // ================================================================ context

  /** Seconds since session start. */
  t() {
    return this.log.t();
  }

  localTime() {
    return addSeconds(this.localTime0, this.t());
  }

  _poiIndex(p) {
    return RoadGraph.indexOf(p && p.location && p.location.road_node_id);
  }

  _vehicleArc() {
    const v = this.road.vehiclePosition();
    return v && v.arc != null ? v.arc : null;
  }

  /** Arc positions of the remaining stops (waypoints then destination). */
  _routeStops() {
    const r = this.vstate.route;
    if (!r) return [];
    return r.waypoints.map((w) => w.poi_id).concat([r.destination_poi_id]).map((id) => {
      const p = this.resolver.poiEntry(id);
      const i = this._poiIndex(p);
      return { poi_id: id, i, arc: i == null ? null : this.road.arcOf(i) };
    });
  }

  _ctx() {
    const route = this.vstate.route;
    const vArc = this._vehicleArc();
    const stops = this._routeStops();
    const dest = stops.length ? stops[stops.length - 1] : null;
    const arcs = stops.map((s) => s.arc).filter((a) => a != null);
    const lo = vArc == null ? null : Math.min(vArc, ...arcs);
    const hi = vArc == null ? null : Math.max(vArc, ...arcs);
    const arcOfPoi = (p) => {
      const i = this._poiIndex(p);
      return i == null ? null : this.road.arcOf(i);
    };
    return {
      now: this.localTime(),
      routeActive: !!route,
      distanceTo: (p) => {
        const a = arcOfPoi(p);
        return a == null || vArc == null ? null : Math.abs(a - vArc);
      },
      routeCorridorDistance: (p) => {
        const a = arcOfPoi(p);
        if (a == null || lo == null) return null;
        return a < lo ? lo - a : a > hi ? a - hi : 0;
      },
      destinationDistance: (p) => {
        const a = arcOfPoi(p);
        return a == null || !dest || dest.arc == null ? null : Math.abs(a - dest.arc);
      },
      _replay: {
        vehicle_arc_m: vArc == null ? null : Math.round(vArc * 100) / 100,
        route_stops: stops.map((s) => s.poi_id),
        local_time: this.localTime(),
      },
    };
  }

  vehicleState() {
    const h = this.h;
    const v = this.road.vehiclePosition();
    let speed = 0;
    let automated = false;
    try { speed = h && h.ego ? +h.ego.speed || 0 : 0; } catch (_e) {}
    try { automated = !!(h && h.autodrive && h.autodrive.value); } catch (_e) {}
    return {
      speed_kmh: Math.round(Math.abs(speed) * 3.6 * 10) / 10,
      driving_mode: automated ? 'automated' : 'manual',
      route_active: !!this.vstate.route,
      road_node_id: v ? v.road_node_id : null,
      x: v ? Math.round(v.x * 100) / 100 : null,
      y: v ? Math.round(v.y * 100) / 100 : null,
    };
  }

  // ================================================================ calls

  /**
   * Execute one vehicle-tools call. `meta.source` is agent | hmi_touch |
   * hmi_voice; `meta.turn` groups parallel calls of one model turn.
   * Never throws: invalid input returns status "invalid_argument".
   */
  call(fn, args, meta) {
    const m = meta || {};
    const source = SOURCES.indexOf(m.source) !== -1 ? m.source : 'agent';
    const t0 = svcNowMs();
    const a = args == null ? {} : args;
    if (this.phase !== 'ready') {
      return { status: 'error', error_code: 'unsupported', message: this.phase === 'failed' ? 'Session stopped: ' + this.error.message : 'No content pack loaded' };
    }
    if (m.turn != null && this.task) this._checkTurnLimit(m.turn);

    const taskId = this.task ? this.task.task_id : null; // end_task closes it during exec
    const schema = toolSchema(fn);
    let result;
    let problems = schema ? validateToolArgs(fn, a) : ['unknown function: ' + fn];
    // HMI browse mode: an empty query is allowed for list screens only.
    const hmi = source !== 'agent';
    if (hmi && problems.length && (fn === 'search_contacts' || fn === 'search_media' || fn === 'search_poi')) {
      const relaxed = Object.assign({}, a);
      delete relaxed.offset;
      delete relaxed.sort;
      if (relaxed.query == null || relaxed.query === '') relaxed.query = 'x';
      problems = validateToolArgs(fn, relaxed);
    }
    if (problems.length) {
      result = schema && schema.kind !== 'lookup'
        ? { status: 'error', action_id: null, error_code: 'invalid_argument', message: problems.join('; ') }
        : { status: 'invalid_argument', candidates: [], total_matches: 0, message: problems.join('; ') };
      if (fn === 'get_contact' || fn === 'get_poi' || fn === 'get_playback_state') result = { status: 'invalid_argument', message: problems.join('; ') };
    } else {
      try {
        result = this._exec(fn, a, source);
      } catch (e) {
        result = { status: 'error', error_code: 'unsupported', message: String((e && e.message) || e) };
      }
    }
    const latency = Math.round((svcNowMs() - t0) * 1000) / 1000;
    this._record(fn, a, source, m, result, latency, taskId);
    return result;
  }

  _exec(fn, a, source) {
    const r = this.resolver;
    switch (fn) {
      case 'search_contacts':
        return r.searchContacts(a);
      case 'get_contact':
        return r.getContact(a.contact_id);
      case 'search_media':
        return r.searchMedia(a);
      case 'get_playback_state':
        return { status: 'ok', item: this._playbackItem() };
      case 'search_poi': {
        const ctx = this._ctx();
        this._lastCtx = ctx._replay;
        return r.searchPoi(Object.assign({}, a, { _browse: source !== 'agent' }), ctx);
      }
      case 'get_poi': {
        const ctx = this._ctx();
        this._lastCtx = ctx._replay;
        return r.getPoi(a.poi_id, ctx);
      }
      case 'call_contact':
        return this._callContact(a);
      case 'send_message':
        return this._sendMessage(a);
      case 'play_media':
        return this._playMedia(a);
      case 'navigate_to':
        return this._navigateTo(a);
      case 'add_waypoint':
        return this._addWaypoint(a);
      case 'end_task':
        return this._endTaskCall(a);
      default:
        return { status: 'invalid_argument', message: 'unknown function: ' + fn };
    }
  }

  _actionId() {
    return 'a_' + String(++this.actionSeq).padStart(4, '0');
  }

  _actErr(code, message) {
    return { status: 'error', action_id: this._actionId(), error_code: code, message };
  }

  _pickNumber(contact, type, preferMobile) {
    const nums = contact.numbers || [];
    if (type) return nums.find((n) => n.type === type) || null;
    if (preferMobile) {
      const mob = nums.find((n) => n.type === 'mobile');
      if (mob) return mob;
    }
    return nums.find((n) => n.default) || nums[0] || null;
  }

  _callContact(a) {
    const c = this.resolver.contactEntry(a.contact_id);
    if (!c) return this._actErr('unknown_id', 'No contact with that ID');
    if (this.vstate.active_call) return this._actErr('busy', 'A call is already active');
    const num = this._pickNumber(c, a.number_type, false);
    if (!num) return this._actErr('no_number_of_type', a.number_type ? `Contact has no ${a.number_type} number` : 'Contact has no phone number');
    const action_id = this._actionId();
    this.vstate.active_call = { contact_id: c.id, number_type: num.type, started_t: this.t(), action_id };
    this._effect('call_screen', action_id, { contact_id: c.id, number_type: num.type });
    if (this.effects) this.effects.startCall(c, num, this.locale);
    this._changed('call');
    return { status: 'ok', action_id, state: { call: 'started', contact_id: c.id, display_name: c.display_name, number_type: num.type } };
  }

  /** Driver hangs up (phone UI) or the 20 s limit passes. */
  hangUp(reason) {
    const call = this.vstate.active_call;
    if (!call) return false;
    this.vstate.active_call = null;
    this._effect('call_ended', call.action_id, { reason: reason || 'driver', duration_s: Math.round((this.t() - call.started_t) * 10) / 10 });
    if (this.effects) this.effects.endCall();
    this._changed('call');
    return true;
  }

  _sendMessage(a) {
    const c = this.resolver.contactEntry(a.contact_id);
    if (!c) return this._actErr('unknown_id', 'No contact with that ID');
    const num = this._pickNumber(c, a.number_type, true);
    if (!num) return this._actErr('no_number_of_type', a.number_type ? `Contact has no ${a.number_type} number` : 'Contact has no phone number');
    const action_id = this._actionId();
    this.vstate.messages.push({ contact_id: c.id, number_type: num.type, text: a.text, t: this.t(), action_id });
    this._effect('message_banner', action_id, { contact_id: c.id });
    if (this.effects) this.effects.messageSent(c, this.locale);
    this._changed('messages');
    return { status: 'ok', action_id, state: { message: 'sent', contact_id: c.id, display_name: c.display_name, number_type: num.type } };
  }

  _playMedia(a) {
    const item = this.resolver.mediaEntry(a.item_id);
    if (!item) return this._actErr('unknown_id', 'No media item with that ID');
    const shuffle = !!(a.options && a.options.shuffle);
    let queue = this.resolver.playableTracks(item.id);
    if ((item.type === 'artist' || item.type === 'album' || item.type === 'playlist') && !queue.length) {
      return this._actErr('unsupported', 'Nothing playable in that item');
    }
    if (shuffle && queue.length > 1) {
      // Deterministic shuffle seeded by the item and action sequence.
      let seed = 0;
      for (const ch of item.id + ':' + this.actionSeq) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      queue = queue.slice();
      for (let i = queue.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const j = seed % (i + 1);
        const tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp;
      }
    }
    const action_id = this._actionId();
    const current = queue.length ? queue[0] : item.id;
    this.vstate.playback = { item_id: item.id, type: item.type, started_t: this.t(), shuffle, queue, current_id: current, action_id };
    this._effect('now_playing', action_id, { item_id: item.id, item_type: item.type });
    if (this.effects) this.effects.playMedia(this._nowPlayingView());
    this._changed('playback');
    const view = this._nowPlayingView();
    return { status: 'ok', action_id, state: { playing: true, item_id: item.id, type: item.type, display_name: item.display_name, now_playing: view.title, artist_names: view.artists, shuffle } };
  }

  stopPlayback(reason) {
    const p = this.vstate.playback;
    if (!p) return false;
    this.vstate.playback = null;
    this._effect('playback_stopped', p.action_id, { reason: reason || 'driver' });
    if (this.effects) this.effects.stopMedia();
    this._changed('playback');
    return true;
  }

  _nowPlayingView() {
    const p = this.vstate.playback;
    if (!p) return null;
    const cur = this.resolver.mediaEntry(p.current_id) || this.resolver.mediaEntry(p.item_id);
    const parent = this.resolver.mediaEntry(p.item_id);
    const artists = (cur && cur.artist_ids ? cur.artist_ids : []).map((id) => {
      const e = this.resolver.mediaEntry(id);
      return e ? e.display_name : null;
    }).filter(Boolean);
    let subtitle = artists.join(', ');
    if (!subtitle && cur && cur.type === 'station') subtitle = [cur.band, cur.frequency].filter(Boolean).join(' ');
    if (!subtitle && cur && cur.type === 'podcast') subtitle = (cur.episode_titles || [])[0] || '';
    return {
      item_id: p.item_id,
      type: p.type,
      title: cur ? cur.display_name : '',
      artists,
      subtitle,
      context: parent && parent.id !== (cur && cur.id) ? parent.display_name : null,
      shuffle: p.shuffle,
    };
  }

  _playbackItem() {
    const p = this.vstate.playback;
    if (!p) return { playing: false };
    const v = this._nowPlayingView();
    return {
      playing: true,
      item_id: p.item_id,
      type: p.type,
      current_track_id: p.type === 'station' || p.type === 'podcast' ? null : p.current_id,
      display_name: v.title,
      artist_names: v.artists,
      shuffle: p.shuffle,
      started_t: p.started_t,
    };
  }

  _routeSummary() {
    const r = this.vstate.route;
    if (!r) return null;
    const vArc = this._vehicleArc();
    const stops = this._routeStops();
    let length = 0;
    let prev = vArc;
    for (const s of stops) {
      if (prev == null || s.arc == null) { length = null; break; }
      length += Math.abs(s.arc - prev);
      prev = s.arc;
    }
    let speed = 0;
    try { speed = Math.abs(+this.h.ego.speed || 0); } catch (_e) {}
    const eta = length == null ? null : Math.round(length / Math.max(speed, MIN_ETA_SPEED));
    return {
      destination_poi_id: r.destination_poi_id,
      waypoints: r.waypoints.map((w) => w.poi_id),
      length_m: length == null ? null : Math.round(length),
      eta_s: eta,
    };
  }

  _navigateTo(a) {
    const p = this.resolver.poiEntry(a.poi_id);
    if (!p) return this._actErr('unknown_id', 'No place with that ID');
    const i = this._poiIndex(p);
    if (i == null || this.road.arcOf(i) == null) return this._actErr('unsupported', 'Place is not on the loaded road network');
    const action_id = this._actionId();
    this.vstate.route = { destination_poi_id: p.id, waypoints: [], started_t: this.t(), action_id };
    const sum = this._routeSummary();
    Object.assign(this.vstate.route, { length_m: sum.length_m, eta_s: sum.eta_s });
    this._effect('route_drawn', action_id, { destination_poi_id: p.id, length_m: sum.length_m, eta_s: sum.eta_s });
    if (this.effects) this.effects.routeChanged(this.routeView());
    this._changed('route');
    return { status: 'ok', action_id, state: Object.assign({ route: 'started', display_name: p.display_name }, sum) };
  }

  _addWaypoint(a) {
    if (!this.vstate.route) return this._actErr('no_route', 'No route active');
    const p = this.resolver.poiEntry(a.poi_id);
    if (!p) return this._actErr('unknown_id', 'No place with that ID');
    const i = this._poiIndex(p);
    if (i == null || this.road.arcOf(i) == null) return this._actErr('unsupported', 'Place is not on the loaded road network');
    const action_id = this._actionId();
    this.vstate.route.waypoints.push({ poi_id: p.id, action_id });
    const sum = this._routeSummary();
    Object.assign(this.vstate.route, { length_m: sum.length_m, eta_s: sum.eta_s });
    this._effect('route_recalculated', action_id, { waypoint_poi_id: p.id, length_m: sum.length_m, eta_s: sum.eta_s });
    if (this.effects) this.effects.routeChanged(this.routeView());
    this._changed('route');
    return { status: 'ok', action_id, state: Object.assign({ route: 'updated', waypoint: p.display_name }, sum) };
  }

  cancelRoute(reason) {
    const r = this.vstate.route;
    if (!r) return false;
    this.vstate.route = null;
    this._effect('route_cleared', r.action_id, { reason: reason || 'driver' });
    if (this.effects) this.effects.routeChanged(null);
    this._changed('route');
    return true;
  }

  routeView() {
    const r = this.vstate.route;
    if (!r || !this.resolver) return null;
    const sum = this._routeSummary();
    const stops = this._routeStops().map((s) => {
      const p = this.resolver.poiEntry(s.poi_id);
      return { poi_id: s.poi_id, i: s.i, display_name: p ? p.display_name : s.poi_id, category: p ? p.category : null, x: p ? p.location.x : null, y: p ? p.location.y : null };
    });
    return Object.assign({ stops }, sum);
  }

  _endTaskCall(a) {
    const action_id = this._actionId();
    const task = this.task;
    if (!task) return { status: 'ok', action_id, state: { task_id: null, outcome: a.outcome, note: 'no task active' } };
    this._closeTask({ outcome: a.outcome, reason: a.reason || null, ended_by: 'end_task', action_id });
    return { status: 'ok', action_id, state: { task_id: task.task_id, outcome: a.outcome } };
  }

  _effect(effect, action_id, extra) {
    this.log.append('effect', Object.assign({ task_id: this.task ? this.task.task_id : null, effect, action_id: action_id || null }, extra || {}));
  }

  _record(fn, args, source, meta, result, latency, taskId) {
    const rec = {
      task_id: taskId !== undefined ? taskId : this.task ? this.task.task_id : null,
      turn: meta.turn == null ? null : meta.turn,
      call_id: meta.call_id || null,
      fn,
      args: this._redactArgs(args),
      source,
      status: result.status,
      latency_ms: latency,
      vehicle_state: this.vehicleState(),
    };
    // HMI list screens browse with an empty query; flag them so parity
    // analysis can separate UI browsing from lookups.
    if (source !== 'agent' && /^search_/.test(fn) && !(args && args.query) && !(args && args.category)) rec.browse = true;
    if (result.candidates) {
      rec.candidates = result.candidates.map((c) => ({ id: c.id, score: c.score, matched_on: c.matched_on }));
      rec.total_matches = result.total_matches;
    }
    if (result.suggestions) rec.suggestions = result.suggestions.map((c) => ({ id: c.id, score: c.score }));
    if (result.item && result.item.id) rec.item_id = result.item.id;
    if (result.action_id) rec.action_id = result.action_id;
    if (result.error_code) rec.error_code = result.error_code;
    if (result.message && result.status !== 'ok') rec.message = result.message;
    if (result.state) rec.state = this._logState(result.state);
    if (fn === 'search_poi' || fn === 'get_poi') rec.ctx = this._lastCtx || null;
    const stored = this.log.append('call', rec);
    if (this.task) this.task.calls.push(stored);
    this.emit('contentCall', stored);
  }

  _redactArgs(args) {
    const out = {};
    for (const k of Object.keys(args || {})) {
      const v = args[k];
      out[k] = typeof v === 'string' ? this._redact(v) : v;
    }
    return out;
  }

  /** Keep IDs and numbers, drop display text (names live in the pack). */
  _logState(state) {
    const out = {};
    for (const k of Object.keys(state)) {
      if (k === 'display_name' || k === 'now_playing' || k === 'artist_names' || k === 'waypoint') continue;
      out[k] = state[k];
    }
    return out;
  }

  // ================================================================ tasks

  taskStart(def) {
    if (this.phase !== 'ready') return { ok: false, error: { code: 'not_ready', message: this.error ? this.error.message : 'No content pack loaded' } };
    const d = def || {};
    if (!d.task_id) return { ok: false, error: { code: 'bad_value', message: 'task_id is required' } };
    if (this.task) this._closeTask({ outcome: 'timeout', reason: 'next task started', ended_by: 'next_task' });
    const limits = Object.assign({}, d.limits || {});
    this.task = {
      task_id: d.task_id,
      prompt_for_driver: d.prompt_for_driver || null,
      condition: d.condition || (this.session && this.session.condition) || null,
      condition_type: d.condition_type || null,
      expected: d.expected || null,
      tolerance: d.tolerance || null,
      limits,
      started_t: this.t(),
      started_ms: svcNowMs(),
      max_turn: 0,
      calls: [],
    };
    this.log.append('task_start', {
      task_id: d.task_id,
      prompt_for_driver: d.prompt_for_driver || null,
      condition: this.task.condition,
      limits,
    });
    this._changed('task');
    return { ok: true, task_id: d.task_id, t: this.task.started_t };
  }

  /** Experimenter/harness ends a task without end_task (e.g. driver gave up). */
  taskEnd(opts) {
    if (!this.task) return { ok: false, error: { code: 'no_task', message: 'No task active' } };
    const o = opts || {};
    return { ok: true, value: this._closeTask({ outcome: o.outcome || 'timeout', reason: o.reason || null, ended_by: o.ended_by || 'timeout' }) };
  }

  _checkTurnLimit(turn) {
    const task = this.task;
    if (!task) return;
    task.max_turn = Math.max(task.max_turn, turn);
    if (task.limits.max_turns != null && turn > task.limits.max_turns) {
      this._closeTask({ outcome: 'timeout', reason: `turn limit ${task.limits.max_turns} reached`, ended_by: 'timeout' });
    }
  }

  _closeTask(end) {
    const task = this.task;
    if (!task) return null;
    this.task = null;
    const rec = {
      task_id: task.task_id,
      outcome: end.outcome,
      reason: end.reason || null,
      ended_by: end.ended_by,
      duration_s: Math.round((this.t() - task.started_t) * 1000) / 1000,
    };
    if (end.action_id) rec.action_id = end.action_id;
    if (task.expected) {
      try {
        const lab = labelTask({ task, calls: task.calls, end: rec, pack: this.pack });
        rec.label = lab.label;
        rec.label_detail = lab.detail;
      } catch (_e) {
        rec.label = null;
      }
    }
    this.log.append('task_end', rec);
    this.tasksDone.push(rec);
    this._changed('task');
    this.emit('contentTaskEnd', rec);
    return rec;
  }

  currentTask() {
    const t = this.task;
    if (!t) return null;
    return { task_id: t.task_id, prompt_for_driver: t.prompt_for_driver, condition: t.condition, limits: t.limits, started_t: t.started_t, calls: t.calls.length, max_turn: t.max_turn };
  }

  // ================================================================ transcript

  logUtterance(u) {
    if (!this.log.sessionId) return { ok: false, error: { code: 'no_session' } };
    const x = u || {};
    if (x.turn != null && this.task) this._checkTurnLimit(x.turn);
    const rec = this.log.append('driver_utterance', {
      task_id: this.task ? this.task.task_id : null,
      text: x.text == null ? null : String(x.text),
      turn: x.turn == null ? null : x.turn,
      asr_confidence: x.asr_confidence == null ? null : x.asr_confidence,
    });
    return { ok: true, value: { seq: rec.seq, t: rec.t } };
  }

  logAgentReply(r) {
    if (!this.log.sessionId) return { ok: false, error: { code: 'no_session' } };
    const x = r || {};
    const rec = this.log.append('agent_reply', {
      task_id: this.task ? this.task.task_id : null,
      text: x.text == null ? null : String(x.text),
      turn: x.turn == null ? null : x.turn,
      model: x.model || (this.session && this.session.model) || null,
      tokens: x.tokens || null,
    });
    return { ok: true, value: { seq: rec.seq, t: rec.t } };
  }

  /** Adapter failures etc. reported by the agent loop. */
  logError(code, message) {
    if (!this.log.sessionId) return { ok: false, error: { code: 'no_session' } };
    this.log.append('session_error', { code: code || 'adapter_failure', message: message || null });
    return { ok: true };
  }

  // ================================================================ lifecycle

  end(opts) {
    if (this.task) this._closeTask({ outcome: 'timeout', reason: 'session ended', ended_by: 'timeout' });
    if (this.vstate.active_call) this.hangUp('session_end');
    if (this.vstate.playback) this.stopPlayback('session_end');
    if (this.log.sessionId) {
      this.log.append('session_end', { reason: (opts && opts.reason) || null, tasks: this.tasksDone.length });
      this.log.finish();
    }
    this.phase = this.phase === 'failed' ? 'failed' : 'ended';
    this._changed('phase');
    this.emit('contentSession', { phase: this.phase });
    return { ok: true, value: this.log.status() };
  }

  /** Per-frame upkeep (engine seam): road recorder, timers, arrivals. */
  tick(nowMs) {
    this.road.poll(nowMs);
    if (this.phase !== 'ready') return;
    const call = this.vstate.active_call;
    if (call && this.t() - call.started_t >= CALL_MAX_S) this.hangUp('timeout_20s');
    const task = this.task;
    if (task && task.limits.max_seconds != null && (svcNowMs() - task.started_ms) / 1000 >= task.limits.max_seconds) {
      this._closeTask({ outcome: 'timeout', reason: `time limit ${task.limits.max_seconds}s reached`, ended_by: 'timeout' });
    }
    const route = this.vstate.route;
    if (route) {
      const vArc = this._vehicleArc();
      if (vArc != null) {
        const stops = this._routeStops();
        const first = stops[0];
        if (first && first.arc != null && Math.abs(first.arc - vArc) <= ARRIVAL_M) {
          if (stops.length > 1) {
            const wp = route.waypoints.shift();
            this._effect('waypoint_reached', wp.action_id, { poi_id: wp.poi_id });
            if (this.effects) this.effects.routeChanged(this.routeView());
            this._changed('route');
          } else {
            this.vstate.route = null;
            this._effect('arrived', route.action_id, { poi_id: route.destination_poi_id });
            if (this.effects) this.effects.routeChanged(null, 'arrived');
            this._changed('route');
          }
        }
      }
    }
  }

  // ================================================================ views

  publicState() {
    return {
      phase: this.phase,
      error: this.error,
      pack: this.pack ? { pack_id: this.pack.pack_id, pack_version: this.pack.pack_version, content_hash: this.pack.content_hash, locale: this.pack.locale } : null,
      map: this.mapEntry ? { map_id: this.mapEntry.map_id, map_version: this.mapEntry.map_version } : null,
      t: this.t(),
      local_time: this.phase === 'ready' ? this.localTime() : null,
      active_call: this.vstate.active_call ? Object.assign({}, this.vstate.active_call) : null,
      messages: this.vstate.messages.length,
      playback: this.vstate.playback ? this._playbackItem() : null,
      route: this.phase === 'ready' ? this._routeSummary() : null,
      task: this.currentTask(),
      log: this.log.status(),
    };
  }

  /** Is a POI open right now (HMI display helper)? */
  openNow(p) {
    return isOpenAt(p && p.opening_hours, this.localTime());
  }
}

  Object.defineProperty(__exports, "ContentService", { enumerable: true, get: () => ContentService });
});

/* --- src/content/effects.js --- */
__def("src/content/effects.js", function (__exports, __req) {
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
const CALL_CLIPS = {
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

const CONTENT_STRINGS = {
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

function contentStrings(locale) {
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

class ContentEffects {
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
function hueOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

  Object.defineProperty(__exports, "CALL_CLIPS", { enumerable: true, get: () => CALL_CLIPS });
  Object.defineProperty(__exports, "CONTENT_STRINGS", { enumerable: true, get: () => CONTENT_STRINGS });
  Object.defineProperty(__exports, "contentStrings", { enumerable: true, get: () => contentStrings });
  Object.defineProperty(__exports, "ContentEffects", { enumerable: true, get: () => ContentEffects });
  Object.defineProperty(__exports, "hueOf", { enumerable: true, get: () => hueOf });
});

/* --- src/content/PoiSigns.js --- */
__def("src/content/PoiSigns.js", function (__exports, __req) {
/**
 * POIs in the 3D world (PromptDrive spec, "POIs in the 3D world"): one
 * generic roadside sign per pack POI, at its slot position, labeled with
 * `display_name` and styled by category (fuel pump, café cup, parking P,
 * pharmacy cross, …). Brand names appear only as text, never as logos.
 * Locked and procedural POIs render the same way.
 *
 * Signs exist for every POI within the default search radius (3 km of network
 * distance, ahead or behind), so whatever search_poi returns near the vehicle
 * is also standing in the world; farther ones are built/disposed lazily.
 */

const { RoadGraph } = __req("src/content/RoadGraph.js");

const SIGN_RANGE_M = 3000; // = default search_poi radius (THRESHOLDS.defaultRadiusM)
const SIGN_UPDATE_MS = 400;
const SIGN_W = 4.2;
const SIGN_H = 2.1;
const SIGN_POST_H = 2.6;

const CATEGORY_STYLE = {
  fuel: { color: '#d9480f', glyph: 'pump' },
  ev_charging: { color: '#2b8a3e', glyph: 'bolt' },
  parking: { color: '#1c62c4', glyph: 'P' },
  restaurant: { color: '#a61e4d', glyph: 'fork' },
  cafe: { color: '#7a4b2a', glyph: 'cup' },
  supermarket: { color: '#5f3dc4', glyph: 'cart' },
  pharmacy: { color: '#2f9e44', glyph: 'cross' },
  hospital: { color: '#c92a2a', glyph: 'H' },
  hotel: { color: '#364fc7', glyph: 'bed' },
  atm: { color: '#087f5b', glyph: '$' },
  car_service: { color: '#495057', glyph: 'wrench' },
  landmark: { color: '#795c00', glyph: 'star' },
  home: { color: '#1971c2', glyph: 'house' },
  work: { color: '#343a40', glyph: 'case' },
};

function drawGlyph(ctx, glyph, cx, cy, s) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const text = (t, size) => {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, cx, cy + s * 0.04);
  };
  switch (glyph) {
    case 'pump':
      ctx.fillRect(cx - s * 0.32, cy - s * 0.38, s * 0.4, s * 0.76);
      ctx.clearRect(cx - s * 0.24, cy - s * 0.3, s * 0.24, s * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.08, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.05);
      ctx.lineTo(cx + s * 0.3, cy + s * 0.25);
      ctx.stroke();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.08, cy - s * 0.42);
      ctx.lineTo(cx - s * 0.22, cy + s * 0.05);
      ctx.lineTo(cx, cy + s * 0.05);
      ctx.lineTo(cx - s * 0.08, cy + s * 0.42);
      ctx.lineTo(cx + s * 0.22, cy - s * 0.05);
      ctx.lineTo(cx, cy - s * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cup':
      ctx.fillRect(cx - s * 0.3, cy - s * 0.15, s * 0.44, s * 0.4);
      ctx.beginPath();
      ctx.arc(cx + s * 0.18, cy + s * 0.04, s * 0.12, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.16, cy - s * 0.38);
      ctx.quadraticCurveTo(cx - s * 0.06, cy - s * 0.3, cx - s * 0.12, cy - s * 0.22);
      ctx.moveTo(cx, cy - s * 0.38);
      ctx.quadraticCurveTo(cx + s * 0.1, cy - s * 0.3, cx + s * 0.04, cy - s * 0.22);
      ctx.stroke();
      break;
    case 'cross':
      ctx.fillRect(cx - s * 0.12, cy - s * 0.38, s * 0.24, s * 0.76);
      ctx.fillRect(cx - s * 0.38, cy - s * 0.12, s * 0.76, s * 0.24);
      break;
    case 'fork':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.18, cy - s * 0.38); ctx.lineTo(cx - s * 0.18, cy + s * 0.38);
      ctx.moveTo(cx - s * 0.3, cy - s * 0.38); ctx.lineTo(cx - s * 0.3, cy - s * 0.1); ctx.lineTo(cx - s * 0.06, cy - s * 0.1); ctx.lineTo(cx - s * 0.06, cy - s * 0.38);
      ctx.moveTo(cx + s * 0.2, cy + s * 0.38); ctx.lineTo(cx + s * 0.2, cy - s * 0.38); ctx.quadraticCurveTo(cx + s * 0.38, cy - s * 0.2, cx + s * 0.2, cy);
      ctx.stroke();
      break;
    case 'cart':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy - s * 0.3); ctx.lineTo(cx - s * 0.25, cy - s * 0.3); ctx.lineTo(cx - s * 0.12, cy + s * 0.15); ctx.lineTo(cx + s * 0.3, cy + s * 0.15); ctx.lineTo(cx + s * 0.38, cy - s * 0.18); ctx.lineTo(cx - s * 0.2, cy - s * 0.18);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - s * 0.08, cy + s * 0.32, s * 0.07, 0, Math.PI * 2); ctx.arc(cx + s * 0.24, cy + s * 0.32, s * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bed':
      ctx.fillRect(cx - s * 0.4, cy, s * 0.8, s * 0.16);
      ctx.fillRect(cx - s * 0.4, cy - s * 0.3, s * 0.08, s * 0.6);
      ctx.fillRect(cx - s * 0.1, cy - s * 0.14, s * 0.5, s * 0.14);
      ctx.beginPath(); ctx.arc(cx - s * 0.2, cy - s * 0.08, s * 0.09, 0, Math.PI * 2); ctx.fill();
      break;
    case 'wrench':
      ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy + s * 0.3); ctx.lineTo(cx + s * 0.12, cy - s * 0.12); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + s * 0.2, cy - s * 0.2, s * 0.16, Math.PI * 0.9, Math.PI * 2.6); ctx.stroke();
      break;
    case 'star': {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? s * 0.18 : s * 0.42;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'house':
      ctx.beginPath(); ctx.moveTo(cx - s * 0.38, cy); ctx.lineTo(cx, cy - s * 0.38); ctx.lineTo(cx + s * 0.38, cy); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - s * 0.26, cy, s * 0.52, s * 0.34);
      break;
    case 'case':
      ctx.fillRect(cx - s * 0.38, cy - s * 0.18, s * 0.76, s * 0.48);
      ctx.strokeRect(cx - s * 0.14, cy - s * 0.34, s * 0.28, s * 0.16);
      break;
    default:
      text(glyph, s * 0.8);
  }
  ctx.restore();
}

/** 2:1 sign face: category color, white glyph tile, display name. */
function paintSign(canvas, poi) {
  const style = CATEGORY_STYLE[poi.category] || { color: '#343a40', glyph: '?' };
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = style.color;
  ctx.fillRect(14, 14, W - 28, H - 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  const tile = H - 120;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(60, 60, tile, tile);
  drawGlyph(ctx, style.glyph, 60 + tile / 2, 60 + tile / 2, tile * 0.9);
  // Name, wrapped to at most 3 lines, auto-shrunk to fit.
  const textX = 60 + tile + 40;
  const maxW = W - textX - 60;
  const words = String(poi.display_name || '').split(/\s+/);
  let size = Math.round(H * 0.18);
  let lines;
  for (; size >= Math.round(H * 0.08); size -= 4) {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (ctx.measureText(next).width <= maxW || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const lh = size * 1.12;
  const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, k) => ctx.fillText(l, textX, y0 + k * lh, maxW));
}

function signThree(THREE, root) {
  const Mat = THREE.MeshBasicMaterial || THREE.C;
  const Plane = THREE.PlaneGeometry || THREE.J;
  const Group = THREE.Group || THREE.G;
  let Mesh = THREE.Mesh || null;
  if (!Mesh && root && root.traverse) {
    root.traverse((c) => { if (!Mesh && c && c.isMesh) Mesh = c.constructor; });
  }
  if (!Mesh) Mesh = THREE.B;
  return { Mat, Plane, Group, Mesh };
}

function makeTexture(THREE, canvas) {
  if (THREE.CanvasTexture) return new THREE.CanvasTexture(canvas);
  for (const key of Object.keys(THREE)) {
    const val = THREE[key];
    if (typeof val === 'function' && val.prototype && val.prototype.isTexture) {
      const tex = new val(canvas);
      tex.image = canvas;
      tex.needsUpdate = true;
      return tex;
    }
  }
  const Loader = THREE.U || THREE.TextureLoader;
  const tmp = new Loader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const tex = new tmp.constructor(canvas);
  tex.image = canvas;
  tex.needsUpdate = true;
  tmp.dispose();
  return tex;
}

class PoiSigns {
  constructor(service) {
    this.svc = service;
    this.h = null;
    this.signs = new Map(); // poi id -> { group, pos, disposeList }
    this._last = 0;
    this._three = null;
    this.disabled = false;
    this.enabled = true;
  }

  attach(h) {
    this.h = h;
  }

  _ground(x, z, fallback) {
    try {
      const V = this.h.THREE.Vector3 || this.h.THREE.W;
      if (V && this.h.world && this.h.world.getHeight) {
        const v = new V(x, fallback, z);
        const hgt = this.h.world.getHeight(v);
        if (isFinite(hgt)) return hgt;
      }
    } catch (_e) {}
    return fallback;
  }

  _build(poi) {
    const h = this.h;
    const parent = h.world && h.world.container;
    if (!parent) return null;
    if (!this._three) this._three = signThree(h.THREE, parent);
    const T = this._three;
    if (!T.Mat || !T.Plane || !T.Mesh || !T.Group) throw new Error('PoiSigns: THREE classes not found');
    const i = RoadGraph.indexOf(poi.location.road_node_id);
    const node = this.svc.road.node(i);
    const x = poi.location.x;
    const z = poi.location.y;
    const ground = this._ground(x, z, node ? node.z : 0);

    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 384;
    paintSign(canvas, poi);
    const tex = makeTexture(h.THREE, canvas);
    const faceMat = new T.Mat({ map: tex });
    const postMat = new T.Mat({ color: 0x5b6270 });
    postMat.side = 2; // DoubleSide
    const boardGeo = new T.Plane(SIGN_W, SIGN_H);
    const postGeo = new T.Plane(0.18, SIGN_POST_H + SIGN_H / 2);

    const group = new T.Group();
    group.name = 'poi_sign_' + poi.id;
    const front = new T.Mesh(boardGeo, faceMat);
    front.position.set(0, SIGN_POST_H + SIGN_H / 2, 0.02);
    const back = new T.Mesh(boardGeo, faceMat);
    back.position.set(0, SIGN_POST_H + SIGN_H / 2, -0.02);
    back.rotation.y = Math.PI;
    for (const sx of [-SIGN_W * 0.35, SIGN_W * 0.35]) {
      const post = new T.Mesh(postGeo, postMat);
      post.position.set(sx, (SIGN_POST_H + SIGN_H / 2) / 2, 0);
      group.add(post);
    }
    group.add(front);
    group.add(back);
    // Face approaching traffic: board normal (+Z local) points back along the
    // road tangent, turned 25° toward the carriageway so it reads from the lane.
    const a = node ? node.a : 0;
    const side = node ? Math.sign((x - node.x) * -node.nx + (z - node.y) * -node.nz) || 1 : 1;
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)) + side * 0.44;
    group.rotation.y = yaw;
    group.position.set(x, ground, z);
    parent.add(group);
    return { group, pos: { x, y: z, ground }, dispose: [tex, faceMat, postMat, boardGeo, postGeo], node: i };
  }

  _dispose(rec) {
    try { if (rec.group.parent) rec.group.parent.remove(rec.group); } catch (_e) {}
    for (const d of rec.dispose) {
      try { d.dispose(); } catch (_e) {}
    }
  }

  clear() {
    for (const rec of this.signs.values()) this._dispose(rec);
    this.signs.clear();
  }

  update(nowMs) {
    if (this.disabled || !this.h || nowMs - this._last < SIGN_UPDATE_MS) return;
    this._last = nowMs;
    const svc = this.svc;
    if (!svc.active || !this.enabled) {
      if (this.signs.size) this.clear();
      return;
    }
    const v = svc.road.vehiclePosition();
    if (!v || v.arc == null) return;
    try {
      const keep = new Set();
      for (const poi of svc.resolver.allPois()) {
        const i = RoadGraph.indexOf(poi.location && poi.location.road_node_id);
        const arc = i == null ? null : svc.road.arcOf(i);
        if (arc == null) continue;
        const d = arc - v.arc;
        if (Math.abs(d) > SIGN_RANGE_M) continue;
        keep.add(poi.id);
        if (!this.signs.has(poi.id)) this.signs.set(poi.id, this._build(poi));
      }
      for (const [id, rec] of this.signs) {
        if (!keep.has(id)) {
          this._dispose(rec);
          this.signs.delete(id);
        }
      }
    } catch (e) {
      this.disabled = true;
      console.error('PoiSigns disabled:', e);
    }
  }

  /** Currently built signs (for the world-consistency acceptance check). */
  state() {
    const out = [];
    for (const [id, rec] of this.signs) {
      if (!rec) continue;
      out.push({ poi_id: id, x: Math.round(rec.pos.x * 100) / 100, y: Math.round(rec.pos.y * 100) / 100, road_node_id: RoadGraph.idOf(rec.node), visible: !!rec.group.parent });
    }
    return out;
  }
}

  Object.defineProperty(__exports, "CATEGORY_STYLE", { enumerable: true, get: () => CATEGORY_STYLE });
  Object.defineProperty(__exports, "PoiSigns", { enumerable: true, get: () => PoiSigns });
});

/* --- src/content/VehicleContent.js --- */
__def("src/content/VehicleContent.js", function (__exports, __req) {
/**
 * Public facade of the content layer, exposed as `window.VehicleContent`
 * (and through the integration API as `PromptDrive.content.*`).
 *
 * Follows the subsystem contract: the facade owns intent + validation; the
 * runtime reads the engine through the bridge handles once they attach; live
 * state is published back (contentState / contentCall / contentEvent events).
 *
 * It needs no engine patch: road state, ego, world container and THREE are
 * already on PromptDriveBridge.handles, and per-frame upkeep (road recorder,
 * timers, POI signs) runs on its own requestAnimationFrame loop.
 */

const { toolDefinitions, SYSTEM_PROMPT_BLOCK, SYSTEM_PROMPT_VERSION, TOOLS_VERSION, TOOL_NAMES, validatePack, computeContentHash, PACKAGE_VERSION } = __req("packages/vehicle-content/index.js");
const { ContentService } = __req("src/content/ContentService.js");
const { ContentEffects, contentStrings, hueOf } = __req("src/content/effects.js");
const { PoiSigns, CATEGORY_STYLE } = __req("src/content/PoiSigns.js");
const { CONTENT_MAPS, findContentMap, identifyLiveMap, checkLiveMap } = __req("src/content/maps.js");

const vcEmit = (ev, payload) => {
  try {
    if (typeof window !== 'undefined' && window.PromptDriveBridge) window.PromptDriveBridge.emit(ev, payload);
  } catch (_e) {}
};

const contentService = new ContentService(vcEmit);
const contentEffects = new ContentEffects();
contentService.effects = contentEffects;
const poiSigns = new PoiSigns(contentService);

function vcOk(value) {
  return { ok: true, value };
}
function vcErr(error, message) {
  return { ok: false, error, message };
}

const VehicleContent = {
  version: PACKAGE_VERSION,
  toolsVersion: TOOLS_VERSION,
  service: contentService,
  effects: contentEffects,
  signs: poiSigns,
  strings: contentStrings,
  hueOf,
  categoryStyle: CATEGORY_STYLE,

  get active() {
    return contentService.active;
  },

  // ---------------------------------------------------------------- session
  load: (opts) => contentService.load(opts),
  status: () => contentService.publicState(),
  end: (opts) => contentService.end(opts),

  // ---------------------------------------------------------------- tools
  /** One vehicle-tools call: (fn, args, { source, turn, call_id }). */
  call: (fn, args, meta) => contentService.call(fn, args, meta),
  /** Parallel calls of one model turn, executed in the given order. */
  callBatch: (calls, meta) => (Array.isArray(calls) ? calls : []).map((c) => ({
    call_id: c && c.call_id != null ? c.call_id : null,
    fn: c && (c.fn || c.name),
    result: contentService.call(c && (c.fn || c.name), c && (c.args || c.arguments), Object.assign({}, meta || {}, { call_id: c && c.call_id })),
  })),
  tools: {
    names: () => TOOL_NAMES.slice(),
    list: (format) => toolDefinitions(format),
    systemPrompt: () => ({ version: SYSTEM_PROMPT_VERSION, text: SYSTEM_PROMPT_BLOCK }),
  },

  // ---------------------------------------------------------------- tasks
  task: {
    start: (def) => contentService.taskStart(def),
    end: (opts) => contentService.taskEnd(opts),
    current: () => contentService.currentTask(),
  },

  // ---------------------------------------------------------------- log
  log: {
    utterance: (u) => contentService.logUtterance(u),
    agentReply: (r) => contentService.logAgentReply(r),
    error: (code, message) => contentService.logError(code, message),
    ack: (batchId) => contentService.log.ack(batchId),
    flush: () => { contentService.log.flush(); return contentService.log.status(); },
    configure: (opts) => contentService.log.configure(opts),
    status: () => contentService.log.status(),
    events: (filter) => {
      const f = filter || {};
      return contentService.log.all.filter((e) => (!f.type || e.type === f.type) && (!f.task_id || e.task_id === f.task_id) && (f.since == null || e.seq > f.since));
    },
    download: () => {
      if (typeof document === 'undefined') return false;
      const lines = contentService.log.all.map((e) => JSON.stringify(e)).join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines], { type: 'application/x-ndjson' }));
      a.download = `content-log-${contentService.log.sessionId || 'session'}.jsonl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return true;
    },
  },

  // ---------------------------------------------------------------- driver controls
  hangUp: () => contentService.hangUp('driver'),
  stopPlayback: () => contentService.stopPlayback('driver'),
  cancelRoute: () => contentService.cancelRoute('driver'),
  nowPlaying: () => (contentService.active ? contentService._nowPlayingView() : null),
  routeView: () => (contentService.active ? contentService.routeView() : null),

  // ---------------------------------------------------------------- map
  map: {
    list: () => CONTENT_MAPS.map((m) => ({ map_id: m.map_id, map_version: m.map_version, label: m.label, scene: Object.assign({}, m.scene), pinned: m.fingerprint.points.length > 0 })),
    info: () => {
      const h = contentService.h;
      const road = contentService.road;
      return {
        live: h ? identifyLiveMap(h, road) : null,
        session: contentService.mapEntry ? { map_id: contentService.mapEntry.map_id, map_version: contentService.mapEntry.map_version } : null,
        recorded: road.ready ? { from: 'n_' + road.minI, to: 'n_' + road.maxI, live_to: road.liveMaxI == null ? null : 'n_' + road.liveMaxI } : null,
        mismatches: road.mismatches.length,
      };
    },
    check: (mapId, mapVersion) => checkLiveMap(findContentMap(mapId, mapVersion), contentService.h, contentService.road),
    position: () => contentService.road.vehiclePosition(),
    /** Road graph JSON as recorded so far (+ fingerprint to pin in maps.js). */
    exportGraph: (meta) => {
      const road = contentService.road;
      if (!road.ready) return vcErr('unavailable', 'road not recorded yet');
      const h = contentService.h || {};
      let scene = null;
      try { scene = { seed: h.sceneConfig.value.seed, sceneName: h.sceneConfig.value.sceneName, topography: h.sceneConfig.value.topography }; } catch (_e) {}
      const graph = road.exportGraph(Object.assign({ map_id: null, map_version: null, scene, start_node: 'n_0', exported_by: 'PromptDrive.content.map.exportGraph' }, meta || {}));
      const idx = [0, 50, 100, 200, 300, 500, 750, 900].filter((i) => i >= road.minI && i <= (road.liveMaxI == null ? -1 : road.liveMaxI));
      return vcOk({ graph, fingerprint: road.fingerprint(idx) });
    },
    /** Stage a registry map's scene config (static; the sim reloads to apply). */
    apply: (mapId, mapVersion) => {
      const m = findContentMap(mapId, mapVersion);
      if (!m) return vcErr('unknown_map', `No map ${mapId} ${mapVersion || ''} in this build`);
      const api = typeof window !== 'undefined' ? window.PromptDrive : null;
      if (!api || !api.config) return vcErr('unavailable', 'PromptDrive API not loaded');
      const staged = api.config.set({ scene: { seed: m.scene.seed, sceneName: m.scene.sceneName, topography: m.scene.topography, startNode: m.scene.startNode } });
      if (!staged || staged.ok === false) return staged;
      return api.config.apply();
    },
  },

  // ---------------------------------------------------------------- packs
  cache: {
    prefetch: (list) => contentService.prefetch(list),
  },
  validatePack: (pack, opts) => validatePack(pack, opts),
  computeContentHash: (pack) => computeContentHash(pack),

  // ---------------------------------------------------------------- HMI helpers
  /** The pack's display locale (HMI language). */
  locale: () => contentService.locale,
  openNow: (poi) => contentService.openNow(poi),
  setAudioGain: (g) => contentEffects.setGain(g),
};

// ---------------------------------------------------------------- engine seam
let vcAttached = false;
function vcLoop() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    contentService.tick(now);
    poiSigns.update(now);
  } catch (e) {
    if (!vcLoop._logged) { vcLoop._logged = true; console.error('VehicleContent tick failed', e); }
  }
  requestAnimationFrame(vcLoop);
}

function vcAttach(h) {
  if (vcAttached) return;
  vcAttached = true;
  contentService.attach(h);
  poiSigns.attach(h);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(vcLoop);
}

if (typeof window !== 'undefined') {
  window.VehicleContent = VehicleContent;
  const tryAttach = () => {
    const b = window.PromptDriveBridge;
    if (b && typeof b.whenAttached === 'function') {
      b.whenAttached((h) => vcAttach(h));
      // Mirror the parent's batch acks if a WorlDrive parent answers by event.
      return true;
    }
    return false;
  };
  if (!tryAttach()) {
    const timer = setInterval(() => { if (tryAttach()) clearInterval(timer); }, 200);
  }
}


});

  __req("src/content/VehicleContent.js");
})();
