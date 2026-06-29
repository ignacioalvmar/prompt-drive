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
npm run build          # cluster + metrics + lanes + main bundle
npm run build:cluster  # src/cluster/ → static/js/cluster.js
npm run build:metrics  # src/metrics/ → static/js/metrics.js
npm run build:lanes    # src/lanes/   → static/js/lanes.js
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
  plus presets (*Single 1+1*, *Dual 2+2*, *Motorway 3+3*, *One-way ×3*). Selection persists
  in `localStorage`. Default **1+1 / auto-width** reproduces the original road exactly.
- **Applies ahead** — because road nodes and terrain tiles bake their width as they are
  generated ahead of the car, a lane change takes effect on the road *ahead* of you and
  **tapers in** over a short distance (a real lane add/drop). Keep driving to reach it.
- **Programmatic API** — `window.LaneRoads`: `get()`, `set({forward, backward, width})`,
  `subscribe(fn)`, `presets`, and `resolved()` (the engine-published geometry —
  `{halfWidth, laneWidth, dividerOffset, egoCenterSigned, …}`, also read by the metrics
  subsystem so lane metrics track the **ego lane** on multi-lane roads).

Markings derive in the terrain shader from the existing road-proximity value plus the
resolved half-width (no new vertex attributes): a centre divider, interior lane lines, and
edge lines. v1 renders solid lines, a centred divider, and markings on the paved
(summer/spring) scene; per-vertex dashes and signed asymmetric dividers are noted as
follow-ups in the plan.

## Deploy

Deploy the repository root as a static site (GitHub Pages, Vercel, Netlify, etc.). No build step is required on deploy if you commit the built `static/js/cluster.js` and `static/js/main.ca6b3355.chunk.js`.

Before publishing, update social meta tags in `index.html` (`og:url`, `twitter:url`) to your production URL.

## Known gaps

The checked-in `static/media/` set is incomplete relative to the full game bundle. Summer/spring gameplay works.