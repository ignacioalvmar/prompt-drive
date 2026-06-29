/**
 * Bundles src/metrics into a browser-global DrivingMetrics class.
 * Mirrors build-cluster.js: strip ES module syntax, concatenate the source
 * files in dependency order inside one IIFE, expose window.DrivingMetrics.
 * THREE is passed in at construction time from the game bundle.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/metrics');

// Dependency order: a file may reference only symbols defined above it.
const files = [
  'config.js',
  'metrics-math.js',
  'compute.js',
  'report.js',
  'MetricsCollector.js',
  'MetricsPanel.js',
  'MetricsOverlay.js',
  'DrivingMetrics.js',
];

function stripModuleSyntax(src) {
  return src
    // remove `import ... from '...';` (single- or multi-line; no ';' inside braces)
    .replace(/import\s+[^;]*?from\s*['"][^'"]+['"];?/g, '')
    // remove side-effect imports `import '...';`
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    // drop the `export ` keyword prefix on declarations
    .replace(/^\s*export\s+/gm, '');
}

const parts = files.map((f) => {
  const p = path.join(dir, f);
  return `/* --- ${f} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

const bundle = `/* Driving performance metrics — built from src/metrics/ */
(function () {
${parts.join('\n\n')}

  if (typeof window !== 'undefined') {
    window.DrivingMetrics = DrivingMetrics;
  }
})();
`;

const outPath = path.join(root, 'static/js/metrics.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);
