/**
 * Bundles src/feedback into a browser-global `window.CabinFeedback` — the
 * in-cabin feedback layer for agent actions (Cabina Abierta challenge).
 * Mirrors build-vehicle.js: strip ES module syntax, concatenate inside one
 * IIFE, expose the global. Feature files in src/feedback/features/ are
 * appended in alphabetical order, so each one is self-contained and
 * registers itself with CabinFeedback.register().
 *
 * Load order in index.html: after vehicle.js (registerProjector seam) and
 * api.js (window.PromptDrive exists, so PromptDrive.feedback can be attached),
 * before the main bundle.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/feedback');
const featuresDir = path.join(dir, 'features');

function stripModuleSyntax(src) {
  return src
    .replace(/\r\n/g, '\n')
    .replace(/import\s+[^;]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    .replace(/^\s*export\s+/gm, '');
}

const core = ['CabinFeedback.js'].map((f) => path.join(dir, f));
const features = fs.existsSync(featuresDir)
  ? fs.readdirSync(featuresDir).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(featuresDir, f))
  : [];

const parts = core.concat(features).map((p) => {
  const rel = path.relative(dir, p).replace(/\\/g, '/');
  return `/* --- ${rel} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

const bundle = `/* Cabin feedback layer — built from src/feedback/ (${features.length} feature file(s)) */
(function () {
${parts.join('\n\n')}
  if (typeof window !== 'undefined') {
    window.CabinFeedback = CabinFeedback;
  }
})();
`;

const outPath = path.join(root, 'static/js/feedback.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath, `(${features.length} features: ${features.map((f) => path.basename(f, '.js')).join(', ') || 'none'})`);
