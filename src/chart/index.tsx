import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { createStore } from "zustand";
import type { AppSettings } from "../settings";
import {
    artistId,
    dayDate,
    dayIndex,
    daysOutsideTopX,
    drawnLines,
    topX,
    type ArtistId,
    type DayIndex,
    type DayWindow,
    type NamedArtist,
    type PinnedArtist,
    type StandingsTables,
} from "../standings";
import { useFocusDay, useTimeline, type Timeline, type View } from "../timeline";
import {
    BandAxis,
    bandY,
    levelScale,
    ScrobblesAxis,
    scrobblesScale,
    SpotlightAxis,
    spotlightY,
    StandingAxis,
    type EasedEnd,
} from "./axes";
import { easeToward, spreadLabels, standingLevel } from "./geometry";
import { hoveredLine } from "./hover";
import { dayScale, plotOf, useSize, type Plot, type Size } from "./layout";
import {
    colorOf,
    linesGeometry,
    type DashedSpans,
    mostScrobbles,
    strokeLines,
    yOnLine,
    type LinesGeometry,
    type LinesScale,
    type LinesStyle,
} from "./lines";
import {
    createLineHover,
    LineHoverCard,
    lineHoverHandlers,
    type LineDetails,
    type LineHover,
} from "./LineHover";
import { SPOTLIGHT_FLOOR, spotlightBand, spotlightBottom, spotlitLines } from "./spotlight";

export { Minimap } from "./minimap";
export type { LineDay, LineDetails } from "./LineHover";

/** The chart settings, all app-wide. */
export type ChartOptions = Pick<
    AppSettings,
    | "yAxis"
    | "belowTopX"
    | "lineShape"
    | "linesDrawn"
    | "hideFuture"
    | "spotlightMode"
    | "neighbours"
>;

/**
 * What the chart card shows: the Timeline of every drawn Artist and the Pinned Artists, or the
 * Spotlight on one Artist's Standing alone.
 */
export type ChartMode =
    | { kind: "timeline"; pins: readonly PinnedArtist[] }
    | { kind: "spotlight"; artist: NamedArtist };

/** Whose lines the painter draws: the Timeline's, dashing the Pinned Artists', or the Spotlit Artist's. */
type DrawnArtists =
    | { kind: "timeline"; pinned: readonly ArtistId[] }
    | { kind: "spotlight"; artist: ArtistId };

/** Half a date label's width, so labels centred on a Day stay inside the chart. */
const HALF_LABEL = 34;
/** The fewest Days the window can be zoomed in to. */
const MIN_WINDOW_DAYS = 14;
/** The height of an Artist label's box, and so the least room between two labels, in pixels. */
const ARTIST_LABEL_PX = 18;
/** The room an Artist label needs right of its dot; nearer the edge it flips to the left. */
const ARTIST_LABEL_ROOM = 160;
/** How far an Artist's label box starts from its dot. */
const ARTIST_LABEL_OFFSET = 10;
/** The padding either side of an Artist's name inside its box. */
const ARTIST_LABEL_PAD = 5;
/** A line's width, before the Spotlit Artist's is drawn thicker. */
const LINE_WIDTH = 1.8;
/** How far past the plot's top and bottom a line may run, so one at #1 isn't cut in half. */
const OVERHANG_PX = 4;
const NOT_DASHED: DashedSpans = new Map();

/** Where each Pinned Artist's line is dashed: across each Day from `from` to `to` they're outside the Top X. */
const dashedSpans = (
    tables: StandingsTables,
    pinned: readonly ArtistId[],
    x: number,
    dayX: (day: number) => number,
    from: DayIndex,
    to: DayIndex,
): DashedSpans =>
    new Map(
        pinned.map((id) => [
            id,
            daysOutsideTopX(tables, id, x, from, to).map(
                ({ start, end }) => [dayX(start - 0.5), dayX(end + 0.5)] as const,
            ),
        ]),
    );

/**
 * The ends of the axes that ease: the Scrobbles axis's top, the static Spotlight's bottom and the
 * best Standing of the dynamic Spotlight's band.
 */
interface EasedEnds {
    scrobblesTop: EasedEnd;
    standingBottom: EasedEnd;
    bandBest: EasedEnd;
}

/** What one frame draws: which lines, on what scale, styled how, and how far past the plot. */
interface FrameLines {
    artists: readonly ArtistId[];
    scale: LinesScale;
    style: Omit<LinesStyle, "emphasised">;
    /** How far past the plot's top and bottom the lines are drawn; none, clipped to a band. */
    overhang: number;
}

