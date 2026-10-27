// SPIKE: ECharts 6, two ways. "line" bends native line series to S-curves; "custom" draws each Artist's
// path itself in a custom series. Both pan and zoom through an inside dataZoom on the x axis.
import { line as d3line, curveBumpX } from "d3-shape";
import * as echarts from "echarts";
import type { StandingsTables } from "../../../src/standings";
import { sCurveSegments, type Point } from "./geometry";
import { colorOf, dateOf, drawnArtists, MARGIN, type Renderer, standingLevel, X } from "./model";

export type EChartsMode = "line" | "custom";

export function mountECharts(host: HTMLElement, tables: StandingsTables, mode: EChartsMode): Renderer {
  const chart = echarts.init(host, undefined, { renderer: "canvas" });
  const plotWidth = host.getBoundingClientRect().width - MARGIN.left - MARGIN.right;
  let view = { from: 0, to: tables.dayCount - 1 };
  let lines = 0;

  // Native line series live in data space, so the 14 px rule is re-solved in Days at every zoom level.
  const lineSeries = () => {
    const pxPerDay = plotWidth / (view.to - view.from);
    const artists = drawnArtists(tables, view.from, view.to);
    lines = artists.length;
    return artists.map((artist) => ({
      id: String(artist),
      type: "line" as const,
      data: sCurveSegments(standingLevel(tables, artist), (day) => day * pxPerDay, view.from, view.to).flatMap(
        (segment) => [...segment.map(([px, standing]) => [px / pxPerDay, standing]), [null, null]],
      ),
      smooth: 0.5,
      smoothMonotone: "x" as const,
      connectNulls: false,
      showSymbol: false,
      silent: true,
      z: 10,
      clip: true,
      lineStyle: { width: 1.8, color: colorOf(artist) },
    }));
  };

  // Custom series: one item per Artist, its path built in pixel space from the axis' current mapping.
  const bumpPath = d3line<Point>().curve(curveBumpX);
  const customSeries = () => {
    const artists = drawnArtists(tables, view.from, view.to);
    lines = artists.length;
    return [
      {
        id: "lines",
        type: "custom" as const,
        z: 10,
        clip: true,
        silent: true,
        data: artists.map((artist) => [artist]),
        renderItem: (params: echarts.CustomSeriesRenderItemParams, api: echarts.CustomSeriesRenderItemAPI) => {
          const artist = api.value(0) as number;
          const origin = api.coord([0, 1]);
          const pxPerDay = api.coord([1, 1])[0]! - origin[0]!;
          const plot = params.coordSys as unknown as { x: number; width: number };
          const toY = (standing: number) => api.coord([0, standing])[1]!;
          const x = (day: number) => origin[0]! + day * pxPerDay;
          const from = (plot.x - origin[0]!) / pxPerDay;
          const to = (plot.x + plot.width - origin[0]!) / pxPerDay;
          const pathData = sCurveSegments(standingLevel(tables, artist), x, from, to)
            .map((segment) => bumpPath(segment.map(([px, standing]) => [px, toY(standing)]))!)
            .join("");
          return {
            type: "path",
            shape: { pathData },
            style: { fill: "none", stroke: colorOf(artist), lineWidth: 1.8 },
          };
        },
      },
    ];
  };

  const series = mode === "line" ? lineSeries : customSeries;
  const standings = Array.from({ length: X }, (_, i) => i + 1);
  // Gridlines on whole Standings: splitLine follows the automatic ticks, so they are a markLine instead.
  const grid = {
    id: "grid",
    type: "line" as const,
    data: [],
    silent: true,
    // markLines draw above series by default, so the Artist lines sit at z 10.
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      animation: false,
      lineStyle: { color: "#eee", type: "solid" as const, width: 1 },
      data: standings.map((yAxis) => ({ yAxis })),
    },
  };

  chart.setOption({
    animation: false,
    grid: { left: MARGIN.left, right: MARGIN.right, top: MARGIN.top, bottom: MARGIN.bottom },
    xAxis: {
      type: "value",
      min: 0,
      max: tables.dayCount - 1,
      splitLine: { show: false },
      axisLabel: { formatter: (day: number) => dateOf(tables, day), color: "#999" },
    },
    yAxis: {
      type: "value",
      inverse: true,
      min: 0.5,
      max: X + 0.5,
      // A 0.5..X+0.5 extent puts the automatic ticks on half-Standings, so Standings are named explicitly.
      axisTick: { show: false, customValues: standings },
      axisLabel: { customValues: standings, formatter: (v: number) => `#${v}`, color: "#999" },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none", throttle: 0, minValueSpan: 14 }],
    series: [grid, ...series()],
  });

  // Wheel and drag report the window in percent, dispatchAction in the values it was given.
  type Zoom = { start?: number; end?: number; startValue?: number; endValue?: number };
  chart.on("datazoom", (event) => {
    const zoom = ((event as { batch?: Zoom[] }).batch?.[0] ?? event) as Zoom;
    const last = tables.dayCount - 1;
    view = {
      from: zoom.startValue ?? ((zoom.start ?? 0) / 100) * last,
      to: zoom.endValue ?? ((zoom.end ?? 100) / 100) * last,
    };
    chart.setOption({ series: [grid, ...series()] }, { replaceMerge: ["series"], lazyUpdate: false });
  });

  return {
    show(from, to) {
      chart.dispatchAction({ type: "dataZoom", startValue: from, endValue: to });
      chart.getZr().flush();
    },
    drawn: () => lines,
    view: () => [view.from, view.to],
  };
}
