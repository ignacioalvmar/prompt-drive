# WorlDrive Spec: Content Packs and Shared vehicle-tools v1.0 Contract

Nov 7, 2026 · @Ignacio Alvarez

## Purpose and scope

PromptDrive gets one shared content layer (contacts, media, POIs) that both human drivers and AI agents query through a fixed, versioned tool API. Today an agent can understand a request correctly and still fail because the car has no matching contact, song, or destination. This spec removes that failure mode and makes content a controlled, logged study variable.

**Repo ownership.** This spec defines the shared contract (pack schema, tool API, matching rules, log format) and the WorlDrive side: authoring, POI placement UI, validation, and publishing. Runtime behavior in the simulator is specified in the companion doc PromptDrive Simulator Spec: Content Layer and vehicle-tools v1.0. The resolver, schemas, synonym files, and failure labeler live in one shared package used by both repos.

**Goals**

- Researchers define the content of a study in WorlDrive, starting from locale starter packs and adding their own entries.
- Human HMI and agent read the same content through the same backend, so their results are comparable.
- Every session is reproducible: pack version, tool version, and every lookup are logged.
- Missing or ambiguous content can be designed into a task on purpose, instead of happening by accident.

**Non-goals for v1**

- Per-study configurable tool sets (the tool set is fixed by the platform; see the v1.0 API section).
- Geo-referenced maps and real-world POI import (maps are synthetic today).
- Syncing a participant's phone over Bluetooth.
- Real audio playback of copyrighted music.

## Architecture overview

WorlDrive produces a frozen content pack at configuration time; at runtime PromptDrive loads it into a single resolver that both the human HMI and the agent call.

&#91;embedded content: content layer architecture · config time and runtime\]

The resolver is the only component that reads the pack. Neither the HMI nor the agent holds its own copy of contacts, media, or POIs, which is what guarantees that both face the same content and the same gaps.

## Content pack schema

A content pack is one JSON document with an envelope and one array per domain. Every entry has a stable `id` that tasks, logs, and the HMI refer to. Packs are immutable once a study session has used them; any edit creates a new version.

### Envelope

```json
{
  "schema_version": "1.0",
  "pack_id": "es-CO-starter",
  "pack_version": 3,
  "content_hash": "sha256:...",
  "locale": "es-CO",
  "extra_locales": ["en-US"],
  "based_on": { "pack_id": "es-CO-starter", "pack_version": 2 },
  "map": { "map_id": "synth-town-01", "map_version": "2026.10" },
  "created_by": "...",
  "created_at": "2026-11-07T08:00:00Z",
  "contacts": [],
  "media": { "tracks": [], "artists": [], "albums": [], "playlists": [], "stations": [], "podcasts": [] },
  "pois": [],
  "designed_conditions": []
}
```

`content_hash` is computed over the canonical JSON (sorted keys, no whitespace) excluding `content_hash` itself and `created_at`. `map` is required only when the pack contains POIs.

### Common fields on every entry

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Stable, unique within the pack, e.g. `c_0012` |
| `display_name` | string | yes | What the HMI shows |
| `aliases` | string\[\] | no | Nicknames, short forms, other spellings |
| `lang` | BCP-47 | no | Defaults to pack `locale` |
| `phonetic` | string | no | Optional pronunciation hint used for matching |
| `tags` | string\[\] | no | Free tags for task templates, e.g. `family`, `work` |

### Contacts

```json
{
  "id": "c_0012",
  "display_name": "Felipe Rodríguez Gómez",
  "given_name": "Felipe",
  "family_names": ["Rodríguez", "Gómez"],
  "aliases": ["Pipe", "Pipe Rodríguez"],
  "relationship": "brother",
  "organization": null,
  "numbers": [
    { "type": "mobile", "value": "+57 300 000 0012", "default": true },
    { "type": "work", "value": "+57 601 000 0012" }
  ],
  "favorite": true,
  "tags": ["family"]
}
```

