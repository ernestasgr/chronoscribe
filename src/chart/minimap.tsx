import { scaleLinear } from "d3-scale";
import { area, curveStepAfter } from "d3-shape";
import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { dayDate, dayScrobbles, type DayWindow, type StandingsTables } from "../standings";
import { panned, useTimeline, useViewFrames, type View } from "../timeline";
import { MARGIN, useSize } from "./layout";

const HEIGHT = 40;
/** The narrowest the window is drawn, so a deep zoom stays easy to grab. */
const MIN_HANDLE_PX = 8;

/** The share of the window's width an arrow key pans by. */
const KEY_STEP = 0.1;

/** The whole history across `width` pixels, inside the chart's horizontal margins. */
const historyScale = (tables: StandingsTables, width: number) =>
    scaleLinear()
        .domain([0, Math.max(1, tables.dayCount - 1)])
        .range([MARGIN.left, Math.max(MARGIN.left + 1, width - MARGIN.right)]);

/** The Daily volume area as an SVG path over `width` pixels, from Day 0 to the last Day. */
function volumePath(tables: StandingsTables, width: number): string {
    const volumes = Array.from({ length: tables.dayCount }, (_, day) => dayScrobbles(tables, day));
    const dayX = historyScale(tables, width);
    const volumeY = scaleLinear()
        .domain([0, Math.max(1, ...volumes)])
        .range([HEIGHT, 2]);
    return (
        area<number>()
            .curve(curveStepAfter)
            .x((_, day) => dayX(day))
            .y0(HEIGHT)
            .y1((volume) => volumeY(volume))(volumes) ?? ""
    );
}

/** Moves the window's mark, and its value for assistive technology, to `window`. */
function markWindow(
    handle: HTMLElement,
    window: DayWindow,
    dayX: ReturnType<typeof historyScale>,
    tables: StandingsTables,
) {
    const left = dayX(window.start);
    const start = Math.round(window.start);
    handle.style.left = `${left}px`;
    handle.style.width = `${Math.max(MIN_HANDLE_PX, dayX(window.end) - left)}px`;
    handle.setAttribute("aria-valuenow", String(start));
    handle.setAttribute(
        "aria-valuetext",
        `${dayDate(tables, start)} to ${dayDate(tables, Math.round(window.end))}`,
    );
}

/**
 * The whole history's Daily volume under the chart, with the chart's window marked on it.
 * Dragging the window, or pressing beside it, pans the chart; the window keeps its width. The
 * window's mark follows every frame without a render.
 */
export function Minimap({ tables }: { tables: StandingsTables }) {
    const element = useRef<HTMLDivElement>(null);
    const handle = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointerX: number; window: DayWindow }>(undefined);
    const size = useSize(element);
    const { getView, setWindow } = useTimeline();
    const last = tables.dayCount - 1;
    const width = size?.width ?? 0;
    const path = useMemo(() => (width ? volumePath(tables, width) : ""), [tables, width]);
    const dayX = useMemo(() => historyScale(tables, width), [tables, width]);

    useViewFrames(
        useCallback(
            ({ window }: View) => {
                if (handle.current) markWindow(handle.current, window, dayX, tables);
            },
            [dayX, tables],
        ),
    );

    const pan = (from: DayWindow, by: number) => setWindow(panned(from, by, last));

    function grab(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !width) return;
        const day = dayX.invert(event.clientX - event.currentTarget.getBoundingClientRect().left);
        const current = getView().window;
        // A press beside the window centres it there, and the drag carries on from that.
        const outside = day < current.start || day > current.end;
        const from = outside
            ? panned(current, day - (current.start + current.end) / 2, last)
            : current;
        setWindow(from);
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerX: event.clientX, window: from };
    }

    function move(event: PointerEvent<HTMLDivElement>) {
        if (!drag.current) return;
        const days = dayX.invert(event.clientX) - dayX.invert(drag.current.pointerX);
        pan(drag.current.window, days);
    }

    function release() {
        drag.current = undefined;
    }

    function press(event: KeyboardEvent<HTMLDivElement>) {
        const current = getView().window;
        const step = Math.max(1, (current.end - current.start) * KEY_STEP);
        const by = {
            ArrowLeft: -step,
            ArrowRight: step,
            PageUp: -(current.end - current.start),
            PageDown: current.end - current.start,
            Home: -last,
            End: last,
        }[event.key];
        if (by === undefined) return;
        event.preventDefault();
        pan(current, by);
    }

    return (
        <div
            ref={element}
            role="group"
            aria-label="Minimap"
            onPointerDown={grab}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
            className="relative h-10 shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        >
            <svg
                role="img"
                aria-label="Daily volume"
                width={width}
                height={HEIGHT}
                className="absolute inset-0 text-muted-foreground"
            >
                <path d={path} fill="currentColor" opacity={0.35} />
            </svg>
            {width > 0 && last > 0 && (
                <div
                    ref={handle}
                    role="slider"
                    aria-label="Chart window"
                    aria-valuemin={0}
                    aria-valuemax={last}
                    tabIndex={0}
                    onKeyDown={press}
                    className="absolute inset-y-0 rounded-sm border border-primary/60 bg-primary/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
            )}
        </div>
    );
}
