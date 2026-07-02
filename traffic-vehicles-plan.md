# Traffic Road Actors — Design & Plan

> **Implemented** on branch `feat/traffic-vehicles` (2026-07-02). What shipped matches
> this plan with four deviations discovered against the real engine:
>
> 1. **Out-of-view spawning (§6)** — a pure camera-frustum rule can never pass ahead of a
>    forward-looking camera on a straight, so **ahead spawns are placed beyond the fog's
>    hiding distance** (`fog.near · 1.05`, read live) where a car is a fully fogged-out
>    dot; behind spawns keep the frustum test. And the engine **retains road-midline
>    nodes only from the ego's node forward** (the head of the node list tracks the
>    vehicle, `deobfuscated.js` midline `update()`), so *driving* spawns behind the ego
>    are structurally impossible — traffic appears behind the ego naturally as it is
>    overtaken (retired nodes keep their `next` links, so overtaken vehicles keep
>    driving; oncoming vehicles are recycled shortly after passing the ego when they
>    reach the severed `prev` chain). The recycle corridor is [−400 m, +1200 m].
> 2. **Autodrive ego-lane fix** — the ego autopilot's target offset was `Yt/2`
>    (half the road half-width): correct for the default 1+1 carriageway but the
>    **lane-1/lane-2 boundary** on multi-lane roads, while markings and metrics use the
>    per-node ego-lane centre. `updateTarget()`/`resetToNode()` now use
>    `node.laneEgoRatio · node.w` on non-default roads (per-node, so lane-change tapers
>    still apply); default roads keep `Yt/2` exactly. Verified: ego lat 1.6 on a 2+2
>    road (was 3.2), unchanged ≈1.5 on default 1+1.
> 3. **Ego collision response (§7)** — a one-shot wheel-impulse let the ego tunnel
>    through at speed. Shipped: a **per-contact-frame velocity cap** — wheel velocity is
>    derived by the engine as `(worldPos − pPos)/pdT`, so writing
>    `pPos = worldPos − vTarget·dt` each frame of overlap caps the ego's along-road
>    speed to the NPC's (with a small bounce) and feeds momentum into the NPC. Event /
>    scrape audio / metrics-collision fire once per contact episode via
>    `didCollide`/`collisionStrength`.
> 4. **Default 1+1 + traffic (§3)** — implemented as proposed via a latched
>    `trafficLaneCentred()` check in `laneSync` (isDefault forced off while traffic is
>    enabled; latched at scene init so the ego line can never jump mid-drive).
> 5. **Signed-lateral frame (post-release fix)** — the engine has TWO opposite lateral
>    conventions: the node normal `n` points one way, while `ii()`'s `d·s` (the frame
>    `egoCenterSigned`, the metrics and the markings use, and the frame this plan's lane
>    convention lives in) is its NEGATIVE — verified empirically: a vehicle placed at
>    `n·(−1.5)` projects to `d·s = +1.5`. Traffic v1 placed vehicles along `+n`, which put
>    every actor in the MIRROR lane: oncoming traffic drove head-on down the ego's lane
>    (the ego autopilot lands on the `d·s`-positive side because the default
>    `autodriveSide` is −1). World offsets are now applied along `−n`
>    (`TrafficManager._roadPoint`), the barrier clamps swapped sides accordingly, and —
>    since "None"(0)/"Right"(+1) side settings would steer the autopilot onto the divider
>    or into the oncoming lane — the autopilot's side is overridden to the forward lane
>    (−1) whenever traffic is enabled. Verified: 8 consecutive head-on passes at 15 m/s
>    with 3.75 m closest approach and zero collision events.
>
> Engine glue lives directly in `src-extracted/deobfuscated.js` (lanes precedent):
> the `trafficTick()` seam after `var si = $t;`, one call in the view update after
> `zl.update(e, t)`, and the two autodrive offsets. Everything else is the
> `src/traffic/` bundle (`window.RoadTraffic`).

**Status:** Implemented (v1). Branch `feat/traffic-vehicles`, 2026-07-02.
**Scope:** Add AI-controlled traffic vehicles alongside the ego vehicle: constant-speed
lane-following autopilot, physics + collisions, random colors, out-of-view spawning, a
front anti-collision sensor, and a "stopped vehicle ahead" scriptable event — configurable
statically (before launch) and triggerable dynamically via settings UI or the
`window.PromptDrive` API.

