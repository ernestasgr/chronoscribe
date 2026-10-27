// SPIKE: mounts one renderer (?renderer=d3|echarts-line|echarts-custom) on the real tables and exposes
// a scripted pan/zoom benchmark as window.bench().
import { mountD3 } from "./d3";
import { mountECharts } from "./echarts";
import { loadTables, type Renderer } from "./model";

type DayWindow = [from: number, to: number];

/** Zoom from the full history into 90 Days, pan them across it, widen to a year, pan back, zoom out. */
function script(dayCount: number): DayWindow[] {
  const last = dayCount - 1;
  const tween = (a: DayWindow, b: DayWindow, frames: number): DayWindow[] =>
    Array.from({ length: frames }, (_, i) => {
      const k = (i + 1) / frames;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    });
  const full: DayWindow = [0, last];
  const quarterAtEnd: DayWindow = [last - 90, last];
  const quarterAtStart: DayWindow = [0, 90];
  const yearAtStart: DayWindow = [0, 365];
  const yearAtEnd: DayWindow = [last - 365, last];
  return [
    ...tween(full, quarterAtEnd, 120),
    ...tween(quarterAtEnd, quarterAtStart, 240),
    ...tween(quarterAtStart, yearAtStart, 60),
    ...tween(yearAtStart, yearAtEnd, 240),
    ...tween(yearAtEnd, full, 60),
  ];
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const round = (v: number) => Math.round(v * 100) / 100;
const summary = (samples: number[]) => {
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)!),
    mean: round(samples.reduce((a, b) => a + b, 0) / samples.length),
  };
};

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

async function bench(renderer: Renderer, dayCount: number) {
  const work: number[] = [];
  const intervals: number[] = [];
  const drawn: number[] = [];
  let previous = await nextFrame();
  for (const [from, to] of script(dayCount)) {
    const started = performance.now();
    renderer.show(from, to);
    work.push(performance.now() - started);
    drawn.push(renderer.drawn());
    const now = await nextFrame();
    intervals.push(now - previous);
    previous = now;
  }
  return { frames: work.length, work: summary(work), interval: summary(intervals), maxLines: Math.max(...drawn) };
}

const name = new URLSearchParams(location.search).get("renderer") ?? "d3";
const host = document.getElementById("chart")!;
const tables = await loadTables();
const renderer =
  name === "d3" ? mountD3(host, tables) : mountECharts(host, tables, name === "echarts-line" ? "line" : "custom");
document.getElementById("title")!.textContent =
  `${name}: ${tables.artists.length} Artists, ${tables.dayCount} Days. Wheel zooms, drag pans.`;

Object.assign(window, {
  bench: () => bench(renderer, tables.dayCount),
  show: (from: number, to: number) => renderer.show(from, to),
  probe: () => ({ view: renderer.view().map(Math.round), lines: renderer.drawn() }),
  ready: true,
});
