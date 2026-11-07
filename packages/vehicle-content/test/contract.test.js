// Hashing, tool schemas + provider drift, argument validation, hours,
// pack validation, starter pack and failure labeler.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sha256Hex, canonicalJson, computeContentHash, verifyContentHash, TOOL_SCHEMAS, TOOL_NAMES,
  toOpenAITools, toGeminiDeclarations, validateToolArgs, isOpenAt, validatePack, labelTask, createResolver,
} from '../index.js';
import { generatedFiles } from '../scripts/gen-provider-tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const repo = path.join(root, '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const starter = readJson(path.join(root, 'packs', 'es-CO-starter.v1.json'));
const tasks = readJson(path.join(root, 'packs', 'es-CO-starter.tasks.json')).tasks;
const graph = readJson(path.join(repo, 'maps', 'synth-town-01', '2026.11', 'road-graph.json'));

test('sha256 test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  assert.equal(sha256Hex('Rodríguez Müller ß ✓'), sha256Hex('Rodríguez Müller ß ✓'));
});

test('canonical JSON sorts keys and excludes content_hash/created_at from the hash', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  const p = { pack_id: 'x', created_at: 'now', content_hash: 'y', z: 1 };
  assert.equal(computeContentHash(p), computeContentHash({ z: 1, pack_id: 'x', created_at: 'later' }));
});

test('starter pack: hash verifies; one changed character breaks it', () => {
  assert.equal(verifyContentHash(starter).ok, true);
  const tampered = JSON.parse(JSON.stringify(starter));
  tampered.contacts[0].aliases[0] = 'Pipa';
  assert.equal(verifyContentHash(tampered).ok, false);
});

test('exactly 12 functions with the frozen names', () => {
  assert.deepEqual(TOOL_NAMES, ['search_contacts', 'get_contact', 'call_contact', 'send_message', 'search_media', 'play_media', 'get_playback_state', 'search_poi', 'get_poi', 'navigate_to', 'add_waypoint', 'end_task']);
});

