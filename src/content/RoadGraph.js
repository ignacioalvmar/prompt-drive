/**
 * Stable road graph for content (POIs, routes, network distances).
 *
 * The engine's road is ONE procedurally generated midline: a linked list of
 * nodes (`roadState.head … vehicleNode … tail`) with an integer index `i`
 * counted from the generation origin (node 0), ~1500 nodes of look-ahead, and
 * nodes behind the vehicle retired. With the same scene config (seed, scene,
 * topography) the generator is a pure function of `i`, so `road_node_id =
 * "n_<i>"` is stable within a map version. Map identity is not trusted on
 * faith: maps.js pins a geometry fingerprint that is compared against the
 * live road before any pack is accepted (fail closed).
 *
 * This recorder copies node geometry as nodes become FINAL (more than
 * ROAD_FINAL_LAG nodes behind the generator tail — the engine may still
 * retract/regenerate the newest nodes) into an index-keyed table, so the graph
 * survives node retirement and can be exported as JSON. Map-local coordinates
 * are (x, y) = (world x, world z); the road graph is a chain, so the network
 * distance between two nodes is the arc length between them.
 */

const ROAD_FINAL_LAG = 520; // > engine retract window (vt = 500 nodes)
const ROAD_POLL_MS = 250;
const ROAD_TOLERANCE_M = 0.5; // live vs committed geometry

export class RoadGraph {
  constructor() {
    this.h = null;
    this.nodes = new Map(); // i -> { i, x, y, z, a, w, nx, nz, bridge }
    this.minI = null;
    this.maxI = null; // highest contiguous index known (seeded or recorded)
    this.liveMaxI = null; // highest contiguous index recorded from the live road
    this.seeded = null; // { map_id, map_version } when seeded from an export
    this.mismatches = []; // live nodes that disagree with the seeded graph
    this.live = new Map(); // i -> [x, y] as recorded from the live road
    this._arc = null; // Float64Array cumulative arc from minI (lazy)
    this._arcMax = null;
    this._lastPoll = 0;
    this._listeners = [];
  }

  attach(h) {
    this.h = h;
  }

  get ready() {
    return this.maxI != null;
  }

  onGrow(fn) {
    this._listeners.push(fn);
  }

  /** Called every frame by the engine seam; throttled internally. */
  poll(nowMs) {
    const rs = this.h && this.h.roadState;
    if (!rs || !rs.head || !rs.tail) return;
    if (nowMs - this._lastPoll < ROAD_POLL_MS) return;
    this._lastPoll = nowMs;
    const finalUpTo = rs.tail.i - ROAD_FINAL_LAG;
    if (this.liveMaxI != null && finalUpTo <= this.liveMaxI) return;
    let n = rs.head;
    const start = this.liveMaxI == null ? 0 : this.liveMaxI + 1;
    while (n && n.i < start) n = n.next;
    let grew = false;
    while (n && n.i <= finalUpTo) {
      if (n.i >= 0 && n.p) {
        if (this.liveMaxI != null && n.i !== this.liveMaxI + 1) break; // keep contiguous
        const rec = {
          i: n.i,
          x: n.p.x,
          y: n.p.z,
          z: n.p.y,
          a: typeof n.a === 'number' ? n.a : 0,
          w: typeof n.w === 'number' ? n.w : 4,
          nx: n.n ? n.n.x : 0,
          nz: n.n ? n.n.z : 0,
          bridge: !!n.bridge,
        };
        this.live.set(n.i, [rec.x, rec.y]);
        const known = this.nodes.get(n.i);
        if (known && this.seeded) {
          // Continuous map verification against the committed export.
          if (Math.abs(known.x - rec.x) > ROAD_TOLERANCE_M || Math.abs(known.y - rec.y) > ROAD_TOLERANCE_M) {
            if (this.mismatches.length < 50) this.mismatches.push({ i: n.i, expected: [known.x, known.y], live: [rec.x, rec.y] });
          }
          known.z = rec.z;
        } else if (!known) {
          if (this.maxI == null || n.i === this.maxI + 1) {
            this.nodes.set(n.i, rec);
            if (this.minI == null) this.minI = n.i;
            this.maxI = n.i;
            grew = true;
          }
        }
        this.liveMaxI = n.i;
      }
      n = n.next;
    }
    if (grew) {
      this._arc = null;
      for (const fn of this._listeners) {
        try { fn(this); } catch (_e) {}
      }
    }
  }

  /** Seed the authoritative geometry from a committed road-graph export. */
  seed(graph) {
    if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return false;
    const live = this.nodes;
    this.nodes = new Map();
    for (const nd of graph.nodes) {
      const i = typeof nd.i === 'number' ? nd.i : RoadGraph.indexOf(nd.id);
      if (i == null) continue;
      const l = live.get(i);
      this.nodes.set(i, {
        i,
        x: nd.x,
        y: nd.y,
        z: l ? l.z : 0,
        a: nd.heading || 0,
        w: nd.half_width || 4,
        nx: nd.normal ? nd.normal[0] : 0,
        nz: nd.normal ? nd.normal[1] : 0,
        bridge: !!nd.bridge,
      });
    }
    const idx = Array.from(this.nodes.keys()).sort((a, b) => a - b);
    this.minI = idx[0];
    this.maxI = idx[idx.length - 1];
    this.seeded = { map_id: graph.map_id, map_version: graph.map_version };
    this.mismatches = [];
    // Re-check everything recorded so far against the seed.
    for (const [i, rec] of live) {
      const known = this.nodes.get(i);
      if (known && (Math.abs(known.x - rec.x) > ROAD_TOLERANCE_M || Math.abs(known.y - rec.y) > ROAD_TOLERANCE_M)) {
        if (this.mismatches.length < 50) this.mismatches.push({ i, expected: [known.x, known.y], live: [rec.x, rec.y] });
      }
    }
    this._arc = null;
    for (const fn of this._listeners) {
      try { fn(this); } catch (_e) {}
    }
    return true;
  }

