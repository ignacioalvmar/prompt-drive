# Prompt Drive

Web driving simulator for AI agents.

## Quick start

Serve the static site locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Any static file server works (`npx serve .`, Python `http.server`, etc.).

## Build

The instrument cluster and game patches are built from source:

```bash
npm run build          # cluster + metrics + lanes + api + main bundle
npm run build:cluster  # src/cluster/ → static/js/cluster.js
npm run build:metrics  # src/metrics/ → static/js/metrics.js
npm run build:lanes    # src/lanes/   → static/js/lanes.js
npm run build:api      # src/api/     → static/js/api.js
npm run build:main     # src-extracted/deobfuscated.js → static/js/main.ca6b3355.chunk.js
```

To re-extract the upstream game bundle (only when replacing `static/js/main.ca6b3355.chunk.original.js`):

```bash
npm run extract
npm run build
```



## Project layout


| Path                                        | Purpose                                     |
| ------------------------------------------- | ------------------------------------------- |
| `index.html`, `static/`                     | Runtime app (served as-is)                  |
| `src/cluster/`                              | Instrument cluster source (canvas UI)       |
| `src/metrics/`                              | Driving-performance metrics (panel/overlay/report) |
| `src/lanes/`                                | Dynamic multi-lane road config + settings UI |
| `src/api/`                                  | Integration API (`window.PromptDrive`) — see [`API.md`](API.md) |
| `api-test.html`                             | Local API test console                      |
| `src-extracted/deobfuscated.js`             | Deobfuscated game bundle; input for patches |
| `scripts/build-*.js`                        | Build pipeline                              |
| `static/js/main.ca6b3355.chunk.original.js` | Minified upstream bundle for re-extraction  |




## Driving performance metrics

A research-metrics subsystem (`src/metrics/`) records ego telemetry every physics
frame and computes standard human-factors metrics: SDLP, mean lateral position,
lane departures, mean speed / SDS, steering reversal rate, steering entropy, and
time-to-line-crossing (plus throttle/brake/jerk and collisions).

- **Configuration** — open the settings panel (gear icon) and expand the
  **driving metrics** section (below *audio*) to choose which metrics to compute.
  Selection persists in `localStorage`.
- **Live overlay** — toggle with the section's *Overlay* button or the **M** key.
  Shows selected metrics over a trailing 30 s window.
- **Run lifecycle** — recording auto-starts when the car moves; *Start / Stop /
  Reset* are in the panel.
- **Export** — *Download report* (Markdown + JSON) and *Download logs* (CSV of raw
  telemetry + events JSON).

Lane metrics use the engine's own road projection (`ii()`), are measured
relative to the **lane center** (the engine's nominal driving line), and are
gated to on-road samples. Interaction metrics (time headway, TTC) require traffic objects;
this build has none, so they stay disabled until a traffic configuration exists.

## Dynamic multi-lane roads

The road is procedurally generated as a single centre-line spline whose surface is
painted onto the terrain from each point's distance to that line. `src/lanes/` adds a
configurable lane model on top: choose how many lanes run in your direction and how many
oncoming, plus a per-lane width. The carriageway widens accordingly, lane markings are
drawn, and the autodrive line follows the ego lane. Design details and the engine
integration map are in
[`dynamic-lane-rendering-plan.md`](dynamic-lane-rendering-plan.md).

- **Configuration** — open the settings panel (gear icon) and expand the **road lanes**
  section (below *driving metrics*): steppers for forward / oncoming lanes and lane width,
  plus presets (*Single 1+1*, *Dual 2+2*, *Wide 3+2*, *One-way ×3*). Selection persists
  in `localStorage`. Default **1+1 / auto-width** reproduces the original road exactly.
- **How many lanes** — up to **5 lanes per direction** can be set as the initial
  configuration (before you start driving). **Once driving, changes are restricted to ±1
  lane per direction at a time** so every transition is a single, continuous merge / lane
  gain — enforced in both the UI and the `set()` API (it clamps to ±1 of the layout
  currently under the car, which the engine publishes live).
- **Applies to the road ahead, smoothly** — a lane change is stamped onto the road a fixed
  distance *ahead* of the car (just beyond the render / terrain / barrier build frontier)
  and **tapers in** over a short stretch: the carriageway width, the divider and the lane
  markings interpolate together, so a new lane **grows in at the edge** (its dashed line
  fades up as the road widens) and a dropped lane **merges out**. Because the change sits
  beyond the build frontier, the rendered road *and* the autodrive line meet it at the same
  place — the autopilot no longer reacts the instant the button is pressed; it follows the
  road into the new layout. The road already built around you keeps its layout (no jump).
  Trees and the paved verge are regenerated from the new width as that stretch is built, so
  a widened road doesn't run through vegetation, and roadside **barriers are placed beyond
  the widest point of each span** (and pushed off the carriageway when it widens) so they
  never sit inside a lane. *Rebuild from start* forces the whole road to the new layout
  immediately for those who don't want to drive forward. (The taper begins ~60 midline
  nodes ahead — tens of seconds at highway speed; this look-ahead is the `LANE_LOOKAHEAD`
  engine constant and can be tuned.)
