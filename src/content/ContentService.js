/**
 * Content runtime service (PromptDrive spec, "Runtime modules"). Sits between
 * the content pack and every client: the agent (over the PromptDrive API) and
 * the HMI screens (center console) call it; it alone owns the resolver, the
 * content-related vehicle state (call, messages, playback, route) and logging.
 *
 *   load({ session, pack?, pack_url? })   -> Promise<{ ok, header | error }>
 *   call(fn, args, { source, turn, call_id })  -> envelope (sync)
 *   taskStart(def) / currentTask() / logUtterance() / logAgentReply() / end()
 *
 * Fail closed: any pack/map/tools mismatch leaves the service in phase
 * "failed" — no tools, no tasks, no HMI content — with a session_error logged.
 */

import {
  createResolver, computeContentHash, validateToolArgs, toolSchema, labelTask,
  TOOLS_VERSION, SUPPORTED_TOOLS_VERSIONS, RESOLVER_VERSION, PACKAGE_VERSION, SOURCES,
  SYSTEM_PROMPT_VERSION, parseLocalTime, addSeconds, isOpenAt,
} from '../../packages/vehicle-content/index.js';
import { RoadGraph } from './RoadGraph.js';
import { EventLog } from './EventLog.js';
import { findContentMap, checkLiveMap, mapsPath } from './maps.js';

const CALL_MAX_S = 20; // a simulated call ends on its own after 20 s
const ARRIVAL_M = 25; // within this network distance of a stop = arrived
const MIN_ETA_SPEED = 50 / 3.6; // ETA floor speed (m/s) when stopped/slow
const MAP_WAIT_MS = 90000;
const PACK_CACHE_PREFIX = 'pd-content-pack:';
const DEFAULT_LOCAL_TIME = 'Fr 10:00';

function svcNowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ContentService {
  constructor(bridgeEmit) {
    this.emit = (ev, payload) => {
      try { if (bridgeEmit) bridgeEmit(ev, payload); } catch (_e) {}
    };
    this.road = new RoadGraph();
    this.log = new EventLog(this.emit);
    this.h = null;
    this.phase = 'idle'; // idle | loading | ready | failed | ended
    this.error = null;
    this.session = null;
    this.pack = null;
    this.resolver = null;
    this.header = null;
    this.mapEntry = null;
    this.localTime0 = parseLocalTime(DEFAULT_LOCAL_TIME);
    this.vstate = this._emptyState();
    this.task = null;
    this.tasksDone = [];
    this.actionSeq = 0;
    this.effects = null; // set by VehicleContent (UI side effects)
    this._participantNames = []; // normalized display names/aliases to redact
    this._listeners = [];
  }

  _emptyState() {
    return { active_call: null, messages: [], playback: null, route: null };
  }

  attach(h) {
    this.h = h;
    this.road.attach(h);
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  }

  _changed(what) {
    for (const fn of this._listeners) {
      try { fn(what, this); } catch (_e) {}
    }
    this.emit('contentState', { what, state: this.publicState() });
  }

  get active() {
    return this.phase === 'ready';
  }

  get locale() {
    return (this.pack && this.pack.locale) || 'en-US';
  }

  // ================================================================ loading

  async load(opts) {
    const o = opts || {};
    const s = o.session || {};
    if (this.phase === 'loading') return { ok: false, error: { code: 'busy', message: 'A pack is already loading' } };
    if (this.phase === 'ready') return { ok: false, error: { code: 'already_loaded', message: 'A pack is loaded; packs are read-only for the session. End the session first.' } };
    this.phase = 'loading';
    this.error = null;
    this.session = Object.assign({}, s);
    this._changed('phase');
    try {
      for (const k of ['session_id', 'pack_id', 'pack_version', 'content_hash', 'tools_version']) {
        if (s[k] == null || s[k] === '') return this._fail('bad_session_config', `Session configuration is missing ${k}`);
      }
      // 1-2. Fetch the pack (explicit object, URL, browser cache, or local file).
      const pack = await this._fetchPack(o, s);
      if (!pack) return this._fail('pack_unavailable', `Pack ${s.pack_id} v${s.pack_version} not found`);
      if (pack.pack_id !== s.pack_id || pack.pack_version !== s.pack_version) {
        return this._fail('pack_mismatch', `Pack ${s.pack_id} v${s.pack_version} expected, got ${pack.pack_id} v${pack.pack_version}`);
      }
      // 3. Recompute the hash with the shared canonicalization.
      const hash = computeContentHash(pack);
      if (hash !== s.content_hash || hash !== pack.content_hash) {
        return this._fail('hash_mismatch', 'Pack hash mismatch', { expected: s.content_hash, declared: pack.content_hash, computed: hash });
      }
      // 4. Tools version + map identity.
      if (SUPPORTED_TOOLS_VERSIONS.indexOf(s.tools_version) === -1) {
        return this._fail('tools_version_unsupported', `Tools version ${s.tools_version} not supported (this build: ${SUPPORTED_TOOLS_VERSIONS.join(', ')})`);
      }
      const needsMap = (pack.pois || []).length > 0 || s.map_id != null;
      if (needsMap) {
        const pm = pack.map || {};
        if (s.map_id !== pm.map_id || s.map_version !== pm.map_version) {
          return this._fail('map_mismatch', `Pack is for map ${pm.map_id} ${pm.map_version}, session expects ${s.map_id} ${s.map_version}`);
        }
        const entry = findContentMap(s.map_id, s.map_version);
        if (!entry) {
          const other = findContentMap(s.map_id);
          return this._fail('map_mismatch', other
            ? `Map version ${s.map_version} expected, this build has ${other.map_version}`
            : `Map ${s.map_id} is not available in this build`);
        }
        const graph = await this._fetchJson(mapsPath(entry, 'road-graph.json'));
        if (!graph || graph.map_id !== entry.map_id || graph.map_version !== entry.map_version) {
          return this._fail('road_graph_missing', `Road graph for ${entry.map_id} ${entry.map_version} not found`);
        }
        const live = await this._waitForMap(entry);
        if (!live.ok) return this._fail(live.code === 'map_pending' || live.code === 'map_not_loaded' ? 'map_not_loaded' : 'map_mismatch', live.message, live.detail);
        this.road.seed(graph);
        const again = checkLiveMap(entry, this.h, this.road);
        if (!again.ok) return this._fail('map_mismatch', again.message, again.detail);
        this.mapEntry = entry;
      }
      // 5. Build the resolver index once.
      this.pack = pack;
      this.resolver = createResolver(pack, { maskNumbers: s.mask_numbers !== false });
      this._participantNames = this._collectParticipantNames(pack);
      this.localTime0 = parseLocalTime(s.local_time || DEFAULT_LOCAL_TIME) || parseLocalTime(DEFAULT_LOCAL_TIME);
      this.vstate = this._emptyState();
      this.task = null;
      this.tasksDone = [];
      this._cachePack(pack);
      // 6. Session header before the first task.
      this.log.begin(s.session_id);
      this.header = {
        session_id: s.session_id,
        study_id: s.study_id || null,
        condition: s.condition || null,
        participant_pseudonym: s.participant_pseudonym || null,
        actor: s.actor || 'agent',
        model: s.model || null,
        tools_version: TOOLS_VERSION,
        resolver_version: RESOLVER_VERSION,
        synonyms_version: this.resolver.meta.synonyms_version,
        package_version: PACKAGE_VERSION,
        system_prompt_version: SYSTEM_PROMPT_VERSION,
        pack_id: pack.pack_id,
        pack_version: pack.pack_version,
        content_hash: hash,
        map_id: this.mapEntry ? this.mapEntry.map_id : null,
        map_version: this.mapEntry ? this.mapEntry.map_version : null,
        start_node: this.mapEntry ? this.mapEntry.start_node : null,
        local_time_start: s.local_time || DEFAULT_LOCAL_TIME,
        wall_clock_start: new Date().toISOString(),
        clock: 'seconds since session start (monotonic, sim)',
      };
      this.log.append('session_header', this.header);
      this.phase = 'ready';
      this._changed('phase');
      this.emit('contentSession', { phase: 'ready', header: this.header });
      return { ok: true, header: this.header };
    } catch (e) {
      return this._fail('load_failed', String((e && e.message) || e));
    }
  }

  _fail(code, message, detail) {
    this.phase = 'failed';
    this.error = { code, message, detail: detail || null };
    this.pack = null;
    this.resolver = null;
    if (this.session && this.session.session_id) {
      this.log.begin(this.session.session_id);
      this.log.append('session_error', { code, message, detail: detail || null });
    }
    this._changed('phase');
    this.emit('contentSession', { phase: 'failed', error: this.error });
    if (this.effects) this.effects.sessionError(this.error);
    return { ok: false, error: this.error };
  }

  async _fetchJson(url) {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  async _fetchPack(o, s) {
    if (o.pack && typeof o.pack === 'object') return JSON.parse(JSON.stringify(o.pack));
    const url = o.pack_url || s.pack_url || null;
    if (url) {
      const p = await this._fetchJson(url);
      if (p) return p;
    }
    const cached = this._cachedPack(s.pack_id, s.pack_version);
    if (cached) return cached;
    if (!url) return this._fetchJson(`./packages/vehicle-content/packs/${s.pack_id}.v${s.pack_version}.json`);
    return null;
  }

  // Offline use: packs can be pre-fetched into the browser; the hash check
  // still runs against the cached copy.
  _cachedPack(id, version) {
    try {
      const raw = localStorage.getItem(PACK_CACHE_PREFIX + id + '@' + version);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }

  _cachePack(pack) {
    try { localStorage.setItem(PACK_CACHE_PREFIX + pack.pack_id + '@' + pack.pack_version, JSON.stringify(pack)); } catch (_e) {}
  }

  async prefetch(list) {
    const out = [];
    for (const item of list || []) {
      const url = typeof item === 'string' ? item : item && item.url;
      const p = url ? await this._fetchJson(url) : (item && item.pack) || null;
      if (p && p.pack_id) {
        this._cachePack(p);
        out.push({ pack_id: p.pack_id, pack_version: p.pack_version, content_hash: p.content_hash, cached: true });
      } else {
        out.push({ url, cached: false });
      }
    }
    return out;
  }

  async _waitForMap(entry) {
    const t0 = svcNowMs();
    let last = null;
    while (svcNowMs() - t0 < MAP_WAIT_MS) {
      last = checkLiveMap(entry, this.h, this.road);
      if (last.ok || (last.code !== 'map_pending' && last.code !== 'map_not_loaded')) return last;
      await sleep(250);
    }
    return last || { ok: false, code: 'map_not_loaded', message: 'Map did not load in time' };
  }

  _collectParticipantNames(pack) {
    const out = [];
    for (const c of pack.contacts || []) {
      if (c.participant_entered || (c.tags || []).indexOf('participant') !== -1) {
        for (const n of [c.display_name, c.given_name].concat(c.aliases || [], c.family_names || [])) {
          if (n) out.push({ id: c.id, name: String(n) });
        }
      }
    }
    out.sort((a, b) => b.name.length - a.name.length);
    return out;
  }

  /** Privacy: participant-entered contact names never reach the log as text. */
  _redact(text) {
    if (typeof text !== 'string' || !this._participantNames.length) return text;
    let s = text;
    for (const { id, name } of this._participantNames) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(esc, 'gi'), '[' + id + ']');
    }
    return s;
  }

  // ================================================================ context

  /** Seconds since session start. */
  t() {
    return this.log.t();
  }

  localTime() {
    return addSeconds(this.localTime0, this.t());
  }

  _poiIndex(p) {
    return RoadGraph.indexOf(p && p.location && p.location.road_node_id);
  }

  _vehicleArc() {
    const v = this.road.vehiclePosition();
    return v && v.arc != null ? v.arc : null;
  }

  /** Arc positions of the remaining stops (waypoints then destination). */
  _routeStops() {
    const r = this.vstate.route;
    if (!r) return [];
    return r.waypoints.map((w) => w.poi_id).concat([r.destination_poi_id]).map((id) => {
      const p = this.resolver.poiEntry(id);
      const i = this._poiIndex(p);
      return { poi_id: id, i, arc: i == null ? null : this.road.arcOf(i) };
    });
  }

  _ctx() {
    const route = this.vstate.route;
    const vArc = this._vehicleArc();
    const stops = this._routeStops();
    const dest = stops.length ? stops[stops.length - 1] : null;
    const arcs = stops.map((s) => s.arc).filter((a) => a != null);
    const lo = vArc == null ? null : Math.min(vArc, ...arcs);
    const hi = vArc == null ? null : Math.max(vArc, ...arcs);
    const arcOfPoi = (p) => {
      const i = this._poiIndex(p);
      return i == null ? null : this.road.arcOf(i);
    };
    return {
      now: this.localTime(),
      routeActive: !!route,
      distanceTo: (p) => {
        const a = arcOfPoi(p);
        return a == null || vArc == null ? null : Math.abs(a - vArc);
      },
      routeCorridorDistance: (p) => {
        const a = arcOfPoi(p);
        if (a == null || lo == null) return null;
        return a < lo ? lo - a : a > hi ? a - hi : 0;
      },
      destinationDistance: (p) => {
        const a = arcOfPoi(p);
        return a == null || !dest || dest.arc == null ? null : Math.abs(a - dest.arc);
      },
      _replay: {
        vehicle_arc_m: vArc == null ? null : Math.round(vArc * 100) / 100,
        route_stops: stops.map((s) => s.poi_id),
        local_time: this.localTime(),
      },
    };
  }

  vehicleState() {
    const h = this.h;
    const v = this.road.vehiclePosition();
    let speed = 0;
    let automated = false;
    try { speed = h && h.ego ? +h.ego.speed || 0 : 0; } catch (_e) {}
    try { automated = !!(h && h.autodrive && h.autodrive.value); } catch (_e) {}
    return {
      speed_kmh: Math.round(Math.abs(speed) * 3.6 * 10) / 10,
      driving_mode: automated ? 'automated' : 'manual',
      route_active: !!this.vstate.route,
      road_node_id: v ? v.road_node_id : null,
      x: v ? Math.round(v.x * 100) / 100 : null,
      y: v ? Math.round(v.y * 100) / 100 : null,
    };
  }

  // ================================================================ calls

  /**
   * Execute one vehicle-tools call. `meta.source` is agent | hmi_touch |
   * hmi_voice; `meta.turn` groups parallel calls of one model turn.
   * Never throws: invalid input returns status "invalid_argument".
   */
  call(fn, args, meta) {
    const m = meta || {};
    const source = SOURCES.indexOf(m.source) !== -1 ? m.source : 'agent';
    const t0 = svcNowMs();
    const a = args == null ? {} : args;
    if (this.phase !== 'ready') {
      return { status: 'error', error_code: 'unsupported', message: this.phase === 'failed' ? 'Session stopped: ' + this.error.message : 'No content pack loaded' };
    }
    if (m.turn != null && this.task) this._checkTurnLimit(m.turn);

    const taskId = this.task ? this.task.task_id : null; // end_task closes it during exec
    const schema = toolSchema(fn);
    let result;
    let problems = schema ? validateToolArgs(fn, a) : ['unknown function: ' + fn];
    // HMI browse mode: an empty query is allowed for list screens only.
    const hmi = source !== 'agent';
    if (hmi && problems.length && (fn === 'search_contacts' || fn === 'search_media' || fn === 'search_poi')) {
      const relaxed = Object.assign({}, a);
      delete relaxed.offset;
      delete relaxed.sort;
      if (relaxed.query == null || relaxed.query === '') relaxed.query = 'x';
      problems = validateToolArgs(fn, relaxed);
    }
    if (problems.length) {
      result = schema && schema.kind !== 'lookup'
        ? { status: 'error', action_id: null, error_code: 'invalid_argument', message: problems.join('; ') }
        : { status: 'invalid_argument', candidates: [], total_matches: 0, message: problems.join('; ') };
      if (fn === 'get_contact' || fn === 'get_poi' || fn === 'get_playback_state') result = { status: 'invalid_argument', message: problems.join('; ') };
    } else {
      try {
        result = this._exec(fn, a, source);
      } catch (e) {
        result = { status: 'error', error_code: 'unsupported', message: String((e && e.message) || e) };
      }
    }
    const latency = Math.round((svcNowMs() - t0) * 1000) / 1000;
    this._record(fn, a, source, m, result, latency, taskId);
    return result;
  }

  _exec(fn, a, source) {
    const r = this.resolver;
    switch (fn) {
      case 'search_contacts':
        return r.searchContacts(a);
      case 'get_contact':
        return r.getContact(a.contact_id);
      case 'search_media':
        return r.searchMedia(a);
      case 'get_playback_state':
        return { status: 'ok', item: this._playbackItem() };
      case 'search_poi': {
        const ctx = this._ctx();
        this._lastCtx = ctx._replay;
        return r.searchPoi(Object.assign({}, a, { _browse: source !== 'agent' }), ctx);
      }
      case 'get_poi': {
        const ctx = this._ctx();
        this._lastCtx = ctx._replay;
        return r.getPoi(a.poi_id, ctx);
      }
      case 'call_contact':
        return this._callContact(a);
      case 'send_message':
        return this._sendMessage(a);
      case 'play_media':
        return this._playMedia(a);
      case 'navigate_to':
        return this._navigateTo(a);
      case 'add_waypoint':
        return this._addWaypoint(a);
      case 'end_task':
        return this._endTaskCall(a);
      default:
        return { status: 'invalid_argument', message: 'unknown function: ' + fn };
    }
  }

  _actionId() {
    return 'a_' + String(++this.actionSeq).padStart(4, '0');
  }

  _actErr(code, message) {
    return { status: 'error', action_id: this._actionId(), error_code: code, message };
  }

  _pickNumber(contact, type, preferMobile) {
    const nums = contact.numbers || [];
    if (type) return nums.find((n) => n.type === type) || null;
    if (preferMobile) {
      const mob = nums.find((n) => n.type === 'mobile');
      if (mob) return mob;
    }
    return nums.find((n) => n.default) || nums[0] || null;
  }

  _callContact(a) {
    const c = this.resolver.contactEntry(a.contact_id);
    if (!c) return this._actErr('unknown_id', 'No contact with that ID');
    if (this.vstate.active_call) return this._actErr('busy', 'A call is already active');
    const num = this._pickNumber(c, a.number_type, false);
    if (!num) return this._actErr('no_number_of_type', a.number_type ? `Contact has no ${a.number_type} number` : 'Contact has no phone number');
    const action_id = this._actionId();
    this.vstate.active_call = { contact_id: c.id, number_type: num.type, started_t: this.t(), action_id };
    this._effect('call_screen', action_id, { contact_id: c.id, number_type: num.type });
    if (this.effects) this.effects.startCall(c, num, this.locale);
    this._changed('call');
    return { status: 'ok', action_id, state: { call: 'started', contact_id: c.id, display_name: c.display_name, number_type: num.type } };
  }

  /** Driver hangs up (phone UI) or the 20 s limit passes. */
  hangUp(reason) {
    const call = this.vstate.active_call;
    if (!call) return false;
    this.vstate.active_call = null;
    this._effect('call_ended', call.action_id, { reason: reason || 'driver', duration_s: Math.round((this.t() - call.started_t) * 10) / 10 });
    if (this.effects) this.effects.endCall();
    this._changed('call');
    return true;
  }

  _sendMessage(a) {
    const c = this.resolver.contactEntry(a.contact_id);
    if (!c) return this._actErr('unknown_id', 'No contact with that ID');
    const num = this._pickNumber(c, a.number_type, true);
    if (!num) return this._actErr('no_number_of_type', a.number_type ? `Contact has no ${a.number_type} number` : 'Contact has no phone number');
    const action_id = this._actionId();
    this.vstate.messages.push({ contact_id: c.id, number_type: num.type, text: a.text, t: this.t(), action_id });
    this._effect('message_banner', action_id, { contact_id: c.id });
    if (this.effects) this.effects.messageSent(c, this.locale);
    this._changed('messages');
    return { status: 'ok', action_id, state: { message: 'sent', contact_id: c.id, display_name: c.display_name, number_type: num.type } };
  }

  _playMedia(a) {
    const item = this.resolver.mediaEntry(a.item_id);
    if (!item) return this._actErr('unknown_id', 'No media item with that ID');
    const shuffle = !!(a.options && a.options.shuffle);
    let queue = this.resolver.playableTracks(item.id);
    if ((item.type === 'artist' || item.type === 'album' || item.type === 'playlist') && !queue.length) {
      return this._actErr('unsupported', 'Nothing playable in that item');
    }
    if (shuffle && queue.length > 1) {
      // Deterministic shuffle seeded by the item and action sequence.
      let seed = 0;
      for (const ch of item.id + ':' + this.actionSeq) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      queue = queue.slice();
      for (let i = queue.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const j = seed % (i + 1);
        const tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp;
      }
    }
    const action_id = this._actionId();
    const current = queue.length ? queue[0] : item.id;
    this.vstate.playback = { item_id: item.id, type: item.type, started_t: this.t(), shuffle, queue, current_id: current, action_id };
    this._effect('now_playing', action_id, { item_id: item.id, item_type: item.type });
    if (this.effects) this.effects.playMedia(this._nowPlayingView());
    this._changed('playback');
    const view = this._nowPlayingView();
    return { status: 'ok', action_id, state: { playing: true, item_id: item.id, type: item.type, display_name: item.display_name, now_playing: view.title, artist_names: view.artists, shuffle } };
  }

  stopPlayback(reason) {
    const p = this.vstate.playback;
    if (!p) return false;
    this.vstate.playback = null;
    this._effect('playback_stopped', p.action_id, { reason: reason || 'driver' });
    if (this.effects) this.effects.stopMedia();
    this._changed('playback');
    return true;
  }

  _nowPlayingView() {
    const p = this.vstate.playback;
    if (!p) return null;
    const cur = this.resolver.mediaEntry(p.current_id) || this.resolver.mediaEntry(p.item_id);
    const parent = this.resolver.mediaEntry(p.item_id);
    const artists = (cur && cur.artist_ids ? cur.artist_ids : []).map((id) => {
      const e = this.resolver.mediaEntry(id);
      return e ? e.display_name : null;
    }).filter(Boolean);
    let subtitle = artists.join(', ');
    if (!subtitle && cur && cur.type === 'station') subtitle = [cur.band, cur.frequency].filter(Boolean).join(' ');
    if (!subtitle && cur && cur.type === 'podcast') subtitle = (cur.episode_titles || [])[0] || '';
    return {
      item_id: p.item_id,
      type: p.type,
      title: cur ? cur.display_name : '',
      artists,
      subtitle,
      context: parent && parent.id !== (cur && cur.id) ? parent.display_name : null,
      shuffle: p.shuffle,
    };
  }

  _playbackItem() {
    const p = this.vstate.playback;
    if (!p) return { playing: false };
    const v = this._nowPlayingView();
    return {
      playing: true,
      item_id: p.item_id,
      type: p.type,
      current_track_id: p.type === 'station' || p.type === 'podcast' ? null : p.current_id,
      display_name: v.title,
      artist_names: v.artists,
      shuffle: p.shuffle,
      started_t: p.started_t,
    };
  }

  _routeSummary() {
    const r = this.vstate.route;
    if (!r) return null;
    const vArc = this._vehicleArc();
    const stops = this._routeStops();
    let length = 0;
    let prev = vArc;
    for (const s of stops) {
      if (prev == null || s.arc == null) { length = null; break; }
      length += Math.abs(s.arc - prev);
      prev = s.arc;
    }
    let speed = 0;
    try { speed = Math.abs(+this.h.ego.speed || 0); } catch (_e) {}
    const eta = length == null ? null : Math.round(length / Math.max(speed, MIN_ETA_SPEED));
    return {
      destination_poi_id: r.destination_poi_id,
      waypoints: r.waypoints.map((w) => w.poi_id),
      length_m: length == null ? null : Math.round(length),
      eta_s: eta,
    };
  }

  _navigateTo(a) {
    const p = this.resolver.poiEntry(a.poi_id);
    if (!p) return this._actErr('unknown_id', 'No place with that ID');
    const i = this._poiIndex(p);
    if (i == null || this.road.arcOf(i) == null) return this._actErr('unsupported', 'Place is not on the loaded road network');
    const action_id = this._actionId();
    this.vstate.route = { destination_poi_id: p.id, waypoints: [], started_t: this.t(), action_id };
    const sum = this._routeSummary();
    Object.assign(this.vstate.route, { length_m: sum.length_m, eta_s: sum.eta_s });
    this._effect('route_drawn', action_id, { destination_poi_id: p.id, length_m: sum.length_m, eta_s: sum.eta_s });
    if (this.effects) this.effects.routeChanged(this.routeView());
    this._changed('route');
    return { status: 'ok', action_id, state: Object.assign({ route: 'started', display_name: p.display_name }, sum) };
  }

  _addWaypoint(a) {
    if (!this.vstate.route) return this._actErr('no_route', 'No route active');
    const p = this.resolver.poiEntry(a.poi_id);
    if (!p) return this._actErr('unknown_id', 'No place with that ID');
    const i = this._poiIndex(p);
    if (i == null || this.road.arcOf(i) == null) return this._actErr('unsupported', 'Place is not on the loaded road network');
    const action_id = this._actionId();
    this.vstate.route.waypoints.push({ poi_id: p.id, action_id });
    const sum = this._routeSummary();
    Object.assign(this.vstate.route, { length_m: sum.length_m, eta_s: sum.eta_s });
    this._effect('route_recalculated', action_id, { waypoint_poi_id: p.id, length_m: sum.length_m, eta_s: sum.eta_s });
    if (this.effects) this.effects.routeChanged(this.routeView());
    this._changed('route');
    return { status: 'ok', action_id, state: Object.assign({ route: 'updated', waypoint: p.display_name }, sum) };
  }

  cancelRoute(reason) {
    const r = this.vstate.route;
    if (!r) return false;
    this.vstate.route = null;
    this._effect('route_cleared', r.action_id, { reason: reason || 'driver' });
    if (this.effects) this.effects.routeChanged(null);
    this._changed('route');
    return true;
  }

  routeView() {
    const r = this.vstate.route;
    if (!r || !this.resolver) return null;
    const sum = this._routeSummary();
    const stops = this._routeStops().map((s) => {
      const p = this.resolver.poiEntry(s.poi_id);
      return { poi_id: s.poi_id, i: s.i, display_name: p ? p.display_name : s.poi_id, category: p ? p.category : null, x: p ? p.location.x : null, y: p ? p.location.y : null };
    });
    return Object.assign({ stops }, sum);
  }

  _endTaskCall(a) {
    const action_id = this._actionId();
    const task = this.task;
    if (!task) return { status: 'ok', action_id, state: { task_id: null, outcome: a.outcome, note: 'no task active' } };
    this._closeTask({ outcome: a.outcome, reason: a.reason || null, ended_by: 'end_task', action_id });
    return { status: 'ok', action_id, state: { task_id: task.task_id, outcome: a.outcome } };
  }

  _effect(effect, action_id, extra) {
    this.log.append('effect', Object.assign({ task_id: this.task ? this.task.task_id : null, effect, action_id: action_id || null }, extra || {}));
  }

  _record(fn, args, source, meta, result, latency, taskId) {
    const rec = {
      task_id: taskId !== undefined ? taskId : this.task ? this.task.task_id : null,
      turn: meta.turn == null ? null : meta.turn,
      call_id: meta.call_id || null,
      fn,
      args: this._redactArgs(args),
      source,
      status: result.status,
      latency_ms: latency,
      vehicle_state: this.vehicleState(),
    };
    // HMI list screens browse with an empty query; flag them so parity
    // analysis can separate UI browsing from lookups.
    if (source !== 'agent' && /^search_/.test(fn) && !(args && args.query) && !(args && args.category)) rec.browse = true;
    if (result.candidates) {
      rec.candidates = result.candidates.map((c) => ({ id: c.id, score: c.score, matched_on: c.matched_on }));
      rec.total_matches = result.total_matches;
    }
    if (result.suggestions) rec.suggestions = result.suggestions.map((c) => ({ id: c.id, score: c.score }));
    if (result.item && result.item.id) rec.item_id = result.item.id;
    if (result.action_id) rec.action_id = result.action_id;
    if (result.error_code) rec.error_code = result.error_code;
    if (result.message && result.status !== 'ok') rec.message = result.message;
    if (result.state) rec.state = this._logState(result.state);
    if (fn === 'search_poi' || fn === 'get_poi') rec.ctx = this._lastCtx || null;
    const stored = this.log.append('call', rec);
    if (this.task) this.task.calls.push(stored);
    this.emit('contentCall', stored);
  }

  _redactArgs(args) {
    const out = {};
    for (const k of Object.keys(args || {})) {
      const v = args[k];
      out[k] = typeof v === 'string' ? this._redact(v) : v;
    }
    return out;
  }

  /** Keep IDs and numbers, drop display text (names live in the pack). */
  _logState(state) {
    const out = {};
    for (const k of Object.keys(state)) {
      if (k === 'display_name' || k === 'now_playing' || k === 'artist_names' || k === 'waypoint') continue;
      out[k] = state[k];
    }
    return out;
  }

  // ================================================================ tasks

  taskStart(def) {
    if (this.phase !== 'ready') return { ok: false, error: { code: 'not_ready', message: this.error ? this.error.message : 'No content pack loaded' } };
    const d = def || {};
    if (!d.task_id) return { ok: false, error: { code: 'bad_value', message: 'task_id is required' } };
    if (this.task) this._closeTask({ outcome: 'timeout', reason: 'next task started', ended_by: 'next_task' });
    const limits = Object.assign({}, d.limits || {});
    this.task = {
      task_id: d.task_id,
      prompt_for_driver: d.prompt_for_driver || null,
      condition: d.condition || (this.session && this.session.condition) || null,
      condition_type: d.condition_type || null,
      expected: d.expected || null,
      tolerance: d.tolerance || null,
      limits,
      started_t: this.t(),
      started_ms: svcNowMs(),
      max_turn: 0,
      calls: [],
    };
    this.log.append('task_start', {
      task_id: d.task_id,
      prompt_for_driver: d.prompt_for_driver || null,
      condition: this.task.condition,
      limits,
    });
    this._changed('task');
    return { ok: true, task_id: d.task_id, t: this.task.started_t };
  }

  /** Experimenter/harness ends a task without end_task (e.g. driver gave up). */
  taskEnd(opts) {
    if (!this.task) return { ok: false, error: { code: 'no_task', message: 'No task active' } };
    const o = opts || {};
    return { ok: true, value: this._closeTask({ outcome: o.outcome || 'timeout', reason: o.reason || null, ended_by: o.ended_by || 'timeout' }) };
  }

  _checkTurnLimit(turn) {
    const task = this.task;
    if (!task) return;
    task.max_turn = Math.max(task.max_turn, turn);
    if (task.limits.max_turns != null && turn > task.limits.max_turns) {
      this._closeTask({ outcome: 'timeout', reason: `turn limit ${task.limits.max_turns} reached`, ended_by: 'timeout' });
    }
  }

  _closeTask(end) {
    const task = this.task;
    if (!task) return null;
    this.task = null;
    const rec = {
      task_id: task.task_id,
      outcome: end.outcome,
      reason: end.reason || null,
      ended_by: end.ended_by,
      duration_s: Math.round((this.t() - task.started_t) * 1000) / 1000,
    };
    if (end.action_id) rec.action_id = end.action_id;
    if (task.expected) {
      try {
        const lab = labelTask({ task, calls: task.calls, end: rec, pack: this.pack });
        rec.label = lab.label;
        rec.label_detail = lab.detail;
      } catch (_e) {
        rec.label = null;
      }
    }
    this.log.append('task_end', rec);
    this.tasksDone.push(rec);
    this._changed('task');
    this.emit('contentTaskEnd', rec);
    return rec;
  }

  currentTask() {
    const t = this.task;
    if (!t) return null;
    return { task_id: t.task_id, prompt_for_driver: t.prompt_for_driver, condition: t.condition, limits: t.limits, started_t: t.started_t, calls: t.calls.length, max_turn: t.max_turn };
  }

  // ================================================================ transcript

  logUtterance(u) {
    if (!this.log.sessionId) return { ok: false, error: { code: 'no_session' } };
    const x = u || {};
    if (x.turn != null && this.task) this._checkTurnLimit(x.turn);
    const rec = this.log.append('driver_utterance', {
      task_id: this.task ? this.task.task_id : null,
      text: x.text == null ? null : String(x.text),
      turn: x.turn == null ? null : x.turn,
      asr_confidence: x.asr_confidence == null ? null : x.asr_confidence,
    });
    return { ok: true, value: { seq: rec.seq, t: rec.t } };
  }

  logAgentReply(r) {
    if (!this.log.sessionId) return { ok: false, error: { code: 'no_session' } };
    const x = r || {};
    const rec = this.log.append('agent_reply', {
      task_id: this.task ? this.task.task_id : null,
      text: x.text == null ? null : String(x.text),
      turn: x.turn == null ? null : x.turn,
      model: x.model || (this.session && this.session.model) || null,
      tokens: x.tokens || null,
    });
    return { ok: true, value: { seq: rec.seq, t: rec.t } };
  }

  /** Adapter failures etc. reported by the agent loop. */
  logError(code, message) {
    if (!this.log.sessionId) return { ok: false, error: { code: 'no_session' } };
    this.log.append('session_error', { code: code || 'adapter_failure', message: message || null });
    return { ok: true };
  }

  // ================================================================ lifecycle

  end(opts) {
    if (this.task) this._closeTask({ outcome: 'timeout', reason: 'session ended', ended_by: 'timeout' });
    if (this.vstate.active_call) this.hangUp('session_end');
    if (this.vstate.playback) this.stopPlayback('session_end');
    if (this.log.sessionId) {
      this.log.append('session_end', { reason: (opts && opts.reason) || null, tasks: this.tasksDone.length });
      this.log.finish();
    }
    this.phase = this.phase === 'failed' ? 'failed' : 'ended';
    this._changed('phase');
    this.emit('contentSession', { phase: this.phase });
    return { ok: true, value: this.log.status() };
  }

  /** Per-frame upkeep (engine seam): road recorder, timers, arrivals. */
  tick(nowMs) {
    this.road.poll(nowMs);
    if (this.phase !== 'ready') return;
    const call = this.vstate.active_call;
    if (call && this.t() - call.started_t >= CALL_MAX_S) this.hangUp('timeout_20s');
    const task = this.task;
    if (task && task.limits.max_seconds != null && (svcNowMs() - task.started_ms) / 1000 >= task.limits.max_seconds) {
      this._closeTask({ outcome: 'timeout', reason: `time limit ${task.limits.max_seconds}s reached`, ended_by: 'timeout' });
    }
    const route = this.vstate.route;
    if (route) {
      const vArc = this._vehicleArc();
      if (vArc != null) {
        const stops = this._routeStops();
        const first = stops[0];
        if (first && first.arc != null && Math.abs(first.arc - vArc) <= ARRIVAL_M) {
          if (stops.length > 1) {
            const wp = route.waypoints.shift();
            this._effect('waypoint_reached', wp.action_id, { poi_id: wp.poi_id });
            if (this.effects) this.effects.routeChanged(this.routeView());
            this._changed('route');
          } else {
            this.vstate.route = null;
            this._effect('arrived', route.action_id, { poi_id: route.destination_poi_id });
            if (this.effects) this.effects.routeChanged(null, 'arrived');
            this._changed('route');
          }
        }
      }
    }
  }

  // ================================================================ views

  publicState() {
    return {
      phase: this.phase,
      error: this.error,
      pack: this.pack ? { pack_id: this.pack.pack_id, pack_version: this.pack.pack_version, content_hash: this.pack.content_hash, locale: this.pack.locale } : null,
      map: this.mapEntry ? { map_id: this.mapEntry.map_id, map_version: this.mapEntry.map_version } : null,
      t: this.t(),
      local_time: this.phase === 'ready' ? this.localTime() : null,
      active_call: this.vstate.active_call ? Object.assign({}, this.vstate.active_call) : null,
      messages: this.vstate.messages.length,
      playback: this.vstate.playback ? this._playbackItem() : null,
      route: this.phase === 'ready' ? this._routeSummary() : null,
      task: this.currentTask(),
      log: this.log.status(),
    };
  }

  /** Is a POI open right now (HMI display helper)? */
  openNow(p) {
    return isOpenAt(p && p.opening_hours, this.localTime());
  }
}
