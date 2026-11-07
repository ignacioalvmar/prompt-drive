/**
 * Bundles the content layer into a browser-global `window.VehicleContent`
 * (static/js/content.js): the shared package packages/vehicle-content
 * (resolver, schemas, adapters, validator, labeler — the single copy shared
 * with WorlDrive) plus the PromptDrive runtime in src/content.
 *
 * Unlike the other build-*.js scripts (which strip module syntax and
 * concatenate into one scope), this one keeps a scope per module: the shared
 * package must stay importable as plain ES modules by WorlDrive, so its files
 * use ordinary names that could collide in a single scope. A tiny module
 * registry maps the supported syntax:
 *   import { a, b as c } from './x.js';     export { a, b as c } from './x.js';
 *   export const|let|function|class NAME    export { a, b as c };
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ENTRY = path.join(root, 'src/content/VehicleContent.js');

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function parseSpecifiers(list) {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (!m) throw new Error('Unsupported specifier: ' + s);
      return { imported: m[1], local: m[2] || m[1] };
    });
}

const modules = new Map(); // abs path -> { id, code, deps }
const order = [];

function load(abs) {
  if (modules.has(abs)) return modules.get(abs);
  const id = rel(abs);
  const mod = { id, code: '', deps: [] };
  modules.set(abs, mod);
  let src = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  const exportsList = [];
  const resolveDep = (spec) => {
    if (!spec.startsWith('.')) throw new Error(`${id}: only relative imports are supported (${spec})`);
    const depAbs = path.resolve(path.dirname(abs), spec);
    load(depAbs);
    mod.deps.push(depAbs);
    return rel(depAbs);
  };

  // Re-exports: export { a, b as c } from './x.js';
  src = src.replace(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, list, spec) => {
    const depId = resolveDep(spec);
    const specs = parseSpecifiers(list);
    for (const s of specs) exportsList.push({ name: s.local, expr: `__req(${JSON.stringify(depId)}).${s.imported}` });
    return '';
  });
  // Imports: import { a, b as c } from './x.js';
  src = src.replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, list, spec) => {
    const depId = resolveDep(spec);
    const specs = parseSpecifiers(list);
    return `const { ${specs.map((s) => (s.imported === s.local ? s.local : `${s.imported}: ${s.local}`)).join(', ')} } = __req(${JSON.stringify(depId)});`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`${id}: unsupported import form`);
  // Local export lists: export { a, b as c };
  src = src.replace(/export\s*\{([^}]*)\};?/g, (_m, list) => {
    for (const s of parseSpecifiers(list)) exportsList.push({ name: s.local, expr: s.imported });
    return '';
  });
  // Declarations: export const|let|function|class NAME
  src = src.replace(/^export\s+(const|let|function|class)\s+(\w+)/gm, (_m, kw, name) => {
    exportsList.push({ name, expr: name });
    return `${kw} ${name}`;
  });
  if (/^\s*export\s/m.test(src)) throw new Error(`${id}: unsupported export form`);

  // Getters so re-exports and late-initialized bindings stay live.
  const exp = exportsList
    .map((e) => `  Object.defineProperty(__exports, ${JSON.stringify(e.name)}, { enumerable: true, get: () => ${e.expr} });`)
    .join('\n');
  mod.code = `${src}\n${exp}`;
  order.push(abs);
  return mod;
}

load(ENTRY);

const defs = order
  .map((abs) => {
    const m = modules.get(abs);
    return `/* --- ${m.id} --- */\n__def(${JSON.stringify(m.id)}, function (__exports, __req) {\n${m.code}\n});`;
  })
  .join('\n\n');

const bundle = `/* Content layer (vehicle-tools/1.0) — built from packages/vehicle-content + src/content/ */
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
${defs}

  __req(${JSON.stringify(rel(ENTRY))});
})();
`;

const outPath = path.join(root, 'static/js/content.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath, `(${order.length} modules)`);
