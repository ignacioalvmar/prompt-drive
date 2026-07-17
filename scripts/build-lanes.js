/**
 * Bundles src/lanes into a browser-global LaneRoads facade.
 * Mirrors build-metrics.js: strip ES module syntax, concatenate the source
 * files in dependency order inside one IIFE, expose window.LaneRoads.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/lanes');

// Dependency order: a file may reference only symbols defined above it.
const files = ['config.js', 'LanePanel.js', 'LaneRoads.js'];

function stripModuleSyntax(src) {
  return src
    .replace(/import\s+[^;]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    .replace(/^\s*export\s+/gm, '');
}

const parts = files.map((f) => {
  const p = path.join(dir, f);
  // Normalize to LF so a CRLF checkout can't leak CRs into the bundle.
  const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return `/* --- ${f} --- */\n${stripModuleSyntax(src)}`;
});

const bundle = `/* Dynamic multi-lane roads — built from src/lanes/ */
(function () {
${parts.join('\n\n')}
})();
`;

const outPath = path.join(root, 'static/js/lanes.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
