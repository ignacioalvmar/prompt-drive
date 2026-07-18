/**
 * Bundles src/console into a browser-global `window.CenterConsole` class
 * (the in-cabin center-stack touchscreen). Mirrors build-cluster.js /
 * build-api.js: strip ES module syntax, concatenate in dependency order
 * inside one IIFE. THREE is passed in at construction time from the game
 * bundle (see the CenterConsole patches in scripts/build-main.js).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/console');

// Dependency order: constants → shared canvas helpers → apps → core class.
const files = [
  'config.js',
  'ui.js',
  'apps/MapApp.js',
  'apps/NavApp.js',
  'apps/AudioApp.js',
  'apps/PhoneApp.js',
  'apps/ComfortApp.js',
  'CenterConsole.js',
];

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

const bundle = `/* Center console (center stack) — built from src/console/ */
(function () {
${parts.join('\n\n')}
  if (typeof window !== 'undefined') {
    window.CenterConsole = CenterConsole;
  }
})();
`;

const outPath = path.join(root, 'static/js/console.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
