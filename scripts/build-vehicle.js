/**
 * Bundles src/vehicle into a browser-global `window.VehicleState` — the
 * CAR-bench-shaped in-cabin vehicle-state mirror (car-bench-compat-plan.md).
 * Mirrors build-console.js / build-api.js: strip ES module syntax, concatenate
 * the sources in dependency order inside one IIFE, expose the global.
 *
 * Load order in index.html: after console.js (link.js projects to
 * window.CenterConsole's Comfort controller) and before api.js (so the
 * PromptDrive.vehicle.* facade can delegate to window.VehicleState).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/vehicle');

// Dependency order: schema/validation → store → engine linkage → ambience.
// link.js and ambience.js are added in WP3; guard for their absence so the
// baseline store builds on its own.
const files = ['config.js', 'VehicleState.js', 'link.js', 'ambience.js'].filter((f) =>
  fs.existsSync(path.join(dir, f))
);

function stripModuleSyntax(src) {
  return src
    .replace(/\r\n/g, '\n') // keep the bundle LF even on a CRLF checkout
    .replace(/import\s+[^;]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    .replace(/^\s*export\s+/gm, '');
}

const parts = files.map((f) => {
  const p = path.join(dir, f);
  return `/* --- ${f} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

const bundle = `/* Vehicle state (CAR-bench mirror) — built from src/vehicle/ */
(function () {
${parts.join('\n\n')}
  if (typeof window !== 'undefined') {
    window.VehicleState = VehicleState;
  }
})();
`;

const outPath = path.join(root, 'static/js/vehicle.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
