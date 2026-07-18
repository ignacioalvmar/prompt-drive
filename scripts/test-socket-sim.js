/**
 * Headless "sim side" for the WebSocket transport test (WP2). Shims a minimal
 * browser window/document, loads the REAL built static/js/vehicle.js +
 * static/js/api.js (so socket.js connects to the given ws url exactly as in a
 * browser), and attaches mock engine handles so the telemetry tick flows.
 *
 * Usage: node scripts/test-socket-sim.js <wsUrl> [token]
 * Kept alive until the parent process terminates it.
 */
const fs = require('fs');
const path = require('path');

const wsUrl = process.argv[2];
const token = process.argv[3] || '';
if (!wsUrl) { console.error('usage: node test-socket-sim.js <wsUrl> [token]'); process.exit(2); }

const store = {};
global.window = {
  location: {
    search: `?ws=${encodeURIComponent(wsUrl)}&wsToken=${encodeURIComponent(token)}`,
    href: 'http://localhost/', origin: 'http://localhost',
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
global.window.parent = global.window; // make the postMessage transport inert
global.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  body: { appendChild() {}, style: {} }, documentElement: { style: {} },
  activeElement: null, referrer: '',
};
// WebSocket, URLSearchParams, performance, setInterval are Node 24 globals.

const dir = path.join(__dirname, '..', 'static/js');
(0, eval)(fs.readFileSync(path.join(dir, 'vehicle.js'), 'utf8'));  // -> window.VehicleState
(0, eval)(fs.readFileSync(path.join(dir, 'api.js'), 'utf8'));      // -> window.PromptDrive (+ socket.js connects)

// Start the real telemetry tick by attaching mock engine handles.
window.PromptDriveBridge.attach({
  ego: { speed: 12.5, steer: 0, heading: 0, position: { x: 1, y: 0, z: 2 }, onRoad: true, wrongWay: false, headlights: false },
  autodrive: { value: false },
  vehicleConfig: { value: { mode: 0 } },
  units: { Units: 1 },
});

process.stdout.write('SIM_READY\n');
setInterval(() => {}, 1000); // keep the process alive
