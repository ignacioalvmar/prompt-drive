#!/usr/bin/env node
/**
 * Pack validator CLI (contract spec, Phase 0 deliverable).
 *
 *   node cli/validate-pack.js <pack.json> [--graph road-graph.json] [--tasks tasks.json] [--json]
 *
 * Exit code 0 = no blocking errors (warnings allowed), 1 = blocking errors.
 * With --graph, POI road nodes must exist and be reachable from the graph's
 * start node (forward along the chain).
 */
import fs from 'node:fs';
import { validatePack } from '../index.js';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1];
};
const packPath = args.find((a, i) => !a.startsWith('--') && (i === 0 || !['--graph', '--tasks'].includes(args[i - 1])));
if (!packPath) {
  console.error('usage: validate-pack.js <pack.json> [--graph road-graph.json] [--tasks tasks.json] [--json]');
  process.exit(2);
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pack = read(packPath);
let roadGraph = null;
if (flag('--graph')) {
  roadGraph = read(flag('--graph'));
  const start = parseInt(String(roadGraph.start_node || 'n_0').replace(/^n_/, ''), 10);
  roadGraph.reachable_from_start = roadGraph.nodes.filter((n) => n.i >= start).map((n) => n.id);
}
const tasksDoc = flag('--tasks') ? read(flag('--tasks')) : null;
const res = validatePack(pack, { roadGraph, tasks: tasksDoc ? tasksDoc.tasks || tasksDoc : [] });

if (args.includes('--json')) {
  console.log(JSON.stringify(res, null, 2));
} else {
  console.log(`${pack.pack_id} v${pack.pack_version} (${pack.content_hash})`);
  for (const e of res.errors) console.log(`  ERROR   ${e.code.padEnd(20)} ${e.message}${e.path ? '  [' + e.path + ']' : ''}`);
  for (const w of res.warnings) console.log(`  warning ${w.code.padEnd(20)} ${w.message}${w.path ? '  [' + w.path + ']' : ''}`);
  console.log(res.ok ? `OK (${res.warnings.length} warnings)` : `BLOCKED (${res.errors.length} errors, ${res.warnings.length} warnings)`);
}
process.exit(res.ok ? 0 : 1);
