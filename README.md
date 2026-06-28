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
npm run build          # cluster + main bundle
npm run build:cluster  # src/cluster/ → static/js/cluster.js
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
| `src-extracted/deobfuscated.js`             | Deobfuscated game bundle; input for patches |
| `scripts/build-*.js`                        | Build pipeline                              |
| `static/js/main.ca6b3355.chunk.original.js` | Minified upstream bundle for re-extraction  |




## Deploy

Deploy the repository root as a static site (GitHub Pages, Vercel, Netlify, etc.). No build step is required on deploy if you commit the built `static/js/cluster.js` and `static/js/main.ca6b3355.chunk.js`.

Before publishing, update social meta tags in `index.html` (`og:url`, `twitter:url`) to your production URL.

## Known gaps

The checked-in `static/media/` set is incomplete relative to the full game bundle. Summer/spring gameplay works.