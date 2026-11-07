# @hcis/vehicle-content

The single shared copy of the content-layer contract used by **PromptDrive**
(runtime) and **WorlDrive** (authoring, validation, analysis). Plain ES
modules, no dependencies, no I/O — pin it by exact version.

```js
import { createResolver, validatePack, computeContentHash, toOpenAITools, toGeminiDeclarations, labelTask } from '@hcis/vehicle-content';

const r = createResolver(pack);
r.searchContacts({ query: 'Pipe' });        // { status:'ok', candidates:[{ id:'c_0012', score:1, matched_on:'alias', … }] }
r.searchPoi({ category: 'fuel' }, ctx);     // ctx: { distanceTo(poi), routeActive, now, … } — deterministic inputs
validatePack(pack, { roadGraph, tasks });  // { ok, errors, warnings }
```

| Module | Contents |
| --- | --- |
| `src/version.js` | versions, thresholds, scores, enums (frozen within 1.x) |
| `src/canonical.js`, `src/sha256.js` | canonical JSON + `content_hash` |
| `src/normalize.js`, `src/synonyms.js`, `src/hours.js` | normalization, phonetic keys, per-locale synonym files, opening hours |
| `src/resolver.js` | scoring, thresholds, tie-breaking, browse mode |
| `src/tools.js`, `src/adapters.js`, `src/validate-args.js` | the 12 `vehicle-tools/1.0` schemas, provider formats, argument validation |
| `src/pack-validate.js` | blocking checks + warnings, designed conditions via the resolver |
| `src/labeler.js` | failure taxonomy |

CLIs: `node cli/validate-pack.js <pack> [--graph road-graph.json] [--tasks tasks.json]`,
`node cli/label-log.js <log.jsonl> --pack <pack> --tasks <tasks>`.
Scripts: `npm run gen:tools` (regenerate `generated/`), `npm test` (drift check + unit tests),
`node scripts/gen-starter-pack.js <slots.json>`.
