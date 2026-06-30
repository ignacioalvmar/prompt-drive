# Dynamic Multi-Lane Road Rendering — Design & Plan

> **Implemented** on branch `dynamic-multi-lane-roads` (2026-06-29). What shipped:
> lane config + persistence + settings UI (`src/lanes/`, exposed as `window.LaneRoads`);
> per-lane width resolved from lane intent; lane markings painted in the Hills terrain
> fragment shader (derived from `roadProx` + a resolved half-width uniform — no new vertex
> attributes); autodrive follows the ego lane; and the driving-metrics patch reads the
> resolved ego-lane geometry.
>
> **Application model — live, ahead of the car (§1.6/§4.2 realised).** Each midline node is
> stamped with the lane structure active when it is generated (`node.laneTotal`,
> `node.laneDivRatio`); `node.w` eases toward the new half-width as a taper. The road-surface
> ribbon copies these onto a per-vertex `laneParam` attribute, so each stretch renders the
> layout it was built with. On a mid-drive config change, `laneSync` detects the new
> signature and `laneRestampAhead()` re-stamps the already-committed upcoming nodes (from a
> short margin ahead of the car to the tail, easing the width), so the change isn't stranded
> at the distant midline frontier — it sits just ahead and **rolls in as the ribbon recycles
> its segments forward** while driving. The autodrive reads the *local* node's geometry only
> (no global fallback), so it transitions exactly where the rendered road transitions rather
> than the instant the config changes. *Rebuild from start* still forces an immediate full
> rebuild. (Earlier iterations locked the config per drive / applied only at the far frontier;
> both limitations are now lifted. Note: ribbon segments already displayed refresh as they
> recycle — within roughly one segment of driving — not instantaneously under the car.)
>
> **Markings map to the real layout — and live on the road-surface mesh, not the terrain.**
> A correction to §1.2 below: the visible road is **not** the terrain `roadProx`/`roadCol`
> paint (that only blends the verge). The road surface is a separate **textured ribbon**
> (class `gl`, material `Xt`) generated along the midline at `±node.w`, with `UV.x` running
> 0→1 across the full width. Markings are therefore painted in **`Xt`'s fragment shader**:
> it derives the signed lateral position `S = (UV.x − 0.5)·2·halfWidth` and draws a line at
> every boundary `dividerOffset + k·laneWidth` (yellow at the divider, white lane lines and
> edge lines), masking the texture's baked centre line. No new vertex attributes are needed.
> An asymmetric carriageway (e.g. 3 forward + 1 oncoming) renders with the divider offset to
> the correct side and the right number of lanes each way. (An earlier attempt painted the
> terrain `Cs` shader and baked a `laneSigned` attribute — that renders *under* the opaque
> road ribbon and was reverted.)
>
> **Remaining v1 deviations** (low-risk choices): lane lines are *solid* (no `arcStation`
> dashes — thin solid lines already alias into a dashed look at distance), markings are wired
> for the paved Hills scene only (Planet shader untouched), and lane counts/width are capped
> to a range the terrain renders cleanly (very wide carriageways bank steeply on hilly
> terrain). Per-vertex dashes and an on-demand terrain rebuild remain documented v2 paths.

**Status:** Implemented (v1); §3.2 Option A realised in the no-extra-attributes form. 2026-06-29
**Scope:** Procedurally render additional lanes — in the same direction and in the
opposite direction — on top of the existing road geometry, configurable at start and
changeable for the road *ahead* of the vehicle. Road geometry/shape is unchanged; only
the carriageway *width* grows and lane markings are introduced.

All line numbers refer to [`src-extracted/deobfuscated.js`](src-extracted/deobfuscated.js)
(the deobfuscated game bundle that `scripts/build-main.js` patches into
`static/js/main.ca6b3355.chunk.js`). Patches live in
[`scripts/build-main.js`](scripts/build-main.js); the metrics subsystem lives in
[`src/metrics/`](src/metrics).

---

## 1. How the road works today

### 1.1 The road is a single midline spline, not a ribbon mesh

The road is represented by **one centerline (“midline”) spline**: a doubly-linked list of
nodes hanging off the global state object `si` (`$t` at line 3051), from `si.head` to
`si.tail`, with `si.vehicleNode` / `si.vehicleIndex` tracking the ego car’s position along
it. Each node is created in `extendMidline` (≈ line 14135) and `reset` (≈ line 13638):

