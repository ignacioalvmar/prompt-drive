# AGENTS.md

Guidance for coding agents working on **Prompt Drive**, a static, client-side web
driving simulator for AI agents. Human-facing docs are in [`README.md`](README.md);
this file is the extra context an agent needs to change the code correctly.

## The one thing to get right: never edit built bundles

`static/js/*.js` are **generated artifacts**. Do **not** hand-edit them — your
changes will be overwritten on the next build and reviewers will reject them.

Edit the **source**, then rebuild:

| To change… | Edit here | Rebuild with |
| --- | --- | --- |
| Instrument cluster UI | `src/cluster/` | `npm run build:cluster` |
| Driving metrics | `src/metrics/` | `npm run build:metrics` |
| Dynamic lanes | `src/lanes/` | `npm run build:lanes` |
| Traffic road actors | `src/traffic/` | `npm run build:traffic` |
| Integration API | `src/api/` | `npm run build:api` |
| Cabin feedback features (Cabina Abierta) | `src/feedback/` (one file per feature in `features/`) | `npm run build:feedback` |
| Game-engine behavior | `scripts/build-main.js` (patches `src-extracted/deobfuscated.js`) | `npm run build:main` |

The built files **are committed to the repo**, so after editing source you must
rebuild and commit the regenerated `static/js/*.js` too.

## Dev environment