All line numbers refer to [`src-extracted/deobfuscated.js`](src-extracted/deobfuscated.js)
(the deobfuscated engine that `scripts/build-main.js` compiles into
`static/js/main.ca6b3355.chunk.js`). Symbols verified against the current tree.

---

## 1. Requirements → design mapping

| # | Requirement | Design answer (section) |
| --- | --- | --- |
| R1 | Autopilot at constant speed, stays in lane | Kinematic lane-follower on the road midline (§5) |
| R2 | Speed set by default or in static traffic config | `pd-traffic-config` store + settings UI + `config.set({traffic})` (§3) |
| R3 | Physics: collide with ego / barriers | Simplified rigid response + engine collision seam (§7) |
| R4 | Random color per vehicle | Seeded palette, cloned body material per NPC (§4) |
| R5 | Spawned out of view (ahead or behind) | Distance + camera-frustum spawn rule, recycle corridor (§6) |
| R6 | Front sensor; slow/stop for obstacles in lane | Node-walk lead-vehicle scan + follow/brake controller (§5.3) |
| R7 | Stopped-vehicle event at distance X, lane L, via settings or API | `RoadTraffic.spawnStopped()` + `PromptDrive.traffic.*` + panel button (§8) |

## 2. Engine integration map (verified)

| Symbol | Line | What it is / why traffic needs it |
| --- | --- | --- |
| `be` / `Ae = new be()` | 1887 / 2064 | Ego vehicle model (THREE.Group): `position`, `vel`, `speed`, `heading`, `wheels{width,length,radius}`. Traffic reads ego pose for sensors/collisions. |
| `Ne` / `je` / `ze` | 2142 / 2560 / 2566 | Vehicle definitions (Roadster, Bike, Coach): `bodyObj`/`wheelObj` OBJ urls, `wheels` dims, skins. Traffic clones these assets. |
| `$t` → `si` | 3214 / 3399 | Road midline state: linked node list (`head`/`tail`), `vehicleNode`, `vehicleIndex`. The traffic "world". |
| road node fields | 13847+ | `p` (Vector3), `a` (heading), `n` (unit normal {x,z}), `w` (half-width), `ps`/`ns` (10 Bézier sub-samples), `laneTotal`/`laneWidth`/`laneDivRatio`/`laneEgoRatio` (stamped per node by the lanes feature), `rWallDist`/`lWallDist` (barrier offsets), `bridge`. |
| `ii(x, z, node, fine?)` | 3299 | Road projection: world → `{d, s, w, t, n, …}` (signed lateral = `d*s`). Used to project ego into lane coordinates for the sensor/collision registry. |
| lanes engine block | 3014–3131 | `laneResolved` geometry, `laneSync()`, `LANE_LOOKAHEAD`. Precedent: first-party engine code written **directly into the deobfuscated source** with readable names — traffic engine glue follows the same pattern. |
| `Vd` autodrive | 18104 | Ego autopilot (pure-pursuit steering + speed control). Reference for the NPC follower; **not reused directly** (it reads `Ae`/`Yd` module singletons). |
| controller `ec` | 18456 | Ego gameplay controller. `updateLive(e,t)` (19024) / `updateStationed` are the per-frame physics entry points — traffic hooks here. `didCollide`, `collisionStrength`, `collisionPos` (19605–19741) are the collision seam the metrics/audio subsystems consume. |
| `zl.testGround(pos, state)` | 16263 | Terrain/wall query: `{h height, n normal, r onRoad, w wall, wd wall dist, …}`. Ground-snaps NPCs; wall clamp after impacts. |
| `_d` | 18387 | Shared material palette (`body`, `wheel`, `default`, …). Body material is **cloned per NPC** for random color. |
| `window.alea` | `alea.min.js` | Seeded RNG (already used by `zl.arng`). Traffic uses its own `alea(seed + "traffic")` stream so spawn pattern + colors are **reproducible per seed** (research requirement-friendly). |
| `PromptDriveBridge.attach` | `build-main.js` | Existing seam where engine handles are published to subsystems. Extended with road/traffic handles (§9). |

**No external physics engine exists.** Ego physics is custom wheel/chassis kinematics per
instance querying `zl.testGround()`; collisions are wall-crossing tests + impulse response.
Ego↔NPC collision therefore must be first-party code (§7).

## 3. Configuration model

Follows `src/lanes/config.js` exactly (observable store, `localStorage`, sanitise + limits).
Storage key `pd-traffic-config`. **Static class**: consumed at world generation / drive
start; changing density/speed live is out of scope (v1), except the stopped-vehicle event.