/** The overlay parts the per-frame painter moves, which React renders but never positions. */
interface PaintedParts {
    timeAxis: RefObject<SVGGElement | null>;
    marker: RefObject<SVGGElement | null>;
    labels: RefObject<SVGGElement | null>;
}

/**
 * The chart, in either mode. The Timeline draws one line per drawn Artist, by Standing or by
 * cumulative Scrobbles, always including the Pinned Artists; the static Spotlight draws the Spotlit
 * Artist's Standing alone on a log axis fixed to their worst, and the dynamic one draws them and
 * their Neighbours in a band of Standings following them. The wheel zooms and dragging pans
 * the time axis only; clicking glides the Focus Day there. Hovering a line while the view is still
 * opens a card of its details, as `renderDetails` renders them, on the Day under the pointer.
 */
export function Chart({
    tables,
    x,
    options,
    mode,
    renderDetails,
}: {
    tables: StandingsTables;
    x: number;
    options: ChartOptions;
    mode: ChartMode;
    renderDetails: LineDetails;
}) {
    const figure = useRef<HTMLElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const timeAxis = useRef<SVGGElement>(null);
    const marker = useRef<SVGGElement>(null);
    const labels = useRef<SVGGElement>(null);
    const [ends] = useState<EasedEnds>(() => ({
        scrobblesTop: createStore(() => ({ end: 1, easedAt: undefined })),
        standingBottom: createStore(() => ({ end: SPOTLIGHT_FLOOR, easedAt: undefined })),
        bandBest: createStore(() => ({ end: 1, easedAt: undefined })),
    }));
    const timeline = useTimeline();
    const size = useSize(figure);
    const pixelRatio = devicePixelRatio || 1;
    const paintedParts: PaintedParts = { timeAxis, marker, labels };
    const drawn = useMemo<DrawnArtists>(
        () =>
            mode.kind === "timeline"
                ? { kind: "timeline", pinned: mode.pins.map(({ id }) => id) }
                : { kind: "spotlight", artist: mode.artist.id },
        [mode],
    );
    const [hover] = useState(createLineHover);

    useFrames(timeline, canvas, paintedParts, tables, x, options, drawn, size, ends, hover);
    useTimeZoom(timeline, figure, tables, size);

    function focus(event: MouseEvent) {
        // A click in the hovered line's card, portalled out of the chart, isn't a click on a Day.
        const inChart = event.target instanceof Node && event.currentTarget.contains(event.target);
        if (!size || !inChart) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const { window } = timeline.getView();
        timeline.seek(
            Math.round(dayScale(window, plotOf(size)).invert(event.clientX - bounds.left)),
        );
    }

    return (
        <figure
            ref={figure}
            aria-label={mode.kind === "spotlight" ? "Spotlight" : "Timeline"}
            onClick={focus}
            {...lineHoverHandlers(hover, timeline)}
            className="relative m-0 min-h-0 flex-1 cursor-crosshair"
        >
            <canvas
                ref={canvas}
                width={Math.round((size?.width ?? 0) * pixelRatio)}
                height={Math.round((size?.height ?? 0) * pixelRatio)}
                className="absolute inset-0 size-full"
            />
            {size && (
                <Overlay
                    tables={tables}
                    x={x}
                    options={options}
                    size={size}
                    mode={mode}
                    ends={ends}
                    paintedParts={paintedParts}
                />
            )}
            <LineHoverCard hover={hover} chart={figure} renderDetails={renderDetails} />
        </figure>
    );
}

/** The Day the Scrobbles axis is fitted to: the playhead, kept within the Days drawn. */
const fittedDay = (playhead: number, from: DayIndex, to: DayIndex): DayIndex =>
    dayIndex(Math.min(to, Math.max(from, Math.floor(playhead))));

/**
 * Paints whenever the view changes, at most once per frame: the lines on the canvas, stopping at
 * the playhead if the future is hidden, then the time axis, the Focus Day marker and the Artist
 * labels riding the lines at the playhead. In Scrobbles mode it keeps painting while the
 * axis eases toward the most Scrobbles drawn up to the playhead, and in the Spotlight while its
 * bottom eases toward the Spotlit Artist's worst Standing, or its band toward their Standing at the
 * playhead. A hovered line is emphasised, and any
 * change to the view or to what is drawn closes its card.
 */
