/* Traffic road actors — built from src/traffic/ */
(function () {
/* --- config.js --- */
/**
 * Traffic configuration store for AI traffic road actors.
 *
 * Holds the researcher's *intent* only — whether traffic is enabled, how many
 * vehicles to maintain, their constant cruise speed, and whether oncoming
 * lanes are populated. The traffic manager resolves this intent against the
 * live road (lane layout, build frontier) and owns all actor state.
 *
 * Static class: the store is read when the sim goes live; density/speed are
 * not re-applied to vehicles already on the road. The stopped-vehicle event
 * is the dynamic path (see RoadTraffic.spawnStopped).
 *
 * Selection persists in localStorage and is published on `window.RoadTraffic`,
 * which the engine hands live handles to and ticks every rendered frame.
 */

const TRAFFIC_STORAGE_KEY = 'pd-traffic-config';

const TRAFFIC_DEFAULTS = {
  enabled: false, // off by default — zero impact on existing studies
  density: 6, // total vehicles maintained around the ego
  speed: 15, // m/s, constant cruise speed for all traffic vehicles
  oncoming: true, // also populate oncoming lanes (when backward > 0)
  seed: null, // RNG seed; null = derive from the scene seed
};

const TRAFFIC_LIMITS = {
  density: { min: 0, max: 16 }, // perf cap: cloned OBJ meshes, no instancing
  speed: { min: 2, max: 45 },
};

// Plausible car body colors, picked per vehicle from the seeded RNG so a
// given scene seed always produces the same traffic appearance.
const TRAFFIC_COLORS = [
  0xc0c5c9, // silver
  0x2a2d30, // near black
  0xffffff, // white
  0x7a8288, // grey
  0x8b1e24, // dark red
  0x1f3a63, // dark blue
  0x2e5339, // dark green
  0xb8860b, // ochre
  0x5c3a21, // brown
  0x9e9646, // olive
  0x36454f, // charcoal blue
  0xd4653a, // orange
];

// Behaviour tuning, isolated here on purpose (plan §7). Distances in metres,
// speeds m/s, times seconds.
const TRAFFIC_TUNING = {
  corridorAhead: 1200, // recycle a vehicle drifting further ahead of the ego
  corridorBehind: 400, // … or further behind
  spawnAheadMin: 250, // ahead spawns: at least this far AND fog-hidden (see manager)
  spawnBehindMin: 150, // … behind the ego
  spawnGap: 40, // min in-lane gap to other traffic at the spawn point
  sensorRange: 60, // front-sensor scan distance along the lane
  timeHeadway: 1.5, // desired following gap = minGap + speed * timeHeadway
  minGap: 2.5, // standstill gap to the lead vehicle
  accelRate: 3, // m/s² toward target speed
  brakeRate: 7, // m/s² when the sensor demands slowing
  stoppedEventMinDist: 30, // spawnStopped distance clamp
  maxVehicles: 24, // hard cap incl. event spawns (density max + extras)
};

function trafficClampNum(v, lo, hi, fallback) {
  v = Number(v);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

/** Coerce an arbitrary partial config into a valid, normalised config. */
function trafficSanitise(cfg) {
  const out = {
    enabled: !!cfg.enabled,
    density: Math.round(
      trafficClampNum(cfg.density, TRAFFIC_LIMITS.density.min, TRAFFIC_LIMITS.density.max, TRAFFIC_DEFAULTS.density)
    ),
    speed: trafficClampNum(cfg.speed, TRAFFIC_LIMITS.speed.min, TRAFFIC_LIMITS.speed.max, TRAFFIC_DEFAULTS.speed),
    oncoming: cfg.oncoming == null ? TRAFFIC_DEFAULTS.oncoming : !!cfg.oncoming,
    seed: cfg.seed == null ? null : String(cfg.seed),
  };
  return out;
}

/** Tiny observable store: get / set (merge) / subscribe, with persistence. */
class TrafficStore {
  constructor() {
    this._listeners = new Set();
    this._cfg = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(TRAFFIC_STORAGE_KEY);
      if (raw) return trafficSanitise(Object.assign({}, TRAFFIC_DEFAULTS, JSON.parse(raw)));
    } catch (_e) {
      /* ignore corrupt storage */
    }
    return Object.assign({}, TRAFFIC_DEFAULTS);
  }

  _save() {
    try {
      localStorage.setItem(TRAFFIC_STORAGE_KEY, JSON.stringify(this._cfg));
    } catch (_e) {
      /* storage may be unavailable */
    }
  }

  /** Current configuration (a copy — callers must not mutate it). */
  get() {
    return Object.assign({}, this._cfg);
  }

  /** Merge a partial config, validate, persist, and notify subscribers. */
  set(partial) {
    const next = trafficSanitise(Object.assign({}, this._cfg, partial || {}));
    const changed = JSON.stringify(next) !== JSON.stringify(this._cfg);
    this._cfg = next;
    if (changed) {
      this._save();
      this._emit();
    }
    return this.get();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snap = this.get();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch (_e) {
        /* a bad listener must not break the others */
      }
    }
  }
}


/* --- TrafficVehicle.js --- */
/**
 * One traffic road actor: cloned engine vehicle meshes with a per-vehicle
 * body color, plus the pose/wheel-spin application. All road math lives in
 * TrafficManager; this class only owns the THREE objects.
 *
 * The engine hands us its minified THREE module; constructors are resolved
 * defensively (named export first, minified letter fallback) the same way the
 * instrument cluster does.
 */

function trafficResolveThree(THREE) {
  return {
    Group: THREE.Group || THREE.G,
    Vector3: THREE.Vector3 || THREE.W,
  };
}

/**
 * Loads and caches the engine's vehicle OBJ assets (one template per vehicle
 * definition), so each traffic vehicle is a cheap `.clone()`. Materials are
 * the engine's shared `_d` palette, except body/livery meshes which get a
 * per-vehicle colored clone of the body material.
 */
class TrafficAssets {
  constructor(handles) {
    this.h = handles;
    this.cache = {}; // def.name -> { body, wheel, waiters, failed }
  }

  /** cb(bodyTemplate, wheelTemplate) once both OBJs are parsed (async). */
  load(def, cb) {
    const entry = this.cache[def.name] || (this.cache[def.name] = { body: null, wheel: null, waiters: [], failed: false });
    if (entry.failed) return;
    if (entry.body && entry.wheel) {
      cb(entry.body, entry.wheel);
      return;
    }
    entry.waiters.push(cb);
    if (entry.loading) return;
    entry.loading = true;
    let Loader;
    try {
      Loader = this.h.objLoader.OBJLoader || this.h.objLoader.a;
    } catch (_e) {
      entry.failed = true;
      return;
    }
    const loader = new Loader();
    const done = () => {
      if (entry.body && entry.wheel) {
        const waiters = entry.waiters.splice(0);
        for (const w of waiters) {
          try {
            w(entry.body, entry.wheel);
          } catch (_e) {
            /* one bad waiter must not break the rest */
          }
        }
      }
    };
    const fail = () => {
      entry.failed = true;
      entry.waiters.length = 0;
    };
    try {
      loader.load(
        def.bodyObj.default,
        (obj) => {
          this._prepTemplate(obj);
          obj.rotation.y = -Math.PI / 2; // OBJ is modeled along +x; engine convention
          entry.body = obj;
          done();
        },
        undefined,
        fail
      );
      const wheelLoader = new Loader();
      wheelLoader.load(
        def.wheelObj.default,
        (obj) => {
          this._prepTemplate(obj, true);
          entry.wheel = obj;
          done();
        },
        undefined,
        fail
      );
    } catch (_e) {
      fail();
    }
  }

  /**
   * Assign the engine's shared materials by mesh-name suffix (mirrors the
   * engine's initVehicle traversal). Body and livery-map meshes are tagged so
   * each cloned vehicle can swap in its own colored material.
   */
  _prepTemplate(obj, isWheel) {
    const mats = this.h.materials;
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const kind = m.name.split('_')[1];
      if (!isWheel && (kind === 'body' || kind === 'map')) {
        m.material = mats.body;
        m.userData.pdTrafficBody = true;
      } else if (kind in mats) {
        m.material = mats[kind];
      } else {
        m.material = isWheel ? mats.wheel : mats.default;
      }
      m.frustumCulled = false; // parents move every frame; skip per-mesh culling
    });
  }
}

