/**
 * Bundles src/api into a browser-global `window.PromptDrive` facade.
 * Mirrors build-lanes.js: strip ES module syntax, concatenate the source files
 * in dependency order inside one IIFE, expose the API + its transports.
 *
 * Load order in index.html: after lanes.js (so window.LaneRoads exists when the
 * API delegates lane changes) and before main.ca6b3355.chunk.js (so
 * window.PromptDriveBridge exists when the patched engine calls attach()).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/api');

// Dependency order: config (schema/validation) → bridge (registry) → facade
// (uses both) → postmessage (uses the facade).
const files = ['config.js', 'bridge.js', 'PromptDriveApi.js', 'postmessage.js', 'broadcast.js', 'autostart.js'];

function stripModuleSyntax(src) {
  return src
    .replace(/import\s+[^;]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    .replace(/^\s*export\s+/gm, '');
}

const parts = files.map((f) => {
  const p = path.join(dir, f);
  return `/* --- ${f} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

const bundle = `/* Prompt Drive integration API — built from src/api/ */
(function () {
${parts.join('\n\n')}
})();
`;

const outPath = path.join(root, 'static/js/api.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