```js
{
  i,            // monotonic node index
  p: Vec3,      // world position of the centerline point
  n: {x, z},    // unit normal (perpendicular, in the XZ plane)
  a, da,        // heading angle and per-node turn (delta-angle)
  w: Yt,        // ROAD HALF-WIDTH at this node  ← the key field
  g, gfa, h,    // lateral/longitudinal gradient terms
  ps: [...],    // ~10 discretised sub-points along the segment (Bezier)
  ns: [...],    // sub-point normals
  next, prev
}
```

Node spacing is small and fixed: the base step `hl = 10` (line 13398) with
`cDist = hl * 0.5 = 5` (line 14119), so nodes are a few metres apart and each segment is
sub-sampled into ~10 `ps`/`ns` points for fine projection.

### 1.2 The road surface is *painted onto the terrain* via `roadProx`

There is **no road mesh**. The road is drawn by the terrain shader as a function of each
terrain vertex’s perpendicular distance to the midline.

- `ii(x, z, node, …)` (line 3136) projects a world XZ point onto the spline and returns:

  ```js
  { d,   // perpendicular distance from the centerline (≥ 0)
    s,   // side sign (−1 / +1)
    w,   // road half-width INTERPOLATED between nodes (i.w + t*(next.w − i.w))
    y, da, g, t, n }
  ```

- The terrain grid-cell generator `oi.generate()` (line 3470) evaluates `ii()` per vertex
  and bakes two attributes into the geometry (lines 3497–3504):

  ```js
  this.signedRoadProx[t] = n.d - (n.w + n.e);  // distance past the blended edge
  this.roadProx[t]       = n.d - n.w;          // signed distance to the road EDGE
  ```

  `roadProx < 0` ⇒ on the tarmac; `0 … 0.7` ⇒ gravel verge; beyond ⇒ terrain.

- The terrain material’s injected fragment shader (line 5272) colours it:

  ```glsl
  vec4 roadCol = vec4(0.45, 0.45, 0.474, 1.0);   // flat grey tarmac
  if (roadProx < -0.2)       texelColor = roadCol;            // road
  else if (roadProx < 0.7)   texelColor = mix(gravel, …);     // verge
  ```

**Consequence #1 (important):** because `ii()` returns the *interpolated per-node* `w`, the
terrain already paints a road of **whatever width each node declares**. Variable width along
the road is therefore *already supported at the geometry level* — today every node simply
gets the same `w = Yt`.

**Consequence #2:** there are **no lane markings of any kind** in the current build. The road
is a uniform grey strip. The only road-line-like feature is the **cat’s-eyes** system.

### 1.3 The width parameter `Yt`

- `Yt` is a module-level `let`, default `3` (line 3005), mutated only through `Vt(e)`
  (line 3006).
- It is set once per scene from the topography config: `Vt(Vs.topography[s].roadWidth)`
  (line 10469; mirror for the “Planet” scene at line 12554).
- `roadWidth` values live in the scene config blocks (lines 4588–4658 “Hills”, 11385–11465
  “Planet”): per difficulty `2.8 … 3.2`, plus a `flat`/wide preset of `20`.
- `Yt` is the **half-width**, so the current carriageway is `2·Yt ≈ 6.4 m` — roughly two
  3.2 m lanes, but with no marked division and no lane discipline.
- `Ut = 0.4` (line 3009) is a constant shoulder/blend margin added in several places.

### 1.4 Who reads the width

Two categories of consumers:

| Reads **per-node `w`** (auto-follows variable width) | Reads **global `Yt`** (needs migration) |
|---|---|
| Terrain painting via `ii().w` (3214/3230/3498) | Steering assist / autodrive `roadEdgeProximity` (17996) |
| Barrier/verge gen `(t.w + Ut) * side` (6539, 12163) | Driving-metrics patch lane model (build-main.js, `Yt` uses) |
| Sea-wall / bridge-wall gen `(t.w + …)` (6941, 7075) | `Lo = Yt + 1.25` cat’s-eye/wall horizon (9544) |
| Sign placement `placementNode.w + 1` (7355, 7429…) | `return Yt + 1` (5927); verge markers `(Yt + 1.1)*side` (5890) |
| Wheel on-road test (terrain raycast, auto) | — |

The autodrive controller centres the car on the **midline**:

```js
// line 17996 — steering assist
this.roadEdgeProximity = Yd.m.d / (Yt - Ae.wheels.width / 2) * Yd.m.s;
```

so today the AI driver targets the geometric centreline, not a lane.

