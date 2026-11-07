#!/usr/bin/env node
/**
 * Generates the provider tool definitions from the shared JSON Schemas:
 *   generated/vehicle-tools-1.0.schema.json   provider-neutral (name/description/parameters)
 *   generated/openai-tools.json               OpenAI-compatible `tools` (GPT-oss etc.)
 *   generated/gemini-declarations.json        Gemini function declarations
 *   generated/system-prompt.txt               the versioned tool-contract prompt block
 *
 * `--check` regenerates in memory and exits 1 if any committed file drifted
 * (the build-time drift test; also run by `npm test`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toJsonSchemaList, toOpenAITools, toGeminiDeclarations, SYSTEM_PROMPT_BLOCK, SYSTEM_PROMPT_VERSION, TOOLS_VERSION } from '../index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generated');

export function generatedFiles() {
  const wrap = (tools) => JSON.stringify({ tools_version: TOOLS_VERSION, tools }, null, 2) + '\n';
  return {
    'vehicle-tools-1.0.schema.json': wrap(toJsonSchemaList()),
    'openai-tools.json': wrap(toOpenAITools()),
    'gemini-declarations.json': wrap(toGeminiDeclarations()),
    'system-prompt.txt': `# ${SYSTEM_PROMPT_VERSION}\n${SYSTEM_PROMPT_BLOCK}\n`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const files = generatedFiles();
  let drift = 0;
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    if (check) {
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null;
      if (cur !== text) {
        console.error(`drift: ${name} differs from the shared schema — run npm run gen:tools`);
        drift++;
      }
    } else {
      fs.writeFileSync(p, text);
      console.log('Wrote', p);
    }
  }
  if (drift) process.exit(1);
  if (check) console.log('provider tool definitions match the shared schema');
}
