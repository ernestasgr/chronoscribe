import { scaleLinear, type ScaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { dayDate, drawnLines, type DayWindow, type StandingsTables } from "../standings";
import { useFocusDay, useTimeline, useViewWindow, type Timeline } from "../timeline";
import { GUTTER_TOP, standingLevel } from "./geometry";
import { strokeStandingLines } from "./lines";

const MARGIN = { left: 56, right: 16, top: 16, bottom: 28 };
/** Half a date label's width, so labels centred on a Day stay inside the chart. */
const HALF_LABEL = 34;
/** The fewest Days the window can be zoomed in to. */
const MIN_WINDOW_DAYS = 14;
const NO_PINS: readonly number[] = [];

interface Size {
    width: number;
    height: number;
}

interface Plot {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

const plotOf = ({ width, height }: Size): Plot => ({
    left: MARGIN.left,
    right: Math.max(MARGIN.left + 1, width - MARGIN.right),
    top: MARGIN.top,
    bottom: Math.max(MARGIN.top + 1, height - MARGIN.bottom),
});

/** The pixel scale of a window, widened around a single Day so it never collapses. */
function dayScale({ start, end }: DayWindow, plot: Plot): ScaleLinear<number, number> {
    const domain = end - start < 1e-9 ? [start - 0.5, end + 0.5] : [start, end];
    return scaleLinear().domain(domain).range([plot.left, plot.right]);
}

const levelScale = (plot: Plot) => scaleLinear().domain([0, 1]).range([plot.top, plot.bottom]);

/**
 * The timeline chart in Standing mode: one line per drawn Artist, with the Top X in rows and every
 * lower Standing in a gutter under #X. The wheel zooms and dragging pans the time axis only;
 * clicking sets the Focus Day.
 */
export function Chart({ tables, x }: { tables: StandingsTables; x: number }) {
    const figure = useRef<HTMLElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const timeline = useTimeline();
    const size = useSize(figure);
    const pixelRatio = devicePixelRatio || 1;

    useStandingLines(timeline, canvas, tables, x, size);
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
            className="relative m-0 h-full cursor-crosshair"
        >
            <canvas
                ref={canvas}
                width={Math.round((size?.width ?? 0) * pixelRatio)}
                height={Math.round((size?.height ?? 0) * pixelRatio)}
                className="absolute inset-0 size-full"
            />
            {size && <Overlay tables={tables} x={x} size={size} />}
        </figure>
    );
}

function useSize(element: RefObject<HTMLElement | null>): Size | undefined {
    const [size, setSize] = useState<Size>();
    useEffect(() => {
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setSize({ width, height });
        });
        observer.observe(element.current!);
        return () => observer.disconnect();
    }, [element]);
    return size;
}

/** Redraws the lines on the canvas whenever the view changes, at most once per frame. */
function useStandingLines(
    { getView, subscribeView }: Timeline,
    canvas: RefObject<HTMLCanvasElement | null>,
    tables: StandingsTables,
    x: number,
    size: Size | undefined,
) {
    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context || !size?.width) return;
        const dpr = element.width / size.width;
        const plot = plotOf(size);
        const levelY = levelScale(plot);
        const last = tables.dayCount - 1;

        const draw = () => {
            const { window } = getView();
            const dayX = dayScale(window, plot);
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
            strokeStandingLines(context, {
                tables,
                artists: drawnLines(tables, window, x, "warm-up", NO_PINS),
                x,
                dayX,
                levelY,
                from: Math.max(0, Math.floor(window.start) - 1),
                to: Math.min(last, Math.ceil(window.end) + 1),
            });
            context.restore();
        };

        let frame: number | undefined;
        const schedule = () => {
            frame ??= requestAnimationFrame(() => {
                frame = undefined;
                draw();
            });
        };
        draw();
        const unsubscribe = subscribeView(schedule);
        return () => {
            unsubscribe();
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [getView, subscribeView, canvas, tables, x, size]);
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
function Overlay({ tables, x, size }: { tables: StandingsTables; x: number; size: Size }) {
    const window = useViewWindow();
    const focusDay = useFocusDay();
    const plot = plotOf(size);
    const dayX = dayScale(window, plot);
    const levelY = levelScale(plot);
    const artistCount = tables.artists.length;
    const rowHeight = ((plot.bottom - plot.top) * GUTTER_TOP) / x;
    const labelEvery = Math.ceil(14 / Math.max(rowHeight, 1));
    const standings = Array.from({ length: x }, (_, i) => i + 1).filter(
        (standing) => standing === 1 || standing % labelEvery === 0,
    );
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
            <g role="group" aria-label="Standing axis" className="fill-muted-foreground">
                {standings.map((standing) => (
                    <text
                        key={standing}
                        x={plot.left - 8}
                        y={levelY(standingLevel(standing, x, artistCount))}
                        textAnchor="end"
                        dominantBaseline="middle"
                    >
                        #{standing}
                    </text>
                ))}
                {artistCount > x && (
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