  /** Has the live recorder reached node i yet? */
  liveHas(i) {
    return this.liveMaxI != null && i <= this.liveMaxI;
  }

  // ------------------------------------------------------------ geometry

  _ensureArc() {
    if (this._arc && this._arcMax === this.maxI) return;
    const n = this.maxI - this.minI + 1;
    const arc = new Float64Array(n);
    for (let k = 1; k < n; k++) {
      const a = this.nodes.get(this.minI + k - 1);
      const b = this.nodes.get(this.minI + k);
      arc[k] = arc[k - 1] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    this._arc = arc;
    this._arcMax = this.maxI;
  }

  /** Arc length (m) of node i from the graph origin, or null if unknown. */
  arcOf(i) {
    if (!this.ready || i < this.minI || i > this.maxI) return null;
    this._ensureArc();
    return this._arc[i - this.minI];
  }

  node(i) {
    return this.nodes.get(i) || null;
  }

  static idOf(i) {
    return 'n_' + i;
  }

  static indexOf(id) {
    const m = /^n_(-?\d+)$/.exec(String(id || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  /** Live vehicle position on the road: { i, t, arc, x, y, road_node_id }. */
  vehiclePosition() {
    const h = this.h;
    const rs = h && h.roadState;
    const ego = h && h.ego;
    if (!rs || !rs.vehicleNode || !ego || !ego.position) return null;
    const node = rs.vehicleNode;
    let t = 0;
    const nx = node.next;
    if (nx && nx.p && node.p) {
      const dx = nx.p.x - node.p.x;
      const dz = nx.p.z - node.p.z;
      const len2 = dx * dx + dz * dz;
      if (len2 > 1e-6) {
        t = ((ego.position.x - node.p.x) * dx + (ego.position.z - node.p.z) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
      }
    }
    const base = this.arcOf(node.i);
    const next = this.arcOf(node.i + 1);
    let arc = null;
    if (base != null) arc = next != null ? base + (next - base) * t : base;
    return {
      i: node.i,
      t,
      arc,
      x: ego.position.x,
      y: ego.position.z,
      road_node_id: RoadGraph.idOf(t >= 0.5 ? node.i + 1 : node.i),
    };
  }

  /** Network distance (m) from the vehicle to node `i`; null when unknown. */
  distanceFromVehicle(i) {
    const v = this.vehiclePosition();
    const target = this.arcOf(i);
    if (!v || v.arc == null || target == null) return null;
    return Math.abs(target - v.arc);
  }

  /** Network distance between two nodes; null when unknown. */
  distanceBetween(i, j) {
    const a = this.arcOf(i);
    const b = this.arcOf(j);
    if (a == null || b == null) return null;
    return Math.abs(a - b);
  }

  // ------------------------------------------------------------ export

  /** LIVE geometry fingerprint at fixed indices (used by maps.js); null until recorded. */
  fingerprint(indices) {
    const out = [];
    for (const i of indices) {
      const n = this.live.get(i);
      if (!n) return null;
      out.push([i, Math.round(n[0] * 100) / 100, Math.round(n[1] * 100) / 100]);
    }
    return out;
  }

  /** JSON road graph (nodes, chain edges with lengths) for WorlDrive / CLIs. */
  exportGraph(meta) {
    if (!this.ready) return null;
    this._ensureArc();
    const nodes = [];
    const edges = [];
    for (let i = this.minI; i <= this.maxI; i++) {
      const n = this.nodes.get(i);
      nodes.push({
        id: RoadGraph.idOf(i),
        i,
        x: Math.round(n.x * 100) / 100,
        y: Math.round(n.y * 100) / 100,
        heading: Math.round(n.a * 10000) / 10000,
        half_width: Math.round(n.w * 100) / 100,
        normal: [Math.round(n.nx * 10000) / 10000, Math.round(n.nz * 10000) / 10000],
        bridge: n.bridge || undefined,
        arc_m: Math.round(this._arc[i - this.minI] * 100) / 100,
      });
      if (i > this.minI) {
        edges.push({
          from: RoadGraph.idOf(i - 1),
          to: RoadGraph.idOf(i),
          length_m: Math.round((this._arc[i - this.minI] - this._arc[i - 1 - this.minI]) * 100) / 100,
        });
      }
    }
    return Object.assign(
      {
        format: 'promptdrive-road-graph/1',
        coord_system: 'map_local',
        topology: 'chain',
        directed: false,
        node_id_scheme: 'n_<midline index>',
      },
      meta || {},
      { nodes, edges },
    );
  }
}
