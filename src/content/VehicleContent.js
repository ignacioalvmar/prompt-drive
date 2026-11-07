/**
 * Public facade of the content layer, exposed as `window.VehicleContent`
 * (and through the integration API as `PromptDrive.content.*`).
 *
 * Follows the subsystem contract: the facade owns intent + validation; the
 * runtime reads the engine through the bridge handles once they attach; live
 * state is published back (contentState / contentCall / contentEvent events).
 *
 * It needs no engine patch: road state, ego, world container and THREE are
 * already on PromptDriveBridge.handles, and per-frame upkeep (road recorder,
 * timers, POI signs) runs on its own requestAnimationFrame loop.
 */

import {
  toolDefinitions, SYSTEM_PROMPT_BLOCK, SYSTEM_PROMPT_VERSION, TOOLS_VERSION, TOOL_NAMES,
  validatePack, computeContentHash, PACKAGE_VERSION,
} from '../../packages/vehicle-content/index.js';
import { ContentService } from './ContentService.js';
import { ContentEffects, contentStrings, hueOf } from './effects.js';
import { PoiSigns, CATEGORY_STYLE } from './PoiSigns.js';
import { CONTENT_MAPS, findContentMap, identifyLiveMap, checkLiveMap } from './maps.js';

const vcEmit = (ev, payload) => {
  try {
    if (typeof window !== 'undefined' && window.PromptDriveBridge) window.PromptDriveBridge.emit(ev, payload);
  } catch (_e) {}
};

const contentService = new ContentService(vcEmit);
const contentEffects = new ContentEffects();
contentService.effects = contentEffects;
const poiSigns = new PoiSigns(contentService);

function vcOk(value) {
  return { ok: true, value };
}
function vcErr(error, message) {
  return { ok: false, error, message };
}