function useFrames(
    { getView, subscribeView }: Timeline,
    canvas: RefObject<HTMLCanvasElement | null>,
    { timeAxis, marker, labels }: PaintedParts,
    tables: StandingsTables,
    x: number,
    {
        yAxis,
        belowTopX,
        lineShape,
        linesDrawn,
        hideFuture,
        spotlightMode,
        neighbours,
    }: ChartOptions,
    drawn: DrawnArtists,
    size: Size | undefined,
    { scrobblesTop, standingBottom, bandBest }: EasedEnds,
    hover: LineHover,
) {
    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context || !size?.width) return;
        const dpr = element.width / size.width;
        const plot = plotOf(size);
        const levelY = levelScale(plot);
        const artistCount = tables.artists.length;
        const last = tables.dayCount - 1;
        let frame: number | undefined;
        // Each name's rendered width, measured once per element since its text never changes.
        const nameWidths = new WeakMap<SVGTextElement, number>();
        const widthOf = (name: SVGTextElement): number => {
            const known = nameWidths.get(name);
            if (known !== undefined) return known;
            const width = name.getComputedTextLength();
            nameWidths.set(name, width);
            return width;
        };
        // Ticks laid out from older tables would keep their old dates.
        if (timeAxis.current) select(timeAxis.current).selectAll("text").remove();

        const schedule = () => {
            frame ??= requestAnimationFrame((now) => {
                frame = undefined;
                draw(now);
            });
        };

        // This frame's end of an eased axis, eased from the last frame's toward `target`.
        const ease = (axisEnd: EasedEnd, target: number, now: number): number => {
            const { end, easedAt } = axisEnd.getState();
            const eased = easedAt === undefined ? target : easeToward(end, target, now - easedAt);
            axisEnd.setState({ end: eased, easedAt: now });
            if (eased !== target) schedule();
            return eased;
        };

        const scaleOf = (artists: readonly ArtistId[], day: DayIndex, now: number): LinesScale =>
            yAxis === "standing"
                ? {
                      yAxis,
                      shape: lineShape,
                      standingY: (standing) =>
                          levelY(standingLevel(standing, x, artistCount, belowTopX)),
                  }
                : {
                      yAxis,
                      scrobblesY: scrobblesScale(
                          plot,
                          ease(scrobblesTop, Math.max(1, mostScrobbles(tables, artists, day)), now),
                      ),
                  };

        // The Timeline's drawn lines, each Pinned Artist's dashed where they're outside the Top X.
        const timelineLines = (
            pinned: readonly ArtistId[],
            { window, playhead }: View,
            dayX: (day: number) => number,
            from: DayIndex,
            to: DayIndex,
            now: number,
        ): FrameLines => {
            const artists = drawnLines(tables, window, x, linesDrawn, pinned);
            return {
                artists,
                scale: scaleOf(artists, fittedDay(playhead, from, to), now),
                style: {
                    dashed: dashedSpans(tables, pinned, x, dayX, from, to),
                    featured: undefined,
                },
                overhang: OVERHANG_PX,
            };
        };

        // The Spotlit Artist's line alone, on a log axis down to their worst Standing so far.
        const staticSpotlightLines = (
            artist: ArtistId,
            { playhead }: View,
            now: number,
        ): FrameLines => {
            const bottom = spotlightBottom(tables, artist, { playhead, hideFuture });
            return {
                artists: [artist],
                scale: {
                    yAxis: "standing",
                    shape: lineShape,
                    standingY: spotlightY(plot, ease(standingBottom, bottom, now)),
                },
                style: { dashed: NOT_DASHED, featured: artist },
                overhang: OVERHANG_PX,
            };
        };

        // The Spotlit Artist and their Neighbours on the Day nearest the playhead, in a band
        // following the Spotlit Artist there and clipped to it.
        const dynamicSpotlightLines = (
            artist: ArtistId,
            { playhead }: View,
            now: number,
        ): FrameLines => {
            const day = dayIndex(Math.min(last, Math.max(0, Math.round(playhead))));
            const { best } = spotlightBand(tables, artist, day, neighbours);
            return {
                artists: spotlitLines(tables, artist, day, neighbours),
                scale: {
                    yAxis: "standing",
                    shape: lineShape,
                    standingY: bandY(plot, ease(bandBest, best, now), neighbours),
                },
                style: { dashed: NOT_DASHED, featured: artist },
                overhang: 0,
            };
        };

        const spotlightLines =
            spotlightMode === "dynamic" ? dynamicSpotlightLines : staticSpotlightLines;

        const draw = (now: number) => {
            const view = getView();
            const { window, playhead } = view;
            const dayX = dayScale(window, plot);
            const from = dayIndex(Math.max(0, Math.floor(window.start) - 1));
            const to = dayIndex(Math.min(last, Math.ceil(hideFuture ? playhead : window.end) + 1));
            const { artists, scale, style, overhang } =
                drawn.kind === "timeline"
                    ? timelineLines(drawn.pinned, view, dayX, from, to, now)
                    : spotlightLines(drawn.artist, view, now);
            const playheadX = dayX(playhead);
            const inView = playheadX >= plot.left - 0.5 && playheadX <= plot.right + 0.5;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, size.width, size.height);
            context.save();
            context.beginPath();
            // Hiding the future is clipping the lines at the playhead.
            const right = hideFuture ? Math.min(plot.right, playheadX) : plot.right;
            context.rect(
                plot.left,
                plot.top - overhang,
                Math.max(0, right - plot.left),
                plot.bottom - plot.top + 2 * overhang,
            );
            context.clip();
            context.lineWidth = LINE_WIDTH;
            const geometry = linesGeometry({ tables, artists, dayX, scale, from, to });
            strokeLines(context, geometry, scale, {
                ...style,
                emphasised: hoveredLine(hover.store.getState())?.artist,
            });
            context.restore();
            hover.painted({ tables, geometry, scale, dayX, plot, right, overhang });
            if (timeAxis.current) placeTimeAxis(timeAxis.current, tables, dayX, size);
            if (marker.current) placeMarker(marker.current, playheadX, inView, size);
            if (labels.current)
                placeLabels(labels.current, {
                    geometry,
                    scale,
                    playheadX: inView ? playheadX : undefined,
                    plot,
                    widthOf,
                });
        };

        // An axis end out of use starts afresh when next shown, rather than easing from where it was.
        if (drawn.kind === "spotlight" || yAxis === "standing")
            scrobblesTop.setState({ easedAt: undefined });
        if (drawn.kind === "timeline" || spotlightMode === "dynamic")
            standingBottom.setState({ easedAt: undefined });
        if (drawn.kind === "timeline" || spotlightMode === "static")
            bandBest.setState({ easedAt: undefined });
        hover.dispatch({ type: "dismissed" });
        draw(performance.now());
        const unsubscribe = subscribeView(() => {
            hover.dispatch({ type: "dismissed" });
            schedule();
        });
        const unhover = hover.store.subscribe(schedule);
        return () => {
            unsubscribe();
            unhover();
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [
        getView,
        subscribeView,
        canvas,
        timeAxis,
        marker,
        labels,
        tables,
        x,
        yAxis,
        belowTopX,
        lineShape,
        linesDrawn,
        hideFuture,
        spotlightMode,
        neighbours,
        drawn,
        size,
        scrobblesTop,
        standingBottom,
        bandBest,
        hover,
    ]);
}

