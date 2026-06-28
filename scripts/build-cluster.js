/**
 * Bundles src/cluster into a browser-global InstrumentCluster class (canvas-only).
 * THREE is passed in at construction time from the game bundle.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'src/cluster/layout.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'src/cluster/icons.js'), 'utf8');
const cluster = fs.readFileSync(path.join(root, 'src/cluster/InstrumentCluster.js'), 'utf8');

function stripModuleSyntax(src) {
  return src
    .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

const bundle = `/* Instrument cluster — built from src/cluster/ */
(function () {
${stripModuleSyntax(layout)}
${stripModuleSyntax(icons)}
${stripModuleSyntax(cluster)}
  if (typeof window !== 'undefined') {
    window.InstrumentCluster = InstrumentCluster;
  }
})();
`;

const outPath = path.join(root, 'static/js/cluster.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
