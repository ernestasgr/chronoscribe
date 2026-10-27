// SPIKE: D3-on-Canvas. d3-zoom drives the x-only pan/zoom; every zoom event redraws the canvas.
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { curveBumpX, line } from "d3-shape";
import { zoom, zoomIdentity } from "d3-zoom";
import type { StandingsTables } from "../../../src/standings";
import { sCurveSegments, type Point } from "./geometry";
import { colorOf, dateOf, drawnArtists, MARGIN, type Renderer, standingLevel, X } from "./model";

export function mountD3(host: HTMLElement, tables: StandingsTables): Renderer {
  const { width, height } = host.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  const canvas = host.appendChild(document.createElement("canvas"));
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  Object.assign(canvas.style, { width: `${width}px`, height: `${height}px`, display: "block" });
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const plot = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: height - MARGIN.bottom };
  const full = scaleLinear().domain([0, tables.dayCount - 1]).range([plot.left, plot.right]);
  const y = scaleLinear().domain([0.5, X + 0.5]).range([plot.top, plot.bottom]);
  const bump = line<Point>().curve(curveBumpX).context(g);
  let lines = 0;

  const draw = (from: number, to: number) => {
    const x = scaleLinear().domain([from, to]).range([plot.left, plot.right]);
    g.clearRect(0, 0, width, height);
    g.font = "11px system-ui";
    g.lineWidth = 1;
    g.strokeStyle = "#eee";
    g.fillStyle = "#999";
    for (let standing = 1; standing <= X; standing++) {
      g.beginPath();
      g.moveTo(plot.left, y(standing));
      g.lineTo(plot.right, y(standing));
      g.stroke();
      g.fillText(`#${standing}`, 6, y(standing) + 4);
    }
    for (const day of x.ticks(Math.floor((plot.right - plot.left) / 110)))
      g.fillText(dateOf(tables, day), x(day) - 30, height - 8);

    g.save();
    g.beginPath();
    g.rect(plot.left, plot.top - 4, plot.right - plot.left, plot.bottom - plot.top + 8);
    g.clip();
    g.lineWidth = 1.8;
    const artists = drawnArtists(tables, from, to);
    lines = artists.length;
    for (const artist of artists) {
      const level = standingLevel(tables, artist);
      g.strokeStyle = colorOf(artist);
      g.beginPath();
      for (const segment of sCurveSegments(level, x, from, to)) bump(segment.map(([px, standing]) => [px, y(standing)]));
      g.stroke();
    }
    g.restore();
  };

  const behaviour = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([1, tables.dayCount / 14])
    .extent([[plot.left, 0], [plot.right, height]])
    .translateExtent([[plot.left, 0], [plot.right, height]])
    .on("zoom", ({ transform }) => {
      const [from, to] = transform.rescaleX(full).domain() as [number, number];
      draw(Math.max(0, from), Math.min(tables.dayCount - 1, to));
    });
  const selection = select(canvas).call(behaviour).on("dblclick.zoom", null);
  draw(0, tables.dayCount - 1);

  return {
    show(from, to) {
      const k = (tables.dayCount - 1) / (to - from);
      selection.call(behaviour.transform, zoomIdentity.translate(plot.left, 0).scale(k).translate(-full(from), 0));
    },
    drawn: () => lines,
  };
}