/** Lays the time axis's date labels out under `dayX`, keeping each tick's element as it moves. */
function placeTimeAxis(
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
function placeMarker(group: SVGGElement, x: number, inView: boolean, size: Size) {
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
function placeLabels(
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

/** Drives the window from the wheel and drags through d3-zoom, on the time axis only. */
function useTimeZoom(
    { getView, setWindow, subscribeView }: Timeline,
    figure: RefObject<HTMLElement | null>,
    tables: StandingsTables,
    size: Size | undefined,
) {
    useEffect(() => {
        const element = figure.current;
        if (!element || !size) return;
        const plot = plotOf(size);
        const last = tables.dayCount - 1;
        const full = dayScale({ start: 0, end: last }, plot);
        const extent: [[number, number], [number, number]] = [
            [plot.left, 0],
            [plot.right, size.height],
        ];
        let gesturing = false;
        const behaviour: ZoomBehavior<HTMLElement, unknown> = zoom<HTMLElement, unknown>()
            .scaleExtent([1, Math.max(1, last / MIN_WINDOW_DAYS)])
            .extent(extent)
            .translateExtent(extent)
            .on("zoom", ({ transform, sourceEvent }) => {
                // Only the user's own wheel and drags move the window; syncs from it don't echo.
                if (!sourceEvent) return;
                // cast: d3 types a linear scale's domain as number[], though it always has two ends.
                const [start, end] = transform.rescaleX(full).domain() as [number, number];
                gesturing = true;
                setWindow({ start, end });
                gesturing = false;
            });
        const selection = select(element).call(behaviour).on("dblclick.zoom", null);

        // Moves d3-zoom's transform to a window set elsewhere, so the next gesture starts from it.
        const follow = ({ start, end }: DayWindow) => {
            if (last <= 0) return;
            const k = last / Math.max(end - start, 1e-9);
            selection.call(
                behaviour.transform,
                zoomIdentity.translate(plot.left - k * full(start), 0).scale(k),
            );
        };
        follow(getView().window);
        const unsubscribe = subscribeView(({ window }) => {
            if (!gesturing) follow(window);
        });
        return () => {
            unsubscribe();
            selection.on(".zoom", null);
        };
    }, [getView, setWindow, subscribeView, figure, tables, size]);
}

const clampLabel = (x: number, { width }: Size) =>
    Math.min(width - HALF_LABEL, Math.max(HALF_LABEL, x));

/**
 * The axes, the Focus Day marker and the Artist labels over the canvas. React renders them as the
 * Focus Day changes; the per-frame painter positions the time axis, the marker and the labels.
 */
function Overlay({
    tables,
    x,
    options,
    mode,
    size,
    ends,
    paintedParts: { timeAxis, marker, labels },
}: {
    tables: StandingsTables;
    x: number;
    options: ChartOptions;
    mode: ChartMode;
    size: Size;
    ends: EasedEnds;
    paintedParts: PaintedParts;
}) {
    const focusDay = useFocusDay();
    const plot = plotOf(size);

    return (
        <svg
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 text-[11px] text-foreground"
        >
            {mode.kind === "spotlight" && options.spotlightMode === "dynamic" ? (
                <BandAxis plot={plot} best={ends.bandBest} neighbours={options.neighbours} />
            ) : mode.kind === "spotlight" ? (
                <SpotlightAxis plot={plot} bottom={ends.standingBottom} />
            ) : options.yAxis === "standing" ? (
                <StandingAxis
                    artistCount={tables.artists.length}
                    x={x}
                    below={options.belowTopX}
                    plot={plot}
                />
            ) : (
                <ScrobblesAxis plot={plot} top={ends.scrobblesTop} />
            )}
            <g
                ref={timeAxis}
                role="group"
                aria-label="Time axis"
                className="fill-muted-foreground"
            />
            <g ref={marker} role="group" aria-label="Focus Day marker">
                <line
                    x1={0}
                    x2={0}
                    y1={plot.top}
                    y2={plot.bottom}
                    stroke="currentColor"
                    strokeDasharray="3 3"
                />
                <text
                    y={plot.top}
                    dy={-4}
                    textAnchor="middle"
                    fill="currentColor"
                    fontWeight="bold"
                >
                    {dayDate(tables, focusDay)}
                </text>
            </g>
            <ArtistLabels
                artists={labelledArtists(tables, focusDay, x, options, mode)}
                group={labels}
            />
        </svg>
    );
}

/**
 * The Spotlit Artist alone or with their Neighbours on the Focus Day, or the Focus Day's Top X and
 * then the Pinned Artists outside it.
 */
const labelledArtists = (
    tables: StandingsTables,
    day: DayIndex,
    x: number,
    { spotlightMode, neighbours }: ChartOptions,
    mode: ChartMode,
): NamedArtist[] => {
    if (mode.kind === "spotlight" && spotlightMode === "dynamic")
        return spotlitLines(tables, mode.artist.id, day, neighbours).flatMap((id) => {
            const artist = tables.artists[id];
            return artist === undefined ? [] : [{ id, artist }];
        });
    if (mode.kind === "spotlight") return [mode.artist];
    const top = topX(tables, day, x);
    return [...top, ...mode.pins.filter((pin) => !top.some((row) => row.id === pin.id))];
};

/** A dot and a name for each labelled Artist, for the painter to put on its line. */
function ArtistLabels({
    artists,
    group,
}: {
    artists: readonly NamedArtist[];
    group: RefObject<SVGGElement | null>;
}) {
    return (
        <g ref={group} role="group" aria-label="Artist labels" className="text-xs font-semibold">
            {artists.map((row) => (
                <g key={row.id} data-artist={row.id}>
                    <line stroke={colorOf(row.id)} strokeWidth={1} />
                    <rect
                        height={ARTIST_LABEL_PX - 2}
                        rx={4}
                        stroke={colorOf(row.id)}
                        strokeWidth={1.5}
                        className="fill-card/90"
                    />
                    <circle
                        r={4}
                        fill={colorOf(row.id)}
                        strokeWidth={1.5}
                        className="stroke-card"
                    />
                    <text dominantBaseline="central" className="fill-foreground">
                        {row.artist}
                    </text>
                </g>
            ))}
        </g>
    );
}
