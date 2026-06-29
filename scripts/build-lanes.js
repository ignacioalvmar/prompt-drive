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
  return `/* --- ${f} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

const bundle = `/* Dynamic multi-lane roads — built from src/lanes/ */
(function () {
${parts.join('\n\n')}
})();
`;

const outPath = path.join(root, 'static/js/lanes.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