class TrafficVehicle {
  /**
   * opts: { id, def, lane (signed int, +fwd/-oncoming), node, t, speed,
   *         targetSpeed, color, mode ('driving'|'stopped'|'crashed'), event }
   */
  constructor(opts, handles) {
    this.h = handles;
    this.T = trafficResolveThree(handles.THREE);
    this.id = opts.id;
    this.def = opts.def;
    this.lane = opts.lane;
    this.dir = opts.lane > 0 ? 1 : -1;
    this.node = opts.node;
    this.t = opts.t || 0;
    this.speed = opts.speed || 0;
    this.cruiseSpeed = opts.targetSpeed != null ? opts.targetSpeed : opts.speed || 0;
    this.targetSpeed = this.cruiseSpeed;
    this.mode = opts.mode || 'driving';
    this.event = !!opts.event; // event spawns don't count toward density
    this.color = opts.color;
    // Collision box (road-aligned): origin is the rear axle, so the box
    // centre sits half a wheelbase ahead. Overhangs approximated from the
    // wheelbase — good enough for gap/contact tests (plan §7).
    this.length = opts.def.wheels.length + 1.5;
    this.width = opts.def.wheels.width + 0.35;
    this.centerOffset = opts.def.wheels.length / 2;
    this.wheelRadius = opts.def.wheels.radius;
    this.wheelRoll = 0;
    this.wheelMeshes = [];
    this.group = null;
    this.ready = false; // meshes still loading; skip pose/render until true
    this.arcFloat = 0; // node.i + t, maintained by the manager
    this.lat = 0; // signed lateral offset actually applied (for collisions)
    this.pushLat = 0; // decaying lateral shove from collisions
    this.pushArc = 0; // decaying longitudinal shove from collisions
  }

  /** Build the THREE objects from cached templates and add them to `parent`. */
  build(assets, parent) {
    assets.load(this.def, (bodyTpl, wheelTpl) => {
      if (this.disposed) return;
      const g = new this.T.Group();
      g.rotation.order = 'YXZ';
      const body = bodyTpl.clone(true);
      // Per-vehicle body color: one cloned material shared by this clone's
      // tagged meshes.
      let bodyMat = null;
      body.traverse((m) => {
        if (m.isMesh && m.userData.pdTrafficBody) {
          if (!bodyMat) {
            bodyMat = m.material.clone();
            bodyMat.color.setHex(this.color);
          }
          m.material = bodyMat;
        }
      });
      this.bodyMaterial = bodyMat;
      g.add(body);
      const w = this.def.wheels;
      const wheelSlots = [
        { x: w.width / 2, z: w.length, y: Math.PI / 2 }, // fl
        { x: -w.width / 2, z: w.length, y: -Math.PI / 2 }, // fr
        { x: w.width / 2, z: 0, y: Math.PI / 2 }, // rl
        { x: -w.width / 2, z: 0, y: -Math.PI / 2 }, // rr
      ];
      for (const slot of wheelSlots) {
        const wm = wheelTpl.clone(true);
        wm.traverse((c) => {
          if (c.isMesh) c.position.z -= w.tyreWidth;
        });
        wm.rotation.order = 'YXZ';
        wm.rotation.y = slot.y;
        wm.position.set(slot.x, w.radius, slot.z);
        wm.userData.side = slot.y > 0 ? 1 : -1;
        this.wheelMeshes.push(wm);
        g.add(wm);
      }
      g.frustumCulled = false;
      this.group = g;
      parent.add(g);
      this.ready = true;
    });
  }

  /** Apply a world pose. yaw follows the engine convention (0 = +z). */
  setPose(x, y, z, yaw, pitch) {
    if (!this.ready) return;
    this.group.position.set(x, y, z);
    this.group.rotation.set(pitch || 0, yaw, 0);
  }

  /** Spin the wheels for the distance travelled this frame. */
  spinWheels(ds) {
    if (!this.ready || !ds) return;
    this.wheelRoll += ds / this.wheelRadius;
    for (const wm of this.wheelMeshes) {
      wm.rotation.x = this.wheelRoll * wm.userData.side;
    }
  }

  dispose(parent) {
    this.disposed = true;
    if (this.group) {
      parent.remove(this.group);
      if (this.bodyMaterial) {
        try {
          this.bodyMaterial.dispose();
        } catch (_e) {
          /* renderer may already hold no reference */
        }
      }
      this.group = null;
    }
    this.ready = false;
  }
}


