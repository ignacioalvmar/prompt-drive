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

export function normalizeText(s) {
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
export function germanForm(s) {
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
export function indexForms(s) {
  const out = [];
  const base = normalizeText(s);
  if (base) out.push(base);
  const de = germanForm(s);
  if (de && de !== base) out.push(de);
  return out;
}

export const STOP_WORDS = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'mi', 'mis', 'un', 'una', 'y', 'en', 'por', 'para', 'con'],
  en: ['the', 'a', 'an', 'my', 'of', 'to', 'and', 'in', 'on', 'for', 'with'],
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'zum', 'zur', 'mein', 'meine', 'meinen', 'und', 'von', 'zu', 'im', 'am'],
};

export function stopWordsFor(locales) {
  const set = new Set();
  for (const loc of locales || []) {
    const lang = String(loc || '').toLowerCase().split('-')[0];
    for (const w of STOP_WORDS[lang] || []) set.add(w);
  }
  return set;
}

export function tokenize(norm) {
  return norm ? norm.split(' ').filter(Boolean) : [];
}

/** Tokens with stop words removed; if that empties the list, keep the original. */
export function scoringTokens(norm, stop) {
  const all = tokenize(norm);
  const kept = all.filter((t) => !stop.has(t));
  return kept.length ? kept : all;
}

/**
 * Phonetic key: a small, deterministic Spanish/English/German-aware reduction
 * ("Yesica" == "Jessica", "Baleria" == "Valeria", "Kathy" == "Cathy").
 * Applied per token on the normalized form.
 */
export function phoneticToken(tok) {
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

export function phoneticKey(norm) {
  return tokenize(norm).map(phoneticToken).join(' ');
}

export function levenshtein(a, b) {
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
export function editSimilarity(a, b) {
  const m = Math.max(a.length, b.length);
  if (!m) return 1;
  return 1 - levenshtein(a, b) / m;
}

/** Round to 4 decimals so floating error never changes ordering across engines. */
export function round4(x) {
  return Math.round(x * 10000) / 10000;
}