```js
TRAFFIC_DEFAULTS = {
  enabled: false,      // off by default — zero impact on existing studies
  density: 6,          // total vehicles maintained around the ego (cap 16)
  speed: 15,           // m/s, constant cruise speed for all traffic (R1/R2)
  oncoming: true,      // also populate oncoming lanes (when backward > 0)
  seed: null,          // null = derive from scene seed (reproducible runs)
}
TRAFFIC_LIMITS = { density: {min:0, max:16}, speed: {min:2, max:45} }
```

Sanity guards: `density` is clamped by available lanes; traffic only spawns once the road
has generated past the spawn corridor and (like metrics) once the sim is live.

### Lane addressing convention (used everywhere: config, events, API)

- `lane: 1..forward` — ego-direction lanes, `1` = innermost forward lane (adjacent to the
  divider; the ego's default lane), increasing outward.
- `lane: -1..-backward` — oncoming lanes, `-1` adjacent to the divider.

Lane k center (signed lateral, from per-node stamps): forward
`dividerOffset + (k − 0.5)·laneWidth`; oncoming `dividerOffset − (|k| − 0.5)·laneWidth`,
with `dividerOffset = laneDivRatio · node.w`. World position =
`node.p + node.n · lateral` (interpolated through `node.ps`/`node.ns` sub-samples).

### ⚠ Design decision needed: default 1+1 road

In the default 1+1 layout the engine keeps the ego line at the **road centre**
(`egoRatio = 0`, line 3049–3052 — original game feel). Real traffic needs the ego in a
real lane. Proposal: **enabling traffic forces lane-centred geometry** — when traffic is
on and the lane config is default, the traffic subsystem applies
`LaneRoads.set({width: <topography base width>})`, which keeps identical road dimensions
but flips `isDefault` off so ego autodrive tracks lane 1 and oncoming lane −1 is clear.
Documented in README + API; no effect when traffic is disabled.

## 4. Vehicle model & rendering (`src/traffic/TrafficVehicle.js`)

- **Assets**: on first spawn per vehicle type, load `bodyObj`/`wheelObj` from `je`
  (Roadster + Coach only; Bike excluded v1) via the engine's OBJ loader handle; cache the
  parsed geometry, then `clone()` per NPC. Same material-by-mesh-name assignment as
  `initVehicle` (18769–18779), but the `body` material is **cloned** with a random color.
- **Random color (R4)**: palette of ~12 plausible car colors; picked from the seeded
  traffic RNG. Deterministic per scene seed.
- **Group layout**: one THREE.Group per NPC added to `zl.container`; 4 wheel meshes
  positioned from `def.wheels` dims and spun from speed (`ω = v / radius`); headlights as
  simple emissive material toggle at night (nice-to-have, phase 6).
- **No dashboards/steering wheels/interiors** — exterior meshes only.

## 5. Motion: constant-speed lane following (R1)

NPC state: `{ node, t (0..1 within edge), lane, speed, targetSpeed, mode }` where
`mode ∈ driving | braking | stopped | crashed`.

1. **Advance**: `s += speed·dt` along the midline arc; step `node`/`t` forward
   (backward for oncoming) through the linked list; edge lengths measured from node
   positions (node pitch varies with generation speed — measured, not assumed).
2. **Pose**: position = Bézier sub-sample interpolation + `normal · laneCenter(lane)`;
   heading = edge tangent (+π for oncoming); `y` from `zl.testGround` (snap to ground +
   wheel radius), pitch/roll from the ground normal — cheap 1-point suspension, no
   per-wheel simulation.
3. **Speed control**: constant `targetSpeed` (config), first-order approach
   (`speed → targetSpeed` with accel/brake rate caps) so starts/stops look physical.

### 5.3 Front sensor (R6)

Per NPC per frame (cheap: node-indexed registry, ~60 m scan):

- Registry maps `nodeIndex → vehicles` (all NPCs + the **ego**, projected via `ii()`
  each frame; ego occupies every lane its width overlaps).
- Walk nodes ahead in the NPC's lane for `SENSOR_RANGE` (≈ 60 m); nearest same-lane
  occupant = lead. Gap = arc distance − vehicle half-lengths.
- Controller: `desiredGap = minGap + speed · timeHeadway` (≈ 2 m + 1.5 s). If
  `gap < desiredGap`, match lead speed scaled by gap ratio; if `gap < criticalGap`, full
  brake to 0 (**full stop supported**). Resumes automatically when the lane clears.
- A stopped/crashed vehicle or the ego in-lane is just a lead with `speed = 0`.

## 6. Spawning & lifecycle (R5)

- **Corridor**: maintain `density` vehicles within [−400 m, +700 m] of the ego (well
  inside the road's ±1000-node existence window, mt/xt at 2966). Vehicles that exit the
  corridor are silently recycled to a new spawn slot.
- **Out of view rule**: a spawn point must be (a) ≥ `SPAWN_MIN_DIST` (≈ 250 m ahead /
  150 m behind) from the ego **and** (b) outside the camera frustum
  (`THREE.Frustum.containsPoint` via the bridge camera) **and** (c) ≥ safe gap from other
  traffic in that lane. Ahead/behind chosen randomly (oncoming: always ahead so they
  drive past the ego).
- **Stopped-event spawns are exempt** from the frustum rule beyond distance (the
  researcher asked for a visible hazard at distance X) but still spawn ≥ X ahead.
- No spawning until the sim is live and the ego has a road node (same gating as metrics).

## 7. Physics & collisions (R3) — scope decision

Full reuse of the engine's wheel physics is **not viable** for NPCs: `ec`'s methods write
the module singletons `Ae`/`$d`/`Yd` directly (e.g. 19213), so a second instance would
corrupt ego state. v1 uses a **simplified single-body model**, stated plainly:

- **Broad phase**: registry by node index; only pairs within ±2 nodes are tested.
- **Narrow phase**: 2D oriented-box overlap in the road plane (length/width from
  `def.wheels` + margin).
- **Ego ↔ NPC**: impulse along the contact normal from relative velocity + masses
  (`def.metrics.mass`). Ego side: adjust `Ae.vel` and set `controller.didCollide = true`,
  `collisionStrength`, `collisionPos` (the engine's own collision seam, 19605–19741) — so
  the **scrape audio and the metrics collision counter fire without any metrics change**.
  NPC side: velocity kick, `mode = crashed` (hazard state: brakes to a stop, stays in
  registry so other traffic stops behind it).
- **NPC ↔ NPC**: the sensor makes this rare; same impulse response as above.
- **NPC ↔ barrier**: lateral position clamped to `node.rWallDist`/`lWallDist` (with a
  small bounce) when a kick pushes an NPC off its lane — mirrors how the lanes feature
  keeps barriers off the carriageway.

Fidelity trade-off is deliberate: collisions are *events with plausible response*, not a
crash simulation. Tunable constants isolated in one place (`src/traffic/config.js`).

## 8. Stopped-vehicle event (R7)

```js
RoadTraffic.spawnStopped({ distance: 120, lane: 1, color? })
// → { ok:true, value:{ id, nodeIndex, lane } } | { ok:false, error:'engine_rejected'|'bad_value' }
```

- Spawns a `mode: stopped` NPC at `distance` metres ahead of the current ego road
  position, centred in `lane` (validated against the live layout; clamped distance
  ≥ 30 m, ≤ corridor end). Counts toward no density quota (extra actor).
- Exposed three ways: the facade above, `PromptDrive.traffic.spawnStopped(...)`
  (transport-friendly: works over postMessage/BroadcastChannel), and a settings-panel
  row (distance + lane steppers + *Spawn* button).
- Emits a `trafficStopped` event with the spawn descriptor.

## 9. Architecture & file plan

Mirrors the lanes subsystem (facade bundle) + metrics (engine handles via bridge):

| File | Content |
| --- | --- |
| `src/traffic/config.js` | Store: defaults/limits/sanitise, `localStorage`, seeded RNG helper |
| `src/traffic/TrafficVehicle.js` | Per-NPC model: mesh build/clone, color, pose, wheel spin |
| `src/traffic/TrafficManager.js` | Registry, spawn/recycle, sensor, follower controller, collisions — pure logic against engine handles |
| `src/traffic/TrafficPanel.js` | Settings section **traffic** (below *road lanes*): enable, density, speed, oncoming + stopped-event row |
| `src/traffic/RoadTraffic.js` | Facade `window.RoadTraffic`: `get/set/subscribe`, `spawnStopped`, `state()` (live NPC list), `_engineUpdate(dt)` entry point |
| `scripts/build-traffic.js` | IIFE bundle → `static/js/traffic.js` (copy of build-lanes.js) |
| engine glue | Small readable block in `src-extracted/deobfuscated.js` (lanes precedent, §2): a `trafficSync()` that passes `{si, ii, je, _d, zl, Ae, controller, THREE}` handles to `window.RoadTraffic` and calls `_engineUpdate(dt)` from `updateLive` **and** `updateStationed` (traffic keeps moving while the ego is parked) — all `try/catch`-guarded, no-op when the bundle is absent |
| `scripts/build-main.js` | Only if an anchor is preferable to direct source edits for a given hook — decided per hook at implementation time |

Integration touch-points:

- `index.html`: script order becomes `cluster → metrics → lanes → traffic → api → main`
  (API delegates `traffic.*` to `RoadTraffic`, so traffic loads before api).
- `package.json`: `build:traffic` + wired into `npm run build`.
- `src/api/config.js`: new field `{ path:'traffic', type:Object, cls:'static' }`
  (validated by `RoadTraffic.set`, like `lanes`); `src/api/PromptDriveApi.js`: `traffic`
  namespace (`spawnStopped`, `state`) + events `trafficSpawned`, `trafficStopped`,
  `trafficCollision` on the existing bus; `telemetry.state()` gains
  `traffic: { count, lead: {gap, speed} | null }` (also unblocks future THW/TTC metrics —
  README already anticipates this).
- Docs: README traffic section, API.md fields/methods/events, this plan updated on drift.
- `api-test.html`: traffic controls in the static area + stopped-event button in dynamic.

## 10. Implementation phases (each ends green: `npm run build` + browser check)

1. **Scaffolding + engine glue** — bundle skeleton, store, facade, build script, script
   tag, handle pass-through + per-frame `_engineUpdate` hook. *Validate:* handles logged,
   update ticking, no console errors, game unchanged with traffic disabled.
2. **Rendering + motion** — asset cache/clone, colors, lane-centred constant-speed
   following (both directions), ground snap, corridor recycle, out-of-view spawn.
   *Validate:* visually — spawn placement, lane keeping through curves/hills, oncoming
   pass-bys, no pop-in inside the frustum.
3. **Front sensor** — registry + follower/brake controller incl. full stop + resume.
   *Validate:* NPC queues behind a stopped NPC; NPC brakes behind the slowed ego.
4. **Collisions** — ego↔NPC impulse + engine collision seam, NPC↔NPC fallback, barrier
   clamp. *Validate:* rear-end the lead car → both react, scrape audio plays, metrics
   `collisions` increments; report shows the event.
5. **Stopped-vehicle event + API + panel** — facade/API/panel/event wiring, api-test.html
   rows. *Validate:* trigger from the test console over BroadcastChannel at 120 m in
   lane 2 of a 2+2 road; ego autodrive + traffic braking behave.
6. **Polish + docs** — night headlights, tuning pass (gaps, spawn distances), README/API.md,
   full `npm run build`, clean localStorage check, final browser sweep of §11.

## 11. Verification checklist (final)

- Default studies unaffected: traffic disabled → zero new console output, identical drive.
- 2+2 road, density 8, 15 m/s: lanes held through hard topography; stable 60 fps
  (perf budget: ≤ 16 NPCs, cloned geometry, zero per-frame allocations in the hot loop).
- Ego stopped in-lane → following NPC stops behind; moves off → NPC resumes.
- Stopped event in ego lane at 100 m with autodrive on → ego's own behavior observed
  (research scenario); with manual drive → collision path exercises §7 + metrics.
- Reload persistence: traffic config restored; seed reproducibility: same seed → same
  colors/spawn pattern.
- `?autostart=1` headless path works with traffic enabled.

## 12. Risks & open questions

1. **Default 1+1 ego-centre line** (§3): needs the reviewer's OK to auto-apply
   lane-centred geometry when traffic is enabled.
2. **Collision fidelity** (§7): simplified impulse model — acceptable for research
   events? (Full wheel-physics NPCs would be a large refactor of singleton-bound code.)
3. **Perf on low-end hardware**: density cap conservative at 16; Coach OBJ is heavier —
   may restrict to Roadster if frame budget is tight.
4. **Autodrive interaction**: the ego autopilot (`Vd`) has no obstacle sensor — with
   autodrive on, the ego *will* rear-end a stopped NPC. That's arguably the point of the
   stopped-vehicle scenario, but an optional "ego traffic-aware braking" could be a v2.
5. **Lane changes / overtaking, speed variance per vehicle, trucks**: out of scope v1;
   the registry + lane-addressing design leaves room.
