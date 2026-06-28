/**
 * Remove Slow Roads / slowroads.io branding from project files.
 * Run: node scripts/rebrand.js && npm run build:main
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const files = [
  'index.html',
  'src-extracted/deobfuscated.js',
  'static/js/main.ca6b3355.chunk.js',
  'static/js/2.feea8a5f.chunk.js',
  'static/js/main.ca6b3355.chunk.original.js',
];

const replacements = [
  ['webpackJsonpslowroads.io', 'webpackJsonppromptdrive'],
  ['"slowroads.io"', '"promptdrive.local"'],
  ['https://slowroads.io/', '#'],
  ['Anslo (slowroads.io)', 'Prompt Drive'],
  ['Slow Roads 2 release', 'Prompt Drive release'],
  [
    'Check back later in Spring 2024 for Slow Roads 2!',
    'Mobile support is planned for a future release.',
  ],
  ['Slow Roads 2 is in development!', 'More features coming soon!'],
  ['https://ko-fi.com/slowroads', '#'],
  ['https://anslo.medium.com/slow-roads-tl-dr-a664ac6bce40', '#'],
  ['Slow roads? More like Fast Roads!', 'Why the scenic route?'],
  [
    'The idea of a "slow road" is about taking the longer scenic route instead of the highway, not about how fast you drive.',
    'The focus is on taking the longer scenic route instead of the highway, not on how fast you drive.',
  ],
  ['and you have Slow Roads.', 'and you have Prompt Drive.'],
  ['Slow Roads exists primarily', 'Prompt Drive exists primarily'],
  ['children: "Slow Roads"', 'children: "Prompt Drive"'],
  ['children: "slow roads"', 'children: "Prompt Drive"'],
  ['Slow Roads', 'Prompt Drive'],
  ['slow roads', 'Prompt Drive'],
];

function rebrandFile(relPath) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn('Skip missing:', relPath);
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  const before = content;
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  if (content !== before) {
    fs.writeFileSync(fullPath, content);
    console.log('Updated:', relPath);
  } else {
    console.log('No changes:', relPath);
  }
}

for (const file of files) {
  rebrandFile(file);
}

console.log('Done. Run npm run build:main to regenerate the patched main bundle.');