`family_names` is an array so that Spanish double surnames and similar conventions are matched correctly. Phone numbers are fictitious and drawn from reserved or test ranges.

### Media

Media entries hold metadata only. Tracks reference artists and albums by `id`.

```json
{ "id": "t_0301", "type": "track", "display_name": "...", "artist_ids": ["a_0040"], "album_id": "al_0011", "genre": ["vallenato"], "duration_s": 214, "lang": "es" }
{ "id": "a_0040", "type": "artist", "display_name": "...", "aliases": [] }
{ "id": "pl_0003", "type": "playlist", "display_name": "Para la carretera", "track_ids": ["t_0301", "t_0302"] }
{ "id": "st_0007", "type": "station", "display_name": "...", "band": "FM", "frequency": "99.1", "genre": ["news"] }
{ "id": "pc_0002", "type": "podcast", "display_name": "...", "episode_titles": ["..."] }
```

Starter packs use invented artist and song names, or real artist names with metadata only. No audio files are bundled with a pack.

### POIs

```json
{
  "id": "p_0105",
  "display_name": "Estación Terpel Calle 80",
  "category": "fuel",
  "subcategories": ["ev_charging"],
  "brand": "Terpel",
  "aliases": ["la Terpel", "la bomba"],
  "location": { "coord_system": "map_local", "x": 1240.5, "y": -388.0, "road_node_id": "n_2231" },
  "opening_hours": "24/7",
  "attributes": { "price_level": 2, "connector_types": ["CCS2"] },
  "placement": "procedural",
  "locked": false
}
```

Categories come from a fixed v1 list: `fuel`, `ev_charging`, `parking`, `restaurant`, `cafe`, `supermarket`, `pharmacy`, `hospital`, `hotel`, `atm`, `car_service`, `landmark`, `home`, `work`. `placement` is `procedural` or `manual`; `locked` entries are never moved by regeneration.

## POI placement on synthetic maps

POIs are placed procedurally on the synthetic map's road graph, then frozen into the pack. Because PromptDrive maps are synthetic today, POI coordinates are map-local and only valid for the `map_id` and `map_version` recorded in the envelope.

**Procedural placement**

1. PromptDrive exports, per map version, a list of candidate slots: road-adjacent positions with `x`, `y`, `road_node_id`, heading, and a zone type (residential, commercial, highway, rural) if the map has one.
2. The researcher sets a density per category, for example 4 fuel, 6 restaurants, 2 pharmacies, per map or per zone type.
3. The placer assigns slots with a fixed random seed stored in the pack, respecting a minimum spacing per category so that two pharmacies don't sit next to each other unless requested.
4. Names and brands come from the locale name list for that category. Each generated POI receives `placement: "procedural"`.
5. The result is written into the pack as plain entries. The seed and generator version are kept in the pack so the same input reproduces the same layout.

**Manual pinning**

Tasks often depend on a specific POI ("the café after the second roundabout"). Researchers can place a POI on a slot by hand and mark it `locked: true`. Regeneration keeps locked POIs in place and fills the remaining density around them.

**Future geo-referencing**

The `location.coord_system` field is the extension point. v1 accepts only `map_local`. When geo-referenced maps arrive, `wgs84` entries (`lat`, `lon`) can be imported from OpenStreetMap for the map's bounding box and snapped to the road graph. The resolver, tool API, and HMI stay unchanged; only a new importer and a projection between the two systems are added.

**Map version changes**

If a map version changes, POIs whose `road_node_id` no longer exists are flagged by validation. The researcher either regenerates (unlocked POIs move) or re-pins the flagged locked POIs. A pack is never silently migrated.

## vehicle-tools v1.0 API

v1.0 is a fixed set of 12 functions, identical for every study. The agent receives them as tool definitions; the human HMI calls the same functions through its screens. The version string `vehicle-tools/1.0` is written into every session log.

### Function list

