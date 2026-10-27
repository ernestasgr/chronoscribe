# SPIKE: chart renderer, D3-on-Canvas vs ECharts 6 (throwaway)

Answers ernestasgr/chronoscribe#12. Never merged.

```bash
npm install
npm run dev     # http://localhost:5299/?renderer=d3|echarts-line|echarts-custom (wheel zooms, drag pans)
npm run bench   # Playwright: frame times -> results/frame-times.json, screenshots -> results/*.png
npm test        # the S-curve geometry both renderers share
```

Needs the local history dump in the main checkout's `.scratch/history/pages` (or `HISTORY_DIR`). The flattened
`public/history.json` and the screenshots are personal data and are git-ignored.

All three renderers draw the **real tables**: the history goes through `buildStandings` from `src/standings`
(96,451 Scrobbles, 1,292 Artists, 2,339 Days, Europe/Vilnius). Each draws Standing mode at X = 10 with the
line rule "every Artist in the Top X on any visible Day", no warm-up, which is the measured worst case of
**44 lines** over the full history. Changes of Standing are S-curves at least 14 px wide (`src/geometry.ts`,
shared by all three). Artists below #X slide off the bottom, and lines break while an Artist is unranked.

- **d3**: Canvas 2D, `d3-zoom` (x only) drives the window, `d3-shape` `curveBumpX` draws each segment.
- **echarts-line**: native `line` series, one per Artist, `dataZoom` inside with `throttle: 0`. The 14 px rule
  is pixel-based but line data lives in Day space, so every zoom event re-solves it in Days and pushes all
  series back through `setOption` (`replaceMerge`). Curves come from `smooth` + `smoothMonotone: 'x'`.
- **echarts-custom**: one `custom` series, one item per Artist; `renderItem` builds the same bump path as D3
  in pixel space from `api.coord`.

## Frame times

Chromium (Playwright, 1200×520 chart, DPR 1); raw numbers in `results/frame-times.json`.

**Scripted pass: CPU work per frame.** The time to move the window through the renderer's own zoom machinery
(`zoom.transform` / `dispatchAction('dataZoom')`) and paint the canvas synchronously (ECharts: `zr.flush()`),
over 720 frames: full history → 90 Days, pan 90 Days across all of it, widen to a year, pan back, zoom out.
One warm-up pass is discarded. All three draw the same 44 lines at the widest window. This is CPU cost only:
Chromium's raster and compositing come on top and are the same for all three (one 2D canvas). Milliseconds.

| Renderer | CPU | median | p95 | max |
|---|---|---|---|---|
| d3 | 1× | **0.2** | **0.5** | **1.1** |
| echarts-line | 1× | 2.9 | 5.1 | 7.9 |
| echarts-custom | 1× | 2.2 | 3.4 | 6.1 |
| d3 | 4× throttled | **0.8** | **2.8** | **7.3** |
| echarts-line | 4× throttled | 15.9 | 29.2 | 35.7 |
| echarts-custom | 4× throttled | 12.6 | 18.8 | 32.5 |

D3 costs 11–20× less at the median and 7–10× less at p95. A 144 fps frame leaves 6.9 ms. D3 stays inside it
at every p95 and misses only at its single worst throttled frame (7.3 ms). ECharts stays inside it only at
1× (echarts-line's worst frame, 7.9 ms, already misses), and is at 2–4× the budget at p95 when throttled.
The prototype's ~144 fps was measured during playback, not pan/zoom, so this compares like with like only
roughly.

**Real-input pass.** 8 wheel ticks in at the right edge, a drag across 80% of the chart and back, 8 ticks out,
with the real Playwright mouse, while counting rAF intervals. Probes confirm the window really moved
(D3: Days 1561–2178 → 1041–1658 and back; ECharts zooms less per tick: 1153–2244 → 221–1312 and back) with
11–15 lines while zoomed and 44 at full width. Headless Chromium caps rAF at 60 Hz, so intervals can't show
144 fps, and Playwright awaits each event, so a slow renderer stretches the run rather than dropping frames:

| Renderer | CPU | wall time | frames > 25 ms |
|---|---|---|---|
| d3 | 1× / 4× | 4.6 s / 4.6 s | 0 / 0 |
| echarts-line | 1× / 4× | 4.6 s / 8.6 s | 0 / 1 |
| echarts-custom | 1× / 4× | 4.6 s / 8.6 s | 0 / 1 |

At 4× ECharts needs nearly twice as long to work through the same input; D3 doesn't slow at all.

## Fidelity

D3 and echarts-custom draw identical geometry: the same segments through the same bump curve, with the 14 px
rule solved in real pixels every frame. echarts-line is only close. Its data lives in Day space, so the 14 px
rule is re-solved in Days on every `datazoom` event and holds only for the window of the last `setOption`. The
curve is ECharts' `smooth` + `smoothMonotone: 'x'` rather than the bump curve, and smoothing looks at
neighbouring points, so neither the shape nor the exact width is ours to set. At 90 Days and at full width the
screenshots look the same as D3's.

## Bending it to the Dashboard design

- **D3** (`src/d3.ts`, 78 lines): everything on the canvas is ours. Of the Dashboard's extras (playhead,
  ghosted future, dots and labels riding the lines, dashed Pinned Artists, hover), the prototype branch already
  built all of them this way. This spike did not rebuild them for either renderer.
- **ECharts** (`src/echarts.ts`, 137 lines for both modes: about 70 shared, 25 for line, 35 for custom).
  The Standing axis alone needed three workarounds:
  - A 0.5..X+0.5 extent puts the automatic ticks on half-Standings, so the labels need `customValues`.
  - `splitLine` follows the automatic ticks, so the gridlines became a `markLine`.
  - markLines paint over series, so the Artist lines needed `z: 10`.

  The custom series that draws faithfully is D3-style path code inside `renderItem`, so ECharts adds only axes
  and dataZoom. The line series needs a full `setOption` on every pan/zoom frame. Neither mode has a built-in
  equivalent of the ghosted future, the riding labels or the gliding playhead.
- Size: the full minified `echarts.min.js` is 1.1 MB (not measured tree-shaken). The four D3 modules are a few
  tens of KB.

## Choice: D3-on-Canvas

It does 7–20× less work per frame and keeps up with real input under 4× throttling where ECharts falls behind.
It draws the S-curves exactly, and it doesn't fight the Dashboard design. ECharts (the fallback) did not win, so
there is no ADR.
