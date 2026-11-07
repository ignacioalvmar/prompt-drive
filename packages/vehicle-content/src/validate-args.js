/**
 * Argument validation for tool calls against their JSON Schema (the subset
 * TOOL_SCHEMAS uses: type, enum, required, properties, additionalProperties,
 * items, minimum/maximum/exclusiveMinimum, minLength, anyOf-of-required).
 * Returns a list of human-readable problems; empty means valid. Invalid calls
 * are answered with status "invalid_argument" instead of throwing.
 */

import { toolSchema } from './tools.js';

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

export function validateToolArgs(name, args) {
  const t = toolSchema(name);
  if (!t) return ['unknown function: ' + name];
  const out = [];
  check(t.parameters, args == null ? {} : args, '', out);
  return out;
}
