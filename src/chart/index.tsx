import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { AppSettings } from "../db";
import { dayDate, drawnLines, type DayWindow, type StandingsTables } from "../standings";
import { useFocusDay, useTimeline, useViewWindow, type Timeline } from "../timeline";
import { easeToward, GUTTER_TOP, logStandingTicks, standingLevel } from "./geometry";
import { dayScale, plotOf, useSize, type Plot, type Size } from "./layout";
import { mostScrobbles, strokeLines, type LinesScale } from "./lines";

export { Minimap } from "./minimap";

/** The chart settings, all app-wide. */
export type ChartOptions = Pick<AppSettings, "yAxis" | "belowTopX" | "lineShape" | "linesDrawn">;

/** Half a date label's width, so labels centred on a Day stay inside the chart. */
const HALF_LABEL = 34;
/** The fewest Days the window can be zoomed in to. */
const MIN_WINDOW_DAYS = 14;
/** The least room a Standing label needs, in pixels. */
const LABEL_PX = 14;
const NO_PINS: readonly number[] = [];

/**
 * The top of the Scrobbles axis as it eases, shared by the canvas loop and the axis labels. It
 * outlives each redraw effect, so a change of X, rule, tables or size eases rather than jumps.
 */
type ScrobblesTop = StoreApi<{ scrobblesMax: number; easedAt: number | undefined }>;

const levelScale = (plot: Plot) => scaleLinear().domain([0, 1]).range([plot.top, plot.bottom]);
const scrobblesScale = (plot: Plot, max: number) =>
    scaleLinear().domain([0, max]).range([plot.bottom, plot.top]);

/**
 * The timeline chart: one line per drawn Artist, by Standing or by cumulative Scrobbles. The wheel
 * zooms and dragging pans the time axis only; clicking sets the Focus Day.
 */
export function Chart({
    tables,
    x,
    options,
}: {
    tables: StandingsTables;
    x: number;
    options: ChartOptions;
}) {
    const figure = useRef<HTMLElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [scrobblesTop] = useState<ScrobblesTop>(() =>
        createStore(() => ({ scrobblesMax: 1, easedAt: undefined })),
    );
    const timeline = useTimeline();
    const size = useSize(figure);
    const pixelRatio = devicePixelRatio || 1;

    useLines(timeline, canvas, tables, x, options, size, scrobblesTop);
    useTimeZoom(timeline, figure, tables, size);

    function focus(event: MouseEvent) {
        if (!size) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const { window } = timeline.getView();
        timeline.seek(
            Math.round(dayScale(window, plotOf(size)).invert(event.clientX - bounds.left)),
        );
    }

    return (
        <figure
            ref={figure}
            aria-label="Timeline"
            onClick={focus}
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
                    scrobblesTop={scrobblesTop}
                />
            )}
        </figure>
    );
}

/** The Day the Scrobbles axis is fitted to: the playhead, kept within the Days drawn. */
const fittedDay = (playhead: number, from: number, to: number) =>
    Math.min(to, Math.max(from, Math.floor(playhead)));

/**
 * Redraws the lines on the canvas whenever the view changes, at most once per frame. In Scrobbles
 * mode it keeps drawing while the axis eases toward the most Scrobbles drawn up to the playhead.
 */
function useLines(
    { getView, subscribeView }: Timeline,
    canvas: RefObject<HTMLCanvasElement | null>,
    tables: StandingsTables,
    x: number,
    { yAxis, belowTopX, lineShape, linesDrawn }: ChartOptions,
    size: Size | undefined,
    scrobblesTop: ScrobblesTop,
) {
    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context || !size?.width) return;
        const dpr = element.width / size.width;
        const plot = plotOf(size);
        const levelY = levelScale(plot);
        const last = tables.dayCount - 1;
        let frame: number | undefined;

        const schedule = () => {
            frame ??= requestAnimationFrame((now) => {
                frame = undefined;
                draw(now);
            });
        };

        // This frame's Scrobbles axis top, eased from the last frame's toward `target`.
        const easeScrobblesTop = (target: number, now: number): number => {
            const { scrobblesMax, easedAt } = scrobblesTop.getState();
            const max =
                easedAt === undefined ? target : easeToward(scrobblesMax, target, now - easedAt);
            scrobblesTop.setState({ scrobblesMax: max, easedAt: now });
            if (max !== target) schedule();
            return max;
        };

        const scaleOf = (artists: readonly number[], day: number, now: number): LinesScale =>
            yAxis === "standing"
                ? { yAxis, x, below: belowTopX, shape: lineShape, levelY }
                : {
                      yAxis,
                      scrobblesY: scrobblesScale(
                          plot,
                          easeScrobblesTop(Math.max(1, mostScrobbles(tables, artists, day)), now),
                      ),
                  };

        const draw = (now: number) => {
            const { window, playhead } = getView();
            const dayX = dayScale(window, plot);
            const from = Math.max(0, Math.floor(window.start) - 1);
            const to = Math.min(last, Math.ceil(window.end) + 1);
            const artists = drawnLines(tables, window, x, linesDrawn, NO_PINS);
            const scale = scaleOf(artists, fittedDay(playhead, from, to), now);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, size.width, size.height);
            context.save();
            context.beginPath();
            context.rect(
                plot.left,
                plot.top - 4,
                plot.right - plot.left,
                plot.bottom - plot.top + 8,
            );
            context.clip();
            context.lineWidth = 1.8;
            strokeLines(context, { tables, artists, dayX, scale, from, to });
            context.restore();
        };

        if (yAxis === "standing") scrobblesTop.setState({ easedAt: undefined });
        draw(performance.now());
        const unsubscribe = subscribeView(schedule);
        return () => {
            unsubscribe();
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [
        getView,
        subscribeView,
        canvas,
        tables,
        x,
        yAxis,
        belowTopX,
        lineShape,
        linesDrawn,
        size,
        scrobblesTop,
    ]);
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

