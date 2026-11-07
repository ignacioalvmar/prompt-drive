# PromptDrive Simulator Spec: Content Layer and vehicle-tools v1.0

Nov 7, 2026 · @Ignacio Alvarez

## Scope and repo ownership

PromptDrive owns everything that runs during a driving session: loading the pack, the runtime resolver, the agent tool loop, the HMI screens, the simulated effects, and the event log. WorlDrive owns authoring and publishing packs. The contract between them (pack schema, tool API, matching rules, log format) is defined in the companion spec *WorlDrive Spec: Content Packs and Shared vehicle-tools v1.0 Contract* and is not repeated here.

The resolver must behave identically in both repos: WorlDrive uses it for the "test the resolver" box and validation, PromptDrive uses it at runtime. It therefore lives in one shared package, not in either app.

| Component | Owner | Notes |
| --- | --- | --- |
| Pack JSON Schema, TypeScript types | Shared package | Single source of truth for both repos |
| Resolver library (normalization, scoring, thresholds) | Shared package | Pure functions, no I/O, deterministic |
| Synonym files per locale | Shared package | Versioned with the tool version |
| Tool definitions for `vehicle-tools/1.0` | Shared package | JSON Schema per function; provider formats generated from it |
| Failure labeler | Shared package | Runs on logs; used by WorlDrive analysis and PromptDrive tests |
| Pack loading, runtime service, agent loop | PromptDrive | This spec |
| HMI screens, simulated effects, vehicle state | PromptDrive | This spec |
| Map slot export, reachability, POI rendering | PromptDrive | This spec |
| Pack authoring UI, POI placer UI, validation UI, publishing | WorlDrive | Companion spec |

Working name for the package: `@hcis/vehicle-content`, versioned with semantic versioning and pinned by exact version in both repos. If a separate package is too much overhead for now, it can start as a folder in one repo that the other imports as a git dependency, as long as there is only one copy of the code.

## Runtime modules

A new runtime service sits between the content and every client: the agent loop and the HMI screens call it, and it alone owns the resolver, vehicle state, and logging.

&#91;embedded content: PromptDrive runtime modules\]

The resolver box is the shared package; everything else in the picture is PromptDrive code.

## Pack loading at session start

A session does not start unless the pack it was configured with is loaded and verified. Running with the wrong or a partial pack would silently invalidate the data.

1. The session configuration from WorlDrive carries `pack_id`, `pack_version`, `content_hash`, `map_id`, `map_version`, and `tools_version`.
2. PromptDrive fetches the pack by `pack_id` and `pack_version` (participant-specific version if one exists).
3. It recomputes the hash with the shared package's canonicalization and compares it to `content_hash`.
4. It checks that the pack's `map_id` and `map_version` match the map actually loaded, and that `tools_version` is one this build supports.
5. It builds the resolver index once and keeps it in memory for the session.
6. It writes the session header to the log before the first task starts.

**Fail closed.** Any mismatch in steps 3 or 4 stops the session with a clear message to the experimenter ("Pack hash mismatch", "Map version 2026.10 expected, 2026.11 loaded"). There is no fallback to a default pack.

**Offline use.** For field studies with poor connectivity (as in the Colombia roadshow setting), packs for a study can be pre-fetched and cached in the browser. The hash check still runs against the cached copy.

**No mid-session changes.** The pack is read-only during a session. Per-participant packs are separate versions, selected at step 2, never patched at runtime.

## Agent integration

The agent sees exactly the 12 `vehicle-tools/1.0` functions, generated from the shared JSON Schemas, and nothing else that touches content. Any existing ad hoc tools in the agent mode that read contacts, media, or destinations are removed or routed through the new service.

### Tool definitions and provider adapters

- The shared package exports one JSON Schema per function. PromptDrive generates provider formats from it at build time: Gemini function declarations and OpenAI-compatible `tools` (used for GPT-oss and similar).
- Function names, parameter names, and descriptions are identical across providers. Descriptions are part of the frozen tool version, because changing them changes agent behavior.
- A schema-level test fails the build if a generated provider definition drifts from the shared schema.

### Turn loop

1. Driver utterance arrives (speech-to-text or typed, as today).
2. The model returns text, tool calls, or both.
3. Each tool call is validated against its schema. Invalid arguments return `status: "invalid_argument"` to the model instead of throwing; this is logged like any other call.
4. Valid calls go to the runtime service, which runs the resolver or the action and returns the envelope.
5. Results are sent back to the model; the loop continues until the model produces a spoken reply with no further tool calls, or calls `end_task`.
6. Parallel tool calls in one model turn are executed in the order given and logged with the same `turn` number.