/* --- TrafficManager.js --- */
/**
 * Traffic manager: owns every traffic road actor and all road-relative math.
 *
 * The engine hands it live handles once (`attach`) and ticks it every rendered
 * frame (`update`). It is defensive throughout: any repeated per-frame error
 * disables traffic for the session rather than breaking the game loop.
 *
 * Road model recap (see traffic-vehicles-plan.md §2): the road midline is a
 * linked list of nodes (`roadState.head/…/vehicleNode`), each with world
 * position `p`, unit lateral normal `n` ({x,z}, +n = signed-lateral +1),
 * half-width `w` and per-node lane stamps (`laneTotal`, `laneWidth`,
 * `laneDivRatio`). A vehicle's road position is (node, t) with t in [0,1)
 * toward `node.next`; `arcFloat = node.i + t`. Longitudinal gaps are node
 * differences scaled by the measured local node pitch — precise enough for
 * car-following at the ~8 m node spacing.
 */

class TrafficManager {
  constructor(store) {
    this.store = store;
    this.h = null; // engine handles, set by attach()
    this.assets = null;
    this.vehicles = [];
    this.nextId = 1;
    this.rng = null;
    this.disabled = false; // latched on repeated per-frame errors
    this.errorCount = 0;
    this.spawnCooldown = 0;
    this.registry = new Map(); // floor(arcFloat) -> [vehicle]
    this.ego = {
      arcFloat: 0,
      lat: 0,
      speedAlong: 0, // signed speed along the road direction
      facing: 1, // +1 when the ego points down the road, -1 reversed
      lanes: [],
      length: 4.2,
      width: 1.7,
      centerOffset: 1.4, // box centre ahead of the rear-axle origin
      node: null,
    };
    this._scratch = null; // lazily created Vector3 for view/height checks
  }

  attach(h) {
    this.h = h;
    this.assets = new TrafficAssets(h);
    const cfg = this.store.get();
    const seed = (cfg.seed != null ? cfg.seed : h.sceneSeed || '') + ':traffic';
    try {
      this.rng = typeof window !== 'undefined' && window.alea ? new window.alea(seed) : Math.random;
    } catch (_e) {
      this.rng = Math.random;
    }
    const V = trafficResolveThree(h.THREE).Vector3;
    this._scratch = V ? new V() : null;
    if (h.ego && h.ego.wheels) {
      this.ego.length = h.ego.wheels.length + 1.5;
      this.ego.width = h.ego.wheels.width + 0.35;
      this.ego.centerOffset = h.ego.wheels.length / 2;
    }
  }

  // ---------------------------------------------------------------- helpers

  _rand() {
    return this.rng ? this.rng() : Math.random();
  }

  _edgeLen(node) {
    const nx = node.next;
    if (!nx) return 8;
    const dx = nx.p.x - node.p.x;
    const dz = nx.p.z - node.p.z;
    return Math.sqrt(dx * dx + dz * dz) || 8;
  }

  /** Signed lateral centre of lane k at `node` (k per plan §3 convention). */
  _laneCenter(node, lane) {
    const hw = node.w || 3;
    const total = node.laneTotal || 2;
    const laneW = node.laneWidth || (2 * hw) / total;
    const divOffset = (node.laneDivRatio != null ? node.laneDivRatio : 0) * hw;
    if (lane > 0) return divOffset + (lane - 0.5) * laneW;
    return divOffset - (Math.abs(lane) - 0.5) * laneW;
  }

  _laneWidth(node) {
    const hw = node.w || 3;
    const total = node.laneTotal || 2;
    return node.laneWidth || (2 * hw) / total;
  }

  _laneCount(node, forward) {
    const total = node.laneTotal || 2;
    const divRatio = node.laneDivRatio != null ? node.laneDivRatio : 0;
    // total = fwd + bwd, divRatio = (bwd - fwd) / total
    const bwd = Math.round((total * (1 + divRatio)) / 2);
    return forward ? total - bwd : bwd;
  }

  /** Interpolated world position + tangent at (node, t) with lateral offset. */
  _roadPoint(node, t, lat, out) {
    const nx = node.next;
    // Use the engine's fine Bézier sub-samples when present (near the ego),
    // else linear interpolation between node centres (far away).
    let px;
    let pz;
    let nxx;
    let nxz;
    if (node.ps && node.ps.length > 1 && node.ns && node.ns.length === node.ps.length) {
      const f = t * (node.ps.length - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(node.ps.length - 1, i0 + 1);
      const ft = f - i0;
      px = node.ps[i0].x + (node.ps[i1].x - node.ps[i0].x) * ft;
      pz = node.ps[i0].z + (node.ps[i1].z - node.ps[i0].z) * ft;
      nxx = node.ns[i0].x + (node.ns[i1].x - node.ns[i0].x) * ft;
      nxz = node.ns[i0].z + (node.ns[i1].z - node.ns[i0].z) * ft;
    } else if (nx) {
      px = node.p.x + (nx.p.x - node.p.x) * t;
      pz = node.p.z + (nx.p.z - node.p.z) * t;
      nxx = node.n.x + (nx.n.x - node.n.x) * t;
      nxz = node.n.z + (nx.n.z - node.n.z) * t;
    } else {
      px = node.p.x;
      pz = node.p.z;
      nxx = node.n.x;
      nxz = node.n.z;
    }
    const nl = Math.sqrt(nxx * nxx + nxz * nxz) || 1;
    nxx /= nl;
    nxz /= nl;
    out.x = px + nxx * lat;
    out.z = pz + nxz * lat;
    // Tangent is the normal rotated -90°: n = (-tz, tx) => t = (nz, -nx).
    out.tx = nxz;
    out.tz = -nxx;
    return out;
  }

  /** Walk `dist` metres along the midline from (node, t). forward = toward next. */
  _walk(node, t, dist, forward) {
    let n = node;
    let len = this._edgeLen(n);
    let remaining = dist + (forward ? t * len : (1 - t) * len);
    if (forward) {
      while (n.next && remaining >= len) {
        remaining -= len;
        n = n.next;
        len = this._edgeLen(n);
      }
      return { node: n, t: Math.min(0.999, remaining / len), ok: !!n.next };
    }
    while (n.prev && remaining >= len) {
      remaining -= len;
      n = n.prev;
      len = this._edgeLen(n);
    }
    return { node: n, t: Math.max(0, 1 - remaining / len), ok: !!n.prev };
  }

  /** True when `p` ({x,y,z}) is inside the active camera's view frustum. */
  _inView(p) {
    const cam = this.h.camera;
    const v = this._scratch;
    if (!cam || !v || !cam.matrixWorldInverse || !cam.projectionMatrix) return false;
    try {
      v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > 0) return false; // behind the camera (it looks down -z)
      v.applyMatrix4(cam.projectionMatrix);
      return Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    } catch (_e) {
      return false;
    }
  }