| Domain | Function | Kind |
| --- | --- | --- |
| Phone | `search_contacts` | lookup |
| Phone | `get_contact` | lookup |
| Phone | `call_contact` | action |
| Phone | `send_message` | action |
| Media | `search_media` | lookup |
| Media | `play_media` | action |
| Media | `get_playback_state` | lookup |
| Navigation | `search_poi` | lookup |
| Navigation | `get_poi` | lookup |
| Navigation | `navigate_to` | action |
| Navigation | `add_waypoint` | action |
| Session | `end_task` | session |

### Signatures

```ts
// Phone
search_contacts(query: string, filter?: { relationship?: string; tag?: string; favorite?: boolean }, limit?: number /* default 5, max 10 */): LookupResult<ContactSummary>
get_contact(contact_id: string): ItemResult<Contact>
call_contact(contact_id: string, number_type?: "mobile" | "home" | "work" | "other"): ActionResult
send_message(contact_id: string, text: string, number_type?: string): ActionResult

// Media
search_media(query: string, types?: ("track" | "artist" | "album" | "playlist" | "station" | "podcast")[], limit?: number): LookupResult<MediaSummary>
play_media(item_id: string, options?: { shuffle?: boolean }): ActionResult
get_playback_state(): ItemResult<PlaybackState>

// Navigation
search_poi(query?: string, category?: PoiCategory, scope?: "near_vehicle" | "along_route" | "near_destination", radius_m?: number /* default 3000 */, open_now?: boolean, limit?: number): LookupResult<PoiSummary>
get_poi(poi_id: string): ItemResult<Poi>
navigate_to(poi_id: string): ActionResult
add_waypoint(poi_id: string): ActionResult

// Session
end_task(outcome: "completed" | "not_possible" | "needs_user", reason?: string): ActionResult
```

`search_poi` requires at least one of `query` or `category`. `along_route` and `near_destination` return `status: "invalid_argument"` when no route is active. Map units are treated as meters.

### Return envelopes

```ts
type LookupStatus = "ok" | "ambiguous" | "not_found" | "invalid_argument";

interface LookupResult<T> {
  status: LookupStatus;
  candidates: (T & { score: number; matched_on: "display_name" | "alias" | "given_name" | "family_name" | "phonetic" | "category" | "brand" | "genre" })[];
  total_matches: number;        // matches above threshold, before limit
  suggestions?: T[];            // only when status = "not_found": up to 3 near misses
  message?: string;             // short human-readable note, e.g. "No route active"
}

interface ItemResult<T> { status: "ok" | "not_found"; item?: T }

interface ActionResult {
  status: "ok" | "error";
  action_id: string;            // used by success checking
  error_code?: "unknown_id" | "no_number_of_type" | "no_route" | "unsupported" | "busy";
  state?: object;               // e.g. call started, now playing, route summary (ETA, distance)
}
```

Summaries return only what an infotainment list would show: contacts give `id`, `display_name`, `relationship`, and number types (not numbers); media gives `id`, `type`, `display_name`, artist names; POIs give `id`, `display_name`, `category`, `brand`, distance in meters, `open_now`. Full records come from the `get_*` functions.

### Behavior rules

- **Actions never search.** `call_contact`, `play_media`, and `navigate_to` accept only IDs. An agent must resolve first, which keeps grounding errors observable.
- **Ambiguity is returned, not resolved.** When the resolver cannot separate the top candidates, it returns `ambiguous` with all of them. Choosing, or asking the driver, is the agent's job.
- **`end_task` closes the episode.** `completed` is checked against the task's success criteria; `not_possible` is correct only for tasks designed with absent content; `needs_user` records that the agent handed back to the driver. Turn and time limits remain as a fallback.
- **Side effects are simulated.** A call plays a ring tone and a canned voice prompt; media plays a royalty-free placeholder plus a "now playing" banner; navigation draws the route in the sim.

## Matching and resolution rules

The resolver is deterministic: the same query against the same pack always returns the same candidates in the same order. No LLM or embedding model runs inside it in v1, so differences between runs come only from the agent or the driver.

### Normalization (applied to queries and to every indexed field)

