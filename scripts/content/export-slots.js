#!/usr/bin/env node
/**
 * Slot export + reachability CLI (PromptDrive spec, "Slot export" and
 * "Reachability"). Reads a committed road graph and writes slots.json next to
 * it: candidate POI positions beside the road that WorlDrive's placer
 * consumes without loading the map.
 *
 *   node scripts/content/export-slots.js maps/synth-town-01/2026.11/road-graph.json
 *     [--spacing-nodes 5] [--offset-m 9] [--clearance-m 40] [--max-turn-rad 0.6]
 *     [--skip-start-m 300] [--out path] [--check]
 *
 * Each slot: slot_id, x, y, road_node_id, side (left/right of travel),
 * heading (rad, direction of travel), zone_type (null — no zones defined on
 * the synthetic maps yet), arc_m (network distance from the start node).
 *
 * Rules:
 * - Slots keep `clearance-m` from junction-like features. The synthetic road
 *   is a single chain without intersections, so the features are bridge
 *   ends and tight bends (heading change over +-3 nodes above max-turn-rad).
 * - Reachability: the vehicle starts at the map's start node and drives
 *   forward along the chain; slots behind the start, or beyond the exported
 *   extent, are unreachable and are excluded from the export (not flagged).
 * - Deterministic: same graph + options -> byte-identical slots.json.
 *
 * --check re-derives slots.json and exits 1 if the committed file differs.
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const o = { spacingNodes: 5, offsetM: 9, clearanceM: 40, maxTurnRad: 0.6, skipStartM: 300, out: null, check: false, graph: null };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const num = () => Number(argv[++k]);
    if (a === '--spacing-nodes') o.spacingNodes = num();
    else if (a === '--offset-m') o.offsetM = num();
    else if (a === '--clearance-m') o.clearanceM = num();
    else if (a === '--max-turn-rad') o.maxTurnRad = num();
    else if (a === '--skip-start-m') o.skipStartM = num();
    else if (a === '--out') o.out = argv[++k];
    else if (a === '--check') o.check = true;
    else if (!o.graph) o.graph = a;
  }
  if (!o.graph) {
    console.error('usage: export-slots.js <road-graph.json> [options]');
    process.exit(2);
  }
  return o;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

const r2 = (v) => Math.round(v * 100) / 100;

function reachableRange(graph) {
  const idx = (id) => parseInt(String(id).replace(/^n_/, ''), 10);
  const start = idx(graph.start_node || graph.nodes[0].id);
  const last = graph.nodes[graph.nodes.length - 1].i;
  return { start, last };
}

function exportSlots(graph, o) {
  const nodes = graph.nodes;
  const byI = new Map(nodes.map((n) => [n.i, n]));
  const { start, last } = reachableRange(graph);
  const startArc = byI.get(start).arc_m;

  // Junction-like features: bridge ends and tight bends.
  const features = [];
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    const prev = nodes[k - 1];
    if (prev && !!prev.bridge !== !!n.bridge) features.push(n.arc_m);
    const a = nodes[k - 3];
    const b = nodes[k + 3];
    if (a && b && angleDiff(b.heading, a.heading) > o.maxTurnRad) features.push(n.arc_m);
  }
  features.sort((x, y) => x - y);
  const nearFeature = (arc) => {
    // binary search for the closest feature
    let lo = 0;
    let hi = features.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (features[mid] < arc) lo = mid + 1;
      else hi = mid;
    }
    const c = [features[lo], features[lo - 1]].filter((v) => v != null);
    return c.some((f) => Math.abs(f - arc) < o.clearanceM);
  };

  const slots = [];
  let excludedUnreachable = 0;
  let excludedClearance = 0;
  for (const n of nodes) {
    if (n.i % o.spacingNodes !== 0) continue;
    if (n.i < start || n.i > last) { excludedUnreachable += 2; continue; }
    if (n.arc_m - startArc < o.skipStartM) continue;
    if (n.bridge || nearFeature(n.arc_m)) { excludedClearance += 2; continue; }
    const d = n.half_width + o.offsetM;
    const [nx, nz] = n.normal;
    // Convention (traffic/nav): +lateral (visually LEFT of travel) is -normal.
    for (const [side, sgn] of [['left', -1], ['right', 1]]) {
      slots.push({
        slot_id: `s_${n.i}_${side === 'left' ? 'L' : 'R'}`,
        x: r2(n.x + sgn * nx * d),
        y: r2(n.y + sgn * nz * d),
        road_node_id: n.id,
        side,
        heading: n.heading,
        zone_type: null,
        arc_m: r2(n.arc_m - startArc),
      });
    }
  }
  return {
    format: 'promptdrive-slots/1',
    map_id: graph.map_id,
    map_version: graph.map_version,
    coord_system: 'map_local',
    start_node: graph.start_node,
    reachable: { from: `n_${start}`, to: `n_${last}`, rule: 'forward along the chain from start_node' },
    options: { spacing_nodes: o.spacingNodes, offset_m: o.offsetM, clearance_m: o.clearanceM, max_turn_rad: o.maxTurnRad, skip_start_m: o.skipStartM },
    excluded: { unreachable: excludedUnreachable, clearance: excludedClearance },
    slots,
  };
}

function serialize(out) {
  const head = Object.assign({}, out);
  delete head.slots;
  const lines = ['{'];
  for (const [k, v] of Object.entries(head)) lines.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + ',');
  lines.push('  "slots": [');
  out.slots.forEach((s, i) => lines.push('    ' + JSON.stringify(s) + (i < out.slots.length - 1 ? ',' : '')));
  lines.push('  ]', '}');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  const graph = JSON.parse(fs.readFileSync(o.graph, 'utf8'));
  const out = exportSlots(graph, o);
  const text = serialize(out);
  const outPath = o.out || path.join(path.dirname(o.graph), 'slots.json');
  if (o.check) {
    const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== text) {
      console.error(`slots out of date: ${outPath}`);
      process.exit(1);
    }
    console.log(`slots up to date: ${outPath} (${out.slots.length} slots)`);
  } else {
    fs.writeFileSync(outPath, text);
    console.log(`Wrote ${outPath}: ${out.slots.length} slots, reachable ${out.reachable.from}..${out.reachable.to}, excluded ${JSON.stringify(out.excluded)}`);
  }
}

module.exports = { exportSlots, reachableRange };