  // ------------------------------------------------------------- lifecycle

  update(dt) {
    if (this.disabled || !this.h) return;
    try {
      this._update(Math.min(dt, 0.1));
      this.errorCount = 0;
    } catch (err) {
      this.errorCount++;
      if (this.errorCount > 10) {
        this.disabled = true;
        try {
          console.error('RoadTraffic disabled after repeated errors', err);
        } catch (_e) {
          /* console unavailable */
        }
      }
    }
  }

  _update(dt) {
    const h = this.h;
    if (!h.roadState.vehicleNode || !h.ego.wheels) return;
    const cfg = this.store.get();
    this._projectEgo();
    // Maintain population (throttled to one spawn attempt per 1/4 s).
    this.spawnCooldown -= dt;
    if (cfg.enabled && this.spawnCooldown <= 0) {
      const active = this.vehicles.filter((v) => !v.event).length;
      if (active < cfg.density && this.vehicles.length < TRAFFIC_TUNING.maxVehicles) {
        this._trySpawn(cfg);
      }
      this.spawnCooldown = 0.25;
    }
    // Registry for sensors/collisions, then per-vehicle tick.
    this._buildRegistry();
    for (const v of this.vehicles) {
      this._sense(v);
      this._integrate(v, dt);
    }
    this._collide();
    this._recycle();
  }

  _projectEgo() {
    const h = this.h;
    const ego = h.ego;
    const proj = h.project(ego.position.x, ego.position.z, h.roadState.vehicleNode, false);
    if (!proj || !proj.n) return;
    this.ego.lat = proj.d * proj.s;
    this.ego.arcFloat = proj.n.i + (proj.t || 0);
    this.ego.node = proj.n;
    // Ego facing/speed along the road direction (negative = against it).
    const p = this._roadPoint(proj.n, proj.t || 0, 0, TrafficManager._pt);
    const along = Math.sin(ego.heading) * p.tx + Math.cos(ego.heading) * p.tz;
    this.ego.facing = along >= 0 ? 1 : -1;
    this.ego.speedAlong = ego.speed * this.ego.facing;
    // Which lanes does the ego body overlap?
    this.ego.lanes.length = 0;
    const node = proj.n;
    const laneHalf = this._laneWidth(node) / 2;
    const fwd = this._laneCount(node, true);
    const bwd = this._laneCount(node, false);
    for (let k = 1; k <= fwd; k++) {
      if (Math.abs(this.ego.lat - this._laneCenter(node, k)) < laneHalf + this.ego.width / 2) {
        this.ego.lanes.push(k);
      }
    }
    for (let k = 1; k <= bwd; k++) {
      if (Math.abs(this.ego.lat - this._laneCenter(node, -k)) < laneHalf + this.ego.width / 2) {
        this.ego.lanes.push(-k);
      }
    }
  }

  _buildRegistry() {
    this.registry.clear();
    for (const v of this.vehicles) {
      v.arcFloat = v.node.i + v.t;
      const key = Math.floor(v.arcFloat);
      let list = this.registry.get(key);
      if (!list) {
        list = [];
        this.registry.set(key, list);
      }
      list.push(v);
    }
  }

  // ---------------------------------------------------------------- spawn

  /**
   * Distance ahead at which a spawn cannot pop in: past the fog's near
   * distance a car is a fully fogged-out dot. Kept inside the recycle
   * corridor so a fresh spawn isn't immediately recycled.
   */
  _hiddenAheadDist() {
    let d = TRAFFIC_TUNING.spawnAheadMin * 2;
    try {
      const fog = this.h.sceneFog && this.h.sceneFog();
      if (fog && isFinite(fog.near)) d = Math.max(TRAFFIC_TUNING.spawnAheadMin, fog.near * 1.05);
    } catch (_e) {
      /* keep fallback */
    }
    return Math.min(d, TRAFFIC_TUNING.corridorAhead - 250);
  }

  _trySpawn(cfg) {
    const h = this.h;
    const node = this.ego.node || h.roadState.vehicleNode;
    const geom = h.laneGeometry();
    const fwdLanes = Math.max(1, geom.forward);
    const bwdLanes = geom.backward;
    const wantOncoming = cfg.oncoming && bwdLanes > 0 && this._rand() < 0.35;
    const lane = wantOncoming
      ? -(1 + Math.floor(this._rand() * bwdLanes))
      : 1 + Math.floor(this._rand() * fwdLanes);
    // Out-of-view rule (R5): behind spawns must be off-camera; ahead spawns
    // sit beyond the fog's hiding distance (a forward-looking camera means a
    // frustum test alone can never pass on a straight). Oncoming vehicles
    // always spawn ahead — they drive toward the ego.
    let ahead = wantOncoming || this._rand() < 0.5;
    let at = null;
    let dist = 0;
    if (!ahead) {
      dist = TRAFFIC_TUNING.spawnBehindMin + this._rand() * 150;
      at = this._walk(node, 0.5, dist, false);
      if (!at.ok) {
        ahead = true; // no road behind yet (drive start) — spawn ahead instead
        at = null;
      }
    }
    if (ahead) {
      dist = this._hiddenAheadDist() + this._rand() * 200;
      at = this._walk(node, 0.5, dist, true);
      if (!at.ok) return; // road not built that far yet
    }
    // The lane must exist at the target position (layout can differ there).
    if (Math.abs(lane) > this._laneCount(at.node, lane > 0)) return;
    const lat = this._laneCenter(at.node, lane);
    const p = this._roadPoint(at.node, at.t, lat, TrafficManager._pt);
    const y = this._groundY(p.x, at.node.p.y, p.z);
    if (!ahead && this._inView({ x: p.x, y: y + 1, z: p.z })) return;
    if (!this._laneClear(at.node.i + at.t, lane, TRAFFIC_TUNING.spawnGap, at.node)) return;
    this._spawn({
      lane,
      node: at.node,
      t: at.t,
      speed: cfg.speed,
      targetSpeed: cfg.speed,
      mode: 'driving',
    });
  }

  _laneClear(arcFloat, lane, gapMetres, node) {
    const gapNodes = gapMetres / this._edgeLen(node);
    for (const v of this.vehicles) {
      if (v.lane === lane && Math.abs(v.arcFloat - arcFloat) < gapNodes) return false;
    }
    if (this.ego.lanes.indexOf(lane) >= 0 && Math.abs(this.ego.arcFloat - arcFloat) < gapNodes) return false;
    return true;
  }