- No install step for running: it's a static site. `npm run dev` serves it on
  [http://localhost:3000](http://localhost:3000) (via `npx serve`). Any static
  file server works.
- `package.json` has **no runtime dependencies** and (currently) no dev
  dependencies, test runner, or linter. Don't add a heavy toolchain without being
  asked; match the existing plain-ES-module + IIFE-bundle style.
- Node is used only for the build scripts (plain `fs`/`path`, no bundler).
- Windows/CRLF: `.gitattributes` forces `eol=lf`. Keep it that way —
  `scripts/build-main.js` matches multi-line patch anchors written with `\n`, so
  CRLF files silently break the build. Author files with LF endings.

## Architecture (read before touching the engine)

Prompt Drive is the upstream game, deobfuscated into
`src-extracted/deobfuscated.js` and **patched at build time**. Three first-party
subsystems are layered on top as separate IIFE bundles, each exposed as a
`window.*` global and loaded by `<script>` tags in `index.html`:

| Subsystem | Source | Bundle | Global |
| --- | --- | --- | --- |
| Instrument cluster | `src/cluster/` | `static/js/cluster.js` | `InstrumentCluster` |
| Driving metrics | `src/metrics/` | `static/js/metrics.js` | `DrivingMetrics` |
| Dynamic lanes | `src/lanes/` | `static/js/lanes.js` | `LaneRoads` |
| Traffic road actors | `src/traffic/` | `static/js/traffic.js` | `RoadTraffic` |
| Integration API | `src/api/` | `static/js/api.js` | `PromptDrive` (+ `PromptDriveBridge`) |
| Cabin feedback | `src/feedback/` | `static/js/feedback.js` | `CabinFeedback` (+ `PromptDrive.feedback`) |

**Script load order matters** (see `index.html`): `cluster → metrics → lanes →
traffic → api → main`. The API bundle must load after `lanes.js` and
`traffic.js` (it delegates lane changes to `LaneRoads` and traffic calls to
`RoadTraffic`) and before the main bundle (so `PromptDriveBridge` exists when
the patched engine attaches handles). Preserve this order.

### The extension pattern

Every subsystem follows the same contract — mirror it for new work:

- A **facade** owns *user intent* + validation + persistence (`localStorage`) +
  its own settings-panel UI.
- The **engine reads/polls** the facade during generation or per frame.
- **Live state is published back** onto the facade for tools to read (e.g.
  `LaneRoads._resolved` / `._applied`; `PromptDriveBridge.handles`).

`src/lanes/LaneRoads.js` is the reference implementation.

### How engine patches work (`scripts/build-main.js`)

Patches are **anchored string replacements** via `replaceOnce(src, needle,
replacement, label)`. Rules:

- The `needle` must appear **exactly once** and match the source verbatim
  (whitespace included). If it's missing, the build throws
  `Patch failed: could not find anchor for "<label>"` — that's intentional, so a
  drifted anchor fails loudly instead of silently no-op'ing.
- Before adding a patch, open `src-extracted/deobfuscated.js`, find a **stable,
  unique** anchor, and copy it precisely. Prefer multi-line anchors with
  surrounding context; verify uniqueness first.
- Keep patched-in code defensive (`try/catch`, `typeof X !== "undefined"`
  guards) — it runs inside the minified engine and must never break the game if
  a global is absent.

### Minified engine symbol map

The deobfuscated engine keeps the upstream's short names. The ones subsystems
hook into:

| Symbol | What it is |
| --- | --- |
| `Ae` | Ego vehicle controller (position, speed, steer, heading, `onRoad`, `setHeadlights`) |
| `Fe` / `We` | `VehicleConfig` (type, mode, grip/speed, seat, …); `.set(key, val)` |
| `jh` / `Nh` | `SceneConfig` (seed, scene, topography, skin, weatherIndex, LOD, FOV); guarded `.set` |
| `ce` | Autodrive observable; `.set(bool)` |
| `ie` / `te` | Units / `GameConfig`; `.set("Units", n)` |
| `zl` | World/scene manager (skins, weather, topography, generation) |
| `Ks` | Day-night cycle length |
| `Vl` | Speed control / cruise |
| `Y` | Input signals (`Y.signal.*`, read each frame) |
| `r` | THREE.js module import (in scope inside the controller class) |

These are registered on `PromptDriveBridge` at controller init (see the
`PromptDrive bridge attach` patch in `build-main.js`) — read from there rather
than re-deriving them when possible.

## Build & validate

There is no automated test suite or linter, so **validation is: the build
succeeds, then the change is verified in the browser.**

1. **Build.** Run the specific `build:*` for what you changed, then a full
   `npm run build` before finishing (it rebuilds everything in dependency order
   and will surface any broken patch anchor).
2. **Verify in the browser.** `npm run dev`, open the app, click **begin**, and
   confirm your change. Watch the devtools console for errors.
   - For API/agent-facing changes, use the test console at
     [`/api-test.html`](api-test.html) — it exercises static + dynamic config,
     metrics, and the live telemetry/event feed over `postMessage`.
   - To skip the *begin* splash for headless checks, load with `?autostart=1`
     (see [`API.md`](API.md)). Note: world generation is `requestAnimationFrame`-
     driven, so a **hidden/background tab pauses generation** — keep the tab in
     the foreground when verifying.
3. **Don't leave the app broken.** After browser testing that wrote to
   `localStorage` (e.g. a bad seed via static config), clear it so a fresh load
   works.

## Code style

- Plain ES modules in `src/*` (the build strips `import`/`export` and wraps each
  subsystem in one IIFE). No TypeScript, JSX, or framework.
- Match the surrounding file's conventions: comment density, naming, and the
  small-observable-store idiom used across `src/*`.
- Keep new engine-facing code defensive and side-effect-free until the relevant
  global is confirmed present.

## PR / commit instructions

- **Only commit or push when the user asks.** When you do:
  - Rebuild first (`npm run build`) and **include the regenerated
    `static/js/*.js`** in the same commit as the source change — source and
    built output must stay in sync.
  - Keep line endings LF (never introduce CRLF).
  - Don't edit `static/js/main.ca6b3355.chunk.original.js` (the minified upstream
    input for re-extraction) unless you are deliberately replacing the upstream
    bundle via `npm run extract`.
- Write focused commits; describe *what changed in source* and note that bundles
  were regenerated.
- Update docs alongside behavior changes: `README.md` for human-facing features,
  [`API.md`](API.md) for the integration API, and the relevant
  `*-plan.md` when the design shifts.

## Key files

| Path | Purpose |
| --- | --- |
| `index.html` | Runtime entry; `<script>` load order for all bundles |
| `src/*/` | Editable subsystem sources |
| `scripts/build-*.js` | Build pipeline (one per subsystem + `build-main.js`) |
| `src-extracted/deobfuscated.js` | Deobfuscated engine; input to `build-main.js` patches |
| `static/js/*.js` | **Generated** bundles (committed; never hand-edit) |
| `api-test.html` | Local API test console |
| `README.md`, `API.md`, `*-plan.md` | Human docs, API reference, design plans |
