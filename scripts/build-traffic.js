/**
 * Bundles src/traffic into a browser-global RoadTraffic facade.
 * Mirrors build-lanes.js: strip ES module syntax, concatenate the source
 * files in dependency order inside one IIFE, expose window.RoadTraffic.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/traffic');

// Dependency order: a file may reference only symbols defined above it
// (TrafficPanel is optional and referenced lazily by RoadTraffic.js).
const files = ['config.js', 'TrafficVehicle.js', 'TrafficManager.js', 'TrafficPanel.js', 'RoadTraffic.js'].filter(
  (f) => fs.existsSync(path.join(dir, f))
);

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

const bundle = `/* Traffic road actors — built from src/traffic/ */
(function () {
${parts.join('\n\n')}
})();
`;

const outPath = path.join(root, 'static/js/traffic.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
