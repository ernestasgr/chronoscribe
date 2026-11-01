import { select } from "d3-selection";
import { artistId, dayDate, dayIndex, type StandingsTables } from "../standings";
import { spreadLabels } from "./geometry";
import { dayScale, plotOf, type Plot, type Size } from "./layout";
import { yOnLine, type LinesGeometry, type LinesScale } from "./lines";

/** Half a date label's width, so labels centred on a Day stay inside the chart. */
const HALF_LABEL = 34;
/** The height of an Artist label's box, and so the least room between two labels, in pixels. */
export const ARTIST_LABEL_PX = 18;
/** The room an Artist label needs right of its dot; nearer the edge it flips to the left. */
const ARTIST_LABEL_ROOM = 160;
/** How far an Artist's label box starts from its dot. */
const ARTIST_LABEL_OFFSET = 10;
/** The padding either side of an Artist's name inside its box. */
const ARTIST_LABEL_PAD = 5;

/** Lays the time axis's date labels out under `dayX`, keeping each tick's element as it moves. */
export function placeTimeAxis(
    group: SVGGElement,
    tables: StandingsTables,
    dayX: ReturnType<typeof dayScale>,
    size: Size,
) {
    const plot = plotOf(size);
    const ticks = dayX
        .ticks(Math.max(2, Math.floor((plot.right - plot.left) / 110)))
        .filter((day) => Number.isInteger(day) && day >= 0 && day < tables.dayCount);
    select(group)
        .selectAll<SVGTextElement, number>("text")
        .data(ticks, (day) => day)
        .join((enter) =>
            enter
                .append("text")
                .attr("text-anchor", "middle")
                .text((day) => dayDate(tables, dayIndex(day))),
        )
        .attr("x", (day) => clampLabel(dayX(day), size))
        .attr("y", size.height - 8);
}

/** Moves the Focus Day marker to the playhead, hidden while the playhead is out of view. */
export function placeMarker(group: SVGGElement, x: number, inView: boolean, size: Size) {
    group.style.display = inView ? "" : "none";
    group.setAttribute("transform", `translate(${x},0)`);
    group.querySelector("text")?.setAttribute("x", String(clampLabel(x, size) - x));
}

interface LabelsFrame {
    geometry: LinesGeometry;
    scale: LinesScale;
    /** The playhead's pixel x, or undefined while it is out of view. */
    playheadX: number | undefined;
    plot: Plot;
    /** A name's rendered width, for its box. */
    widthOf: (name: SVGTextElement) => number;
}

/**
 * Puts each labelled Artist's dot on its line at the playhead and its boxed name beside it, the
 * boxes pushed apart so they don't overlap, with a leader back to the dot. Labels without a line
 * there, out of view, or whose line is outside the plot there, as a Neighbour's leaving the band,
 * are hidden.
 */
export function placeLabels(
    group: SVGGElement,
    { geometry, scale, playheadX, plot, widthOf }: LabelsFrame,
) {
    const items = [...group.children].filter((item) => item instanceof SVGGElement);
    const inPlot = (y: number | undefined) =>
        y !== undefined && y >= plot.top - 0.5 && y <= plot.bottom + 0.5 ? y : undefined;
    const ys = items.map((item) =>
        playheadX === undefined
            ? undefined
            : inPlot(yOnLine(geometry, scale, artistId(Number(item.dataset.artist)), playheadX)),
    );
    const spread = spreadLabels(
        ys.filter((y) => y !== undefined),
        ARTIST_LABEL_PX,
        plot.top,
        plot.bottom,
    );
    const flipped = playheadX !== undefined && playheadX > plot.right - ARTIST_LABEL_ROOM;
    let placed = 0;
    items.forEach((item, i) => {
        const y = ys[i];
        item.style.display = y === undefined ? "none" : "";
        if (y === undefined) return;
        const shift = (spread[placed++] ?? y) - y;
        const side = flipped ? -1 : 1;
        item.setAttribute("transform", `translate(${playheadX},${y})`);
        const leader = item.querySelector("line");
        leader?.setAttribute("x2", String(side * ARTIST_LABEL_OFFSET));
        leader?.setAttribute("y2", String(shift));
        const name = item.querySelector("text");
        const box = item.querySelector("rect");
        if (!name || !box) return;
        const boxWidth = widthOf(name) + 2 * ARTIST_LABEL_PAD;
        const boxLeft = flipped ? -ARTIST_LABEL_OFFSET - boxWidth : ARTIST_LABEL_OFFSET;
        box.setAttribute("x", String(boxLeft));
        box.setAttribute("y", String(shift - (ARTIST_LABEL_PX - 2) / 2));
        box.setAttribute("width", String(boxWidth));
        name.setAttribute("x", String(boxLeft + ARTIST_LABEL_PAD));
        name.setAttribute("y", String(shift));
    });
}

const clampLabel = (x: number, { width }: Size) =>
    Math.min(width - HALF_LABEL, Math.max(HALF_LABEL, x));
