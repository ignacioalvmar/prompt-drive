/**
 * Downloads the vendored MediaPipe Tasks Vision assets used by the gaze
 * subsystem into static/lib/mediapipe/. Pinned versions; files that already
 * exist are skipped so re-runs are cheap. Run via `npm run fetch:gaze`.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'static/lib/mediapipe');

const files = [
  { url: `${CDN}/vision_bundle.mjs`, dest: 'vision_bundle.mjs' },
  { url: `${CDN}/wasm/vision_wasm_internal.js`, dest: 'wasm/vision_wasm_internal.js' },
  { url: `${CDN}/wasm/vision_wasm_internal.wasm`, dest: 'wasm/vision_wasm_internal.wasm' },
  { url: `${CDN}/wasm/vision_wasm_nosimd_internal.js`, dest: 'wasm/vision_wasm_nosimd_internal.js' },
  { url: `${CDN}/wasm/vision_wasm_nosimd_internal.wasm`, dest: 'wasm/vision_wasm_nosimd_internal.wasm' },
  { url: MODEL, dest: 'face_landmarker.task' },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects > 5) return reject(new Error(`Too many redirects for ${url}`));
            res.resume();
            return follow(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          const tmp = `${dest}.download`;
          const out = fs.createWriteStream(tmp);
          res.pipe(out);
          out.on('finish', () => {
            out.close(() => {
              fs.renameSync(tmp, dest);
              resolve();
            });
          });
          out.on('error', reject);
        })
        .on('error', reject);
    };
    follow(url, 0);
  });
}

async function main() {
  fs.mkdirSync(path.join(outDir, 'wasm'), { recursive: true });
  for (const f of files) {
    const dest = path.join(outDir, f.dest);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log('exists ', f.dest, `(${fs.statSync(dest).size} bytes)`);
      continue;
    }
    process.stdout.write(`fetch   ${f.dest} ... `);
    await download(f.url, dest);
    console.log(`${fs.statSync(dest).size} bytes`);
  }
  console.log('MediaPipe assets ready in', outDir);
}

main().catch((err) => {
  console.error('fetch-gaze-deps failed:', err.message);
  process.exit(1);
});