  _spawn(opts) {
    const defs = this.h.vehicleDefs;
    // Mostly cars, the occasional coach for variety.
    const def = this._rand() < 0.85 || !defs.Coach ? defs.Roadster : defs.Coach;
    const color = TRAFFIC_COLORS[Math.floor(this._rand() * TRAFFIC_COLORS.length)];
    const v = new TrafficVehicle(
      {
        id: this.nextId++,
        def,
        lane: opts.lane,
        node: opts.node,
        t: opts.t,
        speed: opts.speed,
        targetSpeed: opts.targetSpeed,
        color,
        mode: opts.mode,
        event: !!opts.event,
      },
      this.h
    );
    v._egoContact = false;
    v.arcFloat = opts.node.i + opts.t;
    v.build(this.assets, this.h.world.container);
    this.vehicles.push(v);
    this._emit('trafficSpawned', {
      id: v.id,
      lane: v.lane,
      mode: v.mode,
      color: '#' + color.toString(16).padStart(6, '0'),
      vehicle: def.name,
    });
    return v;
  }

  /** Stopped-vehicle event (plan §8): stationary actor `distance` m ahead. */
  spawnStopped(opts) {
    if (this.disabled) return { ok: false, error: 'engine_rejected', message: 'traffic disabled after errors' };
    if (!this.h || !this.h.roadState.vehicleNode) {
      return { ok: false, error: 'engine_rejected', message: 'simulation not live' };
    }
    const o = opts || {};
    const distance = Math.max(
      TRAFFIC_TUNING.stoppedEventMinDist,
      Math.min(600, Number(o.distance) || 100)
    );
    const lane = Math.round(Number(o.lane) || 1);
    if (this.vehicles.length >= TRAFFIC_TUNING.maxVehicles) {
      return { ok: false, error: 'bad_value', message: 'too many traffic vehicles' };
    }
    const from = this.ego.node || this.h.roadState.vehicleNode;
    const at = this._walk(from, this.ego.arcFloat % 1 || 0, distance, true);
    if (!at.ok) return { ok: false, error: 'bad_value', message: 'road not built that far ahead' };
    if (lane === 0 || Math.abs(lane) > this._laneCount(at.node, lane > 0)) {
      return { ok: false, error: 'bad_value', message: 'no such lane at target position' };
    }
    const v = this._spawn({ lane, node: at.node, t: at.t, speed: 0, targetSpeed: 0, mode: 'stopped', event: true });
    this._emit('trafficStopped', { id: v.id, distance, lane });
    return { ok: true, value: { id: v.id, distance, lane, nodeIndex: at.node.i } };
  }

  // --------------------------------------------------------------- sensing

