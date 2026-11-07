/**
 * Test harness: loads the BUILT bundle static/js/content.js into a fresh VM
 * context with a fake engine (road linked list from the committed road graph,
 * ego, scene config, minimal THREE + canvas stubs) and a fake bridge. The
 * localStorage object can be shared between instances to simulate a reload.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..', '..');
const BUNDLE = fs.readFileSync(path.join(repo, 'static/js/content.js'), 'utf8');
const GRAPH = JSON.parse(fs.readFileSync(path.join(repo, 'maps/synth-town-01/2026.11/road-graph.json'), 'utf8'));
const PACK = JSON.parse(fs.readFileSync(path.join(repo, 'packages/vehicle-content/packs/es-CO-starter.v1.json'), 'utf8'));
const TASKS = JSON.parse(fs.readFileSync(path.join(repo, 'packages/vehicle-content/packs/es-CO-starter.tasks.json'), 'utf8')).tasks;

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get length() { return m.size; },
    _map: m,
  };
}

function buildRoad(perturb) {
  let prev = null;
  let head = null;
  const byI = new Map();
  for (const n of GRAPH.nodes) {
    const node = {
      i: n.i,
      p: { x: n.x + (perturb && perturb(n.i) ? 3 : 0), y: 0, z: n.y },
      n: { x: n.normal[0], z: n.normal[1] },
      a: n.heading,
      w: n.half_width,
      next: null,
      prev,
    };
    if (prev) prev.next = node;
    else head = node;
    prev = node;
    byI.set(n.i, node);
  }
  return { head, tail: prev, byI };
}

class V3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Obj {
  constructor() { this.position = new V3(); this.rotation = new V3(); this.children = []; this.parent = null; }
  add(c) { c.parent = this; this.children.push(c); }
  remove(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
}
class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
class Disposable { dispose() {} }
const THREE = {
  Group: Obj,
  Mesh,
  Vector3: V3,
  PlaneGeometry: class extends Disposable {},
  MeshBasicMaterial: class extends Disposable { constructor(o) { super(); Object.assign(this, o); } },
  CanvasTexture: class extends Disposable { constructor(c) { super(); this.image = c; } },
};

const ctx2d = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 10 }) : () => {}),
  set: () => true,
});

/**
 * Create a sim instance. opts: { storage, scene, perturb(i)->bool, emitLog }
 * Returns { VC, emitted, road, ego, setVehicle(i, t), tick(), handles }.
 */
function createSim(opts) {
  const o = opts || {};
  const storage = o.storage || makeStorage();
  const road = buildRoad(o.perturb);
  const emitted = [];
  const listeners = {};
  const ego = { position: { x: 0, y: 0, z: 0 }, speed: 0, heading: 0 };
  const rs = { head: road.head, tail: road.tail, vehicleNode: null };
  const container = new Obj();
  const handles = {
    roadState: rs,
    ego,
    sceneConfig: { value: Object.assign({ seed: 'b4e6eba7', sceneName: 'Hills', topography: 'normal' }, o.scene || {}), initialNode: 0 },
    autodrive: { value: false },
    world: { container, getHeight: () => 0 },
    THREE,
  };
  const bridge = {
    attached: true,
    handles,
    whenAttached: (fn) => fn(handles),
    emit: (ev, p) => {
      emitted.push({ ev, p });
      for (const fn of listeners[ev] || []) fn(p);
    },
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    pause: () => { emitted.push({ ev: 'paused' }); },
  };
  let clock = 0;
  const sandbox = {
    console,
    JSON, Math, Date, Map, Set, Promise, Array, Object, String, Number, RegExp, Error, Uint8Array, Uint32Array, Float64Array, TextEncoder,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    performance: { now: () => (clock += 1) },
    localStorage: storage,
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }), getElementById: () => null, body: { appendChild() {} } },
    fetch: async (url) => {
      const p = path.join(repo, String(url).replace(/^\.\//, '').split('?')[0]);
      if (!fs.existsSync(p)) return { ok: false, json: async () => null };
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.PromptDriveBridge = bridge;
  vm.createContext(sandbox);
  vm.runInContext(BUNDLE, sandbox);
  const VC = sandbox.VehicleContent;

  const setVehicle = (i, t) => {
    const n = road.byI.get(i);
    rs.vehicleNode = n;
    const nx = n.next || n;
    const f = t || 0;
    ego.position.x = n.p.x + (nx.p.x - n.p.x) * f;
    ego.position.z = n.p.z + (nx.p.z - n.p.z) * f;
  };
  setVehicle(5, 0);
  const tick = () => {
    clock += 1000; // past the recorder (250 ms) and sign (400 ms) throttles
    VC.service.tick(clock);
    VC.signs.update(clock);
  };
  tick();
  return { VC, emitted, road, ego, handles, setVehicle, tick, storage, container, sandbox };
}

function session(extra) {
  return Object.assign({
    session_id: 'S-' + Math.random().toString(36).slice(2, 8),
    study_id: 'study-test',
    condition: 'agent',
    participant_pseudonym: 'P017',
    actor: 'agent',
    model: 'scripted',
    pack_id: PACK.pack_id,
    pack_version: PACK.pack_version,
    content_hash: PACK.content_hash,
    map_id: 'synth-town-01',
    map_version: '2026.11',
    tools_version: 'vehicle-tools/1.0',
  }, extra || {});
}

/** Copy a value out of the VM realm (so deepStrictEqual compares plain host objects). */
function host(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

/** Strip non-deterministic fields (clock, sequence, latency, ids). */
function stable(rec) {
  const c = host(rec);
  delete c.t; delete c.seq; delete c.latency_ms; delete c.session_id;
  return c;
}

module.exports = { createSim, session, makeStorage, stable, host, PACK, TASKS, GRAPH };
