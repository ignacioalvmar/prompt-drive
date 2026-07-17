/**
 * Bundles src/cluster into a browser-global InstrumentCluster class (canvas-only).
 * THREE is passed in at construction time from the game bundle.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Normalize to LF so a CRLF checkout can't leak CRs into the bundle.
const readLf = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const layout = readLf(path.join(root, 'src/cluster/layout.js'));
const icons = readLf(path.join(root, 'src/cluster/icons.js'));
const cluster = readLf(path.join(root, 'src/cluster/InstrumentCluster.js'));

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