  /**
   * Front sensor (R6): nearest same-lane occupant ahead within sensorRange,
   * then a time-headway follower — matches the lead's speed as the gap closes
   * and brakes to a full stop behind stationary obstacles. Resumes on its own
   * when the lane clears (the target returns to cruise).
   */
  _sense(v) {
    if (v.mode === 'stopped' || v.mode === 'crashed') {
      v.targetSpeed = 0;
      return;
    }
    const pitch = this._edgeLen(v.node);
    const rangeNodes = TRAFFIC_TUNING.sensorRange / pitch;
    let gapNodes = Infinity;
    let leadSpeed = 0;
    const from = Math.floor(v.arcFloat);
    const steps = Math.ceil(rangeNodes) + 1;
    for (let k = 0; k <= steps; k++) {
      const bucket = this.registry.get(from + k * v.dir);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other === v || other.lane !== v.lane) continue;
        const d = (other.arcFloat - v.arcFloat) * v.dir;
        if (d > 0 && d < gapNodes) {
          gapNodes = d;
          leadSpeed = other.mode === 'driving' ? other.speed : 0;
        }
      }
    }
    // The ego is an obstacle too when it overlaps this vehicle's lane.
    if (this.ego.node && this.ego.lanes.indexOf(v.lane) >= 0) {
      const d = (this.ego.arcFloat - v.arcFloat) * v.dir;
      if (d > 0 && d < gapNodes) {
        gapNodes = d;
        leadSpeed = this.ego.speedAlong * v.dir; // negative when closing head-on
      }
    }
    const gap = gapNodes * pitch - v.length; // bumper-to-bumper approximation
    if (!isFinite(gap) || gap * 1 > TRAFFIC_TUNING.sensorRange) {
      v.targetSpeed = v.cruiseSpeed;
      return;
    }
    const desired = TRAFFIC_TUNING.minGap + v.speed * TRAFFIC_TUNING.timeHeadway;
    if (gap < TRAFFIC_TUNING.minGap) {
      v.targetSpeed = 0; // emergency: full stop in lane
    } else if (gap < desired) {
      const approach = Math.max(0, leadSpeed) + (gap - desired) * 0.5;
      v.targetSpeed = Math.max(0, Math.min(v.cruiseSpeed, approach));
    } else {
      v.targetSpeed = v.cruiseSpeed;
    }
  }

  // ------------------------------------------------------------ integration

  _integrate(v, dt) {
    // First-order speed control with asymmetric rate caps.
    const rate = v.targetSpeed > v.speed ? TRAFFIC_TUNING.accelRate : TRAFFIC_TUNING.brakeRate;
    const dv = v.targetSpeed - v.speed;
    v.speed += Math.max(-rate * dt, Math.min(rate * dt, dv));
    if (v.speed < 0.02 && v.targetSpeed === 0) v.speed = 0;
    // Decaying collision shove (longitudinal metres/s, lateral metres).
    const ds = v.speed * dt + v.pushArc * dt;
    v.pushArc *= Math.max(0, 1 - 3 * dt);
    v.pushLat *= Math.max(0, 1 - 3 * dt);
    if (ds !== 0) {
      const step = this._walk(v.node, v.t, Math.abs(ds), v.dir > 0 ? ds > 0 : ds < 0);
      v.node = step.node;
      v.t = step.t;
      v.arcFloat = v.node.i + v.t;
    }
    this._pose(v, ds);
  }

  _pose(v, ds) {
    if (!v.ready) return;
    let lat = this._laneCenter(v.node, v.lane) + v.pushLat;
    // Never through a barrier: clamp inside the walls when they exist.
    const margin = v.width / 2 + 0.2;
    if (v.node.rWallDist != null && lat > v.node.rWallDist - margin) lat = v.node.rWallDist - margin;
    if (v.node.lWallDist != null && lat < -(v.node.lWallDist - margin)) lat = -(v.node.lWallDist - margin);
    v.lat = lat;
    const p = this._roadPoint(v.node, v.t, lat, TrafficManager._pt);
    const y = this._groundY(p.x, v.node.p.y, p.z);
    // Pitch from the slope toward the next node in the travel direction.
    const aheadNode = v.dir > 0 ? v.node.next : v.node.prev;
    let pitch = 0;
    if (aheadNode) {
      pitch = -Math.atan2(aheadNode.p.y - v.node.p.y, this._edgeLen(v.dir > 0 ? v.node : aheadNode));
    }
    const yaw = Math.atan2(p.tx * v.dir, p.tz * v.dir);
    v.setPose(p.x, y, p.z, yaw, pitch);
    v.spinWheels(ds * (v.dir > 0 ? 1 : 1));
  }

  _groundY(x, fallback, z) {
    const v = this._scratch;
    try {
      if (v && this.h.world.getHeight) {
        v.set(x, fallback, z);
        const hgt = this.h.world.getHeight(v);
        if (isFinite(hgt)) return hgt;
      }
    } catch (_e) {
      /* fall through to midline height */
    }
    return fallback;
  }

  // ------------------------------------------------------------- collisions

  /**
   * Road-aligned box overlap (plan §7). All actors (incl. the ego) are boxes
   * centred `centerOffset` ahead of their rear-axle origin along their travel
   * direction; longitudinal separation is node distance × local pitch.
   */
  _collide() {
    for (const v of this.vehicles) {
      if (!v.ready) continue;
      const pitch = this._edgeLen(v.node);
      // vs ego
      if (this.ego.node) {
        const dLon =
          (this.ego.arcFloat - v.arcFloat) * pitch +
          this.ego.facing * this.ego.centerOffset -
          v.dir * v.centerOffset;
        const dLat = this.ego.lat - v.lat;
        if (
          Math.abs(dLon) < (v.length + this.ego.length) / 2 &&
          Math.abs(dLat) < (v.width + this.ego.width) / 2
        ) {
          this._resolveEgoHit(v, dLon, !v._egoContact);
          v._egoContact = true;
        } else {
          v._egoContact = false;
        }
      }
      // vs other NPCs (id ordering avoids double handling)
      for (let k = Math.floor(v.arcFloat) - 2; k <= Math.floor(v.arcFloat) + 2; k++) {
        const bucket = this.registry.get(k);
        if (!bucket) continue;
        for (const o of bucket) {
          if (o.id <= v.id || !o.ready) continue;
          const dLon = (o.arcFloat - v.arcFloat) * pitch + o.dir * o.centerOffset - v.dir * v.centerOffset;
          const dLat = o.lat - v.lat;
          if (Math.abs(dLon) < (v.length + o.length) / 2 && Math.abs(dLat) < (v.width + o.width) / 2) {
            this._resolvePairHit(v, o);
          }
        }
      }
    }
  }

  /**
   * Ego ↔ NPC contact. Runs EVERY frame of overlap: the ego's along-road
   * velocity is capped to the NPC's (with a slight bounce), so the ego stops
   * against a stopped car instead of tunnelling through it, and shoves it
   * forward if the driver keeps pushing. Event/audio/metrics fire once per
   * contact episode via the engine's own collision seam.
   */
  _resolveEgoHit(v, dLon, firstContact) {
    const h = this.h;
    const ctrl = h.controller;
    const rel = Math.abs(this.ego.speedAlong * v.dir - v.speed);
    const egoAheadOfV = dLon > 0; // ego box centre ahead of v's, in v's direction
    if (firstContact) {
      v.mode = 'crashed';
      v.targetSpeed = 0;
      v.pushLat += (v.lat >= this.ego.lat ? 1 : -1) * Math.min(1, rel * 0.1);
      try {
        if (ctrl && !ctrl.collisionsDisabled) {
          ctrl.didCollide = true;
          ctrl.collisionStrength = Math.max(ctrl.collisionStrength || 0, rel / 10);
          if (ctrl.collisionPos && ctrl.collisionPos.set) {
            ctrl.collisionPos.set(0, 0.3, egoAheadOfV ? -2 : 2);
          }
        }
      } catch (_e) {
        /* ego seam is best-effort */
      }
      this._emit('trafficCollision', {
        id: v.id,
        with: 'ego',
        lane: v.lane,
        relativeSpeed: Math.round(rel * 10) / 10,
      });
    }
    // Continuous contact response. Wheel velocity is derived by the engine as
    // (worldPos - pPos) / pdT with pPos reset to worldPos after each step, so
    // writing pPos = worldPos - vTarget·dt makes the next step see exactly
    // vTarget — the lateral/vertical components are preserved, only the
    // along-road component is capped.
    try {
      if (ctrl && !ctrl.collisionsDisabled && ctrl.wheels && ctrl.wheels.children.length) {
        const dtp = ctrl.pdT || 0.016;
        const axis = Math.sign(v.arcFloat - this.ego.arcFloat) || 1; // ego → NPC
        const p = this._roadPoint(this.ego.node, 0, 0, TrafficManager._pt);
        const npcAlong = v.dir * v.speed;
        const closing = (this.ego.speedAlong - npcAlong) * axis;
        if (closing > 0) {
          const targetAlong = npcAlong - 0.15 * closing * axis; // slight bounce
          v.pushArc += Math.min(3, closing * 0.25); // momentum into the NPC
          for (const w of ctrl.wheels.children) {
            if (!w.pPos || !w.vel || !w.worldPos) continue;
            const along = w.vel.x * p.tx + w.vel.z * p.tz;
            const dAlong = targetAlong - along;
            w.pPos.x = w.worldPos.x - (w.vel.x + p.tx * dAlong) * dtp;
            w.pPos.z = w.worldPos.z - (w.vel.z + p.tz * dAlong) * dtp;
          }
        }
      }
    } catch (_e) {
      /* physics response is best-effort */
    }
  }

  _resolvePairHit(a, b) {
    // The rear vehicle takes the blame: it stops; the front one is shoved.
    const rear = (b.arcFloat - a.arcFloat) * a.dir > 0 ? a : b;
    const front = rear === a ? b : a;
    const rel = Math.abs(rear.speed - front.speed) || 1;
    rear.mode = 'crashed';
    rear.targetSpeed = 0;
    front.pushArc += rel * 0.4;
    this._emit('trafficCollision', {
      id: rear.id,
      with: front.id,
      lane: rear.lane,
      relativeSpeed: Math.round(rel * 10) / 10,
    });
  }

  // --------------------------------------------------------------- recycle

  _recycle() {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      // NB: roadState.head tracks the ego's node (not the retirement point);
      // the corridor bounds are what keeps vehicles on retained road — the
      // engine retains far more road behind than corridorBehind.
      const metres = (v.arcFloat - this.ego.arcFloat) * this._edgeLen(v.node);
      const out =
        metres < -TRAFFIC_TUNING.corridorBehind ||
        metres > TRAFFIC_TUNING.corridorAhead ||
        !v.node ||
        (v.dir < 0 && !v.node.prev); // oncoming reached the retired tail
      if (out) {
        v.dispose(this.h.world.container);
        this.vehicles.splice(i, 1);
      }
    }
  }

  clear() {
    for (const v of this.vehicles) v.dispose(this.h ? this.h.world.container : null);
    this.vehicles.length = 0;
    return { ok: true, value: true };
  }

  // ----------------------------------------------------------------- state

  /**
   * The ego's lead vehicle in any lane the ego overlaps: { gap (m, bumper to
   * bumper), speed (m/s, along the ego's direction), lane, id } or null.
   * Published in telemetry.state().traffic for headway/TTC-style measures.
   */
  egoLead() {
    if (!this.ego.node) return null;
    const pitch = this._edgeLen(this.ego.node);
    let best = null;
    for (const v of this.vehicles) {
      if (this.ego.lanes.indexOf(v.lane) < 0) continue;
      const dNodes = (v.arcFloat - this.ego.arcFloat) * this.ego.facing;
      if (dNodes <= 0) continue;
      const gap = dNodes * pitch - this.ego.length / 2 - v.length / 2;
      if (gap < (best ? best.gap : 2 * TRAFFIC_TUNING.sensorRange)) {
        best = {
          gap: Math.round(gap * 10) / 10,
          speed: Math.round(v.dir * v.speed * this.ego.facing * 10) / 10,
          lane: v.lane,
          id: v.id,
        };
      }
    }
    return best;
  }

  state() {
    return {
      enabled: this.store.get().enabled,
      attached: !!this.h,
      count: this.vehicles.length,
      vehicles: this.vehicles.map((v) => ({
        id: v.id,
        lane: v.lane,
        mode: v.mode,
        speed: Math.round(v.speed * 10) / 10,
        nodeIndex: v.node ? v.node.i : -1,
        event: v.event,
      })),
    };
  }

  _emit(name, payload) {
    try {
      if (typeof window !== 'undefined' && window.PromptDriveBridge) {
        window.PromptDriveBridge.emit(name, payload);
      }
    } catch (_e) {
      /* event bus is best-effort */
    }
  }
}

