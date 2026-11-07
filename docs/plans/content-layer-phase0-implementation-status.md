# Content layer & vehicle-tools v1.0 — Phase 0 implementation status (PromptDrive)

Nov 7, 2026. Companion to
[`promptdrive-simulator-spec-content-layer-and-vehicle-tools-v1.0.md`](promptdrive-simulator-spec-content-layer-and-vehicle-tools-v1.0.md)
and the shared contract
[`worldrive-spec-content-packs-and-shared-vehicle-tools-v1.0-contract.md`](worldrive-spec-content-packs-and-shared-vehicle-tools-v1.0-contract.md)
(copied here from the WorlDrive repo so both specs travel with the code).

## Where things live

| Spec component | Implementation |
| --- | --- |
| Shared package (schema checks, hashing, resolver, synonyms, tool schemas, adapters, labeler) | `packages/vehicle-content/` (`@hcis/vehicle-content` 1.0.0, plain ESM, no deps). WorlDrive imports it as a git dependency pinned to a commit/tag. |
| Runtime service (pack loading, resolver, vehicle state, logging) | `src/content/ContentService.js`, `EventLog.js` → `static/js/content.js` (`window.VehicleContent`, `PromptDrive.content.*`) |
| Stable road graph + map versions | `src/content/RoadGraph.js`, `src/content/maps.js`, `maps/synth-town-01/2026.11/road-graph.json` |
| Slot export + reachability CLI | `scripts/content/export-slots.js` → `maps/…/slots.json` |
| Provider adapters + drift test | `packages/vehicle-content/src/adapters.js`, `generated/*.json`, `scripts/gen-provider-tools.js --check` |
| HMI screens on the service | `src/console/apps/ContentScreens.js` (hooked into Phone/Audio/Nav/Map apps) |
| Simulated effects | `src/content/effects.js` |
| Roadside sign per POI | `src/content/PoiSigns.js` |
| Starter pack + reference tasks | `packages/vehicle-content/packs/es-CO-starter.v1.json`, `es-CO-starter.tasks.json` (generator: `scripts/gen-starter-pack.js`) |
| Acceptance tests | `test/content/acceptance.test.js` (built bundle + fake engine), `packages/vehicle-content/test/` |

## Phase 0 work items

- [x] Shared package set up as one folder; nothing content-related duplicated in the sim
- [x] Stable `map_id` / `map_version` / `road_node_id` for one synthetic map; road graph export
- [x] Slot export and reachability CLI
- [x] Pack loader with hash, map (scene + geometry fingerprint + full-graph check) and tools-version checks, fail closed
- [x] Runtime service owning resolver, vehicle state and logging
- [x] Provider adapters (Gemini, OpenAI-compatible) generated from the shared schemas; drift test
- [x] Turn-loop support: argument validation (`invalid_argument`), `end_task`, `max_turns`/`max_seconds`, `next_task` closing
- [x] Phone, media and navigation screens moved onto the service (`source: "hmi_touch"`)
- [x] Effects for the five actions, placeholder audio, per-locale call prompt
- [x] Roadside sign per POI in the 3D world
- [x] Event logging with lifecycle events, monotonic clock, buffered acknowledged transport

## Acceptance tests (`npm run test:content`)

| # | Test | Where verified |
| --- | --- | --- |
| 1 | Determinism (replay → identical resolver results) | node, built bundle |
| 2 | Fail closed (one changed character; other map version; wrong scene/road; tools version) | node + browser (overlay) |
| 3 | Parity (touch vs agent: same functions and `contact_id`, differ only in `source`) | node + browser (real touch flow on the console) |
| 4 | Designed conditions (5 reference tasks → status + label) | node |
| 5 | World consistency (every `search_poi` result has a sign at its position; routes end at the POI's node) | node + browser (sign seen while driving, `arrived` event) |
| 6 | Field robustness (network cut + page reload → no lost events, ordered, final batch acked) | node |

## Decisions taken on open questions

- **Where the service runs.** In the sim (browser). WorlDrive's agent loop already
  executes tool calls in the participant's sim over postMessage, so the service
  sits next to the HMI and the vehicle state; tool latency is a local call.
- **Stable node IDs without regenerating maps.** Yes: the engine's midline is a
  pure function of the scene config, indexed from the generation origin. Two
  independent loads produced identical geometry for all 1,486 nodes, so
  `road_node_id = n_<index>`. A fingerprint + continuous comparison against the
  committed graph guards against engine changes.
- **Network distance.** The synthetic map is one road (a chain), so the network
  distance is the arc-length difference, undirected (U-turns allowed). Reachability
  for slots is forward from the start node. Roadside signs exist within the
  default 3 km search radius in both directions.
- **Call voice prompt.** Browser speech synthesis in the pack locale ("Hola, ¿qué
  tal?") until recorded clips exist (`CALL_CLIPS[locale].src`).
- **Number visibility.** `get_contact` masks numbers by default
  (`session.mask_numbers: false` to show them). Summaries show only number types.
- **Near-miss suggestions** kept on `not_found` (contract proposal).
- **Relationship matches** ("mi hermano") score as category matches (0.65,
  `matched_on: "category"`), since the frozen `matched_on` enum has no relationship value.
- **Session clock for `open_now`.** A session local time (`session.local_time`,
  default `Fr 10:00`) advanced by `t` — deterministic and logged.
- **Starter-pack brands.** Invented names, except the contract's own example
  "Estación Terpel Calle 80" (brands appear only as sign text).

## Not done here (WorlDrive side / later)

- WorlDrive's LLM runner must use `content.tools.list('openai'|'gemini')` and
  `content.tools.call(..., { source:'agent', turn })`, drop its ad hoc
  contact/media/destination tools, add the system-prompt block, forward
  transcripts with `content.log.utterance/agentReply`, and acknowledge
  `contentLogBatch` events (or set `content.log.configure({ endpoint })`).
- Persisting the log batches in the study backend and the Content panel / POI
  placer UI (WorlDrive Phase 1). `slots.json` and `road-graph.json` are ready to consume.
- Category-specific 3D props (signs only for now), more maps, and zone types.
- A tuning pass on thresholds with the es-CO pack before freezing v1.0.