### 1.5 Cat’s-eyes = the existing per-node marker pipeline

`Ja` (line 7666) walks the midline node-by-node ahead of the car, emits an instanced,
headlight-reactive stud geometry at `±Va` from the centreline (`Va = 0.04`, line 7643),
recycles instances behind the car, and is driven each frame from `update()`. It already
solves *exactly* the problem a lane-marking renderer must solve (walk nodes, place geometry
at lateral offsets, retire behind the car), so it is the natural template / alternative for
markings.

### 1.6 Generation horizon — where “ahead” is

New midline nodes are generated out to `si.vehicleIndex + Jt`, where
`Jt = lt.wallGenHorizon` (line 3014, set from the quality preset). The presets
(lines 2874–2915) give `wallGenHorizon` of **65 → 140 nodes** by quality tier. Terrain grid
cells bake their `roadProx` at the moment they are generated, also ahead of the car and
within an active window that retires behind it.

**Consequence #3:** any change to width or lane count baked at node-creation / tile-creation
time **only affects geometry generated after the change** — i.e. it naturally appears some
distance *ahead* of the car (on the order of the generation horizon), never underneath or
behind it. This is precisely the “change the lanes ahead, before they’re generated” behaviour
the feature requires; it falls out of the streaming architecture for free.

---

## 2. Target model

### 2.1 Lane descriptor (single source of truth)

Introduce one mutable module-level descriptor that every consumer reads:

```js
const roadLanes = {
  forward:  1,    // lanes in the ego direction
  backward: 1,    // oncoming lanes
  width:    3.2,  // metres per lane
  // derived:
  // total      = forward + backward
  // halfWidth  = total * width / 2          → assigned to Yt and node.w
  // dividerOff = (backward - forward) * width / 2   // lateral offset of the
  //              centre divider from the midline (0 when symmetric)
};
```

### 2.2 Lateral coordinate model

Measure lateral position `y` from the midline along node normal `n`, positive toward the
ego/forward side. The carriageway spans `[−halfWidth, +halfWidth]`.

- **Total half-width:** `halfWidth = (forward + backward) * width / 2`. Set `Yt` and every
  new node’s `w` to this.
- **Direction divider** at `y_div = (backward − forward) * width / 2` from the midline
  (`0` for the symmetric 1+1 default, so default behaviour is unchanged).
- **Lane boundaries (markings):** for `k = 0…total`, boundary `k` sits at
  `y_k = −halfWidth + k * width`.
- **Lane centres:** lane `k` centre at `y_k + width/2`. The **ego target lane** centre
  (rightmost forward lane by default, or a chosen lane) becomes the autodrive target instead
  of `y = 0`.

The midline spline (`node.p`) remains the geometric centre of the *whole* carriageway, so the
road shape and all existing offset-from-`w` placement (barriers, verges, signs) keep working;
only the *amount* of width changes.

### 2.3 Default-compatibility guarantee

With `forward = backward = 1, width = 3.2`: `halfWidth = 3.2` (== current `Yt` for the
default topography), `dividerOff = 0`, two lanes with a centre line at the midline. Visually
near-identical to today plus a centre marking. This keeps the change low-risk and lets the
default ship dark.

---

## 3. Rendering mechanism

### 3.1 Width growth — almost free

Because terrain painting already uses interpolated per-node `w` (§1.2), widening the road is:

1. Set `Yt = roadLanes.halfWidth` at scene init (replace the direct `Vt(roadWidth)` call).
2. Have the node builder write `node.w = currentHalfWidth()` instead of the constant `Yt`.

Newly generated terrain cells then paint the wider strip automatically. Verges, barriers,
walls and signs that key off `node.w` follow the new edge with no change.

### 3.2 Lane markings — the new rendering work

Two viable approaches; **recommended: shader-based**, with the generalised cat’s-eyes
generator as a complementary/fallback option.

#### Option A — Shader-painted markings (recommended)

The road is already a shader; paint the lines in the same pass.

- **New per-vertex attributes** computed in `oi.generate()` (where `ii()` is already called
  at line 3495):
  - `signedLateral = n.d * n.s` — signed distance from the midline.
  - `arcStation` — a longitudinal coordinate for dashes. Cheapest source: bake a cumulative
    arc-length onto each node at creation (accumulate segment length in `extendMidline`) and
    interpolate it like `w`; expose it through `ii()` (add `station: i.station + t*(…)`).
