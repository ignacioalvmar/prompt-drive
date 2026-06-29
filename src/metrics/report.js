/**
 * End-of-run report + raw-log export. Produces a human-readable Markdown
 * report, a machine-readable JSON report, and a CSV of raw telemetry, each
 * downloadable via a Blob + temporary <a download>.
 */

import { computeMetrics } from './compute.js';
import { getMetric } from './config.js';

/** Build the structured report object for a finished run. */
export function buildReport(collector, selection, opts = {}) {
  const cols = collector.columns();
  const results = computeMetrics(cols, selection, {
    paramOverrides: opts.paramOverrides,
    trafficAvailable: opts.trafficAvailable,
    baselineRange: opts.baselineRange,
    events: collector.events,
  });
  return {
    generatedAt: new Date().toISOString(),
    meta: collector.meta,
    run: {
      durationSec: collector.durationSec(),
      distanceM: collector.distanceM(),
      samples: collector.sampleCount,
      events: collector.events,
    },
    selection,
    paramOverrides: opts.paramOverrides || {},
    results,
  };
}

function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return Number(v).toFixed(digits);
}

/** Render the report object as Markdown. */
export function reportToMarkdown(report) {
  const r = report.results;
  const lines = [];
  lines.push('# Driving Performance Report');
  lines.push('');
  lines.push(`*Generated ${report.generatedAt}*`);
  lines.push('');
  lines.push('## Run');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Duration | ${fmt(report.run.durationSec, 1)} s |`);
  lines.push(`| Distance | ${fmt(report.run.distanceM, 1)} m |`);
  lines.push(`| Samples | ${report.run.samples} |`);
  if (report.meta.vehicle) lines.push(`| Vehicle | ${report.meta.vehicle} |`);
  if (report.meta.units != null) lines.push(`| Units mode | ${report.meta.units} |`);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value | Detail | Unit |');
  lines.push('|---|---|---|---|');
  for (const id in r) {
    const m = getMetric(id);
    const res = r[id];
    lines.push(
      `| ${m ? m.label : id} | ${fmt(res.value)} | ${detailString(id, res)} | ${res.unit || ''} |`
    );
  }
  lines.push('');

  if (report.run.events.length) {
    lines.push('## Events');
    lines.push('');
    lines.push('| # | Type | t (s) | Detail |');
    lines.push('|---|---|---|---|');
    report.run.events.forEach((e, i) => {
      lines.push(`| ${i + 1} | ${e.type} | ${fmt(e.t, 2)} | ${e.speed != null ? fmt(e.speed, 1) + ' m/s' : ''} |`);
    });
    lines.push('');
  }

  lines.push('## Parameters');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.paramOverrides, null, 2));
  lines.push('```');
  return lines.join('\n');
}

function detailString(id, res) {
  switch (id) {
    case 'meanLP':
      return `median ${fmt(res.median)}, MAD ${fmt(res.mad)}`;
    case 'laneDepartures':
      return `${fmt(res.perKm, 2)}/km, mean dur ${fmt(res.meanDurationSec, 2)} s`;
    case 'tlc':
      return `15th pct ${fmt(res.p15, 2)} s`;
    case 'swrr':
      return `${res.reversals} reversals`;
    case 'steeringEntropy':
      return `α ${fmt(res.alpha, 4)}`;
    case 'collisions':
      return `${fmt(res.perKm, 2)}/km, ${fmt(res.perHour, 2)}/h`;
    case 'throttleBrake':
      return `thr ${fmt(res.throttleShare, 2)}, brk ${fmt(res.brakeShare, 2)}, jerk ${fmt(res.peakJerk, 1)}`;
    default:
      return res.note || '';
  }
}

/** Raw telemetry as CSV (one row per logged frame). */
export function logsToCsv(collector) {
  const cols = collector.columns();
  const keys = Object.keys(cols);
  const n = cols.t ? cols.t.length : 0;
  const rows = [keys.join(',')];
  for (let i = 0; i < n; i++) {
    rows.push(keys.map((k) => csvNum(cols[k][i])).join(','));
  }
  return rows.join('\n');
}

function csvNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
  return String(v);
}

/** Trigger a browser download of a text blob. */
export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Download report (.md + .json). */
export function downloadReport(report) {
  const base = `driving-report-${stamp()}`;
  downloadText(`${base}.md`, reportToMarkdown(report), 'text/markdown');
  downloadText(`${base}.json`, JSON.stringify(report, null, 2), 'application/json');
}

/** Download raw telemetry logs (.csv) + events (.json). */
export function downloadLogs(collector) {
  const base = `driving-logs-${stamp()}`;
  downloadText(`${base}.csv`, logsToCsv(collector), 'text/csv');
  downloadText(
    `${base}.events.json`,
    JSON.stringify({ meta: collector.meta, events: collector.events }, null, 2),
    'application/json'
  );
}