- **Programmatic API** — `window.LaneRoads`: `get()`, `set({forward, backward, width})`
  (persists and applies ahead, ±1-clamped while driving), `apply()` (rebuild from start
  now), `subscribe(fn)`, `presets`, `resolved()` (the engine-published target geometry —
  `{halfWidth, laneWidth, dividerOffset, egoCenterSigned, egoRatio, …}`, also read by the
  metrics subsystem so lane metrics track the **ego lane**), `applied()` (the rounded
  `{forward, backward}` layout currently under the car) and `driving()`.
- **Width range** — very wide carriageways (≳18 m) forced onto hilly terrain bank steeply
  and look uneven, so lane width is capped to a well-behaved range; 1+1, 2+2 and one-way
  layouts render cleanly.

Markings are painted by the **road-surface material's** shader (the road is a separate
textured ribbon spanning the full carriageway, with `UV.x` running 0→1 across it). Each
vertex carries `laneParam = (localHalfWidth, laneCount, dividerRatio)` captured from the
midline node it was generated from — and because those fields are interpolated along the
road during a transition, `laneCount` is a *float* through a merge, so boundaries slide
continuously. The shader flattens the texture to clean asphalt (removing the baked-in centre
line), then draws a boundary at every `dividerOffset + k·laneWidth`: a **solid yellow
divider** at the forward/oncoming split, **dashed white lines** between same-direction lanes
(so it reads as lane-changeable), and **solid white edge lines**. Each lane line **fades out
as it nears the carriageway edge**, so a lane that grows in (or merges out) as the road
widens / narrows appears / disappears smoothly rather than popping. Markings are on the paved
(summer/spring) scene.

## Integration API

An external service (an AI-agent harness, an orchestrator, a test rig, or a
parent web app) can read the full simulation configuration and steer it — both
**static** setup applied at world generation and **dynamic** changes applied to
a running sim — plus subscribe to a telemetry + event stream. It follows the
same extension pattern as the subsystems above: an IIFE bundle (`src/api/` →
`static/js/api.js`) exposed as `window.PromptDrive` and wired to the engine by
`scripts/build-main.js`.

- **Facade** — `window.PromptDrive`: `schema()`, `get(path?)`, `config.*`
  (static: `set`/`pending`/`apply`/`autostart`), `dynamic.*` (live: weather,
  skin, lanes, drive mode, grip/speed, autodrive, headlights, camera, cruise,
  FOV, units, general settings, and programmatic drive `input`), `telemetry.*`,
  `metrics.*` (which driving metrics to collect), `run.*` (run lifecycle +
  report/log download), `end()` (finalize the run, auto-export the
  driver-performance report + logs, and halt), and `on`/`off`/`subscribe`.
- **Transports** — call the facade directly (in-page / headless browser), over
  `postMessage` when embedded in an iframe, or over a same-origin
  `BroadcastChannel` from a separate tab (origin allow-listed for postMessage). A
  `?autostart=1` launch option bypasses the *begin* splash for headless use.
- **Test console** — [`api-test.html`](api-test.html): a **standalone** page
  (configuration + telemetry only, no game rendering) that drives a simulation
  running normally at `localhost:3000` over the `BroadcastChannel` transport.
  Separate **static** and **dynamic** areas, a metrics/logs panel, and a live
  telemetry + event feed; dynamic controls activate only while a live feed is
  running. Run the sim, then open the console — it connects automatically.

**Full reference: [`API.md`](API.md).** Design rationale and the phased roadmap
are in [`prompt-drive-api-plan.md`](prompt-drive-api-plan.md).

## Deploy

Deploy the repository root as a static site (GitHub Pages, Vercel, Netlify, etc.). No build step is required on deploy if you commit the built `static/js/cluster.js` and `static/js/main.ca6b3355.chunk.js`.

Before publishing, update social meta tags in `index.html` (`og:url`, `twitter:url`) to your production URL.

## Known gaps

The checked-in `static/media/` set is incomplete relative to the full game bundle. Summer/spring gameplay works.