### Ending a task

- `end_task` ends the current task immediately and records its `outcome` and `reason`.
- If the agent never calls it, the existing turn and time limits end the task with outcome `timeout`.
- When the driver moves on to the next task prompt without the agent ending the previous one, the previous task closes as `timeout` at that moment.

### System prompt

The agent system prompt gets one fixed, versioned block describing the tool contract in plain terms: actions take IDs only, `ambiguous` means ask the driver, `not_found` means tell the driver, and call `end_task` when done or when the request cannot be fulfilled. This block is part of `vehicle-tools/1.0` and logged by version.

## HMI changes

The phone, media, and navigation screens stop holding their own data and render only from the runtime service. Every touch interaction that reads or acts on content becomes a logged call to the same 12 functions, with `source: "hmi_touch"`.

| Screen | Reads through | Acts through | New states needed |
| --- | --- | --- | --- |
| Contacts list and search | `search_contacts`, `get_contact` | `call_contact`, `send_message` | Number-type picker when a contact has several numbers; empty search result |
| Media library and search | `search_media`, `get_playback_state` | `play_media` | Tabs per media type; empty search result; now-playing bar |
| Radio | `search_media` with `types: ["station"]` | `play_media` | Station list sorted by frequency |
| Navigation search | `search_poi`, `get_poi` | `navigate_to`, `add_waypoint` | Category shortcuts; distance and open-now in results; "no route active" for along-route search |

**Browsing without a query.** Plain list screens (all contacts A to Z, all playlists) call the search function with an empty query and a domain-specific sort. The service returns all entries for empty queries, paged, with `status: "ok"`. This is a UI-only mode; the agent's tool schema keeps `query` required.

**Agent-driven UI.** When the agent calls an action, the HMI reflects it the same way as a touch action (call screen appears, now-playing updates, route is drawn). When the agent receives `ambiguous`, the HMI does not show a picker on its own; the agent asks by voice. Whether to also show candidates on screen is a study design choice and is out of scope for v1.0.

**Voice for human-only conditions.** If a condition uses the built-in voice control without an LLM agent, its calls are logged with `source: "hmi_voice"` and go through the same functions.

## Simulated effects and vehicle state

Actions change simulator state that the driver can see and hear, and that later calls can read back. Effects are deliberately simple and identical across conditions.

| Action | Effect in the sim | State kept | Ends when |
| --- | --- | --- | --- |
| `call_contact` | Call screen with name and number type; ring tone, then a short neutral voice prompt ("Hola, ¿qué tal?") from a per-locale clip | `active_call: { contact_id, number_type, started_t }` | Driver or agent hangs up, or after a fixed 20 s |
| `send_message` | "Message sent to …" banner for 3 s | Appended to a session message list | Immediately |
| `play_media` | Now-playing bar with title and artist; royalty-free placeholder loop at low volume | `playback: { item_id, type, started_t, shuffle }` | Another `play_media`, or a stop control |
| `navigate_to` | Route drawn on the road graph; ETA and distance shown; turn prompts as today | `route: { destination_poi_id, waypoints[], length_m, eta_s }` | Arrival or a new `navigate_to` |
| `add_waypoint` | Route recalculated through the POI | Waypoint inserted before the destination | Arrival at the waypoint |

Error cases return `ActionResult` with an `error_code` and have no effect in the sim: for example `add_waypoint` with no active route returns `no_route`, and `call_contact` while a call is active returns `busy`.

### Vehicle state the service must expose

The resolver needs a small read-only view of the vehicle for distance-based POI search and for logging:

- Current position as `x`, `y`, and nearest `road_node_id`.
- Route-network distance (not straight-line distance) from the vehicle to any road node, for `near_vehicle` search radius and result distances.
- Active route as an ordered list of road nodes, for `along_route` search (POIs within 300 m of the remaining route, measured on the network).
- Speed and a simple driving-mode flag (manual or automated), copied into every log entry.

If network distance is too expensive per query, a precomputed distance cache per map version is acceptable, as long as results are deterministic.

## Map work

POIs only work if the synthetic maps expose a stable road graph and if POIs are visible in the world the driver sees. Both are PromptDrive changes.

### Stable road graph and map versions

- Every map gets a `map_id` and a `map_version`. Any change to road geometry bumps `map_version`.
- Road nodes get stable `road_node_id` values within a map version. Generating IDs from geometry order at load time is not enough, because it can change between builds.
- The road graph (nodes, edges, lengths) is exportable as JSON per map version, so WorlDrive and the shared package can compute reachability and distances without running the sim.

