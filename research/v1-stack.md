# v1 stack: which TypeScript/React stack should Chronoscribe use?

Research for [#3](https://github.com/ernestasgr/chronoscribe/issues/3) (child of map [#1](https://github.com/ernestasgr/chronoscribe/issues/1)).
Researched 2026-10-25. Version numbers, publish dates and weekly downloads come from the npm registry
(`registry.npmjs.org/<pkg>` and `api.npmjs.org/downloads/point/last-week/<pkg>`) queried that day. Repo activity
comes from the GitHub REST API (`api.github.com/repos/<owner>/<repo>`, `pushed_at`), queried the same day.

## TL;DR: recommended stack

| Layer | Pick | Main alternative |
|---|---|---|
| Language | TypeScript **6.0.x** for now (TS 7 when typescript-eslint supports it) | TypeScript 7.0 with oxlint/Biome instead of typescript-eslint |
| Build tool / framework | **Vite 8** + `@vitejs/plugin-react` 6, plain client-side SPA, React 19.3 | TanStack Start in SPA mode (only if routing/server functions become needed) |
| Charting layer | **Custom chart: D3 modules (`d3-scale`, `d3-shape`, `d3-zoom`, `d3-array`) drawing to Canvas 2D**, with React rendering axes, Focus Day marker and labels | **Apache ECharts 6** (canvas, built-in pan/zoom via `dataZoom`, animation, `endLabel`) |
| Local storage | **Dexie 4** (IndexedDB) for raw Scrobbles + cached derived data | SQLite-WASM (`@sqlite.org/sqlite-wasm`) on the `opfs-sahpool` VFS |
| Aggregation (Standings) | Plain TypeScript over typed arrays **in a Web Worker** | DuckDB-WASM (SQL window functions) |
| Worker tooling | **Comlink** + Vite's native `new Worker(new URL(...), { type: 'module' })` | Hand-written typed `postMessage` protocol |
| UI state | **Zustand 5** | Jotai |
| Async data (worker queries, last.fm calls) | **TanStack Query 5** | `dexie-react-hooks` `useLiveQuery` + plain `fetch` |
| Styling / UI kit | **Tailwind CSS 4 + shadcn/ui** (Base UI or Radix primitives) | Mantine 9 |
| List virtualization | **TanStack Virtual 3** | virtua |
| Search over Artists | **uFuzzy** (or plain substring) into a virtualized list | Fuse.js |
| Testing | **Vitest 5** (unit, + `fake-indexeddb`), **Playwright** (e2e), Testing Library | Vitest Browser Mode in place of Playwright e2e |

No routing library is needed for v1 (one screen plus a settings panel). **No server or proxy is needed**: the last.fm
API sends `access-control-allow-origin: *` (see [last.fm API](#lastfm-api-needs-no-proxy)).

## The workload that drives these choices

- 100k–500k+ Scrobbles; with a ~10-year history that is ~3,650+ Days and plausibly 5k–20k distinct Artists.
- Standing on every Day for every Artist is dense: 5,000 Days x 10,000 Artists = 50M cells. That should not be
  materialized as rows in any store. It is cheap to compute incrementally in memory: walk Days in order, add each
  Day's Daily plays, and re-rank only Artists whose count changed (ties broken by who reached the count first, per
  GLOSSARY). Output is compact: per-Day Top X arrays, and per-Artist sparse series of (Day, Standing, cumulative count)
  for the Artists that ever need a line.
- Climbers range over **all** Artists, so the Focus Day panel needs the full rank vector for two adjacent Days. That is
  O(Artists) per Focus Day and easily done in the worker on demand.
- The chart draws "dozens" of lines (every Artist in the Top X on any Day in the visible window, plus Pinned Artists);
  zoomed out, that is up to ~50 lines x ~5,000 points = ~250k points, and the set of lines changes while panning.

This makes the storage layer a simple append-mostly log, and the hard parts the **worker computation** and a
**bespoke, fast chart**.

## Build tool / framework

**Pick: Vite 8 (SPA).**

- Vite 8.3.5 published 2026-10-21; ~127M weekly downloads. Vite 8 (announced 2026-03-12) replaced esbuild+Rollup with
  the Rust bundler Rolldown and uses Oxc; `@vitejs/plugin-react` 6 uses Oxc for React Refresh. Requires Node 20.19+ / 22.12+.
  Source: [vite.dev/blog/announcing-vite8](https://vite.dev/blog/announcing-vite8), [vite.dev/blog](https://vite.dev/blog/).
- State of JS 2025: Vite has 98% satisfaction among build tools (webpack 26%) and 84.4% usage.
  Source: [2025.stateofjs.com libraries](https://2025.stateofjs.com/en-US/libraries/).
- Web Workers are first-class in Vite (`new Worker(new URL('./standings.worker.ts', import.meta.url), { type: 'module' })`),
  which is all the worker tooling we need.

**Why not Next.js** (16.4.3, ~44.6M/wk): it is server-first (RSC, server routes) and we have no server. Its State of JS
2025 satisfaction fell from 68% to 55%.

**Main alternative: TanStack Start** (`@tanstack/react-start` 1.169.4, ~7.4M/wk, published 2026-10-22). It has an SPA mode
that prerenders only a static shell and deploys to any static host; server functions are optional
([docs](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)). That would only pay off if v1 grows
routes or needs a server function (e.g. hiding an API key). Today it adds a router and framework surface we do not need.

## Charting layer

### Requirements that rule libraries in or out

1. Smooth horizontal pan/zoom across thousands of Days (60 fps while dragging, and during autoplay).
2. Dozens of lines, up to ~250k visible points when zoomed out, with the **set of lines changing** as the window moves.
3. Y axis switchable between Standing (inverted rank, bump-chart style, lines leaving the Top X fall off the bottom or
   break) and cumulative Scrobble count, ideally with an animated transition.
4. A Focus Day marker synced with a side panel; autoplay that scrolls the window over time.
5. Highlighting a hovered/Pinned Artist; end labels with Artist names.

### Candidates

| Library | Version / last publish | Weekly dl | Renderer | Fit |
|---|---|---|---|---|
| D3 modules (`d3-scale` 4.0.2, `d3-shape` 3.2.0, `d3-zoom` 3.0.0) | stable; last publishes 2021-2022; `d3/d3` repo pushed 2026-10-21 | 48.6M / 61.1M / 22.4M | none (you choose: Canvas 2D) | Full control over all 5 requirements; most code to write |
| Apache ECharts | 6.1.0, 2026-05-19 | ~4.0M | Canvas (or SVG) | Good: `dataZoom` inside = wheel zoom + drag pan, animation, `endLabel`, inverse Y axis |
| uPlot | 1.6.32, 2025-03-14; repo pushed 2026-10-25 | ~449k | Canvas 2D | Fastest raw line rendering; **no animations, no built-in panning** |
| visx | 4.0.0, 2026-06-11 | `@visx/shape` 4.6M, `@visx/xychart` 233k | SVG (React) | Nice React primitives but SVG re-render of ~250k points per pan frame is the wrong cost model |
| Recharts | 3.10.1, 2026-07-25 | ~35.4M | SVG | Most popular, but SVG + no real pan/zoom; not built for this volume |
| Nivo (`@nivo/bump`) | 0.99.0, 2025-05-23 | 22k | SVG/Canvas | Has a bump chart, but no pan/zoom, fixed series per render, slow release cadence |
| Observable Plot | 0.6.17, 2025-02-14 | ~713k | SVG | Excellent for static exploratory charts; not interactive pan/zoom |
| lightweight-charts | 5.2.1, 2026-08-12 | ~824k | Canvas | Financial time series; no rank axis/bump semantics |
| deck.gl / PixiJS (WebGL) | 9.4.0 / 8.22.0 | ~601k / ~884k | WebGL | Overkill at 250k points; Canvas 2D suffices |

Evidence:

- uPlot README: 166,650 points rendered interactively in ~25 ms cold; "No transitions or animations"; zoom built in
  but panning needs plugins; may "struggle beyond 100k in-view points" when streaming at 60 fps.
  Source: [github.com/leeoniya/uPlot](https://github.com/leeoniya/uPlot).
- ECharts `dataZoom` (type `inside`) supports wheel zoom (`zoomOnMouseWheel`), drag pan (`moveOnMouseMove`),
  `filterMode: 'none' | 'empty'` (keep the other axis stable), and a `throttle` (default 100 ms, set to 0 for smooth
  drag when animation is off). Source: [option.dataZoom-inside](https://echarts.apache.org/en/llms-documents/option-parts/option.dataZoom-inside.md).
  ECharts `endLabel` (since 5.0) with `valueAnimation` gives the "bar chart race" style labels.
  Source: [option.series-line](https://echarts.apache.org/en/llms-documents/option-parts/option.series-line.md).
  ECharts' feature page claims incremental rendering of "millions of data points" and automatic diff-and-animate on data change.
  Source: [echarts.apache.org/en/feature.html](https://echarts.apache.org/en/feature.html).

### Recommendation: custom Canvas 2D chart built from D3 modules

The chart **is** the product, and every requirement is bespoke: a dynamic set of lines tied to the visible window,
rank-vs-count Y modes with a morph between them, a Focus Day cursor driving a panel, and autoplay. A thin custom layer
handles this better than configuring a general-purpose library against its grain:

- `d3-scale` (`scaleUtc`/`scaleLinear`) for X (Days) and Y (Standing or count); `d3-zoom` for wheel/drag/touch pan-zoom
  constrained to X (`translateExtent`, `scaleExtent`); `d3-shape` `line()` with a canvas `context` to draw paths;
  `d3-array` `bisector` to slice each series to the visible Day range.
- Canvas 2D for lines (one `stroke()` per Artist, highlighted line drawn last); React/SVG overlay for axes, the Focus Day
  marker and end labels. Redraw in `requestAnimationFrame`; React state updates only when the visible Day range settles.
- Y-mode switch: tween each point's Y between the two scales over ~400 ms (`d3-interpolate`/`d3-ease`, or just a lerp).
- D3 modules last published 2021-2022 but are stable, dependency-free, and heavily used (tens of millions of weekly
  downloads); the `d3/d3` repo is still maintained (pushed 2026-10-21).

**Main alternative: ECharts 6.** It gets a working chart fastest: inverse Y axis for Standing, `connectNulls: false` for
breaks when an Artist leaves the Top X, `dataZoom` for pan/zoom, `endLabel`, built-in animations. Risks: pushing a
changing set of dozens of series through `setOption` on every pan/autoplay frame, keeping animation smooth while
`dataZoom` throttles, and bending its tooltip/axis model to the Focus Day UX. Choose it if speed to a first demo matters
more than control.

**Suggested de-risking:** a 1-day `prototype` spike rendering 50 synthetic series x 5,000 Days with pan, zoom, Y-mode
switch and autoplay, in both D3+Canvas and ECharts, before committing.

## Local storage

| Option | Version / publish | Weekly dl | Notes |
|---|---|---|---|
| Dexie | 4.4.7, 2026-10-19 | ~1.66M | IndexedDB wrapper; `bulkPut` designed for 100k-item imports; compound indexes; `useLiveQuery` hooks |
| SQLite-WASM (`@sqlite.org/sqlite-wasm`) | 3.54.1-build1, 2026-10-19 | ~602k | Official build; real SQL incl. window functions; OPFS persistence from a worker |
| DuckDB-WASM | 1.33.1-dev57.0 (latest tag is a dev build), 2026-06-22 | ~341k | Columnar OLAP SQL; best GROUP BY/window performance; heavy |
| PGlite | 0.5.11 | ~17.1M | Postgres in WASM; not designed for this analytic workload |

Evidence:

- Dexie: `bulkPut()` is faster than `put()` in a loop and the docs use a 100,000-item example; wrap in a transaction
  for all-or-nothing. Source: [dexie.org/docs/Table/Table.bulkPut()](https://dexie.org/docs/Table/Table.bulkPut()).
- SQLite-WASM persistence: the `opfs` VFS needs `SharedArrayBuffer` and therefore COOP/COEP headers; the
  `opfs-sahpool` VFS needs no COOP/COEP, works on major browsers since March 2023, is the fastest OPFS option, but
  allows only one connection (a second tab fails). All OPFS VFSes are worker-only.
  Source: [sqlite.org/wasm/doc/trunk/persistence.md](https://sqlite.org/wasm/doc/trunk/persistence.md).
- DuckDB-WASM: single-threaded by default ("multithreading ... still experimental"), WebAssembly memory capped at 4 GB.
  Source: [duckdb.org/docs/2.0/clients/wasm/overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html).

**Pick: Dexie.** The store's job is small: persist the raw Scrobble log (dedupe on a compound key such as
`[timestamp+artist+track]`), remember sync progress, and optionally cache derived Standings. 500k rows is a few tens
of MB in IndexedDB. The heavy aggregation (Standings, Climbers) is a sequential sweep better done in typed arrays in the
worker than as SQL over a 50M-cell virtual table, so a SQL engine buys little. Dexie is the most-used, actively released
option with the simplest setup (no WASM, no OPFS, no headers).

**Main alternative: SQLite-WASM on `opfs-sahpool`.** Worth it if we later want ad-hoc SQL (e.g. per-track queries
post-v1). Costs: ~1 MB WASM, worker-only, single-tab. **DuckDB-WASM** is the right tool only if aggregation moves into
SQL; its npm `latest` tag pointing to a dev build is itself a caution sign.

## Worker tooling

**Pick: Comlink** (4.4.2, ~1.77M/wk) on top of Vite's native module workers. Comlink turns the worker into an async
object (`standings.compute()`, `standings.focusDay(day)`), and `Comlink.transfer()` lets us hand back `Float32Array`/
`Int32Array` buffers without copying. Risk is low but note: last npm release was 2024-11-07 (the
`GoogleChromeLabs/comlink` repo was pushed 2026-10-14); it is small and feature-complete.

**Alternative:** a hand-written discriminated-union `postMessage` protocol (no dependency, more boilerplate).

## State management

**Pick: Zustand 5** (5.0.16, 2026-10-22, ~40.5M/wk) for UI state: visible Day window, Focus Day, Y mode, X (Top X size),
Pinned Artists, autoplay on/off and speed. Selectors keep the chart from re-rendering on unrelated changes, and
`store.subscribe` lets the canvas render loop read state outside React. State of React 2025 describes Zustand as
"gaining ground fast" and the most popular by satisfaction.
Source: [2025.stateofreact.com state management](https://2025.stateofreact.com/en-US/libraries/state-management/).

**Alternative: Jotai** (3.0.1, 2026-09-29, ~4.2M/wk), atom-per-setting; fine, but the chart loop benefits from one store.
Redux Toolkit (2.13.0, ~21.6M/wk) is more ceremony than a single-user app needs.

## Data fetching

**Pick: TanStack Query 5** (5.104.5, 2026-10-19, ~42.7M/wk) as the async cache for (a) worker queries keyed by
`[focusDay, x]` or visible window, and (b) small last.fm calls (user info). The long paginated import/sync is **not** a
query: write it as a plain async job (`fetch` loop, rate-limited, resumable via a stored cursor) that writes to Dexie and
reports progress through Zustand; trigger it with a `useMutation`.

**Alternative:** `dexie-react-hooks` `useLiveQuery` (4.4.0, ~341k/wk) for reactive reads straight from IndexedDB, plus
plain `fetch`. SWR (2.5.1, ~12.4M/wk) is a lighter but less capable equivalent of TanStack Query.

### last.fm API needs no proxy

A request from origin `http://localhost:5173` to `ws.audioscrobbler.com/2.0/?...&format=json` returned
`access-control-allow-origin: *` and `access-control-allow-methods: POST, GET, OPTIONS` (checked with curl,
2026-10-25). The browser can call last.fm directly; the API key is the listener's own and lives in local settings.
last.fm warns that accounts making "several calls per second" continuously may be suspended, so the import must
throttle. Source: [last.fm/api/intro](https://www.last.fm/api/intro). (Detailed API behaviour belongs to the API
research ticket.)

## Styling / UI kit

**Pick: Tailwind CSS 4 + shadcn/ui.** Tailwind 4.3.3 (~88.7M/wk); `shadcn` CLI 4.22.1 (2026-10-18, ~8.0M/wk) copies
components into the repo on top of Base UI (`@base-ui/react` 1.9.0, ~11.9M/wk) or Radix (`radix-ui` 1.8.1, ~11.7M/wk).
We own the code, so the side panel, toggles, slider and search popover are easy to adapt, and nothing styles the canvas.

**Alternative: Mantine 9** (9.7.3, 2026-10-17, ~1.66M/wk): batteries-included (Combobox, SegmentedControl, Slider,
hooks), less assembly, but its own styling system alongside the chart's.

## List virtualization and Artist search

**Pick: TanStack Virtual 3** (3.14.22, 2026-10-22, ~17.8M/wk), headless, for the Climbers list and the search results
over thousands of Artists. Filter with **uFuzzy** (`@leeoniya/ufuzzy` 1.0.19, ~308k/wk; same author as uPlot, built
for fast filtering of large lists) or simple case-insensitive substring matching, then render through the virtualizer.

shadcn's Command (`cmdk` 1.1.1, last published 2025-03-14) is convenient for the popover shell, but feed it
pre-filtered, capped results rather than thousands of items.

**Alternatives:** virtua (0.53.6, ~706k/wk, zero-config) or react-window 2 (2.5.0, ~3.8M/wk); Fuse.js (7.5.0, ~8.7M/wk)
for typo-tolerant search.

## Testing

**Pick: Vitest 5** (5.0.5, ~83.7M/wk) for unit tests, especially the Standings/Climbers computation (pure functions
over typed arrays: the most valuable thing to test), with `fake-indexeddb` (6.2.6) for Dexie code; **Testing Library**
(`@testing-library/react` 16.3.3) for components; **Playwright** (1.64.1, ~49.8M/wk) for end-to-end and canvas
screenshot tests. State of JS 2025 satisfaction: Vitest 97%, Playwright 94%, Testing Library 89%, MSW 87%; Vitest and
Playwright each gained 14 points of usage year over year. Source: [2025.stateofjs.com](https://2025.stateofjs.com/en-US/libraries/).
MSW (3.0.3) can mock last.fm for import tests.

**Alternative:** Vitest Browser Mode (`@vitest/browser` 5.0.5, ~8.7M/wk) for component/worker tests in a real browser
instead of jsdom; Jest is no longer the default choice (65% satisfaction).

## Risky bets and open flags

1. **TypeScript 7 vs typescript-eslint.** TypeScript 7.0.2 (the native port) is npm `latest` since 2026-07-08, but
   `typescript-eslint` 8.72.0 declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. Either pin TS 6.0.x with ESLint 10,
   or use TS 7 with oxlint (1.89.0) or Biome (2.6.3) and give up type-aware ESLint rules. Recommended: TS 6.0.x now.
2. **Custom chart is the biggest cost.** The D3+Canvas pick trades library help for control. Spike it (see above); if
   the spike drags, fall back to ECharts.
3. **uPlot** looks attractive on raw speed but explicitly has no animations and no built-in pan, and its npm release
   is from 2025-03; do not pick it for a chart whose Y-mode switch and autoplay want motion.
4. **DuckDB-WASM**: npm `latest` is a dev build (1.33.1-dev57.0); avoid unless SQL aggregation becomes central.
5. **SQLite-WASM on `opfs-sahpool`** fails on a second tab; if chosen, the app must handle "already open elsewhere".
6. **Comlink** has not published since 2024-11; low risk (tiny, stable), replaceable with raw `postMessage`.
7. **Nivo / visx / Recharts / Observable Plot** are SVG-first; at ~250k visible points with continuous pan they are
   the wrong rendering model for this chart, regardless of popularity.
8. **IndexedDB eviction**: browser storage is best-effort unless `navigator.storage.persist()` is granted; the app
   should request it after first import (re-importing from last.fm is the recovery path).
