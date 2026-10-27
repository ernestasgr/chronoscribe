# SPIKE: chart renderer, D3-on-Canvas vs ECharts 6 (throwaway)

Answers ernestasgr/chronoscribe#12. Never merged.

```bash
npm install
npm run dev     # http://localhost:5299/?renderer=d3|echarts-line|echarts-custom (wheel zooms, drag pans)
npm run bench   # Playwright: frame times -> results/frame-times.json, screenshots -> results/*.png
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

Chromium (Playwright, 1200×520 chart, DPR 1). "Work" is the time per frame to move the window through the
renderer's own zoom machinery (`zoom.transform` / `dispatchAction('dataZoom')`) and paint synchronously
(ECharts: `zr.flush()`), over a scripted 720-frame pan/zoom: full history → 90 Days, pan 90 Days across all
of it, widen to a year, pan back, zoom out. One warm-up pass is discarded. Milliseconds.

| Renderer | CPU | median | p95 | max |
|---|---|---|---|---|
| d3 | 1× | **0.2** | **0.5** | **1.3** |
| echarts-line | 1× | 2.8 | 5.0 | 8.0 |
| echarts-custom | 1× | 2.2 | 3.4 | 6.3 |
| d3 | 4× throttled | **1.0** | **3.8** | **8.9** |
| echarts-line | 4× throttled | 15.5 | 29.1 | 37.7 |
| echarts-custom | 4× throttled | 12.3 | 18.5 | 28.9 |

Real wheel and drag input (Playwright mouse, rAF intervals): every renderer holds 16.7 ms frames (headless
vsync) at 1×; at 4× throttling ECharts drops 1 frame to 33 ms per run, D3 none. The prototype's ~144 fps
baseline needs < 6.9 ms per frame: D3 clears it with a wide margin even throttled, ECharts only unthrottled.

## Fidelity

D3 and echarts-custom draw identical geometry (same segments, same bump curve). echarts-line is close: its
monotone smoothing gives S-curves that look the same at 90 Days and over the full history, but the shape is
ECharts' smoothing, not the bump curve, so the exact curve is not ours to set.

## Bending it to the Dashboard design

- **D3**: 78 lines. Everything on the canvas is ours, so the Dashboard's playhead, ghosted future, riding
  dots and labels, dashed Pinned Artists and hover are more of the same code (the prototype already did them).
- **ECharts**: 137 lines, and the Standing axis alone needed three workarounds. A 0.5..X+0.5 extent puts the
  automatic ticks on half-Standings, so labels need `customValues`; `splitLine` follows the automatic ticks,
  so gridlines became a `markLine`; markLines paint over series, so the lines needed `z: 10`. The custom
  series that draws faithfully is D3-style path code inside `renderItem`, so ECharts adds axes and dataZoom
  but costs 5–10× the frame time. The line series needs a full `setOption` on every pan/zoom frame. The
  ghosted future, riding labels and gliding playhead have no built-in equivalent in either mode.
- Size: the full minified `echarts.min.js` is 1.1 MB (not measured tree-shaken); the four D3 modules are a
  few tens of KB.

## Choice: D3-on-Canvas

It is 5–15× cheaper per frame, the only one that keeps 144 fps headroom under 4× throttling, draws the
S-curves exactly, and doesn't fight the Dashboard design. ECharts (the fallback) did not win, so no ADR.