- **New uniforms:** `laneHalfWidth`, `laneWidth`, `dividerOffset`, plus line styling
  (`lineWidth ≈ 0.12 m`, `dashPeriod`, `dashOn`, colours for white/yellow).
- **Fragment logic** (added to the `roadProx < -0.2` branch at line 5272): for each interior
  boundary offset `y_k`, draw a line where `abs(signedLateral − y_k) < lineWidth/2`. Use a
  **solid** line at the direction divider (`y_div`, yellow/double), **dashed** lines between
  same-direction lanes (`fract(arcStation / dashPeriod) < dashOn`), and **solid** edge lines
  just inside `±halfWidth`. Anti-alias with `smoothstep`/`fwidth`.

Pros: scales to any lane count, crisp at all distances, no extra geometry, matches “same road
geometry, more lanes” exactly. Cons: shader edits + the `arcStation` plumbing.

#### Option B — Generalised cat’s-eyes / instanced quads

Generalise `Ja` (line 7666) to emit thin dashed quads (or studs) at each lane-boundary offset
rather than only `±Va`. Reuse its node-walk, instancing and retire logic verbatim; loop over
boundary offsets from `roadLanes`.

Pros: no terrain-shader/attribute changes; dashes and reflective studs are trivial; isolated
to one class. Cons: more vertices; markings are discrete quads rather than continuously
projected paint (can shimmer on tight curves).

**Recommendation:** Option A for painted lines (divider, lane lines, edge lines). Keep/retarget
the cat’s-eyes (Option B style) for reflective studs on the divider so night driving reads well.

---

## 4. Configuration mechanism

### 4.1 Initial configuration

- Add a `lanes: { forward, backward, width }` block to each scene/topography config
  (next to `roadWidth` at lines 4588–4658 / 11385–11465). `roadWidth` becomes derived/legacy:
  if `lanes` is absent, fall back to `forward=backward=1, width=roadWidth` so existing configs
  keep working.
- At scene `initialise()` (line 10462), compute `roadLanes` from the active topography and call
  `Vt(roadLanes.halfWidth)` instead of `Vt(roadWidth)`.
- Surface a UI section mirroring the existing **driving metrics** panel pattern
  (see README §“Driving performance metrics” and [`src/metrics/`](src/metrics) for the
  settings-panel + `localStorage` persistence model): sliders/steppers for forward lanes,
  backward lanes, lane width, plus presets (e.g. *2-lane*, *dual carriageway 2+2*,
  *motorway 3+3*). Persist selection in `localStorage`.

### 4.2 Changing lanes ahead (dynamic)

Expose:

```js
setLaneConfig({ forward, backward, width }, { taperNodes = 8 } = {})
```

Mechanism (leans entirely on the streaming architecture, §1.6):

1. Update the `roadLanes` **target**. Do **not** touch existing nodes.
2. In the node builder (`extendMidline`, the `w: Yt` site at line 14147), read a
   `currentHalfWidth()` that **eases** from the previous half-width to the target over
   `taperNodes` nodes (a smooth widen/narrow transition — a real lane add/drop taper). Write
   the eased value into `node.w`, and stamp the per-node lane descriptor needed for markings
   (boundary offsets / divider offset / lane count) so markings transition with the geometry.
3. Newly generated nodes and the terrain cells built around them automatically render the new
   width and markings. The change therefore **manifests ~`Jt` nodes ahead** of the car (tens
   of nodes; hundreds of metres at typical speeds), and the car drives *into* it. Geometry
   already built around/behind the car is untouched (correct: the change is “ahead”).
4. Bound the requested change horizon by the current `wallGenHorizon` so a request can never
   try to mutate already-committed geometry; if a caller wants it sooner, the only correct
   option is a full midline/terrain rebuild (see §6).

The taper also keeps the terrain height-blend margin (`ai.rm`, lines 3379/3407, which blends
ground height within `w + rm`) from popping when the edge moves.

---

## 5. Subsystems to update

