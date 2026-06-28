/**
 * De-minify the production main chunk with webcrack.
 * Run once after updating static/js/main.ca6b3355.chunk.original.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const input = path.join(root, 'static/js/main.ca6b3355.chunk.original.js');
const outDir = path.join(root, 'src-extracted');

if (!fs.existsSync(input)) {
  console.error('Missing original bundle. Restore static/js/main.ca6b3355.chunk.original.js first.');
  process.exit(1);
}

execSync(`npx --yes webcrack "${input}" -o "${outDir}"`, {
  stdio: 'inherit',
  cwd: root,
});

console.log('Extraction complete. Run npm run build to apply cluster patches.');