test('provider adapters keep names/params/descriptions and match the committed files (drift test)', () => {
  const oa = toOpenAITools();
  const ge = toGeminiDeclarations();
  TOOL_SCHEMAS.forEach((t, k) => {
    assert.equal(oa[k].function.name, t.name);
    assert.equal(oa[k].function.description, t.description);
    assert.deepEqual(Object.keys(oa[k].function.parameters.properties || {}), Object.keys(t.parameters.properties || {}));
    assert.equal(ge[k].name, t.name);
    assert.equal(ge[k].description, t.description);
    assert.deepEqual(Object.keys((ge[k].parameters || {}).properties || {}), Object.keys(t.parameters.properties || {}));
  });
  for (const [name, text] of Object.entries(generatedFiles())) {
    const cur = fs.readFileSync(path.join(root, 'generated', name), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(cur, text, `generated/${name} drifted from the shared schema (npm run gen:tools)`);
  }
});

test('argument validation returns problems instead of throwing', () => {
  assert.deepEqual(validateToolArgs('search_contacts', { query: 'Pipe' }), []);
  assert.ok(validateToolArgs('search_contacts', {}).length);
  assert.ok(validateToolArgs('search_contacts', { query: '' }).length);
  assert.ok(validateToolArgs('search_contacts', { query: 'x', limit: 11 }).length);
  assert.ok(validateToolArgs('call_contact', { contact_id: 'c', number_type: 'fax' }).length);
  assert.ok(validateToolArgs('search_poi', { radius_m: 10 }).length);
  assert.deepEqual(validateToolArgs('search_poi', { category: 'fuel' }), []);
  assert.ok(validateToolArgs('end_task', { outcome: 'done' }).length);
  assert.ok(validateToolArgs('nope', {}).length);
});

test('opening hours', () => {
  const fri10 = { day: 'Fr', minutes: 600 };
  assert.equal(isOpenAt('24/7', fri10), true);
  assert.equal(isOpenAt('Mo-Fr 08:00-18:00', fri10), true);
  assert.equal(isOpenAt('Mo-Fr 08:00-18:00; Sa off', { day: 'Sa', minutes: 600 }), false);
  assert.equal(isOpenAt('Mo-Su 18:00-02:00', { day: 'Sa', minutes: 60 }), true);
  assert.equal(isOpenAt('Mo-Su 18:00-02:00', fri10), false);
  assert.equal(isOpenAt(undefined, fri10), null);
});

test('starter pack validates against the road graph (nodes + reachability) with no warnings', () => {
  const start = parseInt(graph.start_node.slice(2), 10);
  const g = Object.assign({}, graph, { reachable_from_start: graph.nodes.filter((n) => n.i >= start).map((n) => n.id) });
  const v = validatePack(starter, { roadGraph: g, tasks });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.equal(starter.contacts.length, 60);
  assert.equal(starter.media.tracks.length, 150);
  assert.equal(starter.media.artists.length, 30);
  assert.equal(starter.media.playlists.length, 8);
  assert.equal(starter.media.stations.length, 10);
  assert.equal(starter.pois.length, 40);
});

test('validation blocks broken packs', () => {
  const bad = JSON.parse(JSON.stringify(starter));
  bad.pois[0].location.road_node_id = 'n_999999';
  bad.media.tracks[0].artist_ids = ['a_missing'];
  bad.contacts[1].id = bad.contacts[0].id;
  bad.content_hash = computeContentHash(bad);
  const codes = validatePack(bad, { roadGraph: graph }).errors.map((e) => e.code);
  assert.ok(codes.includes('duplicate_id'));
  const fixedDup = JSON.parse(JSON.stringify(bad));
  fixedDup.contacts[1].id = 'c_9999';
  fixedDup.content_hash = computeContentHash(fixedDup);
  const codes2 = validatePack(fixedDup, { roadGraph: graph }).errors.map((e) => e.code);
  assert.ok(codes2.includes('bad_road_node'));
  assert.ok(codes2.includes('bad_ref'));
  // A designed condition that no longer holds blocks the pack.
  const broken = JSON.parse(JSON.stringify(starter));
  broken.contacts.push({ id: 'c_9000', display_name: 'Valentina Gil', given_name: 'Valentina', family_names: ['Gil'], numbers: [{ type: 'mobile', value: '+57 300 000 9000' }] });
  broken.content_hash = computeContentHash(broken);
  assert.ok(validatePack(broken).errors.some((e) => e.code === 'designed_condition'));
});

test('designed conditions resolve as declared (reference tasks)', () => {
  const r = createResolver(starter);
  assert.equal(r.searchContacts({ query: 'Valentina' }).status, 'not_found');
  const amb = r.searchContacts({ query: 'Andrés' });
  assert.equal(amb.status, 'ambiguous');
  assert.deepEqual(amb.candidates.map((c) => c.id).sort(), ['c_0016', 'c_0017']);
  const boss = r.searchContacts({ query: 'mi jefa' });
  assert.equal(boss.candidates[0].id, 'c_0019');
  assert.deepEqual(boss.candidates[0].number_types, ['work']);
  const nm = r.searchContacts({ query: 'Camila' });
  assert.equal(nm.candidates.concat(nm.suggestions || [])[0].id, 'c_0018');
  assert.deepEqual(r.searchContacts({ query: 'Pipe' }).candidates.map((c) => c.id), ['c_0012']);
});

// ------------------------------------------------------------- labeler
const call = (fn, args, status, extra) => Object.assign({ fn, args, status }, extra || {});
const task = (k) => tasks.find((t) => t.task_id === k);
const endBy = (outcome) => ({ outcome, ended_by: 'end_task' });

test('labeler: success / false_completion / grounding / query / intent / execution / timeout', () => {
  const t = task('call_brother_mobile');
  const found = call('search_contacts', { query: 'Pipe' }, 'ok', { candidates: [{ id: 'c_0012' }] });
  const ok = call('call_contact', { contact_id: 'c_0012', number_type: 'mobile' }, 'ok', { state: { number_type: 'mobile' } });
  assert.equal(labelTask({ task: t, calls: [found, ok], end: endBy('completed'), pack: starter }).label, 'success');
  // number_type omitted but the default (mobile) was used -> still success
  const okDefault = call('call_contact', { contact_id: 'c_0012' }, 'ok', { state: { number_type: 'mobile' } });
  assert.equal(labelTask({ task: t, calls: [found, okDefault], end: endBy('completed'), pack: starter }).label, 'success');
  assert.equal(labelTask({ task: t, calls: [found], end: endBy('completed'), pack: starter }).label, 'false_completion');
  const wrongFound = call('search_contacts', { query: 'Felipe' }, 'ambiguous', { candidates: [{ id: 'c_0012' }, { id: 'c_0022' }] });
  assert.equal(labelTask({ task: t, calls: [wrongFound, call('call_contact', { contact_id: 'c_0022' }, 'ok')], end: endBy('completed'), pack: starter }).label, 'grounding_error');
  const miss = call('search_contacts', { query: 'brother Pipe Felipe xyz' }, 'not_found', { candidates: [] });
  assert.equal(labelTask({ task: t, calls: [miss], end: endBy('not_possible'), pack: starter }).label, 'query_error');
  assert.equal(labelTask({ task: t, calls: [call('navigate_to', { poi_id: 'p_0101' }, 'ok')], end: endBy('completed'), pack: starter }).label, 'intent_error');
  const fail = call('call_contact', { contact_id: 'c_0012', number_type: 'home' }, 'error', { error_code: 'no_number_of_type' });
  assert.equal(labelTask({ task: t, calls: [found, fail], end: endBy('needs_user'), pack: starter }).label, 'execution_error');
  assert.equal(labelTask({ task: t, calls: [found], end: { outcome: 'timeout', ended_by: 'timeout' }, pack: starter }).label, 'timeout');
});

test('labeler: designed absence handled / mishandled', () => {
  const t = task('call_valentina_absent');
  const nf = call('search_contacts', { query: 'Valentina' }, 'not_found', { candidates: [] });
  assert.equal(labelTask({ task: t, calls: [nf], end: endBy('not_possible'), pack: starter }).label, 'content_absence_handled');
  assert.equal(labelTask({ task: t, calls: [nf, call('call_contact', { contact_id: 'c_0018' }, 'ok')], end: endBy('completed'), pack: starter }).label, 'content_absence_mishandled');
  assert.equal(labelTask({ task: t, calls: [nf], end: endBy('completed'), pack: starter }).label, 'content_absence_mishandled');
  const mt = task('call_boss_mobile_missing');
  assert.equal(labelTask({ task: mt, calls: [], end: endBy('needs_user'), pack: starter }).label, 'success');
});
