/**
 * Provider adapters generated from TOOL_SCHEMAS. Names, parameter names and
 * descriptions are passed through unchanged; only the envelope differs.
 *
 *   toOpenAITools()          -> [{ type:'function', function:{ name, description, parameters } }]
 *   toGeminiDeclarations()   -> [{ name, description, parameters }]  (OpenAPI 3.0 subset)
 */

import { TOOL_SCHEMAS } from './tools.js';

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

export function toOpenAITools(schemas) {
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

export function toGeminiDeclarations(schemas) {
  return (schemas || TOOL_SCHEMAS).map((t) => {
    const params = toGeminiSchema(t.parameters);
    const decl = { name: t.name, description: t.description };
    // Gemini rejects an OBJECT with no properties; omit parameters instead.
    if (params.properties && Object.keys(params.properties).length) decl.parameters = params;
    return decl;
  });
}

/** The provider-neutral listing (what the shared package exports). */
export function toJsonSchemaList(schemas) {
  return (schemas || TOOL_SCHEMAS).map((t) => ({ name: t.name, description: t.description, parameters: clone(t.parameters) }));
}

export function toolDefinitions(format) {
  if (format === 'openai') return toOpenAITools();
  if (format === 'gemini') return toGeminiDeclarations();
  return toJsonSchemaList();
}