1. Unicode NFKD, then strip combining marks: "Rodríguez" and "Rodriguez" match, "Müller" and "Muller" match.
2. Lowercase; collapse whitespace; drop punctuation except digits.
3. Locale expansions: German `ü→ue`, `ö→oe`, `ä→ae`, `ß→ss` are indexed as extra forms.
4. Stop words per locale are removed for scoring only ("la", "el", "de", "der", "the"), so "la Terpel" matches "Terpel".

### Scoring

Each candidate field gets a score from 0 to 1; the entry's score is its best field score.

| Match type | Score | Example |
| --- | --- | --- |
| Exact on `display_name` or alias | 1.00 | "Pipe" to alias "Pipe" |
| Exact on a name part (given or one family name) | 0.90 | "Rodríguez" to Felipe Rodríguez Gómez |
| Token-set match (all query tokens present, any order) | 0.85 | "Gómez Felipe" |
| Prefix match on a token (3 or more characters) | 0.75 | "Rodri" |
| Phonetic match (locale-aware phonetic key) | 0.70 | "Yesica" to "Jessica" |
| Fuzzy, normalized edit similarity of 0.80 or more | 0.60 to 0.80 | "Felpe" |
| Category, brand, or genre match | 0.65 | "gas station" to category `fuel` |

Category synonyms ("gasolinera", "bomba", "Tankstelle", "gas station" for `fuel`) live in a fixed, versioned synonym file per locale, shipped with the tool version, not with the pack.

### Thresholds and status

- **Accept threshold:** 0.60. Entries below it are not candidates.
- **`ok`:** exactly one candidate, or the top candidate leads the second by 0.15 or more.
- **`ambiguous`:** two or more candidates within 0.15 of the top score. All candidates within that band are returned, up to `limit`.
- **`not_found`:** no candidate reaches 0.60. Up to three near misses scoring 0.40 or more are returned in `suggestions`.

### Tie-breaking and order

Candidates are ordered by score, then by a domain rule, then by `id`. Domain rules: contacts prefer `favorite`; POIs prefer shorter distance and `open_now`; media prefers the requested `types` order. The tie-break never turns an ambiguous result into `ok`; it only orders the list.

### Language

Matching runs over all locales listed in the pack (`locale` plus `extra_locales`). A Spanish pack with English extras lets "call my brother" match `relationship: brother` while "llama a mi hermano" matches the same entry through the Spanish relationship synonyms.

## Task binding, success checking, designed absence

Tasks refer to pack entries by `id`, and success is checked automatically from the action log. A task never relies on free-text matching of what the agent said.

### Task definition

```json
{
  "task_id": "call_brother_mobile",
  "prompt_for_driver": "Call your brother Pipe on his mobile.",
  "expected": {
    "actions": [ { "fn": "call_contact", "args": { "contact_id": "c_0012", "number_type": "mobile" } } ],
    "end_outcome": "completed"
  },
  "tolerance": { "extra_lookups": "allowed", "extra_actions": "fail" },
  "limits": { "max_turns": 8, "max_seconds": 90 }
}
```

`number_type` may be omitted in `expected` when any number of the contact counts as success. `extra_actions: "fail"` means calling the wrong person first and then the right one is a failure; `"allowed"` scores only the final state.

### Task templates

Templates generate task instances from a pack, which is what makes the benchmark scale across locales.

```json
{
  "template_id": "call_by_relationship",
  "select": { "domain": "contacts", "where": { "relationship": { "exists": true }, "numbers.type": "mobile" } },
  "prompt_for_driver": { "es": "Llama a tu {relationship_es}.", "en": "Call your {relationship_en}." },
  "expected": { "actions": [ { "fn": "call_contact", "args": { "contact_id": "{id}" } } ], "end_outcome": "completed" }
}
```

Instances are expanded and frozen when the study is published, with the seed recorded, so participants in the same condition get identical tasks.

### Designed conditions

The pack's `designed_conditions` array marks content that is missing or ambiguous on purpose.

