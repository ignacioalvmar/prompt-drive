/**
 * Bundles src/gaze into a browser-global gaze-tracking subsystem plus a
 * companion inference worker:
 *   static/js/gaze.js        — main-thread facade (window.GazeTracking)
 *   static/js/gaze-worker.js — MediaPipe inference worker (config + math +
 *                              worker.js). Instantiated as a CLASSIC worker:
 *                              MediaPipe's FilesetResolver needs
 *                              importScripts() (module workers forbid it) and
 *                              dynamic import() of the vendored
 *                              vision_bundle.mjs works in classic workers.
 * Mirrors build-metrics.js: strip ES module syntax, concatenate the source
 * files in dependency order inside one IIFE.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src/gaze');

// Dependency order: a file may reference only symbols defined above it.
const files = [
  'config.js',
  'filters.js',
  'gaze-math.js',
  'calibration.js',
  'FaceEngine.js',
  'aoi.js',
  'GazeAnalyzer.js',
  'CalibrationModal.js',
  'GazeTracking.js',
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

const bundle = `/* Gaze-tracking attention metrics — built from src/gaze/ */
(function () {
${parts.join('\n\n')}

  if (typeof window !== 'undefined') {
    try {
      window.GazeTracking = new GazeTracking();
    } catch (e) {
      console.error('GazeTracking init failed', e);
    }
  }
})();
`;

const outPath = path.join(root, 'static/js/gaze.js');
fs.writeFileSync(outPath, bundle);
console.log('Wrote', outPath);

// --- inference worker bundle -------------------------------------------------
const workerFiles = ['config.js', 'gaze-math.js', 'worker.js'];
const workerParts = workerFiles.map((f) => {
  const p = path.join(dir, f);
  return `/* --- ${f} --- */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`;
});

// No window/document in a worker: config.js's load/save helpers reference
// localStorage only when called, and the worker never calls them — but wrap
// everything in an IIFE anyway to keep globals contained.
const workerBundle = `/* Gaze inference worker — built from src/gaze/ (config, gaze-math, worker) */
(function () {
${workerParts.join('\n\n')}
})();
`;

const workerOutPath = path.join(root, 'static/js/gaze-worker.js');
fs.writeFileSync(workerOutPath, workerBundle);
console.log('Wrote', workerOutPath);
