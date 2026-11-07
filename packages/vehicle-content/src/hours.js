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

export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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
export function parseOpeningHours(str) {
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
export function isOpenAt(hours, now) {
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
export function parseLocalTime(str) {
  const m = String(str || '').trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { day: m[1], minutes: +m[2] * 60 + +m[3] };
}

/** Advance a local time by `seconds` (wraps the week). */
export function addSeconds(t, seconds) {
  const total = DAYS.indexOf(t.day) * 1440 + t.minutes + Math.floor(seconds / 60);
  const wrapped = ((total % 10080) + 10080) % 10080;
  return { day: DAYS[Math.floor(wrapped / 1440)], minutes: wrapped % 1440 };
}
