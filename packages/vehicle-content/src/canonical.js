/**
 * Canonical JSON + content hash (contract spec, "Envelope"): sorted keys, no
 * whitespace, computed over the whole pack except `content_hash` and
 * `created_at`. Both repos must use exactly this function.
 */

import { sha256Hex } from './sha256.js';

const HASH_EXCLUDED_KEYS = ['content_hash', 'created_at'];

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !isFinite(value)) throw new Error('canonicalJson: non-finite number');
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export function computeContentHash(pack) {
  const copy = {};
  for (const k of Object.keys(pack || {})) {
    if (HASH_EXCLUDED_KEYS.indexOf(k) === -1) copy[k] = pack[k];
  }
  return 'sha256:' + sha256Hex(canonicalJson(copy));
}

/** Verify a pack's own content_hash (and optionally an expected one). */
export function verifyContentHash(pack, expected) {
  const actual = computeContentHash(pack);
  const declared = pack && pack.content_hash;
  if (declared !== actual) return { ok: false, actual, declared, reason: 'declared_mismatch' };
  if (expected != null && expected !== actual) return { ok: false, actual, expected, reason: 'expected_mismatch' };
  return { ok: true, actual };
}
