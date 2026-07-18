# CAR-bench compatibility plan — prompt-drive as a live in-cabin backend

**Status:** design approved, not yet implemented.
**Audience:** AI coding agents implementing and verifying the work packages in §7. This document is self-contained: every claim is anchored to a file (and line where load-bearing) in one of the two repos. Verify anchors before patching — line numbers drift.

| Repo | Path | Role |
| --- | --- | --- |
| prompt-drive | `C:\Users\alvarez\Documents\code\prompt-drive` | Web driving simulator (this repo). Gains the vehicle-state store, benchmark mode, and WebSocket transport. |
| car-bench | `C:\Users\alvarez\Documents\code\car-bench` | Python benchmark for in-car voice-assistant LLM agents (personal fork). Gains a thin `live_sim` adapter. |

Companion docs in this repo: [`API.md`](API.md) (implemented integration API), [`AGENTS.md`](AGENTS.md) (extension conventions, build pipeline, engine symbol map).

---

## 1. Purpose & scope

CAR-bench evaluates multi-turn, tool-using LLM agents in an automotive voice-assistant domain: an LLM-simulated user, 57 wired tools (58 defined; one disabled), 19 policies, and a mutable environment. Today its "vehicle" is a Pydantic object in Python memory. The goal of this plan is to let **prompt-drive be that vehicle**: a running, visible simulation that

1. **serves vehicle state in CAR-bench's exact format** (field names, enum strings, ranges, serialization),
2. **exposes a real-time API** so CAR-bench tool calls read/write the live sim,
3. **links to real simulator features where they exist** (headlights, climate/seat-heating via the center console, cruise/autodrive/weather already exist for free-play), and
4. **covers every gap** with either (a) a *simulated default state* — a state field that round-trips correctly with no visual effect — or (b) a *recommended visual feature* specced in enough detail to implement (§7, WP-V1…V6).

**Compatibility contract (baseline):** with WP0–WP5 done and zero optional visual packages, a full CAR-bench run (any task type) against the live sim must produce **identical rewards and state hashes** to a pure-Python run, while the sim visibly reflects the linked fields (headlights, climate temperatures, seat heating, fan) and every other field is faithfully stored and queryable. Visual packages WP-V1…V6 then upgrade individual simulated fields to visible behavior without touching the contract.

Out of scope: replacing CAR-bench's static databases (48 cities, ~130k POIs, ~1.7M routes, weather profiles, contacts, calendars — they stay in Python), moving tool validation/policy logic into the browser, and physical simulation of climate/charging.

---

## 2. CAR-bench environment model (what we must be compatible with)

### 2.1 Mutable vehicle state — `ContextState` (31 fields)

Source: `car_bench/envs/car_voice_assistant/context/dynamic_context_state.py` (fields at lines 45–165). A Pydantic v2 `BaseModel` with `validate_assignment = True`, held in a `ContextVar` (`context_state`). Set-tools mutate it exclusively through `update_state(**kwargs)` (line 180): thread-locked, **silently ignores unknown keys**, and contains one embedded policy hook (setting `waypoints_id` whose first element ≠ `fixed_context.current_location.id` appends `TECH-AUT-POL:016` to the runtime policy errors).

The full schema, verbatim. This is the shape `window.VehicleState` must replicate exactly:

| # | Field | Type | Default | Constraint |
| --- | --- | --- | --- | --- |
| 1 | `sunroof_position` | int | `0` | 0–100 (% open) |
| 2 | `sunshade_position` | int | `0` | 0–100 (% open) |
| 3 | `trunk_door_position` | str | `"closed"` | **free string** — the set-tool writes `"OPEN"`/`"CLOSE"` (uppercase); never normalize |
| 4 | `window_driver_position` | int | `0` | 0–100 |
| 5 | `window_passenger_position` | int | `0` | 0–100 |
| 6 | `window_driver_rear_position` | int | `0` | 0–100 |
| 7 | `window_passenger_rear_position` | int | `0` | 0–100 |
| 8 | `reading_light_driver` | bool | `False` | |
| 9 | `reading_light_passenger` | bool | `False` | |
| 10 | `reading_light_driver_rear` | bool | `False` | |
| 11 | `reading_light_passenger_rear` | bool | `False` | |
| 12 | `fog_lights` | bool | `False` | |
| 13 | `head_lights_low_beams` | bool | `False` | |
| 14 | `head_lights_high_beams` | bool | `False` | |
| 15 | `ambient_light` | enum | `OFF` | `OFF, RED, GREEN, BLUE, YELLOW, WHITE, PINK, ORANGE, PURPLE, CYAN` |
| 16 | `climate_temperature_driver` | float | `20` | 16–28, multiple of 0.5 (°C) |
| 17 | `climate_temperature_passenger` | float | `20` | 16–28, multiple of 0.5 (°C) |
| 18 | `steering_wheel_heating` | int | `0` | 0–3 |
| 19 | `seat_heating_driver` | int | `0` | 0–3 |
| 20 | `seat_heating_passenger` | int | `0` | 0–3 |
| 21 | `fan_speed` | int | `0` | 0–5 |
| 22 | `window_front_defrost` | bool | `False` | |
| 23 | `window_rear_defrost` | bool | `False` | |
| 24 | `fan_airflow_direction` | enum | `FEET` | `FEET, HEAD, HEAD_FEET, WINDSHIELD, WINDSHIELD_FEET, WINDSHIELD_HEAD, WINDSHIELD_HEAD_FEET` |
| 25 | `air_conditioning` | bool | `False` | |
| 26 | `air_circulation` | enum | `AUTO` | `AUTO, FRESH_AIR, RECIRCULATION` |
| 27 | `navigation_active` | bool | `False` | |
| 28 | `waypoints_id` | list[str] | `[]` | location/POI ids; `[0]` = start (must equal current location), last = destination |
| 29 | `routes_to_final_destination_id` | list[str] | `[]` | route ids, one per segment |
| 30 | `email_addresses_sent_mail_to` | list[str] | `[]` | append-only log |
| 31 | `phone_numbers_called` | list[str] | `[]` | append-only log |

Enums are `(str, Enum)` classes and serialize to plain strings in `model_dump()` (e.g. `"ambient_light": "OFF"`).

### 2.2 Fixed context — `FixedContext` (12 fields, read-only to the agent)

Source: `car_bench/envs/car_voice_assistant/context/fixed_context.py`. Same ContextVar pattern (`fixed_context`), same `update_state` (used only at task init). No set-tool writes it; several get-tools read it. The sim stores a copy for display/inspection only — it is never part of the reward hash.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `car_color` | str | `"blue"` | tasks use e.g. `"GREEN"` |
| `battery_capacity_kwh` | float | `80` | 60–100, gross kWh |
| `useable_battery_percentage` | float | `95` | 90–100 |
| `max_charging_power_ac` | Literal | `11` | {11, 22} kW |
| `max_charging_power_dc` | Literal | `250` | {150, 200, 250, 268, 300, 350, 1000} kW |
| `energy_consumption` | float | `15` | 10–20 kWh/100km |
| `charging_curve_parameters` | dict | soc_tresholds/power_percentages arrays | note upstream misspelling `soc_tresholds` |
| `state_of_charge` | float | `10` | 10–100 % |
| `seats_occupied` | dict[str,bool] | driver True, others False | keys: `driver, passenger, driver_rear, passenger_rear` |
| `current_location` | object | Munich `loc_mun_9995` | `{id, name, position:{longitude, latitude}}` |
| `current_datetime` | object | 2025-02-14 12:00 | `{year, month, day, hour, minute}` (class name upstream is `CurrenDateTime` — typo is theirs) |
| `user_preferences` | nested object | all empty lists | see `UserPreferences` in the same file |

### 2.3 Task lifecycle

Per task (canonical routine: `_init_context_state`, `interactive_app.py:449`):

