/**
 * Synthetic map registry (PromptDrive spec, "Stable road graph and map
 * versions"). A map is a pinned scene configuration plus the geometry it
 * produces. `map_version` changes whenever road geometry changes (new seed,
 * scene, topography, or an engine change to the midline generator).
 *
 * The fingerprint is a handful of live node positions captured from the real
 * sim; a pack is only accepted when the loaded scene reproduces them within
 * tolerance (fail closed). The committed road graph lives at
 * maps/<map_id>/<map_version>/road-graph.json, slots at .../slots.json.
 *
 * To add or re-version a map: load the sim with the scene below, run
 * `PromptDrive.content.map.exportGraph()` in the console (or the API), save the
 * JSON under maps/, run `node scripts/content/export-slots.js`, and paste the
 * printed fingerprint here.
 */

export const CONTENT_MAPS = [
  {
    map_id: 'synth-town-01',
    map_version: '2026.11',
    label: 'Synthetic town 01 (Hills, normal topography, seed b4e6eba7)',
    // Static scene config that reproduces this map (applied via config.set).
    scene: { seed: 'b4e6eba7', sceneName: 'Hills', topography: 'normal', startNode: 0 },
    // The engine places the ego 5 nodes past the generation head.
    start_node: 'n_5',
    // Captured 2026-11-07 from two independent loads (identical to the cm).
    // Indices stay <= 900 so the check passes at every view-LOD look-ahead;
    // nodes beyond are verified continuously against road-graph.json.
    fingerprint: {
      tolerance_m: 0.5,
      points: [
        [0, 0, 0], [50, -106.47, 460.45], [100, -3.14, 756.58], [200, -310.28, 1679.99],
        [300, -800.73, 2302.35], [500, -1763.99, 3774.95], [750, -3797.09, 3883.28], [900, -3892.58, 4641.46],
      ],
    },
  },
];

export function mapsPath(entry, file) {
  return `./maps/${entry.map_id}/${entry.map_version}/${file}`;
}

export function findContentMap(mapId, mapVersion) {
  return CONTENT_MAPS.find((m) => m.map_id === mapId && (mapVersion == null || m.map_version === mapVersion)) || null;
}

/** Compare the live scene config + road against a registry entry. */
export function checkLiveMap(entry, handles, roadGraph) {
  if (!entry) return { ok: false, code: 'map_unknown', message: 'Map not in this build\'s registry' };
  const h = handles || {};
  let live = null;
  try {
    const v = h.sceneConfig && h.sceneConfig.value;
    live = v ? { seed: v.seed, sceneName: v.sceneName, topography: v.topography } : null;
  } catch (_e) {
    live = null;
  }
  if (!live) return { ok: false, code: 'map_not_loaded', message: 'No map loaded yet' };
  for (const k of ['seed', 'sceneName', 'topography']) {
    if (entry.scene[k] != null && String(live[k]) !== String(entry.scene[k])) {
      return {
        ok: false,
        code: 'map_mismatch',
        message: `Map ${entry.map_id} ${entry.map_version} expected (${k} "${entry.scene[k]}"), loaded ${k} "${live[k]}"`,
      };
    }
  }
  const pts = entry.fingerprint.points || [];
  if (!pts.length) return { ok: false, code: 'map_unpinned', message: `Map ${entry.map_id} ${entry.map_version} has no geometry fingerprint in this build` };
  const fp = roadGraph.fingerprint(pts.map((p) => p[0]));
  if (!fp) return { ok: false, code: 'map_pending', message: 'Road geometry not generated yet' };
  const tol = entry.fingerprint.tolerance_m || 0.5;
  for (let k = 0; k < pts.length; k++) {
    if (Math.abs(fp[k][1] - pts[k][1]) > tol || Math.abs(fp[k][2] - pts[k][2]) > tol) {
      return {
        ok: false,
        code: 'map_mismatch',
        message: `Map ${entry.map_id} ${entry.map_version} expected, loaded road differs at node n_${pts[k][0]}`,
        detail: { node: pts[k][0], expected: pts[k].slice(1), live: fp[k].slice(1) },
      };
    }
  }
  if (roadGraph.mismatches && roadGraph.mismatches.length) {
    return { ok: false, code: 'map_mismatch', message: `Map ${entry.map_id} ${entry.map_version} expected, live road differs from the committed graph`, detail: roadGraph.mismatches[0] };
  }
  return { ok: true };
}

/** Which registry map (if any) is live right now. */
export function identifyLiveMap(handles, roadGraph) {
  for (const m of CONTENT_MAPS) {
    const r = checkLiveMap(m, handles, roadGraph);
    if (r.ok) return { map_id: m.map_id, map_version: m.map_version };
  }
  return null;
}