const VehicleContent = {
  version: PACKAGE_VERSION,
  toolsVersion: TOOLS_VERSION,
  service: contentService,
  effects: contentEffects,
  signs: poiSigns,
  strings: contentStrings,
  hueOf,
  categoryStyle: CATEGORY_STYLE,

  get active() {
    return contentService.active;
  },

  // ---------------------------------------------------------------- session
  load: (opts) => contentService.load(opts),
  status: () => contentService.publicState(),
  end: (opts) => contentService.end(opts),

  // ---------------------------------------------------------------- tools
  /** One vehicle-tools call: (fn, args, { source, turn, call_id }). */
  call: (fn, args, meta) => contentService.call(fn, args, meta),
  /** Parallel calls of one model turn, executed in the given order. */
  callBatch: (calls, meta) => (Array.isArray(calls) ? calls : []).map((c) => ({
    call_id: c && c.call_id != null ? c.call_id : null,
    fn: c && (c.fn || c.name),
    result: contentService.call(c && (c.fn || c.name), c && (c.args || c.arguments), Object.assign({}, meta || {}, { call_id: c && c.call_id })),
  })),
  tools: {
    names: () => TOOL_NAMES.slice(),
    list: (format) => toolDefinitions(format),
    systemPrompt: () => ({ version: SYSTEM_PROMPT_VERSION, text: SYSTEM_PROMPT_BLOCK }),
  },

  // ---------------------------------------------------------------- tasks
  task: {
    start: (def) => contentService.taskStart(def),
    end: (opts) => contentService.taskEnd(opts),
    current: () => contentService.currentTask(),
  },

  // ---------------------------------------------------------------- log
  log: {
    utterance: (u) => contentService.logUtterance(u),
    agentReply: (r) => contentService.logAgentReply(r),
    error: (code, message) => contentService.logError(code, message),
    ack: (batchId) => contentService.log.ack(batchId),
    flush: () => { contentService.log.flush(); return contentService.log.status(); },
    configure: (opts) => contentService.log.configure(opts),
    status: () => contentService.log.status(),
    events: (filter) => {
      const f = filter || {};
      return contentService.log.all.filter((e) => (!f.type || e.type === f.type) && (!f.task_id || e.task_id === f.task_id) && (f.since == null || e.seq > f.since));
    },
    download: () => {
      if (typeof document === 'undefined') return false;
      const lines = contentService.log.all.map((e) => JSON.stringify(e)).join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines], { type: 'application/x-ndjson' }));
      a.download = `content-log-${contentService.log.sessionId || 'session'}.jsonl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return true;
    },
  },

  // ---------------------------------------------------------------- driver controls
  hangUp: () => contentService.hangUp('driver'),
  stopPlayback: () => contentService.stopPlayback('driver'),
  cancelRoute: () => contentService.cancelRoute('driver'),
  nowPlaying: () => (contentService.active ? contentService._nowPlayingView() : null),
  routeView: () => (contentService.active ? contentService.routeView() : null),

  // ---------------------------------------------------------------- map
  map: {
    list: () => CONTENT_MAPS.map((m) => ({ map_id: m.map_id, map_version: m.map_version, label: m.label, scene: Object.assign({}, m.scene), pinned: m.fingerprint.points.length > 0 })),
    info: () => {
      const h = contentService.h;
      const road = contentService.road;
      return {
        live: h ? identifyLiveMap(h, road) : null,
        session: contentService.mapEntry ? { map_id: contentService.mapEntry.map_id, map_version: contentService.mapEntry.map_version } : null,
        recorded: road.ready ? { from: 'n_' + road.minI, to: 'n_' + road.maxI, live_to: road.liveMaxI == null ? null : 'n_' + road.liveMaxI } : null,
        mismatches: road.mismatches.length,
      };
    },
    check: (mapId, mapVersion) => checkLiveMap(findContentMap(mapId, mapVersion), contentService.h, contentService.road),
    position: () => contentService.road.vehiclePosition(),
    /** Road graph JSON as recorded so far (+ fingerprint to pin in maps.js). */
    exportGraph: (meta) => {
      const road = contentService.road;
      if (!road.ready) return vcErr('unavailable', 'road not recorded yet');
      const h = contentService.h || {};
      let scene = null;
      try { scene = { seed: h.sceneConfig.value.seed, sceneName: h.sceneConfig.value.sceneName, topography: h.sceneConfig.value.topography }; } catch (_e) {}
      const graph = road.exportGraph(Object.assign({ map_id: null, map_version: null, scene, start_node: 'n_0', exported_by: 'PromptDrive.content.map.exportGraph' }, meta || {}));
      const idx = [0, 50, 100, 200, 300, 500, 750, 900].filter((i) => i >= road.minI && i <= (road.liveMaxI == null ? -1 : road.liveMaxI));
      return vcOk({ graph, fingerprint: road.fingerprint(idx) });
    },
    /** Stage a registry map's scene config (static; the sim reloads to apply). */
    apply: (mapId, mapVersion) => {
      const m = findContentMap(mapId, mapVersion);
      if (!m) return vcErr('unknown_map', `No map ${mapId} ${mapVersion || ''} in this build`);
      const api = typeof window !== 'undefined' ? window.PromptDrive : null;
      if (!api || !api.config) return vcErr('unavailable', 'PromptDrive API not loaded');
      const staged = api.config.set({ scene: { seed: m.scene.seed, sceneName: m.scene.sceneName, topography: m.scene.topography, startNode: m.scene.startNode } });
      if (!staged || staged.ok === false) return staged;
      return api.config.apply();
    },
  },

  // ---------------------------------------------------------------- packs
  cache: {
    prefetch: (list) => contentService.prefetch(list),
  },
  validatePack: (pack, opts) => validatePack(pack, opts),
  computeContentHash: (pack) => computeContentHash(pack),

  // ---------------------------------------------------------------- HMI helpers
  /** The pack's display locale (HMI language). */
  locale: () => contentService.locale,
  openNow: (poi) => contentService.openNow(poi),
  setAudioGain: (g) => contentEffects.setGain(g),
};

// ---------------------------------------------------------------- engine seam
let vcAttached = false;
function vcLoop() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    contentService.tick(now);
    poiSigns.update(now);
  } catch (e) {
    if (!vcLoop._logged) { vcLoop._logged = true; console.error('VehicleContent tick failed', e); }
  }
  requestAnimationFrame(vcLoop);
}

function vcAttach(h) {
  if (vcAttached) return;
  vcAttached = true;
  contentService.attach(h);
  poiSigns.attach(h);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(vcLoop);
}

if (typeof window !== 'undefined') {
  window.VehicleContent = VehicleContent;
  const tryAttach = () => {
    const b = window.PromptDriveBridge;
    if (b && typeof b.whenAttached === 'function') {
      b.whenAttached((h) => vcAttach(h));
      // Mirror the parent's batch acks if a WorlDrive parent answers by event.
      return true;
    }
    return false;
  };
  if (!tryAttach()) {
    const timer = setInterval(() => { if (tryAttach()) clearInterval(timer); }, 200);
  }
}