1. Fresh `TaskConfig` (holds `calendar_id`), fresh `ContextState()`, fresh `FixedContext()` are set into their ContextVars.
2. **One flat dict**, `task.context_init_config`, is applied via `update_state(**config)` to **both** models — each silently ignores the other's keys. It typically contains every field of both schemas.
3. Runtime error accumulators (`policy_errors_during_runtime`, `tool_execution_errors_during_runtime`, `end_conversation_failure`) are reset to `[]`.
4. The agent/user loop runs (max 40 steps, `car_bench/orchestrator.py`); tools execute in parallel per assistant turn via `asyncio.gather` from worker threads (`car_bench/envs/base.py`, `run_steps`).
5. `call_phone_by_number` is a terminate tool — calling it ends the episode.

There is **no physics, no clock, no movement** in CAR-bench: `current_datetime` is static, charging tools are pure calculators, navigation stores ids only. The world is static except the 31 mutable fields. This is why prompt-drive (which *does* have physics) must never let its autonomous behaviors leak into the mirrored state (§4.5).

### 2.4 Evaluation constraints (these dictate the architecture)

1. **The reward hashes the Pydantic object's `str()`.** `Env.get_context_state_hash` (`car_bench/envs/base.py:314-315`) → `consistent_hash(to_hashable(context_state))`; `to_hashable` (`base.py:45-53`) unwraps only dict/list/set and passes a `BaseModel` through, and `consistent_hash` (`base.py:56-59`) is `sha256(str(value))`. So the hashed value is the model's repr — enum members, float formatting (`20.0` vs `20`), field order, everything.
2. **Ground truth is a replay.** `calculate_state_based_reward` (`car_bench/envs/reward_calculators.py`) swaps a **plain fresh `ContextState`** into the ContextVar, replays `task.actions` through the real tools, hashes, and restores the token. Whatever live proxy we install is absent during replay by construction — replay must (and will) generate zero sim traffic.
3. **Intermediate hashes matter.** At every user-facing turn boundary the env snapshots the state hash; the agent run's hash *set* must be a subset of the GT run's. Therefore **any state change not caused by an agent tool call corrupts evaluation** — this includes a simulator auto-behavior flipping a mirrored field between turns.
4. `calculate_reward` also reads attributes directly off the live object (`base.py:325-328`), and other code calls `model_dump()`. Reads must be local and cheap.

Consequences: Python stays authoritative for the hashed state (§4.1); the sim mirror is write-through with read-back verification; benchmark mode (§4.5) suppresses all non-commanded writes on the sim side so mirror and truth cannot diverge silently.

### 2.5 Tool inventory (57 wired)

Registry: `car_bench/envs/car_voice_assistant/tools/__init__.py` (`ALL_TOOLS`, line 171). 58 tool classes exist; `GetFuelInformation` is commented out (line 119) and broken upstream (reads removed fuel fields) — the car is modeled as **electric only**. The orchestrator strips `think` and `planning_tool` from the agent's toolset by default. Full per-tool mapping in §6.

### 2.6 Policies that couple state fields (simulator-relevant subset)

Source: `car_bench/envs/car_voice_assistant/wiki.md` (the agent system prompt); deterministic checks in `car_bench/envs/policy_evaluator.py`. The **agent** is responsible for satisfying these; the simulator must merely represent the involved fields faithfully. Relevant couplings:

- **AUT-POL:005** — sunroof may open only if sunshade is (or is simultaneously being) fully opened.
- **AUT-POL:009 / LLM-POL:008** — weather must be checked (`get_weather`) before opening sunroof / enabling fog lights in the wrong conditions; confirmation required.
- **AUT-POL:010** — front/all window defrost ON ⇒ fan ≥ 2, airflow includes WINDSHIELD, AC on.
- **AUT-POL:011** — AC ON ⇒ close windows open > 20 %, fan ≥ 1.
- **LLM-POL:007** — window > 25 % while AC on ⇒ confirm + inefficiency warning.
- **AUT-POL:013/014** — fog lights ON ⇒ low beams ON and high beams OFF; high beams cannot be turned on while fog lights are on.
- **LLM-POL:012** — zone temperatures differing > 3 °C ⇒ inform user.
- **AUT-POL:016–019** — navigation ordering rules (start = current location; edit tools only when nav active; sequential edits; route ≥ start+destination).
- **REQUIRES_CONFIRMATION** tools: `send_email`, `open_close_trunk_door`, `set_head_lights_high_beams`.

These are also excellent demo scenarios once visual packages land (e.g. WP-V1 fog + beams interplay, WP-V4 defrost side-effects visible on the climate screen).

---

## 3. prompt-drive today

### 3.1 Relevant existing surface

- **Integration API** `window.PromptDrive` (`src/api/`, built to `static/js/api.js`, documented in [`API.md`](API.md)): schema/introspection, static config staging + apply, dynamic setters (weather, skin, day-night, headlights, autodrive, drive mode, camera, lanes, cruise, grip/speed, FOV, units, hideMenu, virtual drive inputs), telemetry (`t, speed m/s, steerRad, heading, posX/Y/Z, onRoad, wrongWay, headlights, autodrive, driveMode, units, lane, traffic`) at ~10 Hz, event bus, `pause()/resume()`.
- **Transports** — all resolve a dot-path `op` into `window.PromptDrive`, so **any new facade namespace is remotely callable with zero transport changes**: in-page, iframe `postMessage` (`src/api/postmessage.js`), cross-tab `BroadcastChannel` (`src/api/broadcast.js`, envelopes `{ns:'promptdrive', kind:'req'|'res'|'event', id, op, args | result | event, payload}`). **No WebSocket yet** — it was planned as Phase P5 (`prompt-drive-api-plan.md`, branch `origin/claude/prompt-drive-api-plan-eu6mzy`) and never built. §4.4 implements it.
- **Extension pattern** (see `AGENTS.md`): `src/<module>/` ES sources → `scripts/build-<module>.js` concatenates into one IIFE → `static/js/<module>.js` exposing `window.<Global>` → `<script>` tag in `index.html` (order matters: subsystem bundles before `api.js`, `api.js` before `main.*.chunk.js`) → engine wiring via anchored string patches in `scripts/build-main.js` (`replaceOnce` fails loudly on drifted anchors). `window.PromptDriveBridge` (`src/api/bridge.js`) is the engine-handle registry (`handles: {controller, ego, vehicleConfig, sceneConfig, autodrive, units, world, dayNight, speedControl, input, ticker, camera, firstPerson, audioManager, centerConsole, THREE, …}`) + event bus; `whenAttached(fn)` defers work until the sim is running.
- **Center console** (`src/console/`, `window.CenterConsole`): canvas-texture screen in the first-person cabin view, five apps (Map, Nav, Audio, Phone, **Comfort**). The **Comfort app is the climate backend for this plan**: zones `driver/passenger/rear`, each `{tempC, fan, seatHeat}` + global `auto`/`sync` flags, with limits **identical to CAR-bench** — `tempMin 16, tempMax 28` on a 0.5° grid, `fanMax 5`, `seatHeatMax 3` (`src/console/config.js:149-153`; defaults at :162). Programmatic controller: `PromptDrive.console.comfort.get()/set()/reset()` — synchronous, validating, emits `consoleComfort`. Pure UI + localStorage (no physics), which is exactly what we need: a *visible* state display.
- **Instrument cluster** (`src/cluster/`): speed gauge, throttle/"power" gauge, odometer, road worm, autodrive indicator, drive-mode label, clock. No battery/SOC gauge, no telltales for beams/fog — extension points for WP-V1/V5.
- **Engine headlights**: a single on/off spotlight pair on the ego (`src-extracted/deobfuscated.js`, ego class ~:1886–2064). `setHeadlights(e, t = false)` at `deobfuscated.js:2029`; the `t` ("manual") flag suppresses auto-dusk but **is cleared whenever lights turn off** (`manual = (manual||t) && e`), so manual-off does not protect against later auto-on. Un-commanded write paths: day/night blend auto-toggle (`:10873-10875`), weather application forcing `setHeadlights(!!weather.headlights)` (`:11205`, `:13083`), user key `KeyH` (`:19912`), render warm-up (`:20911-20914`). No low/high-beam distinction, no fog lights.

