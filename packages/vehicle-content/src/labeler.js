/**
 * Failure labeler (contract spec, "Failure taxonomy"). One primary label per
 * finished task, computed from the per-call log records and the task
 * definition. Deterministic; `query_error` replays the target's reference
 * queries (display name + aliases) against the same pack and resolver.
 *
 *   labelTask({ task, calls, end, pack }) -> { label, detail }
 *
 *   task  : { task_id, expected:{ actions:[{fn,args}], end_outcome }, tolerance?, condition_type? }
 *   calls : per-call records for this task in log order
 *           ({ fn, args, status, candidates?, error_code?, state? })
 *   end   : task_end record ({ outcome, ended_by })
 */

import { createResolver } from './resolver.js';
import { toolSchema } from './tools.js';

const TARGET_KEYS = ['contact_id', 'item_id', 'poi_id'];

const targetOf = (args) => {
  for (const k of TARGET_KEYS) if (args && args[k] != null) return args[k];
  return null;
};

const isAction = (fn) => {
  const t = toolSchema(fn);
  return !!t && t.kind === 'action';
};
const domainOfFn = (fn) => {
  const t = toolSchema(fn);
  return t ? t.domain : null;
};

/** Expected args are a subset of the effective args (call args + resolved state). */
function argsMatch(expected, call) {
  const eff = Object.assign({}, call.state || {}, call.args || {});
  if (call.state && call.state.number_type && !(call.args && call.args.number_type)) eff.number_type = call.state.number_type;
  for (const k of Object.keys(expected || {})) {
    if (JSON.stringify(expected[k]) !== JSON.stringify(eff[k])) return false;
  }
  return true;
}

function outcomeOk(expected, actual) {
  if (expected == null) return true;
  return Array.isArray(expected) ? expected.indexOf(actual) !== -1 : expected === actual;
}

export function labelTask(input) {
  const task = input.task || {};
  const calls = input.calls || [];
  const end = input.end || {};
  const expected = task.expected || {};
  const expActions = expected.actions || [];
  const tolerance = Object.assign({ extra_lookups: 'allowed', extra_actions: 'fail' }, task.tolerance || {});
  const timedOut = end.ended_by === 'timeout' || end.ended_by === 'next_task' || end.outcome === 'timeout';
  const endOutcome = end.ended_by === 'end_task' ? end.outcome : null;

  const okActions = calls.filter((c) => isAction(c.fn) && c.status === 'ok');
  const failedActions = calls.filter((c) => isAction(c.fn) && c.status === 'error');

  // ---------------------------------------------------- tasks with no action
  if (!expActions.length) {
    // Designed absence: the entry is missing (absent) or only a similar one
    // exists (near_miss). Acting on a near miss without confirmation is
    // "content_absence_mishandled" (contract example: called Camilo).
    const absent = task.condition_type === 'absent' || task.condition_type === 'near_miss'
      || (task.condition_type == null && expected.end_outcome === 'not_possible');
    if (okActions.length) return { label: absent ? 'content_absence_mishandled' : 'intent_error', detail: { acted_on: okActions.map((c) => c.fn + ':' + targetOf(c.args)) } };
    if (endOutcome && outcomeOk(expected.end_outcome, endOutcome)) {
      return { label: task.condition_type === 'absent' || (absent && task.condition_type == null) ? 'content_absence_handled' : 'success', detail: {} };
    }
    if (endOutcome === 'completed') return { label: absent ? 'content_absence_mishandled' : 'false_completion', detail: { end_outcome: endOutcome } };
    if (timedOut) return { label: 'timeout', detail: {} };
    return { label: absent ? 'content_absence_mishandled' : 'intent_error', detail: { end_outcome: endOutcome } };
  }

  // ---------------------------------------------------- success
  const matchedIdx = new Set();
  let allMatched = true;
  for (const ea of expActions) {
    let found = -1;
    if (tolerance.extra_actions === 'allowed') {
      // Final state only: the LAST ok call of that function must match.
      for (let i = okActions.length - 1; i >= 0; i--) {
        if (okActions[i].fn === ea.fn) { found = argsMatch(ea.args, okActions[i]) ? i : -1; break; }
      }
    } else {
      found = okActions.findIndex((c, i) => !matchedIdx.has(i) && c.fn === ea.fn && argsMatch(ea.args, c));
    }
    if (found === -1) allMatched = false;
    else matchedIdx.add(found);
  }
  const illegalExtra = tolerance.extra_actions !== 'allowed' && okActions.some((_c, i) => !matchedIdx.has(i));
  const endMatches = endOutcome != null ? outcomeOk(expected.end_outcome, endOutcome) : !expected.end_outcome || timedOut === false;
  if (allMatched && !illegalExtra && endOutcome != null && endMatches) return { label: 'success', detail: {} };
  if (allMatched && !illegalExtra && endOutcome == null && !timedOut) return { label: 'success', detail: { note: 'no end_task' } };

  // ---------------------------------------------------- failure analysis
  const ea = expActions[0];
  const domain = domainOfFn(ea.fn);
  const target = targetOf(ea.args);
  const inDomain = calls.filter((c) => domainOfFn(c.fn) === domain);
  const wrongDomainAction = okActions.find((c) => domainOfFn(c.fn) !== domain);
  if (!inDomain.length || wrongDomainAction) {
    return { label: 'intent_error', detail: { wrong_domain_action: wrongDomainAction ? wrongDomainAction.fn : null } };
  }

  const surfaced = target != null && calls.some((c) => (c.candidates || []).some((x) => x.id === target));
  const wrongId = okActions.find((c) => c.fn === ea.fn && targetOf(c.args) !== target);
  if (wrongId && surfaced) return { label: 'grounding_error', detail: { used: targetOf(wrongId.args), expected: target } };

  if (target != null && !surfaced && input.pack) {
    const r = createResolver(input.pack);
    const refHit = r.referenceQueries(target).some((q) => {
      const res = domain === 'phone' ? r.searchContacts({ query: q, limit: 10 })
        : domain === 'media' ? r.searchMedia({ query: q, limit: 10 })
          : r.searchPoi({ query: q, limit: 10 }, {});
      return res.candidates.some((x) => x.id === target);
    });
    if (refHit) return { label: 'query_error', detail: { queries: calls.filter((c) => c.args && c.args.query != null).map((c) => c.args.query) } };
  }
  if (wrongId) return { label: 'grounding_error', detail: { used: targetOf(wrongId.args), expected: target, surfaced: false } };

  const failedOnTarget = failedActions.filter((c) => targetOf(c.args) === target);
  if (failedOnTarget.length) {
    const last = failedOnTarget[failedOnTarget.length - 1];
    return { label: 'execution_error', detail: { error_code: last.error_code || null } };
  }
  if (endOutcome === 'completed') return { label: 'false_completion', detail: {} };
  if (timedOut) return { label: 'timeout', detail: {} };
  if (allMatched && illegalExtra) return { label: 'grounding_error', detail: { note: 'extra actions' } };
  return { label: 'execution_error', detail: { note: 'no action taken', end_outcome: endOutcome } };
}