/** The axes and the Focus Day marker, drawn by React over the canvas. */
function Overlay({
    tables,
    x,
    options,
    size,
    scrobblesTop,
}: {
    tables: StandingsTables;
    x: number;
    options: ChartOptions;
    size: Size;
    scrobblesTop: ScrobblesTop;
}) {
    const window = useViewWindow();
    const focusDay = useFocusDay();
    const plot = plotOf(size);
    const dayX = dayScale(window, plot);
    const ticks = dayX
        .ticks(Math.max(2, Math.floor((plot.right - plot.left) / 110)))
        .filter((day) => Number.isInteger(day) && day >= 0 && day < tables.dayCount);
    const markerX = dayX(focusDay);
    const showMarker = markerX >= plot.left - 0.5 && markerX <= plot.right + 0.5;

    return (
        <svg
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 text-[11px] text-foreground"
        >
            {options.yAxis === "standing" ? (
                <StandingAxis
                    artistCount={tables.artists.length}
                    x={x}
                    below={options.belowTopX}
                    plot={plot}
                />
            ) : (
                <ScrobblesAxis plot={plot} scrobblesTop={scrobblesTop} />
            )}
            <g role="group" aria-label="Time axis" className="fill-muted-foreground">
                {ticks.map((day) => (
                    <text
                        key={day}
                        x={clampLabel(dayX(day), size)}
                        y={size.height - 8}
                        textAnchor="middle"
                    >
                        {dayDate(tables, day)}
                    </text>
                ))}
            </g>
            {showMarker && (
                <g role="group" aria-label="Focus Day marker">
                    <line
                        x1={markerX}
                        x2={markerX}
                        y1={plot.top}
                        y2={plot.bottom}
                        stroke="currentColor"
                        strokeDasharray="3 3"
                    />
                    <text
                        x={clampLabel(markerX, size)}
                        y={plot.top}
                        dy={-4}
                        textAnchor="middle"
                        fill="currentColor"
                        fontWeight="bold"
                    >
                        {dayDate(tables, focusDay)}
                    </text>
                </g>
            )}
        </svg>
    );
}

/** The Standings worth a label, each at least `LABEL_PX` below the last one kept. */
const spacedStandings = (candidates: number[], y: (standing: number) => number): number[] =>
    candidates.reduce<number[]>((kept, standing) => {
        const previous = kept.at(-1);
        return previous === undefined || y(standing) - y(previous) >= LABEL_PX
            ? [...kept, standing]
            : kept;
    }, []);

/** The labels for `rows` evenly spaced Standings, thinned to every n-th when rows are tight. */
function rowStandings(rows: number, rowHeight: number): number[] {
    const labelEvery = Math.ceil(LABEL_PX / Math.max(rowHeight, 1));
    return Array.from({ length: rows }, (_, i) => i + 1).filter(
        (standing) => standing === 1 || standing % labelEvery === 0,
    );
}

/** The Standing labels for each way of showing the Artists below the Top X. */
function StandingAxis({
    artistCount,
    x,
    below,
    plot,
}: {
    artistCount: number;
    x: number;
    below: ChartOptions["belowTopX"];
    plot: Plot;
}) {
    const levelY = levelScale(plot);
    const y = (standing: number) => levelY(standingLevel(standing, x, artistCount, below));
    const rowsHeight = (plot.bottom - plot.top) * (below === "gutter" ? GUTTER_TOP : 1);
    const standings =
        below === "log"
            ? spacedStandings(logStandingTicks(artistCount), y)
            : rowStandings(x, rowsHeight / x);
    const gutter = below === "gutter" && artistCount > x;

    return (
        <g role="group" aria-label="Standing axis" className="fill-muted-foreground">
            {standings.map((standing) => (
                <text
                    key={standing}
                    x={plot.left - 8}
                    y={y(standing)}
                    textAnchor="end"
                    dominantBaseline="middle"
                >
                    #{standing}
                </text>
            ))}
            {gutter && (
                <>
                    <rect
                        x={plot.left}
                        y={levelY(GUTTER_TOP)}
                        width={plot.right - plot.left}
                        height={plot.bottom - levelY(GUTTER_TOP)}
                        className="fill-muted-foreground"
                        opacity={0.08}
                    />
                    <text
                        x={plot.left - 8}
                        y={(levelY(GUTTER_TOP) + plot.bottom) / 2}
                        textAnchor="end"
                        dominantBaseline="middle"
                    >
                        below
                    </text>
                </>
            )}
        </g>
    );
}

/** The cumulative Scrobbles labels, following the axis top as the canvas eases it. */
function ScrobblesAxis({ plot, scrobblesTop }: { plot: Plot; scrobblesTop: ScrobblesTop }) {
    const max = useStore(scrobblesTop, (state) => state.scrobblesMax);
    const scrobblesY = scrobblesScale(plot, max);
    const ticks = scrobblesY
        .ticks(Math.max(2, Math.floor((plot.bottom - plot.top) / 40)))
        .filter((scrobbles) => Number.isInteger(scrobbles) && scrobbles <= max);

    return (
        <g role="group" aria-label="Scrobbles axis" className="fill-muted-foreground">
            {ticks.map((scrobbles) => (
                <text
                    key={scrobbles}
                    x={plot.left - 8}
                    y={scrobblesY(scrobbles)}
                    textAnchor="end"
                    dominantBaseline="middle"
                >
                    {scrobbles.toLocaleString("en")}
                </text>
            ))}
        </g>
    );
}
