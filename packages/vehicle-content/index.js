/**
 * @hcis/vehicle-content — the one shared copy of the content-layer contract
 * used by PromptDrive (runtime) and WorlDrive (authoring/validation/analysis).
 * Plain ES modules, no dependencies, no I/O.
 *
 * PromptDrive bundles these modules into static/js/content.js
 * (scripts/build-content.js); WorlDrive imports this folder as a git
 * dependency pinned to an exact version.
 */

export {
  PACKAGE_VERSION, SCHEMA_VERSION, TOOLS_VERSION, SUPPORTED_TOOLS_VERSIONS, RESOLVER_VERSION,
  THRESHOLDS, SCORES, POI_CATEGORIES, MEDIA_TYPES, MEDIA_BUCKETS, NUMBER_TYPES, END_OUTCOMES, SOURCES,
} from './src/version.js';
export { sha256Hex } from './src/sha256.js';
export { canonicalJson, computeContentHash, verifyContentHash } from './src/canonical.js';
export { normalizeText, indexForms, phoneticKey, phoneticToken, editSimilarity } from './src/normalize.js';
export { SYNONYMS, synonymsVersion } from './src/synonyms.js';
export { parseOpeningHours, isOpenAt, parseLocalTime, addSeconds } from './src/hours.js';
export { createResolver } from './src/resolver.js';
export { TOOL_SCHEMAS, TOOL_NAMES, toolSchema, SYSTEM_PROMPT_BLOCK, SYSTEM_PROMPT_VERSION } from './src/tools.js';
export { toOpenAITools, toGeminiDeclarations, toJsonSchemaList, toolDefinitions } from './src/adapters.js';
export { validateToolArgs } from './src/validate-args.js';
export { validatePack } from './src/pack-validate.js';
export { labelTask } from './src/labeler.js';
