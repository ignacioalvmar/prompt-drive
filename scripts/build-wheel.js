/**
 * Bundles src/wheel into a browser-global WheelControls facade.
 * Mirrors build-traffic.js: strip ES module syntax, concatenate the source
 * files in dependency order inside one IIFE, expose window.WheelControls.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/wheel');

// Dependency order: a file may reference only symbols defined above it
// (WheelPanel is optional and referenced lazily by WheelControls.js).
const files = ['config.js', 'WheelInput.js', 'WheelPanel.js', 'WheelControls.js'].filter(
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
  return `/* --- ${f} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

const bundle = `/* Steering-wheel & pedal controls — built from src/wheel/ */
(function () {
${parts.join('\n\n')}
})();
`;

const outPath = path.join(root, 'static/js/wheel.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
