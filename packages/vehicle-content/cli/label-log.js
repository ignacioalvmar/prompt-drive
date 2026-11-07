#!/usr/bin/env node
/**
 * Failure labeler CLI: re-labels every finished task in a PromptDrive content
 * log (JSONL, as written by content.log.download() or collected from the
 * contentLogBatch transport) against the task definitions and the pack.
 *
 *   node cli/label-log.js <log.jsonl> --pack <pack.json> --tasks <tasks.json> [--json]
 *
 * Output: one row per task_end with the computed label (and the label the
 * sim stored at runtime, when present, so drift is visible).
 */
import fs from 'node:fs';
import { labelTask } from '../index.js';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1];
};
const logPath = args[0];
if (!logPath || !flag('--pack') || !flag('--tasks')) {
  console.error('usage: label-log.js <log.jsonl> --pack <pack.json> --tasks <tasks.json> [--json]');
  process.exit(2);
}
const pack = JSON.parse(fs.readFileSync(flag('--pack'), 'utf8'));
const tasksDoc = JSON.parse(fs.readFileSync(flag('--tasks'), 'utf8'));
const defs = new Map((tasksDoc.tasks || tasksDoc).map((t) => [t.task_id, t]));
const events = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const rows = [];
for (const end of events.filter((e) => e.type === 'task_end')) {
  // Task ids in a session may carry a prefix/suffix; match the definition by inclusion.
  const def = defs.get(end.task_id) || [...defs.values()].find((d) => String(end.task_id).includes(d.task_id));
  if (!def) {
    rows.push({ task_id: end.task_id, label: null, note: 'no task definition' });
    continue;
  }
  const calls = events.filter((e) => e.type === 'call' && e.task_id === end.task_id && e.fn !== 'end_task');
  const out = labelTask({ task: def, calls, end, pack });
  rows.push({ task_id: end.task_id, label: out.label, runtime_label: end.label || null, detail: out.detail });
}

if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) console.log(`${String(r.task_id).padEnd(32)} ${String(r.label).padEnd(28)} ${r.runtime_label && r.runtime_label !== r.label ? '(runtime: ' + r.runtime_label + ')' : ''}`);