| Subsystem | File / line | Change |
|---|---|---|
| Width source | 3005–3008, 10469, 12554 | `Yt = roadLanes.halfWidth`; per-node `w` from `currentHalfWidth()` |
| Node builder | 14135–14152, 13638–13657 | Write eased `w`; stamp lane descriptor + `arcStation` |
| Road projection | 3136–3234 | Add `station` (and optionally `lanes`) to the returned object |
| Terrain attributes | 3470–3509 | Bake `signedLateral`, `arcStation` per vertex |
| Terrain shader | 5269–5272 (and 11741+ Planet) | New varyings/uniforms; draw divider/lane/edge lines |
| Steering assist | 17996 | Use projection `w` (not global `Yt`); target ego **lane centre**, not midline |
| Driving metrics | `scripts/build-main.js` (`Yt` uses, `_laneCenter`) | Lane half-width/centre from `roadLanes` + projection `w`, per direction |
| Cat’s-eyes | 7666–7787, `Va` 7643, `Lo` 9544 | Retarget studs to the divider offset; widen horizon vs `halfWidth` |
| Misc `Yt`±const | 5890–5891, 5927 | Replace with per-node `w` so transitions place correctly |
| Walls/barriers/signs | 6539, 6941, 7075, 7355… | Mostly already `node.w`-based — **audit only**, fix any stray `Yt` |
| On-road test | 19384–19399 | None — terrain raycast auto-follows painted width |
| Scene/topo config | 4588–4658, 11385–11465 | Add `lanes` block; `roadWidth` → fallback |
| Settings UI | new, modelled on `src/metrics/` panel | Lane controls + presets + `localStorage` |

---

## 6. Risks & edge cases

- **Already-built geometry can’t retro-change.** Runtime lane changes only apply ahead. A
  “change everything now” needs a midline+terrain rebuild (there is already a midline-reset /
  `handleMidlineReset` path at 10494 and tile regeneration to reuse). Document that the cheap
  path is *ahead-only*.
- **Height-blend pop at width transitions** — mitigated by the taper (§4.2) and by keeping
  `ai.rm`/`Ut` edge blends.
- **Arc-length for dashes:** node spacing varies on curves; bake true cumulative distance per
  node rather than `index × constant` so dashes stay metric and don’t crawl.
- **Asymmetric forward/backward** shifts the ego lane off the midline; verify reset/respawn
  and camera framing still centre on the *ego lane*, not the midline.
- **Very wide presets** (e.g. `flat` = 20) interplay with bridges, sea walls and drystone
  generators — test those scenes specifically.
- **Metric semantics change:** SDLP, mean lateral position, lane departures and TTC are all
  defined relative to “the lane.” Redefining the lane (width, which lane is ego’s) changes
  these numbers. This must be called out in the metrics report/README so runs aren’t compared
  across different lane configs. Lane half-width fed to the metrics must become the *single
  ego-lane* half-width, not the whole-carriageway half-width.
- **Planet scene** has its own shader (11741+) and width path (12554) — apply marking/width
  changes to both or gate markings to paved scenes (`paved` flag, 17327/17343).

---

## 7. Suggested implementation phases

0. **Plumbing, no behaviour change.** Add `roadLanes` + `lanes` config with 1+1 fallback;
   compute `Yt` from it. Ship dark; verify default unchanged.
1. **Variable width.** Node builder writes per-node `w` from config; migrate `Yt`-readers
   (autodrive, metrics, stray `Yt`±const) to projection `w`. Verify a wider road paints,
   drives and collides correctly with no markings yet.
2. **Markings.** Add `signedLateral` + `arcStation` attributes/uniforms and the fragment-shader
   divider/lane/edge lines (Option A). Retarget cat’s-eyes studs to the divider.
3. **Dynamic change + taper.** `setLaneConfig()` with eased width and stamped lane descriptor;
   lane add/drop transitions; autodrive targets the ego lane centre.
4. **UI + presets + persistence**, modelled on the metrics panel.
5. **Verification:** drive each scene/topography and preset; screenshot markings on straights
   and curves; confirm streaming change lands ahead and tapers smoothly; re-baseline metrics
   and document the semantic change.

---

## 8. Key references

- Midline node + projection: 3051 (`$t`/`si`), 3136 (`ii`), 13638 / 14135 (node creation).
- Width: 3005 (`Yt`), 3009 (`Ut`), 10469 / 12554 (set from `roadWidth`).
- Terrain bake + shader: 3470 (`oi.generate`), 3497–3504 (`roadProx`), 5269–5272 (Hills shader),
  11741+ (Planet shader).
- Consumers: 17996 (steering assist), `scripts/build-main.js` (metrics lane model), 7666 / 7643
  (cat’s-eyes / `Va`).
- Horizon: 3014 (`Jt`), 2874–2915 (per-quality `wallGenHorizon`).
- Config: 4588–4658 / 11385–11465 (`roadWidth` per topography).