### Slot export

A CLI in the PromptDrive repo produces `slots.json` per map version: candidate POI positions next to the road, each with `slot_id`, `x`, `y`, `road_node_id`, side of road, heading, and zone type if the map defines zones. Slots respect a minimum distance from intersections so POIs never sit inside a junction. WorlDrive's placer consumes this file; it does not need to load the map.

### Reachability

The same CLI (or the shared package, given the exported graph) checks that every slot is reachable from the session start position. Unreachable slots are excluded from export rather than flagged later.

### POIs in the 3D world

A POI the agent navigates to should also exist where the driver looks. For each POI in the pack, the sim places a generic building or sign at its slot, labeled with `display_name`, and styled by category (fuel canopy, café sign, parking sign, pharmacy cross). Brand names appear only as text labels, never as logos. Locked and procedural POIs render the same way.

This is the largest new piece of work in this spec. A first version can use a simple roadside sign per POI and add category-specific props later.

## Event logging

PromptDrive emits the session header and per-call records defined in the companion spec, plus lifecycle events it alone knows about. Logging sits inside the runtime service, so no client (HMI or agent) can bypass it.

**Additional event types**

| Event | Fields beyond `t`, `session_id`, `task_id` |
| --- | --- |
| `task_start` | `prompt_for_driver`, condition |
| `task_end` | `outcome`, `reason`, `ended_by` (`end_task`, `timeout`, `next_task`) |
| `driver_utterance` | text, `turn`, ASR confidence if available |
| `agent_reply` | text, `turn`, model, token counts |
| `effect` | effect type (call screen, now playing, route drawn), linked `action_id` |
| `session_error` | error code and message (hash mismatch, map mismatch, adapter failure) |

**Clock.** `t` is seconds since session start from a single monotonic clock in the sim. Wall-clock time is recorded once in the header. Agent latency is logged per call as `latency_ms`, measured inside the service.

**Transport.** Events are buffered locally and sent in batches to the existing study backend. The buffer survives a page reload and is flushed at session end; a session is marked complete only when the final flush is acknowledged. This matters for field studies with unstable networks.

**Privacy.** Participant-entered contact names are written to the log as entry IDs only, never as text, except inside `driver_utterance` and `agent_reply` transcripts, which follow the study's transcript handling rules.

## Phase 0 work items for PromptDrive

Phase 0 in PromptDrive is done when one synthetic map runs the es-CO starter pack end to end, for both a human driver and an agent, with complete logs. Packs can be loaded from a local JSON file in this phase; the WorlDrive integration comes in Phase 1.

### Work items

- [ ] Set up the shared package (or shared folder) and import it; move nothing content-related into PromptDrive itself
- [ ] Stable `map_id`, `map_version`, and `road_node_id` for one synthetic map; road graph export
- [ ] Slot export and reachability CLI for that map
- [ ] Pack loader with hash, map, and tools-version checks (fail closed)
- [ ] Runtime service wrapping the shared resolver and owning vehicle state and logging
- [ ] Provider adapters (Gemini, OpenAI-compatible) generated from the shared tool schemas; build-time drift test
- [ ] Turn loop changes: argument validation, `end_task`, timeout handling
- [ ] Phone, media, and navigation screens moved onto the service
- [ ] Simulated effects for the five actions, with placeholder audio and per-locale call clip
- [ ] Roadside sign per POI in the 3D world
- [ ] Event logging with lifecycle events, monotonic clock, buffered transport

### Acceptance tests

1. **Determinism.** Replaying a recorded agent session (same tool calls in the same order) against the same pack produces byte-identical resolver results.
2. **Fail closed.** A pack with one changed character, or a pack for another map version, stops the session before the first task.
3. **Parity.** A human calling "Pipe" from the contacts screen and an agent doing the same task produce the same function sequence and the same `contact_id` in the log, differing only in `source`.
4. **Designed conditions.** The five reference tasks from the companion spec yield the expected status and, for a scripted agent, the expected failure label.
5. **World consistency.** Every POI returned by `search_poi` in a test drive has a visible sign at its position, and `navigate_to` produces a route that ends there.
6. **Field robustness.** With the network cut for two minutes mid-session, no events are lost after reconnect.

### Open questions for the PromptDrive side

- Where the agent loop runs today (browser or server) decides where the runtime service runs; it should sit next to the loop to keep tool latency low.
- Whether existing synthetic maps can get stable road node IDs without regenerating them.
- Which TTS or recorded clips to use for the call voice prompt in each locale.
