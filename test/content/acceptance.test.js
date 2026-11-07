/**
 * Phase 0 acceptance tests (PromptDrive spec, "Acceptance tests"), run
 * against the BUILT static/js/content.js with a fake engine (harness.js).
 * The visual parts (touch HMI, 3D signs in the real renderer) are verified in
 * the browser; here the same service paths are exercised headlessly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSim, session, makeStorage, stable, host, PACK, TASKS, GRAPH } = require('./harness');

const TASK = (id) => {
  const t = TASKS.find((x) => x.task_id === id);
  return Object.assign({}, t, { prompt_for_driver: t.prompt_for_driver.es });
};
const calls = (VC, taskId) => host(VC.log.events({ type: 'call' })).filter((e) => !taskId || e.task_id === taskId);
const lastTaskEnd = (VC) => VC.log.events({ type: 'task_end' }).slice(-1)[0];

async function ready(opts, sess) {
  const sim = createSim(opts);
  const res = await sim.VC.load({ session: session(sess) });
  return Object.assign(sim, { res });
}

// A scripted agent: the same calls in the same order, every time.
function scriptedSession(VC, setVehicle) {
  VC.task.start(TASK('call_brother_mobile'));
  const s = VC.call('search_contacts', { query: 'Pipe' }, { source: 'agent', turn: 1 });
  VC.call('call_contact', { contact_id: s.candidates[0].id, number_type: 'mobile' }, { source: 'agent', turn: 2 });
  VC.call('end_task', { outcome: 'completed' }, { source: 'agent', turn: 3 });
  VC.hangUp();
  setVehicle(40, 0.5);
  VC.call('search_poi', { query: 'gasolinera' }, { source: 'agent', turn: 4 });
  VC.call('search_poi', { category: 'restaurant', radius_m: 5000 }, { source: 'agent', turn: 4 });
  const p = VC.call('search_poi', { query: 'droguería', limit: 3 }, { source: 'agent', turn: 5 });
  VC.call('navigate_to', { poi_id: p.candidates[0].id }, { source: 'agent', turn: 6 });
  VC.call('search_poi', { category: 'cafe', scope: 'along_route' }, { source: 'agent', turn: 7 });
  VC.call('search_media', { query: 'vallenato', types: ['playlist', 'track'] }, { source: 'agent', turn: 8 });
  VC.call('search_contacts', { query: 'Andrés' }, { source: 'agent', turn: 9 });
  VC.call('search_contacts', { query: 'Camila' }, { source: 'agent', turn: 9 });
}

test('pack loads with hash, map and tools checks; header written first', async () => {
  const { VC, res } = await ready();
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.equal(VC.status().phase, 'ready');
  const ev = VC.log.events();
  assert.equal(ev[0].type, 'session_header');
  for (const k of ['tools_version', 'resolver_version', 'synonyms_version', 'pack_id', 'pack_version', 'content_hash', 'map_id', 'map_version', 'participant_pseudonym', 'wall_clock_start']) {
    assert.ok(ev[0][k] != null, 'header field ' + k);
  }
  assert.equal(ev[0].synonyms_version, 'es-CO@1,en-US@1');
});

test('1. determinism: replaying the same tool calls yields byte-identical resolver results', async () => {
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const sim = await ready();
    scriptedSession(sim.VC, sim.setVehicle);
    runs.push(calls(sim.VC).map((c) => JSON.stringify(stable(c))));
  }
  assert.equal(runs[0].length, 11);
  assert.deepEqual(runs[0], runs[1]);
  // Replay from the log alone: same pack + recorded ctx -> same candidates.
  const sim = await ready();
  scriptedSession(sim.VC, sim.setVehicle);
  const recorded = calls(sim.VC).filter((c) => c.fn.startsWith('search_'));
  const replay = await ready();
  for (const c of recorded) {
    if (c.ctx && c.ctx.vehicle_arc_m != null) {
      const n = GRAPH.nodes.find((x) => x.arc_m >= c.ctx.vehicle_arc_m) || GRAPH.nodes[0];
      replay.setVehicle(n.i === 40 ? 40 : n.i - 1, n.i === 40 ? 0.5 : 0);
      replay.setVehicle(40, 0.5);
    }
    if (c.ctx && c.ctx.route_stops.length && !replay.VC.status().route) replay.VC.call('navigate_to', { poi_id: c.ctx.route_stops[0] }, { source: 'agent' });
    const r = replay.VC.call(c.fn, c.args, { source: c.source });
    assert.deepEqual(host((r.candidates || []).map((x) => [x.id, x.score, x.matched_on])), (c.candidates || []).map((x) => [x.id, x.score, x.matched_on]), c.fn + ' ' + JSON.stringify(c.args));
  }
});

test('2. fail closed: one changed character stops the session before the first task', async () => {
  const tampered = JSON.parse(JSON.stringify(PACK));
  tampered.contacts[0].aliases[0] = 'Pipa';
  const sim = createSim();
  const res = await sim.VC.load({ session: session(), pack: tampered });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'hash_mismatch');
  assert.equal(res.error.message, 'Pack hash mismatch');
  assert.equal(sim.VC.status().phase, 'failed');
  assert.equal(sim.VC.task.start(TASK('call_brother_mobile')).ok, false);
  assert.equal(sim.VC.call('search_contacts', { query: 'Pipe' }, { source: 'agent' }).status, 'error');
  assert.ok(sim.VC.log.events({ type: 'session_error' }).some((e) => e.code === 'hash_mismatch'));
  assert.ok(sim.emitted.some((e) => e.ev === 'paused'), 'sim is stopped');
});

test('2. fail closed: wrong map version, other map, wrong scene, different road, tools version', async () => {
  const v = await ready({}, { map_version: '2026.10' });
  assert.equal(v.res.ok, false);
  assert.equal(v.res.error.code, 'map_mismatch');
  assert.match(v.res.error.message, /2026\.11/);
  const otherMapPack = JSON.parse(JSON.stringify(PACK));
  otherMapPack.map.map_version = '2026.10';
  otherMapPack.content_hash = v.VC.computeContentHash(otherMapPack);
  const o = createSim();
  const r2 = await o.VC.load({ session: session({ content_hash: otherMapPack.content_hash }), pack: otherMapPack });
  assert.equal(r2.error.code, 'map_mismatch');
  const scene = await ready({ scene: { seed: 'deadbeef' } });
  assert.equal(scene.res.error.code, 'map_mismatch');
  assert.match(scene.res.error.message, /seed/);
  const road = await ready({ perturb: (i) => i === 300 });
  assert.equal(road.res.error.code, 'map_mismatch');
  const tools = await ready({}, { tools_version: 'vehicle-tools/2.0' });
  assert.equal(tools.res.error.code, 'tools_version_unsupported');
});

test('3. parity: touch and agent produce the same functions and IDs, differing only in source', async () => {
  const run = async (source) => {
    const sim = await ready();
    sim.VC.task.start(TASK('call_brother_mobile'));
    sim.VC.call('search_contacts', { query: '' }, { source: 'hmi_touch' }); // list screen (browse) — touch only
    const s = sim.VC.call('search_contacts', { query: 'Pipe' }, { source, turn: 1 });
    sim.VC.call('call_contact', { contact_id: s.candidates[0].id, number_type: 'mobile' }, { source, turn: 2 });
    sim.VC.call('end_task', { outcome: 'completed' }, { source, turn: 3 });
    return calls(sim.VC).filter((c) => !c.browse).map((c) => { const x = stable(c); delete x.source; return JSON.stringify(x); });
  };
  const agent = await run('agent');
  const human = await run('hmi_touch');
  assert.deepEqual(human, agent);
  assert.equal(agent.length, 3);
});

test('4. designed conditions: reference tasks give the expected status and label', async () => {
  const { VC } = await ready();
  const agent = (fn, args, turn) => VC.call(fn, args, { source: 'agent', turn });

  VC.task.start(TASK('call_brother_mobile'));
  const pipe = agent('search_contacts', { query: 'Pipe' }, 1);
  assert.equal(pipe.status, 'ok');
  agent('call_contact', { contact_id: pipe.candidates[0].id, number_type: 'mobile' }, 2);
  agent('end_task', { outcome: 'completed' }, 3);
  assert.equal(lastTaskEnd(VC).label, 'success');
  VC.hangUp();

  VC.task.start(TASK('call_valentina_absent'));
  assert.equal(agent('search_contacts', { query: 'Valentina' }, 1).status, 'not_found');
  agent('end_task', { outcome: 'not_possible', reason: 'No contact named Valentina' }, 2);
  assert.equal(lastTaskEnd(VC).label, 'content_absence_handled');

  VC.task.start(TASK('call_andres_ambiguous'));
  const andres = agent('search_contacts', { query: 'Andrés' }, 1);
  assert.equal(andres.status, 'ambiguous');
  agent('call_contact', { contact_id: 'c_0016' }, 2); // picks without asking -> wrong one
  agent('end_task', { outcome: 'completed' }, 3);
  assert.equal(lastTaskEnd(VC).label, 'grounding_error');
  VC.hangUp();

  VC.task.start(TASK('call_boss_mobile_missing'));
  const boss = agent('search_contacts', { query: 'mi jefa' }, 1);
  assert.equal(boss.status, 'ok');
  const fail = agent('call_contact', { contact_id: boss.candidates[0].id, number_type: 'mobile' }, 2);
  assert.deepEqual([fail.status, fail.error_code], ['error', 'no_number_of_type']);
  agent('end_task', { outcome: 'needs_user', reason: 'Only a work number' }, 3);
  assert.equal(lastTaskEnd(VC).label, 'success');

  VC.task.start(TASK('call_camila_near_miss'));
  const cam = agent('search_contacts', { query: 'Camila' }, 1);
  assert.equal(cam.candidates.concat(cam.suggestions || [])[0].id, 'c_0018');
  agent('call_contact', { contact_id: 'c_0018' }, 2); // acts on the near miss without confirming
  agent('end_task', { outcome: 'completed' }, 3);
  assert.equal(lastTaskEnd(VC).label, 'content_absence_mishandled');
});

test('turn loop: invalid arguments, end_task, next_task and limits', async () => {
  const { VC } = await ready();
  const bad = VC.call('call_contact', { contact_id: 'c_0012', number_type: 'fax' }, { source: 'agent', turn: 1 });
  assert.deepEqual([bad.status, bad.error_code], ['error', 'invalid_argument']);
  assert.equal(VC.call('search_contacts', { query: '' }, { source: 'agent' }).status, 'invalid_argument');
  assert.equal(VC.call('get_contact', {}, { source: 'agent' }).status, 'invalid_argument');
  assert.equal(VC.call('add_waypoint', { poi_id: PACK.pois[0].id }, { source: 'agent' }).error_code, 'no_route');
  assert.equal(VC.call('call_contact', { contact_id: 'nope' }, { source: 'agent' }).error_code, 'unknown_id');
  assert.ok(VC.log.events({ type: 'call' }).some((c) => c.status === 'invalid_argument'), 'invalid calls are logged');

  VC.task.start(TASK('call_brother_mobile'));
  VC.task.start(TASK('call_valentina_absent')); // driver moved on
  const prev = VC.log.events({ type: 'task_end' }).slice(-1)[0];
  assert.deepEqual([prev.task_id, prev.outcome, prev.ended_by], ['call_brother_mobile', 'timeout', 'next_task']);
  VC.call('search_contacts', { query: 'Valentina' }, { source: 'agent', turn: 7 }); // max_turns is 6
  const lim = lastTaskEnd(VC);
  assert.deepEqual([lim.task_id, lim.outcome, lim.ended_by], ['call_valentina_absent', 'timeout', 'timeout']);
});

test('effects + state: call busy/20 s, message, playback, route with waypoint and arrival', async () => {
  const sim = await ready();
  const { VC } = sim;
  assert.equal(VC.call('call_contact', { contact_id: 'c_0012' }, { source: 'agent' }).state.number_type, 'mobile');
  assert.equal(VC.call('call_contact', { contact_id: 'c_0013' }, { source: 'agent' }).error_code, 'busy');
  VC.service.vstate.active_call.started_t -= 25;
  sim.tick();
  assert.equal(VC.status().active_call, null, 'call ends on its own after 20 s');
  assert.ok(VC.log.events({ type: 'effect' }).some((e) => e.effect === 'call_ended' && e.reason === 'timeout_20s'));
  assert.equal(VC.call('send_message', { contact_id: 'c_0019', text: 'Voy tarde' }, { source: 'agent' }).state.number_type, 'work');
  assert.equal(VC.status().messages, 1);
  const pl = VC.call('play_media', { item_id: 'pl_0002' }, { source: 'agent' });
  assert.equal(pl.status, 'ok');
  assert.equal(VC.call('get_playback_state', {}, { source: 'agent' }).item.item_id, 'pl_0002');

  const pois = PACK.pois.map((p) => [p, parseInt(p.location.road_node_id.slice(2), 10)]).sort((a, b) => a[1] - b[1]);
  const [wp, wpI] = pois[2];
  const [dest, destI] = pois[6];
  assert.equal(VC.call('navigate_to', { poi_id: dest.id }, { source: 'agent' }).status, 'ok');
  const r1 = VC.status().route.length_m;
  assert.equal(VC.call('add_waypoint', { poi_id: wp.id }, { source: 'agent' }).status, 'ok');
  assert.deepEqual(host(VC.status().route.waypoints), [wp.id]);
  assert.equal(VC.status().route.length_m, r1, 'waypoint on the way does not lengthen a chain route');
  sim.setVehicle(wpI, 0);
  sim.tick();
  assert.deepEqual(host(VC.status().route.waypoints), []);
  sim.setVehicle(destI, 0);
  sim.tick();
  assert.equal(VC.status().route, null);
  const fx = VC.log.events({ type: 'effect' }).map((e) => e.effect);
  for (const f of ['call_screen', 'message_banner', 'now_playing', 'route_drawn', 'route_recalculated', 'waypoint_reached', 'arrived']) assert.ok(fx.includes(f), f);
});

test('5. world consistency: every POI search_poi returns has a sign at its position; routes end there', async () => {
  const sim = await ready();
  const { VC } = sim;
  const seen = new Map();
  for (let i = 5; i <= 1400; i += 25) {
    sim.setVehicle(i, 0);
    sim.tick();
    for (const cat of ['fuel', 'pharmacy', 'cafe', 'restaurant', 'parking', 'atm']) {
      const r = VC.call('search_poi', { category: cat }, { source: 'agent' }); // default 3 km radius
      for (const c of r.candidates) {
        const signs = VC.signs.state();
        const sign = signs.find((s) => s.poi_id === c.id);
        const poi = PACK.pois.find((p) => p.id === c.id);
        if (sign) seen.set(c.id, true);
        if (sign) {
          assert.equal(sign.x, Math.round(poi.location.x * 100) / 100);
          assert.equal(sign.y, Math.round(poi.location.y * 100) / 100);
          assert.equal(sign.road_node_id, poi.location.road_node_id);
          assert.equal(sign.visible, true);
        }
        assert.ok(sign, `${c.id} (${c.distance_m} m away) has no sign`);
      }
    }
  }
  assert.ok(seen.size >= 15, 'saw signs for many POIs: ' + seen.size);
  // navigate_to ends at the POI's road node, beside its slot.
  sim.setVehicle(5, 0);
  for (const poi of PACK.pois) {
    assert.equal(VC.call('navigate_to', { poi_id: poi.id }, { source: 'agent' }).status, 'ok');
    const rv = VC.routeView();
    assert.equal('n_' + rv.stops[rv.stops.length - 1].i, poi.location.road_node_id);
    const node = GRAPH.nodes.find((n) => n.id === poi.location.road_node_id);
    const off = Math.hypot(poi.location.x - node.x, poi.location.y - node.y);
    assert.ok(Math.abs(off - (node.half_width + 9)) < 0.05, `${poi.id} sits on its slot (${off.toFixed(2)} m from the road node)`);
  }
});

test('6. field robustness: network cut + reload mid-session loses no events', async () => {
  const storage = makeStorage();
  const a = await ready({ storage }, { session_id: 'S-field' });
  a.VC.task.start(TASK('call_brother_mobile'));
  // Network is down: batches are emitted but never acknowledged.
  for (let k = 0; k < 120; k++) a.VC.call('search_contacts', { query: k % 2 ? 'Pipe' : 'Andrés' }, { source: 'agent', turn: 1 });
  a.VC.log.flush();
  const before = a.VC.log.status();
  assert.ok(before.pending >= 120);
  // Page reload while still offline: a new instance with the same storage.
  const b = createSim({ storage });
  assert.equal(b.VC.log.status().session_id, 'S-field');
  assert.equal(b.VC.log.status().pending, before.pending);
  await b.VC.load({ session: session({ session_id: 'S-field' }) });
  b.VC.task.start(TASK('call_valentina_absent'));
  b.VC.call('search_contacts', { query: 'Valentina' }, { source: 'agent', turn: 1 });
  b.VC.end({ reason: 'test end' });
  // Network back: the parent acknowledges every batch it receives.
  const received = [];
  for (let guard = 0; guard < 50 && !b.VC.log.status().complete; guard++) {
    b.VC.log.flush();
    const batch = b.emitted.filter((e) => e.ev === 'contentLogBatch').map((e) => e.p).slice(-1)[0];
    if (!batch) break;
    if (!received.some((x) => x.batch_id === batch.batch_id)) received.push(batch);
    b.VC.log.ack(batch.batch_id);
  }
  assert.equal(b.VC.log.status().complete, true);
  const seqs = received.flatMap((x) => x.events.map((e) => e.seq));
  const want = Array.from({ length: seqs.length }, (_v, k) => k + 1);
  assert.deepEqual(seqs, want, 'all events, in order, no gaps');
  const types = received.flatMap((x) => x.events.map((e) => e.type));
  assert.equal(types[0], 'session_header');
  assert.equal(types[types.length - 1], 'session_end');
  assert.ok(received[received.length - 1].final);
  const ts = received.flatMap((x) => x.events.map((e) => e.t));
  assert.ok(ts.every((t, k) => k === 0 || t >= ts[k - 1]), 'clock is monotonic across the reload');
});

test('privacy: participant-entered names reach the log as IDs only', async () => {
  const pack = JSON.parse(JSON.stringify(PACK));
  pack.contacts.push({ id: 'c_p001', display_name: 'Tía Marleny', given_name: 'Marleny', family_names: [], aliases: ['Tía Marleny'], participant_entered: true, numbers: [{ type: 'mobile', value: '+57 300 000 7001' }] });
  pack.pack_version = 2;
  const sim = createSim();
  pack.content_hash = sim.VC.computeContentHash(pack);
  const res = await sim.VC.load({ session: session({ pack_version: 2, content_hash: pack.content_hash }), pack });
  assert.equal(res.ok, true);
  const r = sim.VC.call('search_contacts', { query: 'Marleny' }, { source: 'agent' });
  assert.equal(r.candidates[0].id, 'c_p001');
  const logged = JSON.stringify(sim.VC.log.events());
  assert.ok(!/Marleny/.test(logged), 'name not in log');
  assert.ok(/\[c_p001\]/.test(logged));
});