| Type | Pack content | Correct agent behavior | `end_outcome` |
| --- | --- | --- | --- |
| `absent` | The requested entry does not exist, e.g. no contact "Camila" | Tell the driver it is not available; no action | `not_possible` |
| `ambiguous_pair` | Two entries collide, e.g. two "Andrés" | Ask the driver which one, then act on the chosen `id` | `completed` |
| `missing_attribute` | Entry exists but lacks what was asked, e.g. no work number | Report the gap or offer an alternative | `not_possible` or `needs_user` |
| `near_miss` | Only a similar entry exists, e.g. "Camilo" when asked for "Camila" | Confirm before acting | `needs_user` or `completed` after confirmation |

```json
{ "type": "absent", "label": "no Camila", "domain": "contacts", "query_hint": "Camila", "must_not_match": true }
{ "type": "ambiguous_pair", "label": "two Andrés", "ids": ["c_0031", "c_0032"] }
```

Validation checks that an `absent` condition really has no candidate at or above the accept threshold, and that an `ambiguous_pair` really resolves to `ambiguous`. A pack edit that breaks a designed condition is blocked until the condition is fixed or removed.

## Logging and failure taxonomy

Every tool call is logged with enough context to tell *why* a task failed, not only *that* it failed. The same log format applies to human HMI interactions and agent tool calls.

### Session header

```json
{ "session_id": "...", "study_id": "...", "condition": "...", "participant_pseudonym": "P017", "actor": "agent" | "human", "model": "...", "tools_version": "vehicle-tools/1.0", "resolver_version": "1.0.3", "synonyms_version": "es-CO@1", "pack_id": "...", "pack_version": 3, "content_hash": "sha256:...", "map_id": "...", "map_version": "..." }
```

### Per call

```json
{ "t": 12.84, "task_id": "call_brother_mobile", "turn": 2, "fn": "search_contacts", "args": { "query": "Pipe" }, "source": "agent" | "hmi_touch" | "hmi_voice", "status": "ok", "candidates": [ { "id": "c_0012", "score": 1.0, "matched_on": "alias" } ], "latency_ms": 3, "vehicle_state": { "speed_kmh": 48, "route_active": false } }
```

The transcript of what the driver said and what the agent said is logged separately and joined on `session_id`, `task_id`, and `turn`.

### Failure taxonomy

Each finished task gets one primary label, computed automatically from the logs and the task definition. Researchers can override a label in review.

| Label | Rule | Example |
| --- | --- | --- |
| `success` | Expected actions and `end_outcome` match | Called c\_0012 on mobile |
| `intent_error` | No call into the expected domain, or an action in a different domain | Started navigation when asked to call |
| `query_error` | Right domain, but no lookup query returned the target, while a query built from the task's target would have | Searched "brother Pipe" as one name and got not\_found |
| `grounding_error` | The target was among the candidates, but the action used a different `id` | Picked the wrong Andrés without asking |
| `content_absence_handled` | Designed absence, agent ended with `not_possible` and took no action | Said Camila is not in contacts |
| `content_absence_mishandled` | Designed absence, but the agent acted on a near miss or claimed success | Called Camilo |
| `execution_error` | Correct `id`, but the action returned `error` and the agent did not recover | Asked for work number that does not exist, gave up silently |
| `false_completion` | `end_task("completed")` without the expected action in the log | Claimed the call was placed |
| `timeout` | Turn or time limit reached first |  |