### 3.2 Gap summary

Concepts that **do not exist anywhere** in the sim engine (verified by search): windows, sunroof/sunshade, trunk, door locks, reading lights, ambient/interior lighting, fog lights, high/low beam split, wipers, turn signals, horn, mirrors, seat occupancy (seat settings only move the FP camera), battery/SOC/charging, tire pressure, destination-based navigation (the console Nav/Map apps render the procedural road; no routing), gear selector (P/R/N/D), RPM/tachometer. HVAC/seat-heat/media/phone exist **only** as the center-console infotainment mock. Each gap is dispositioned in §5.

### 3.3 Known defect (fix first): the console is dormant on `main`

`index.html` loads `2.feea8a5f.chunk.js, cluster.js, metrics.js, lanes.js, traffic.js, wheel.js, api.js, main.ca6b3355.chunk.js` — **`console.js` is missing** (verified on current `main`; the tag existed on `feat/center-console` and was dropped in the PR #20 merge, commit `6ef3295`). `static/js/console.js` is built and committed, and all `build-main.js` console patches are in the shipped main bundle, but `window.CenterConsole` is undefined at runtime, so the engine guard no-ops and `PromptDrive.console.*` returns `unavailable`. `vercel.json` (line ~15-16) also omits `console` from the no-cache filename alternation. This is **WP0** — nothing climate-related works until it lands.

---

## 4. Target architecture

```
┌────────────────────────────  Python (car-bench fork)  ───────────────────────────┐
│ orchestrator / env / tools (UNCHANGED)                                           │
│   context_state ──► LiveContextState(ContextState)   ← authoritative, hashed     │
│   fixed_context ──► LiveFixedContext(FixedContext)                               │
│         │ update_state(**kw): super() → mirror diff → read-back verify           │
│         ▼                                                                        │
│   PromptDriveClient  (websockets server, 127.0.0.1:8765, sync thread-safe API)   │
└───────────────▲──────────────────────────────────────────────────────────────────┘
                │ WebSocket  {op,args}/{id,result}/{event,payload}
┌───────────────┴──────────────────────  Browser (prompt-drive)  ──────────────────┐
│ src/api/socket.js (NEW) ── dot-path ops ──► window.PromptDrive.vehicle.* (NEW)   │
│                                                   │                              │
│                              window.VehicleState (NEW src/vehicle/)              │
│                              car-bench-shaped store (31 + fixed)                 │
│                     ┌──────────────┼─────────────────┬─────────────────┐         │
│              linked fields   simulated fields   benchmark locks   events        │
│              ego headlights  (state only)       setHeadlights guard,            │
│              console Comfort                    KeyH filter, dayNight freeze,   │
│              (temps/seat/fan)                   console input lock, hideMenu    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 State ownership: Python-authoritative, sim = write-through mirror

**Decision.** The hashed `ContextState` lives in Python, exactly as today. The sim holds a mirror (`window.VehicleState`) updated write-through on every `update_state`, with read-back verification. Divergences are **reported, never propagated** into the hashed state.

**Why not sim-authoritative:** §2.4-1 makes the hash a function of the Pydantic repr; rehydrating a model from a JS snapshot on every read/hash is a round trip per access and a float/enum re-serialization hazard that would only ever surface as a silent hash mismatch. It would also make a closed tab mid-task fatal. Python-authoritative keeps agent-run and GT-replay hashing byte-identical by construction (same code path, same objects), costs one fire-and-verify round trip (~1–3 ms loopback) per *write* only, and degrades gracefully: sim unreachable ⇒ the run continues as a pure-Python run with `sim_unreachable` divergence warnings (optional strict mode aborts instead).

**Read-back verification.** After each mirrored write the adapter fetches the changed keys (`vehicle.get(keys)`) and diffs against `model_dump(mode='json', include=changed)`. Configurable: `per_write` (default) | `per_task` | `off`. Mismatches append to a divergence list surfaced in run info.

### 4.2 `window.VehicleState` — new module `src/vehicle/`

A store shaped **exactly** like CAR-bench state: all 31 dynamic fields (§2.1 names, enum strings, defaults) plus a fixed-context store (§2.2). Rules:

- Validation clones CAR-bench constraints: integer clamp/reject out-of-range per field table, temperature snapped to the 0.5° grid, enums validated against the string lists, `trunk_door_position` stored as an **unconstrained verbatim string**, lists copied. Invalid values return `{ok:false, error:'bad_value', …}` — mirroring Pydantic's reject rather than silently clamping, so read-back verification can't mask an adapter bug. (Field table lives in `src/vehicle/config.js` as data, like `src/api/config.js` `FIELDS`.)
- **Synchronous and rAF-independent**: `get/set/reset/snapshot` never await a frame, so state ops work in throttled/background/headless tabs even when rendering stalls. (Both projection targets already satisfy this: `console.comfort.set` and `ego.setHeadlights` are synchronous.)
- Works engine-detached (before the begin splash): pure state; linked-field projection begins once `PromptDriveBridge.whenAttached` fires.
- Emits through the bridge bus: `vehicleState` (per-write: `{changed:{…}, snapshot:{…}}`), `vehicleReset {snapshot}`, `vehicleBenchmark {on}`, `vehicleExternalAttempt {field?, source, code?}`.
- Persistence: **none for dynamic state** (a benchmark reset defines it; free-play keeps it session-local). Fixed store likewise session-local.

### 4.3 `PromptDrive.vehicle.*` — new facade namespace

Registered in `src/api/PromptDriveApi.js` beside `traffic`/`console`, guarded with the same `unavailable` pattern. Because transports resolve dot-paths, all of this is immediately callable over postMessage/BroadcastChannel/WebSocket:

| Op | Purpose |
| --- | --- |
| `vehicle.get(keys?)` | full dynamic snapshot, or subset by key list |
| `vehicle.set(partial)` | validate + store + project linked fields (under `_applying`) + emit |
| `vehicle.snapshot()` | `{dynamic, fixed, benchmark, linkedHealth}` |
| `vehicle.reset(initConfig, opts?)` | per-task init, §4.6 |
| `vehicle.benchmark(on, opts?)` | engage/release locks, §4.5 |
| `vehicle.fixed.get()/set(partial)` | fixed-context store |
| `vehicle.ambience(spec)` | optional visual sync, §4.7 |
| `vehicle.navDisplay(meta?)` | display-only route metadata for WP-V6 (`{destinationName, waypointNames[], distanceKm, etaMin}` or `null` to clear) — pushed by the Python adapter because route/POI ids are opaque to the sim |

### 4.4 Transport: WebSocket relay (`src/api/socket.js`) + Python client

**Decision.** Primary transport = WebSocket; the browser connects **out** to a small Python server. This is the repo's own planned-but-unbuilt P5, it gives ~1–3 ms loopback round trips (budget: 1–40 sequential tool calls per task), native server-push for events/telemetry, and works identically for a human-visible desktop browser (the demo case) and headless CI. Playwright is *not* a second transport — at most an optional browser-lifecycle harness (launch/hold the page) while all traffic flows over the same WS. postMessage/BroadcastChannel remain for `api-test.html`.

**Browser side** — `src/api/socket.js`, a clone of `broadcast.js` with a WS instead of a channel:

- Activation: `?ws=<url>&wsToken=<token>` query params (or `localStorage 'pd-ws'`). Absent ⇒ module inert.
- On open, send `{ns:'promptdrive', kind:'hello', role:'sim', token, version:'1.0', url:location.href}`.
- Inbound `{kind:'req', id, op, args}` → same `resolveOp` dot-path dispatch as `broadcast.js:23` → reply `{kind:'res', id, result}`. Errors reply `{kind:'res', id, result:{ok:false, error:'exception', message}}`.
- Outbound: forward every bridge event as `{kind:'event', event, payload}` (subscribe via the bus `any` channel), keep the ~10 Hz `tick` alive while connected.
- Reconnect: exponential backoff 0.5 s → 30 s cap, forever; re-`hello` on reconnect. Native WS ping every 15 s.
- Added to `scripts/build-api.js` file list; documented in `API.md`.

**Python side** — `PromptDriveClient` (lives in the car-bench fork, §4.8; ~200 lines, dependency: `websockets` only):

```python
class PromptDriveClient:
    def __init__(self, host="127.0.0.1", port=8765, token=None, call_timeout=2.0): ...
    def start(self): ...            # websockets server in a daemon thread w/ its own asyncio loop
    def stop(self): ...
    def wait_for_sim(self, timeout=60.0): ...   # blocks until a valid `hello`
    def call(self, op, *args, timeout=None): ...  # sync + thread-safe (futures keyed by id,
                                                  # marshalled via run_coroutine_threadsafe);
                                                  # raises SimUnavailable / SimTimeout
    def try_call(self, op, *args): ...            # -> (ok: bool, result)
    def subscribe(self, event, fn): ...           # 'vehicleState', 'vehicleExternalAttempt', 'tick', …
    def on_sim_connected(self, fn): ...           # used to re-push full state after a reconnect
```

Thread-safety is required: CAR-bench executes tools from worker threads (`base.py` `run_steps` uses `asyncio.gather` inside threads). Auth: server rejects connections with a wrong/missing token; a second `hello` replaces the active sim connection with a logged warning. Launch orchestration: Python starts the server, then opens the browser at `http://localhost:3000/?ws=ws%3A%2F%2F127.0.0.1%3A8765&wsToken=<uuid>&autostart=1&hideMenu=1` (serve the repo statically, e.g. `npm run dev`; local hosting avoids https→ws mixed-content edge cases), then `wait_for_sim()` + `PromptDrive.ready` (poll `vehicle.get` until it answers).

### 4.5 Benchmark mode — "the system never autonomously changes state", literally

`vehicle.benchmark(true, opts?)` engages five locks; every blocked attempt emits `vehicleExternalAttempt` (forwarded to Python and logged as a divergence-class warning):

| # | Lock | Mechanism | Blocks |
| --- | --- | --- | --- |
| 1 | **Headlight hard lock** | New `build-main.js` patch **inside** `setHeadlights(e, t = false) {` (anchor `deobfuscated.js:2029`): early-return unless `!VehicleState._lightsLocked || VehicleState._applying`, emitting the event on block. VehicleState performs its own writes wrapped in `_applying = true; ego.setHeadlights(on, true); _applying = false;` | auto-dusk (`:10873`), weather-forced (`:11205`, `:13083`), `KeyH` engine handler (`:19912`), any stray engine call. (Render warm-up `:20911` predates benchmark engagement — unaffected.) |
| 2 | **Day/night freeze** | record `handles.dayNight.value`, set cycle `0` (off); restore on release | dusk transitions ever starting |
| 3 | **Keyboard filter** | capture-phase `keydown`/`keyup` listener on `window` + `document`, `preventDefault` + `stopImmediatePropagation` for a configurable code list (default `['KeyH']`, extend via `benchmark(true, {blockKeys})`) | user flipping mirrored state from the keyboard |
| 4 | **Console input lock** | new `CenterConsole.setInputLocked(bool)`: pointer events aimed at the screen plane are still swallowed (don't leak to the game) but perform no app routing; synthetic `tap()` returns `{ok:false, error:'locked'}`; emits `consoleInputBlocked {u,v}`. **Programmatic `comfort.controller.set` stays open** — it is VehicleState's own projection path. | touch taps on comfort/audio/phone/layout |
| 5 | **Menu lockdown** | existing `ui.hideMenu` (`PromptDriveHideMenu.set(true)`) | settings panels + bottom-bar toggles |

Not locked (they touch no mirrored field): driving input, pause/resume, cameras, autodrive, cruise, traffic. Weather/skin stay programmatically settable (ambience, §4.7) — lock #1 absorbs the weather system's forced-headlight side effect. `benchmark(false)` restores prior dayNight and hideMenu values, removes the key filter, unlocks the console.

Free-play note: with benchmark off, an optional `VehicleState.follow(true)` may import `consoleComfort` UI changes back into the store. Explicitly out of benchmark scope.

### 4.6 `vehicle.reset(initConfig, opts)` — per-task initialization

**In-place, no page reload** (a reload costs 5–15 s of world regeneration plus a WS reconnect and autostart cycle per task; nothing in the mapped state requires regeneration). Ordered, atomic from the caller's perspective:

1. *(optional, `opts.ambience !== false` and fixed fields present)* apply ambience (§4.7) **first**, so the weather system's forced `setHeadlights` lands before step 3 overrides it.
2. Reset dynamic store to §2.1 defaults and fixed store to §2.2 defaults; apply `initConfig` (one flat dict; unknown keys silently ignored, mirroring `update_state`; values validated with the cloned rules — a rejected value fails the whole reset with `{ok:false}`).
3. Project linked fields under `_applying`: `ego.setHeadlights(head_lights_low_beams, true)`; `comfort.controller.set({driver:{tempC,fan,seatHeat}, passenger:{tempC,fan,seatHeat}, rear:{tempC:<driver temp>, fan, seatHeat:0}, auto:false, sync:false})`.
4. Engage (or re-assert) benchmark locks (`opts.benchmark !== false`, default true).
5. Emit `vehicleReset {snapshot}` and **return the full snapshot** — the adapter diffs it against its own `model_dump(mode='json')` at t0, catching any clamp/serialization mismatch before the task starts.

Sim-only state (ego pose, speed, scene, traffic, metrics run) is left untouched between tasks — the car visibly keeps driving across tasks, which is the desired demo behavior. `opts.repositionNode` may optionally invoke the engine reset-to-node path.

### 4.7 Ambience sync (optional visual flavor, zero eval impact)

Maps task context onto sim visuals. Python resolves the weather condition for `current_location` from CAR-bench's weather DB and passes strings; the sim only receives a preset request.

- **Time slot** from `current_datetime.hour`: 5–8 → `sunrise`-like, 8–17 → `clear`-like, 17–20 → `sunset`-like, 20–5 → `night`-like.
- **Condition override**: contains `rain|thunderstorm|hail` → rain preset; contains `snow` → snow preset (Winter skin); contains `fog` → closest fog-bearing preset (rain, or Autumn `twilight`); else keep the time slot. `night` wins over condition.
- Resolution is **by name-substring** against the active skin's weather list (`world.scene.skinWeatherList`; e.g. Summer `sunrise/clear/rain/sunset/night`, Winter `winterSunrise/clearSnow/snow/winterSunset/nightSnow` — `deobfuscated.js:5291-5349`), applied via the existing `PromptDrive.dynamic.weather(name)` resolver; fall back to index 1 (clear) when nothing matches. `dayNightCycle` stays 0 under benchmark mode, so the preset is static per task.

### 4.8 CAR-bench adapter — `car_bench/envs/car_voice_assistant/live_sim/`

New package in the fork: `__init__.py`, `client.py` (§4.4), `proxies.py`, `lifecycle.py`. **No changes to `base.py`, `reward_calculators.py`, the orchestrator, or any tool.**

`proxies.py`:

```python
class LiveContextState(ContextState):
    # NO new pydantic fields (they would change __str__ and break the hash).
    # Private attrs only, assigned via object.__setattr__ (same pattern as _lock upstream).
    def bind(self, client, verify="per_write"): ...
    def update_state(self, **kwargs):
        super().update_state(**kwargs)          # identical validation + waypoints policy hook
        changed = [k for k in kwargs if k in type(self).model_fields]
        if changed and self._pd_client is not None:
            diff = self.model_dump(mode="json", include=set(changed))  # enums→str, JSON-safe floats
            ok, res = self._pd_client.try_call("vehicle.set", diff)
            # read-back verify per config; failures append to self._pd_divergences,
            # never mutate local state
```

`LiveFixedContext(FixedContext)` mirrors writes to `vehicle.fixed.set`. `lifecycle.py` provides `init_live_context_state(env, idx, client)` — a clone of `interactive_app._init_context_state` (line 449) that (a) instantiates the Live subclasses, (b) calls `client.vehicle_reset(task.context_init_config, {...})` **before** binding write-through (so the local `update_state(**config)` doesn't double-send), (c) binds, (d) asserts the returned snapshot equals `model_dump(mode='json')`, and (e) exposes `finish()` for the end-of-task full-snapshot parity check + divergence report. Wiring: an `--live-sim` flag (or `CAR_BENCH_LIVE_SIM=1` + `CAR_BENCH_WS_PORT/TOKEN`) in `interactive_app.py` switches init to the live variant; `on_sim_connected` re-pushes `vehicle.set(full dump)` + `benchmark(true)` after any reconnect (Python is authoritative). GT replay (§2.4-2) instantiates plain `ContextState` and therefore never touches the sim — during scoring the sim keeps displaying the agent's final state, which is correct.

---

## 5. Field mapping

Legend — **LINKED**: drives existing sim visuals in the baseline. **SIM**: simulated default state in the baseline (round-trips correctly, no visual effect). **→WP-Vn**: optional visual package upgrades it (§7).

### 5.1 Dynamic fields (all 31)

| CAR-bench field | Baseline backing | Exact sim target / notes | Visual upgrade |
| --- | --- | --- | --- |
| `head_lights_low_beams` | **LINKED** | `ego.setHeadlights(on, true)` under `_applying` (engine spotlights; `PromptDrive.telemetry.state().headlights` reflects it) | WP-V1 refines into a true low beam |
| `climate_temperature_driver` | **LINKED** | `console.comfort` `driver.tempC` — identical range/step (16–28 × 0.5) | — (already visible on console) |
| `climate_temperature_passenger` | **LINKED** | `console.comfort` `passenger.tempC` | — |
| `seat_heating_driver` | **LINKED** | `console.comfort` `driver.seatHeat` (0–3, identical) | — |
| `seat_heating_passenger` | **LINKED** | `console.comfort` `passenger.seatHeat` | — |
| `fan_speed` | **LINKED** | projected to **all three** comfort zones' `fan` (coherent single-fan story on screen); driver zone is the canonical read-back | — |
| `head_lights_high_beams` | SIM | pure state in baseline — deliberately *not* boosting the single spotlight pair (keeps baseline behavior trivially predictable) | →WP-V1 |
| `fog_lights` | SIM | | →WP-V1 |
| `ambient_light` | SIM | 10-value color enum stored verbatim | →WP-V2 |
| `reading_light_driver` / `_passenger` / `_driver_rear` / `_passenger_rear` | SIM | | →WP-V2 |
| `window_driver_position` / `_passenger_` / `_driver_rear_` / `_passenger_rear_` | SIM | 0–100 ints | →WP-V3 |
| `sunroof_position` / `sunshade_position` | SIM | 0–100 ints | →WP-V3 |
| `trunk_door_position` | SIM | **verbatim free string** (`"closed"` default; tools write `"OPEN"`/`"CLOSE"`) — never normalize case | none (not visible from the cabin) |
| `window_front_defrost` / `window_rear_defrost` | SIM | | →WP-V4 |
| `fan_airflow_direction` | SIM | 7-value enum verbatim | →WP-V4 |
| `air_conditioning` | SIM | note: console `auto` flag is *not* this — kept independent | →WP-V4 |
| `air_circulation` | SIM | 3-value enum verbatim | →WP-V4 |
| `steering_wheel_heating` | SIM | 0–3 | →WP-V4 |
| `navigation_active` | SIM | | →WP-V6 |
| `waypoints_id` / `routes_to_final_destination_id` | SIM | ids are opaque to the sim; human-readable metadata arrives via `vehicle.navDisplay` | →WP-V6 |
| `email_addresses_sent_mail_to` | SIM | append-only log, stored verbatim | none |
| `phone_numbers_called` | SIM | console Phone app contacts are fictional and disjoint from CAR-bench's contact DB — deliberately **not** linked | none |

Comfort extras with no CAR-bench counterpart (`rear` zone temp/seatHeat, `auto`, `sync` flags): frozen at `vehicle.reset` in benchmark mode (`auto:false, sync:false`, rear temp = driver init temp for cosmetic coherence, rear seatHeat 0) and held by the console input lock. `sync`'s driver-copy behavior (`ComfortApp` mirrors driver temp/fan) would fight per-zone temperatures, and an active `auto` badge would imply autonomous behavior — both contradict the benchmark world model.

### 5.2 Fixed context (all 12)

| Field | Sim use |
| --- | --- |
| `state_of_charge` | stored in `VehicleState.fixed` | →WP-V5 cluster SOC gauge |
| `battery_capacity_kwh`, `useable_battery_percentage`, `energy_consumption`, `max_charging_power_ac/dc`, `charging_curve_parameters` | stored for inspection (charging tools compute in Python) |
| `current_datetime` | stored; drives ambience time slot (§4.7) |
| `current_location` | stored; weather-lookup key for ambience (resolved Python-side); optional city label in WP-V6 card |
| `seats_occupied` | stored — this is exactly the "simulated state without visible results" case: `get_seats_occupancy` answers from it (e.g. driver-only = 1 occupant) with no visual counterpart |
| `car_color` | stored for inspection (`get_car_color`); vehicle paint is not an exposed engine field — visual mapping out of scope |
| `user_preferences` | stored for inspection (read only by `get_user_preferences` in Python) |

---

## 6. Tool mapping (all 57 wired tools)

"Backend" says where the tool's effect/answer lives once the adapter is installed. **Every tool keeps its Python implementation, schema, validation, and error codes unchanged** — sim involvement happens only through the state proxies.

### Vehicle SET — 17 tools → `LiveContextState.update_state` → mirrored to `vehicle.set`

| Tool | Fields written | Sim effect (baseline) |
| --- | --- | --- |
| `set_head_lights_low_beams` | `head_lights_low_beams` | **engine headlights toggle (visible)** |
| `set_climate_temperature` | `climate_temperature_driver/_passenger` (zones ALL_ZONES/DRIVER/PASSENGER) | **console Comfort temp readout (visible)** |
| `set_seat_heating` | `seat_heating_driver/_passenger` | **console Comfort seat-heat pips (visible)** |
| `set_fan_speed` | `fan_speed` | **console Comfort fan gauge, all zones (visible)** |
| `set_head_lights_high_beams` *(REQUIRES_CONFIRMATION)* | `head_lights_high_beams` | state only → WP-V1 |
| `set_fog_lights` | `fog_lights` | state only → WP-V1 |
| `set_ambient_lights` | `ambient_light` | state only → WP-V2 |
| `set_reading_light` | one of 4 `reading_light_*` | state only → WP-V2 |
| `open_close_window` | 1–4 `window_*_position` (window enum incl. ALL, RIGHT_REAR≡DRIVER_REAR, LEFT_REAR≡PASSENGER_REAR) | state only → WP-V3 |
| `open_close_sunroof` / `open_close_sunshade` | `sunroof_position` / `sunshade_position` | state only → WP-V3 |
| `open_close_trunk_door` *(REQUIRES_CONFIRMATION)* | `trunk_door_position` = `"OPEN"`/`"CLOSE"` | state only |
| `set_window_defrost` | `window_front_defrost`/`window_rear_defrost` | state only → WP-V4 |
| `set_fan_airflow_direction` | `fan_airflow_direction` | state only → WP-V4 |
| `set_air_conditioning` | `air_conditioning` | state only → WP-V4 |
| `set_air_circulation` | `air_circulation` | state only → WP-V4 |
| `set_steering_wheel_heating` | `steering_wheel_heating` | state only → WP-V4 |

### Vehicle GET — 12 tools → read `LiveContextState` / `LiveFixedContext` attributes (local, zero latency; values match the sim by §4.1 write-through + verification)

`get_exterior_lights_status` (fog + low/high beams), `get_temperature_inside_car`, `get_climate_settings` (fan, airflow, AC, circulation, defrost), `get_seat_heating_level`, `get_steering_wheel_heating_level`, `get_ambient_light_status_and_color`, `get_reading_lights_status`, `get_vehicle_window_positions`, `get_sunroof_and_sunshade_position`, `get_trunk_door_position`, `get_seats_occupancy` (fixed store — simulated occupancy), `get_car_color` (fixed store).
*(58th tool `get_fuel_information` stays disabled — electric-only model.)*

### Navigation — 6 GET + 7 SET

GET (`get_location_id_by_location_name`, `get_routes_from_start_to_destination`, `search_poi_at_location`, `search_poi_along_the_route`, `get_current_navigation_state`, `convert_route_distance_and_time`): **pure Python** over the JSONL databases; `get_current_navigation_state` reads the proxy's nav fields.
SET (`set_new_navigation`, `navigation_add_one_waypoint`, `navigation_replace_one_waypoint`, `navigation_replace_final_destination`, `navigation_delete_waypoint`, `navigation_delete_destination`, `delete_current_navigation`): Python validation + `update_state` on `navigation_active`/`waypoints_id`/`routes_to_final_destination_id` → mirrored. With WP-V6, the adapter additionally resolves names/distances from the route DB and pushes `vehicle.navDisplay(meta)` after each successful nav-set (and `navDisplay(null)` after delete) so the console Nav app can render a destination card.

### Charging — 4 tools (pure Python calculators)

`get_charging_specs_and_status`, `get_distance_by_soc`, `calculate_charging_time_by_soc`, `calculate_charging_soc_by_time` — read the fixed store's battery fields + POI plug data; nothing to mirror (SOC never changes during a task). WP-V5 merely displays SOC.

### Weather / productivity / preferences / cross-domain — pure Python

`get_weather` (weather DB; current-day gate AUT-POL:024 — optionally the same condition string feeds ambience §4.7), `get_contact_id_by_contact_name`, `get_contact_information`, `get_entries_from_calendar` (calendar DB; AUT-POL:023), `send_email` *(REQUIRES_CONFIRMATION;* appends to `email_addresses_sent_mail_to` → mirrored*)*, `call_phone_by_number` (appends to `phone_numbers_called` → mirrored; **terminate tool** — episode ends), `get_user_preferences`, `calculate_math`, `calculate_datetime`, `think` (no-op), `planning_tool` (no-op scratchpad; `think`/`planning_tool` are stripped from the agent's toolset by default).

---

## 7. Work packages

Conventions for implementers: never edit built `static/js/*.js` bundles — edit `src/**` and rebuild (`npm run build`); keep LF line endings (CRLF silently breaks `build-main.js` anchors); keep injected engine code defensive (`typeof X !== 'undefined'`, try/catch). See `AGENTS.md`.

### WP0 — Restore the center console (regression fix) — **XS**

- **Goal:** make `window.CenterConsole` load on `main` again (climate backend for the linked fields).
- **Files:** `index.html` — add `<script src="./static/js/console.js?v=…"></script>` between `wheel.js` and `api.js` (match the existing versioned-tag style); `vercel.json` — extend the no-cache filename alternation `(api|cluster|metrics|lanes|traffic|wheel)` with `console` (and pre-add `vehicle` for WP1).
- **Depends on:** —
- **Acceptance:** after `npm run dev`, in first-person camera the console renders and responds to taps; `PromptDrive.console.state()` returns `{ok:true, …}`; `PromptDrive.console.comfort.get()` returns zone data.

### WP1 — `window.VehicleState` store (`src/vehicle/`) — **M**

- **Goal:** the CAR-bench-shaped store per §4.2 (31 dynamic fields + fixed store), engine-independent.
- **Files (new):** `src/vehicle/config.js` (field table: names verbatim from §2.1, defaults, clamps incl. 0.5° snap, enum string lists, trunk = free string; fixed-context defaults from §2.2), `src/vehicle/VehicleState.js` (store + validate + `get/set/reset/snapshot/fixed` + event emission via `PromptDriveBridge` when present), `scripts/build-vehicle.js` (clone `scripts/build-console.js`; assign `window.VehicleState`). **Modified:** `package.json` (add `build:vehicle` before `build:api` in the chain), `index.html` (script tag after `console.js`, before `api.js`).
- **Depends on:** — (parallel with WP0).
- **Acceptance:** in a browser console with the sim **not** started: set/get/reset round-trips every field; out-of-range/enum-invalid values return `{ok:false, error:'bad_value'}` (parity check against §2.1 table, field by field: e.g. `sunroof_position: -1` rejected, `climate_temperature_driver: 21.3` rejected, `21.5` accepted, `trunk_door_position: "OPEN"` stored verbatim, unknown keys ignored by `reset`/`set` init path); `snapshot()` returns defaults matching §2.1/§2.2 exactly.

### WP2 — `vehicle.*` facade namespace + WebSocket transport — **M**

- **Goal:** remote real-time access per §4.3/§4.4.
- **Files:** `src/api/PromptDriveApi.js` (register the `vehicle` namespace next to `traffic`/`console`, same guard pattern; delegate to `window.VehicleState`), **new** `src/api/socket.js` (per §4.4: query-param activation, hello/req/res/event envelopes, reconnect/backoff, event forwarding), `scripts/build-api.js` (add `socket.js` to the file list), `API.md` (document `vehicle.*` + the WS transport).
- **Depends on:** WP1 (namespace can be built against a stub first; protocol in §4.4 + Appendix A is frozen — WP4 builds against it in parallel).
- **Acceptance:** a ≤30-line Python script using `websockets` (serve, accept hello, send `{kind:'req', op:'vehicle.set', args:[{fan_speed:3}]}`) receives `{ok:true,…}`, a `vehicleState` event, and periodic `tick` events; killing and restarting the Python server reconnects within 5 s (backoff visible in console); wrong token ⇒ connection closed.

### WP3 — Linkage, benchmark mode, reset, ambience — **L**

- **Goal:** §4.5 + §4.6 + §4.7 and the linked-field projections of §5.1.
- **Files (new):** `src/vehicle/link.js` (projection to `console.comfort` + `ego.setHeadlights` under `_applying`; keyboard filter; dayNight freeze/restore; reset ordering; comfort-extras freeze), `src/vehicle/ambience.js` (§4.7 mapping, resolves via `dynamic.weather`). **Modified:** `scripts/build-main.js` (ONE new anchored patch inside `setHeadlights(e, t = false) {` at `deobfuscated.js:2029` implementing lock #1 — verify the anchor string first), `src/console/CenterConsole.js` (`setInputLocked(bool)` + guards in the pointer handler and `tap()`), `scripts/build-vehicle.js` (include `link.js`/`ambience.js`).
- **Depends on:** WP0, WP1 (WP2 to exercise remotely).
- **Acceptance:** with sim running and `vehicle.benchmark(true)`: (a) pressing `H` does **not** change `telemetry.state().headlights` and emits `vehicleExternalAttempt {source:'keyboard'}`; (b) `dynamic.weather('night')` (or rain) does **not** flip headlights and emits `vehicleExternalAttempt {source:'engine'}`; (c) console taps do nothing and emit `consoleInputBlocked`; (d) `vehicle.reset(<task base_0-style config>)` sets comfort temps/fan/seat-heat and engine headlights to the config values and returns a snapshot equal to `vehicle.get()`; (e) `vehicle.benchmark(false)` restores dayNight + menu and KeyH works again; (f) `vehicle.set({head_lights_low_beams:true})` still works while locked (the `_applying` path).

### WP4 — CAR-bench adapter (`live_sim/`, in the car-bench fork) — **M**

- **Goal:** §4.8 — client, proxies, lifecycle, wiring flag. No changes to env/tools/eval.
- **Files (new, in car-bench):** `car_bench/envs/car_voice_assistant/live_sim/{__init__,client,proxies,lifecycle}.py`. **Modified:** `interactive_app.py` (`--live-sim`/env-var switch selecting `init_live_context_state`), fork README (run instructions).
- **Depends on:** protocol freeze (§4.4/Appendix A); testable against WP2.
- **Acceptance:** (a) **hash-parity property test**: for randomized field-value sets, `LiveContextState` (unbound) and `ContextState` produce byte-identical `str()`, `model_dump()`, and `consistent_hash(to_hashable(...))`; (b) all set-tools mutate an unbound `LiveContextState` identically to stock (client=None ⇒ pure passthrough); (c) with a mock client, `update_state` sends exactly the changed keys as JSON-mode dumps; (d) sim unreachable ⇒ warnings + run completes; strict mode ⇒ raises; (e) concurrent `update_state` calls from threads don't interleave corruptly (existing lock + client thread-safety).

### WP5 — End-to-end verification — **M**

- **Goal:** prove the compatibility contract of §1.
- **Files:** car-bench `tests/test_live_sim_parity.py`; prompt-drive `api-test.html` (new **Vehicle** tab: 31-field live panel, benchmark toggle, reset-JSON box, `vehicleExternalAttempt` log — clone an existing tab); README/`API.md` headless notes.
- **Method:** for ≥10 tasks spanning climate, lights, windows/sunroof, and navigation (e.g. from `docs/reference_data/tasks/tasks_base.py`): run `env.reset` + replay `task.actions` through `env.step` with `--live-sim` (no LLM needed — deterministic), assert `r_actions_final == 1`, `r_actions_intermediate == 1`, and an empty divergence list; re-run pure-Python and diff final `model_dump()` — must be equal. Then one full LLM-agent task run live vs pure, same reward. Headless notes: launch Chromium with `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding` (rAF throttling pauses *rendering/world-gen* in hidden tabs; `VehicleState` ops are deliberately rAF-independent, §4.2, so state parity holds even throttled — include one backgrounded-tab test to prove it).
- **Depends on:** WP1–WP4.

### Optional visual packages (independent; each upgrades SIM fields to visible behavior)

Each package: expected functionality, integration point, acceptance criteria. All read state exclusively from `window.VehicleState` via the `vehicleState` event — none may write state in benchmark mode.

#### WP-V1 — High/low beam split + fog lights — **S/M**
- **Functionality:** `head_lights_low_beams` keeps today's spotlight look. `head_lights_high_beams=true` (with low on or alone) visibly intensifies and lengthens the beams: intensity ×~2 and the spotlight target pushed further ahead. `fog_lights=true` renders a distinct cue — v1 may be a cluster telltale only; v1.1 adds two short, wide, low-mounted cones. Cluster shows standard telltales: green low-beam, blue high-beam, green fog lamp.
- **Integration:** extend the WP3 `setHeadlights` patch region in `scripts/build-main.js` with a beam-mode multiplier read from `VehicleState` (the headlight intensity update path is adjacent to `deobfuscated.js:2029-2042`); telltale glyphs in `src/cluster/icons.js` + a small zone in `src/cluster/InstrumentCluster.js`/`layout.js`.
- **Acceptance:** toggling high beams with low on visibly changes throw/intensity in chase and first-person cameras; all three telltales reflect state within one frame of `vehicle.set`; with both new fields false, rendering is pixel-equivalent to today; benchmark lock still blocks non-`_applying` writes.

#### WP-V2 — Ambient cabin light + reading lights — **M**
- **Functionality:** `ambient_light` tints the cabin in first-person view with the enum color (one interior point light + optional emissive trim strip; `OFF` removes it; exact color map for the 9 colors in `src/vehicle/config.js`). The four `reading_light_*` fields each toggle a small warm-white point light at the corresponding seat position.
- **Integration:** no engine patch needed — `src/vehicle/link.js` creates lights with `PromptDriveBridge.handles.THREE` parented to `handles.ego.geo`; re-attach on vehicle-change events (the console does the same via `resetForVehicleChange`).
- **Acceptance:** each enum color visibly and distinctly tints the cabin in FP camera; `OFF` returns to stock; the 4 reading lights toggle independently; exterior cameras show no effect beyond window glow; frame-rate impact < 5 %.

#### WP-V3 — Window glass + sunroof/sunshade visuals (experimental) — **L**
- **Functionality:** per-window translucent glass plane in the cabin whose top edge lowers proportionally to `window_*_position`; a roof aperture whose opening tracks `sunroof_position` with a sliding opaque shade tracking `sunshade_position`, letting sky light into the cabin.
- **Integration:** geometry added to the interior model from `src/vehicle/link.js` (or a `build-main.js` patch if the interior mesh must be split). The interior anchor-mesh discovery pattern is in `src/console/CenterConsole.js` (`_findAnchor`, `INTERIOR_MESH`).
- **Mandated fallback:** if the interior meshes don't decompose cleanly, ship **indicator glyphs instead** — window/sunroof percent readouts on the cluster or a console status strip — and keep the package "done". State round-trips are already guaranteed by WP1 either way.
- **Acceptance:** positions 0/50/100 are visually distinct in FP view (or fallback readouts match state); no z-fighting artifacts in exterior cameras; state behavior unchanged.

#### WP-V4 — Console Climate screen (full HVAC display) — **M**
- **Functionality:** extend the Comfort app with a second pane/row rendering the remaining HVAC state: AC on/off badge, front/rear defrost buttons, 7-value airflow-direction pictogram (feet/head/windshield combinations), 3-state circulation selector, steering-wheel-heat 0–3 pips. Values come from `VehicleState`; in benchmark mode the pane is display-only (input lock); in free-play, taps write to `VehicleState` and emit `vehicleState`.
- **Integration:** `src/console/apps/ComfortApp.js` + `src/console/config.js` (layout constants, icons); subscribes to `vehicleState` via `PromptDriveBridge`.
- **Acceptance:** all six field groups render current values within one frame of `vehicle.set`; benchmark-mode taps emit `consoleInputBlocked` and change nothing; free-play taps round-trip through `VehicleState`; existing three-zone pane unaffected.

#### WP-V5 — Cluster SOC/battery gauge — **S/M**
- **Functionality:** a battery/SOC arc + percentage readout on the instrument cluster fed from `VehicleState.fixed.state_of_charge` (static per task; the fixed default 10 % renders as a low-battery state). Optional low-SOC tint below 20 %.
- **Integration:** `src/cluster/InstrumentCluster.js` + `src/cluster/layout.js` (new zone; the arc-gauge drawing helper already exists), reading via a bridge subscription set up in `src/vehicle/link.js` or directly from `window.VehicleState`.
- **Acceptance:** gauge shows the init SOC immediately after `vehicle.reset`; defaults render correctly with no fixed context set; no regression to the speed/power/odometer zones.

#### WP-V6 — Nav app destination card — **S/M**
- **Functionality:** when `navigation_active` is true and `vehicle.navDisplay(meta)` has been pushed, the console Nav app renders a header card: destination name, waypoint count/names, total distance km / ETA, and a "NAV ACTIVE" badge; the card clears on `navDisplay(null)` or `navigation_active=false`. The existing lane-view rendering is untouched.
- **Integration:** `src/console/apps/NavApp.js` (header band above the current view); `vehicle.navDisplay` op from WP2; Python adapter pushes metadata after successful nav-set tools (§6).
- **Acceptance:** in a live task, `set_new_navigation` makes the card appear with the destination name within one turn; `delete_current_navigation` clears it; no card when metadata was never pushed.

---

## 8. Execution order & parallelism

```
WP0 ──┐
      ├──► WP3 ──► WP5
WP1 ──┤
      └──► WP2 ──┘
WP4 (parallel once §4.4/Appendix A protocol is frozen; integration-tested against WP2)

After WP1 (and WP0/WP3 where console/locks are involved):
WP-V1 … WP-V6 fully independent of each other — parallel agents OK.
```

- WP0 and WP1 both touch `index.html` — land sequentially (either order).
- Freeze the protocol (Appendix A) before starting WP4 so the Python and browser sides don't drift.
- Recommended reviewer checks per PR: `npm run build` passes (anchored patches fail loudly), `api-test.html` still works over BroadcastChannel, and for engine patches, diff the built `static/js/main.ca6b3355.chunk.js` only via rebuild (never hand-edit).

---

## 9. Global verification strategy

1. **Hash parity (WP4 AC-a)** is the keystone: if `LiveContextState` is byte-identical to `ContextState` in `str()`/`model_dump()`, evaluation math is untouched no matter what the sim does.
2. **Deterministic replay parity (WP5)** proves the full loop (adapter → WS → facade → store → linked visuals) without LLM cost or nondeterminism.
3. **Benchmark-mode adversarial checks (WP3 AC)** prove no un-commanded writes: keyboard, weather, dusk, console taps.
4. **Divergence telemetry** (read-back verify + `vehicleExternalAttempt` events) turns any residual leak into a visible warning instead of a silent hash failure.
5. **One live LLM run** (WP5) as the end-to-end smoke test: same reward live vs pure.

---

## Appendix A — WebSocket protocol (frozen for WP2/WP4)

Namespace `ns:'promptdrive'` (matches `src/api/broadcast.js:8-10`). Default endpoint `ws://127.0.0.1:8765`.

```jsonc
// browser → server, once per (re)connect
{ "ns":"promptdrive", "kind":"hello", "role":"sim", "token":"<uuid>", "version":"1.0", "url":"http://localhost:3000/?..." }

// server → browser (request)          // op = dot-path into window.PromptDrive
{ "ns":"promptdrive", "kind":"req", "id": 17, "op":"vehicle.set", "args":[{ "fan_speed": 3 }] }

// browser → server (response; result is the facade's {ok,...} object)
{ "ns":"promptdrive", "kind":"res", "id": 17, "result": { "ok": true, "value": { "fan_speed": 3 } } }

// browser → server (events, unsolicited)
{ "ns":"promptdrive", "kind":"event", "event":"vehicleState", "payload": { "changed": {"fan_speed":3}, "snapshot": { /* 31 fields */ } } }
{ "ns":"promptdrive", "kind":"event", "event":"vehicleExternalAttempt", "payload": { "field":"head_lights_low_beams", "source":"engine" } }
{ "ns":"promptdrive", "kind":"event", "event":"tick", "payload": { /* telemetry */ } }
```

Rules: unknown `op` ⇒ `res` with `{ok:false, error:'unknown_op'}`; exceptions ⇒ `{ok:false, error:'exception', message}`; server closes on bad token; a new `hello` supersedes the previous sim connection (log a warning); client (Python) call timeout default 2 s ⇒ `SimTimeout`; no connection ⇒ `SimUnavailable`; browser reconnects with backoff 0.5 s → 30 s; Python re-pushes full state + `benchmark(true)` on `on_sim_connected`.

## Appendix B — Ambience mapping (reference table)

| Input | Preset intent | Name-substring match against active skin list |
| --- | --- | --- |
| hour 5–8 | sunrise | `sunrise` (`springSunrise`, `winterSunrise`, …) |
| hour 8–17 | clear | `clear` (`clearSpring`, `clearSnow`, …) |
| hour 17–20 | sunset | `sunset` / `twilight` |
| hour 20–5 | night | `night` (`nightSnow`) — wins over condition |
| condition ~ rain/thunderstorm/hail | rain | `rain` |
| condition ~ snow | snow | `snow` (Winter skin) |
| condition ~ fog | closest wet/dim preset | `rain`, else `twilight` |
| no match | clear | fall back to weather index 1 |

## Appendix C — Serialization gotchas (source of hash bugs; read before coding)

1. Floats: Python `20` assigned to a float field prints as `20.0` in the model repr; JS JSON gives `20`. Only Python-side values are hashed (§4.1), so this is a *verification* concern: compare using `model_dump(mode='json')` on the Python side vs the sim snapshot, both JSON-normalized.
2. `trunk_door_position` casing: default `"closed"`, tool writes `"OPEN"`/`"CLOSE"`. Store and compare verbatim.
3. Enums serialize to plain strings in `model_dump()`; init configs use those strings (`"ambient_light":"YELLOW"`). The sim store keeps plain strings everywhere.
4. `update_state` ignores unknown keys — `vehicle.reset`/`vehicle.set`'s init path must do the same (a strict-reject there would break `context_init_config` application).
5. Four tools' names differ from their class/file names: `get_vehicle_window_positions` (class `GetWindowPositions`), `get_charging_specs_and_status` (`GetChargingStatus`), `navigation_delete_destination` (`NavigationDeleteFinalDestination`), `navigation_delete_waypoint` (`NavigationDeleteOneWaypoint`).
6. `call_phone_by_number` terminates the episode (`env.terminate_tools`).

## Appendix D — Key file reference

**car-bench** (read-only for this plan except `interactive_app.py` + new `live_sim/`):
`car_bench/envs/car_voice_assistant/context/dynamic_context_state.py` (ContextState; `update_state` :180) · `context/fixed_context.py` (FixedContext) · `tools/__init__.py` (`ALL_TOOLS` :171) · `envs/base.py` (`to_hashable` :45, `consistent_hash` :56, `get_context_state_hash` :314, `run_steps`, `calculate_reward` :317) · `envs/reward_calculators.py` (GT replay) · `envs/policy_evaluator.py` (deterministic policy checks) · `envs/car_voice_assistant/wiki.md` (19 policies / system prompt) · `interactive_app.py` (`_init_context_state` :449) · `docs/reference_data/tasks/tasks_base.py` (full `context_init_config` example, task `base_0`).

**prompt-drive:**
`src/api/config.js` (FIELDS pattern to copy) · `src/api/PromptDriveApi.js` (facade; namespace registration pattern) · `src/api/bridge.js` (handles + event bus + `whenAttached`) · `src/api/broadcast.js` (envelope + `resolveOp` template for `socket.js`) · `src/console/config.js` (COMFORT_LIMITS :149) · `src/console/apps/ComfortApp.js` (comfort controller = projection target; WP-V4 host) · `src/console/CenterConsole.js` (input handling for the lock; interior-mesh anchoring for WP-V2/V3) · `src/cluster/InstrumentCluster.js` + `layout.js` + `icons.js` (WP-V1/V5) · `scripts/build-main.js` (anchored patches; bridge attach handle list) · `scripts/build-console.js` (build-script template) · `src-extracted/deobfuscated.js` (`setHeadlights` :2029; auto-dusk :10873; weather-forced :11205/:13083; KeyH :19912) · `index.html` + `vercel.json` (WP0/WP1 wiring) · `AGENTS.md` (conventions) · `API.md` (public API docs to extend).