TrafficManager._pt = { x: 0, z: 0, tx: 0, tz: 1 };


/* --- TrafficPanel.js --- */
/**
 * Traffic configuration UI, injected into the game's settings sidebar as a
 * collapsible "traffic" section (placed below the road-lanes section, which
 * is appended before this bundle loads).
 *
 * Mirrors LanePanel: the React-rendered settings list mounts/unmounts as the
 * user opens/closes it, so the section is (re)injected via a MutationObserver
 * and matches the native collapsible markup so it looks built-in.
 *
 * Static config (enabled/density/speed/oncoming) applies on reload; the
 * stopped-vehicle event row is live (plan §8).
 */

const TP_STYLE_ID = 'pd-traffic-style';
const TP_SECTION_ID = 'pd-traffic-section';
const TP_CONTENT_ID = 'pd-traffic-content';

const TP_CSS = `
#${TP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${TP_SECTION_ID} .collapsible-cross{float:right}
#${TP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${TP_CONTENT_ID}.open{display:block}
#${TP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${TP_CONTENT_ID} .pd-trow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${TP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${TP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${TP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${TP_CONTENT_ID} .pd-step .val{min-width:52px;text-align:center;color:#eafffb;font-weight:600}
#${TP_CONTENT_ID} .pd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;
  border-top:1px solid #333;padding-top:10px}
#${TP_CONTENT_ID} .pd-actions button{flex:1 1 auto;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${TP_CONTENT_ID} .pd-actions button:hover{border-color:#3ec6b5}
#${TP_CONTENT_ID} .pd-actions button.apply{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${TP_CONTENT_ID} .pd-actions button.on{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${TP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${TP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

class TrafficPanel {
  constructor(store, getFacade) {
    this.store = store;
    this.getFacade = getFacade;
    this.expanded = false;
    this.eventDistance = 100;
    this.eventLane = 1;
    this._injectStyle();
    this._buildSection();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._unsub = store.subscribe(() => this._render());
  }

  _injectStyle() {
    if (document.getElementById(TP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = TP_STYLE_ID;
    s.textContent = TP_CSS;
    document.head.appendChild(s);
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInject();
    });
  }

  _tryInject() {
    const list = document.querySelector('.settings-input-list');
    if (!list) return;
    if (list.contains(this.header) && list.contains(this.content)) return;
    list.appendChild(this.header);
    list.appendChild(this.content);
    this._render();
  }

  _buildSection() {
    this.header = tpEl('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = TP_SECTION_ID;
    this.title = tpEl('div', 'collapsible-title', 'traffic');
    this.cross = tpEl('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = tpEl('div');
    this.content.id = TP_CONTENT_ID;

    this.content.appendChild(tpEl('div', 'pd-fam', 'traffic vehicles'));
    const toggles = tpEl('div', 'pd-actions');
    this.enabledBtn = tpEl('button', null, 'Traffic off');
    this.enabledBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.set({ enabled: !this.store.get().enabled });
    });
    this.oncomingBtn = tpEl('button', null, 'Oncoming on');
    this.oncomingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.set({ oncoming: !this.store.get().oncoming });
    });
    toggles.append(this.enabledBtn, this.oncomingBtn);
    this.content.appendChild(toggles);

    this.densityRow = this._stepperRow('Vehicles', () => this._adjust('density', -1), () => this._adjust('density', 1));
    this.speedRow = this._stepperRow('Speed', () => this._adjust('speed', -1), () => this._adjust('speed', 1));
    this.content.append(this.densityRow.row, this.speedRow.row);

    const applyRow = tpEl('div', 'pd-actions');
    this.applyBtn = tpEl('button', 'apply', 'Apply & restart');
    this.applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      location.reload();
    });
    applyRow.appendChild(this.applyBtn);
    this.content.appendChild(applyRow);

    // --- Stopped-vehicle event (live) ---
    this.content.appendChild(tpEl('div', 'pd-fam', 'stopped vehicle event'));
    this.evDistRow = this._stepperRow('Distance ahead', () => this._adjustEvent('eventDistance', -10), () => this._adjustEvent('eventDistance', 10));
    this.evLaneRow = this._stepperRow('Lane', () => this._adjustEvent('eventLane', -1), () => this._adjustEvent('eventLane', 1));
    this.content.append(this.evDistRow.row, this.evLaneRow.row);
    const evRow = tpEl('div', 'pd-actions');
    this.spawnBtn = tpEl('button', 'apply', 'Spawn stopped vehicle');
    this.spawnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._spawnStopped();
    });
    evRow.appendChild(this.spawnBtn);
    this.content.appendChild(evRow);

    this.note = tpEl('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _spawnStopped() {
    let result = null;
    try {
      result = this.getFacade().spawnStopped({ distance: this.eventDistance, lane: this.eventLane });
    } catch (_e) {
      result = { ok: false, error: 'unavailable' };
    }
    this.spawnBtn.textContent = result && result.ok ? 'Spawned ✓' : 'Failed — sim live?';
    setTimeout(() => {
      this.spawnBtn.textContent = 'Spawn stopped vehicle';
    }, 1500);
  }

  _stepperRow(label, onMinus, onPlus) {
    const row = tpEl('div', 'pd-trow');
    row.appendChild(tpEl('span', null, label));
    const step = tpEl('div', 'pd-step');
    const minus = tpEl('button', null, '−');
    const val = tpEl('span', 'val', '');
    const plus = tpEl('button', null, '+');
    const stop = (fn) => (e) => {
      e.stopPropagation();
      fn();
    };
    minus.addEventListener('click', stop(onMinus));
    plus.addEventListener('click', stop(onPlus));
    step.append(minus, val, plus);
    row.appendChild(step);
    return { row, val };
  }

  _adjust(key, delta) {
    const cfg = this.store.get();
    this.store.set({ [key]: cfg[key] + delta });
  }

  _adjustEvent(key, delta) {
    if (key === 'eventDistance') {
      this.eventDistance = Math.max(TRAFFIC_TUNING.stoppedEventMinDist, Math.min(600, this.eventDistance + delta));
    } else {
      // Signed lane: skip 0 (…-2, -1, 1, 2…), clamped to the configured layout.
      let next = this.eventLane + delta;
      if (next === 0) next += delta;
      let fwd = 5;
      let bwd = 5;
      try {
        const lanes = typeof window !== 'undefined' && window.LaneRoads ? window.LaneRoads.get() : null;
        if (lanes) {
          fwd = lanes.forward;
          bwd = lanes.backward;
        }
      } catch (_e) {
        /* keep permissive bounds */
      }
      this.eventLane = Math.max(bwd > 0 ? -bwd : 1, Math.min(fwd, next));
      if (this.eventLane === 0) this.eventLane = 1;
    }
    this._render();
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+';
    this.content.classList.toggle('open', this.expanded);
  }

  _render() {
    if (!this.densityRow) return;
    const cfg = this.store.get();
    this.enabledBtn.textContent = cfg.enabled ? 'Traffic on' : 'Traffic off';
    this.enabledBtn.classList.toggle('on', cfg.enabled);
    this.oncomingBtn.textContent = cfg.oncoming ? 'Oncoming on' : 'Oncoming off';
    this.oncomingBtn.classList.toggle('on', cfg.oncoming);
    this.densityRow.val.textContent = String(cfg.density);
    this.speedRow.val.textContent = cfg.speed + ' m/s';
    this.evDistRow.val.textContent = this.eventDistance + ' m';
    this.evLaneRow.val.textContent = this.eventLane > 0 ? `fwd ${this.eventLane}` : `onc ${-this.eventLane}`;
    this.note.innerHTML =
      `Traffic vehicles hold their lane at <b>${cfg.speed} m/s</b> ` +
      `(${Math.round(cfg.speed * 3.6)} km/h) and brake for obstacles ahead. ` +
      `Enable/density/speed apply on <b>Apply &amp; restart</b>. ` +
      `The stopped-vehicle event is live: lane <b>fwd 1</b> is the ego's lane, ` +
      `<b>onc</b> lanes are oncoming.`;
  }

  dispose() {
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function tpEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


/* --- RoadTraffic.js --- */
/**
 * Public facade for AI traffic road actors, exposed as `window.RoadTraffic`.
 * The game engine hands it live handles once the world exists and ticks it
 * every rendered frame; this module owns the researcher's intent (config +
 * persistence + settings UI) and the traffic manager owns all actor state.
 *
 * API:
 *   RoadTraffic.get()             -> { enabled, density, speed, oncoming, seed }
 *   RoadTraffic.set(partial)      -> merges, validates, persists (static: takes
 *                                    effect for vehicles spawned from now on;
 *                                    enabling traffic needs a reload so the
 *                                    ego line is lane-centred from the start)
 *   RoadTraffic.spawnStopped(o)   -> dynamic event: stationary vehicle o.distance
 *                                    metres ahead in lane o.lane (plan §8)
 *   RoadTraffic.clear()           -> remove all traffic vehicles
 *   RoadTraffic.state()           -> live actor list (id, lane, mode, speed)
 *   RoadTraffic.subscribe(fn)     -> fn(cfg) on config change; returns unsubscribe
 *   RoadTraffic.defaults/limits/colors
 *
 * Engine-facing seam (called by the patched main bundle, not by users):
 *   RoadTraffic._engineAttach(handles)   once, when the world is live
 *   RoadTraffic._engineUpdate(dt)        every rendered frame
 */

const trafficStore = new TrafficStore();
const trafficManager = new TrafficManager(trafficStore);
const trafficPanel =
  typeof document !== 'undefined' && typeof TrafficPanel !== 'undefined'
    ? new TrafficPanel(trafficStore, () => RoadTraffic)
    : null;

const RoadTraffic = {
  get: () => trafficStore.get(),
  set: (partial) => trafficStore.set(partial),
  subscribe: (fn) => trafficStore.subscribe(fn),
  defaults: Object.assign({}, TRAFFIC_DEFAULTS),
  limits: TRAFFIC_LIMITS,
  colors: TRAFFIC_COLORS.slice(),
  tuning: TRAFFIC_TUNING,

  spawnStopped: (opts) => trafficManager.spawnStopped(opts),
  clear: () => trafficManager.clear(),
  state: () => trafficManager.state(),

  // --- engine seam ---
  _engineAttached: false,
  _engineAttach(handles) {
    trafficManager.attach(handles);
    this._engineAttached = true;
  },
  _engineUpdate(dt) {
    trafficManager.update(dt);
  },
  _manager: trafficManager,
  _panel: trafficPanel,
};

if (typeof window !== 'undefined') {
  window.RoadTraffic = RoadTraffic;
}

})();