`query_error` is decided by replaying a reference query (the target's `display_name` and aliases) against the same pack and resolver version, which is possible because the resolver is deterministic.

## WorlDrive Content panel

The Content panel is a new step in study configuration, between choosing the map and defining tasks. Its output is one published content pack per condition (or one shared by all conditions).

### Functions

1. **Start from a starter pack.** Pick a locale pack (v1: es-CO first, then de-DE, en-US, es-ES). Starter packs are read-only; editing creates a study-owned copy with `based_on` set.
2. **Import.** Contacts from CSV or vCard 3.0/4.0; media from CSV or M3U (metadata only); POIs from CSV with map-local coordinates or from the procedural placer; whole packs from JSON. Import mode is `append` or `replace` per domain.
3. **Edit.** A table editor per domain with search, inline editing, alias editing, and bulk delete. A preview shows how the HMI list screens will look.
4. **Place POIs.** Category densities, seed, regenerate, pin, and lock (see POI placement). A 2D map view shows the result on the road graph.
5. **Mark designed conditions.** Add `absent`, `ambiguous_pair`, `missing_attribute`, and `near_miss` entries.
6. **Test the resolver.** A query box runs the real resolver against the draft pack and shows status, candidates, and scores. This is how a researcher checks that "Pipe" finds Felipe before running a study.
7. **Scope.** Assign packs per condition. Optional per-participant overrides come from a pre-session form (for example, up to five names the participant would really call), merged into a participant-specific pack version.
8. **Publish.** Validation runs, the pack is frozen, `content_hash` is computed, and task templates are expanded.

### Validation (blocking unless marked as a warning)

| Check | Level |
| --- | --- |
| Schema valid, required fields present, IDs unique | Blocking |
| Track, album, playlist references point to existing IDs | Blocking |
| POIs have a valid `road_node_id` for the selected map version | Blocking |
| POIs reachable from the start position on the road graph | Blocking |
| Every task's expected IDs exist in the pack | Blocking |
| Designed conditions resolve as declared | Blocking |
| Two entries resolve to `ambiguous` for their own display name, not declared as designed | Warning |
| Contact without any number; POI category with zero entries but referenced by a template | Warning |
| Phone numbers outside reserved or test ranges | Warning |

### Privacy for participant overrides

Names entered by participants are stored only in the participant-specific pack, replaced by pseudonyms (`P017_contact_1`) in analysis exports, and deleted with the session raw data according to the study's data management plan.

## Phase 0 deliverables and open decisions

Phase 0 proves the pipeline end to end on one map and one locale, before any WorlDrive UI is built. Packs are edited as JSON files in this phase.

### Deliverables

- [ ] Pack JSON Schema (`content-pack-1.0.schema.json`) with a validator CLI
- [ ] Resolver library implementing normalization, scoring, thresholds, and tie-breaking as specified, with unit tests per rule
- [ ] es-CO synonym file (categories, relationships)
- [ ] `vehicle-tools/1.0` exposed to the agent loop and wired to the existing PromptDrive HMI screens
- [ ] Slot export from one synthetic map and the procedural POI placer (CLI, seeded)
- [ ] es-CO starter pack: about 60 contacts, 150 tracks across 30 artists, 8 playlists, 10 stations, 40 POIs
- [ ] Session header and per-call logging; automatic failure labeling
- [ ] Five reference tasks, one per designed condition type plus one plain success task

### Acceptance criteria

1. Running the same agent, model, seed, pack, and task twice yields identical resolver logs.
2. Each designed condition in the reference tasks produces its expected status (`not_found`, `ambiguous`, and so on) in a resolver test.
3. A human driver and the agent completing the same task produce comparable log entries (same functions, same IDs).
4. Failure labels match manual labeling on a set of at least 20 deliberately varied runs.

### Open decisions

- **Near-miss suggestions on `not_found`.** Real infotainment systems show close matches; returning them helps agents but also makes `near_miss` conditions easier. Proposal: keep them in v1.0 and treat it as fixed platform behavior.
- **Score thresholds.** 0.60 accept and 0.15 ambiguity gap are starting values. Tune them on the es-CO pack before freezing v1.0, then never change them within 1.x.
- **Number visibility.** Contact summaries hide phone numbers. Decide whether `get_contact` returns full numbers or masked ones.
- **Media playback placeholder.** Choose the royalty-free audio source and whether TTS announces the track title.
- **Starter pack authorship.** Who generates and reviews each locale pack, and how culturally specific the names, artists, and brands should be (real brands vs. invented ones).
- **Versioning policy.** Proposal: additive changes (new optional fields, new functions) bump the minor version; any change to existing behavior or thresholds bumps the major version.
