import type { BelowTopX } from "../db";
import type { DayWindow } from "../standings";

export type Point = [x: number, y: number];

/** The narrowest S-curve a change of Standing is drawn with: adjacent Days are often < 1 px apart. */
const MIN_CURVE_PX = 14;

/** The share of the plot's height given to the gutter under #X. */
const GUTTER_SHARE = 0.15;

/**
 * Where a Standing sits, from 0 at the top of the plot to 1 at the bottom, for each way of showing
 * the Artists below the Top X.
 * - "gutter": the Top X share the upper rows evenly; every lower Standing, down to
 *   `#artistCount`, is squeezed into a log-scaled band under #X.
 * - "slide-off": the Top X share the whole height; every lower Standing waits one row below it.
 * - "log": every Standing on one log scale, from half a row above #1 to half a row below the last.
 */
export function standingLevel(
    standing: number,
    x: number,
    artistCount: number,
    below: BelowTopX,
): number {
    switch (below) {
        case "gutter":
            return gutterLevel(standing, x, artistCount);
        case "slide-off":
            return (Math.min(standing, x + 1) - 0.5) / x;
        case "log":
            return Math.log(2 * standing) / Math.log(2 * artistCount + 1);
    }
}

function gutterLevel(standing: number, x: number, artistCount: number): number {
    const rows = 1 - GUTTER_SHARE;
    if (standing <= x) return ((standing - 0.5) / x) * rows;
    const below = Math.log(standing - x) / Math.log(Math.max(2, artistCount - x + 1));
    return rows + below * GUTTER_SHARE;
}

/** The level at which the gutter band begins, just under #X's row. */
export const GUTTER_TOP = 1 - GUTTER_SHARE;

/**
 * One line over Days `from`..`to` as runs of points, to be drawn with a bump-x curve: consecutive
 * points at the same height are a flat run, at different heights an S-curve at least
 * `MIN_CURVE_PX` wide, centred between its two Days. The line breaks wherever `y` is undefined.
 */
export function sCurveSegments(
    y: (day: number) => number | undefined,
    x: (day: number) => number,
    from: number,
    to: number,
): Point[][] {
    const segments: Point[][] = [];
    let run: Point[] = [];
    let held: { day: number; y: number } | undefined;

    const close = () => {
        if (held && x(held.day) > run.at(-1)![0]) run.push([x(held.day), held.y]);
        if (run.length > 0) segments.push(run);
        run = [];
        held = undefined;
    };

    for (let day = from; day <= to; day++) {
        const current = y(day);
        if (current === undefined) {
            close();
            continue;
        }
        if (!held) run.push([x(day), current]);
        else if (current !== held.y) {
            const before = x(day - 1);
            const after = x(day);
            const mid = (before + after) / 2;
            const half = Math.max((after - before) / 2, MIN_CURVE_PX / 2);
            const last = run.at(-1)!;
            // Changes closer together than a curve's width curve straight on from the last one.
            if (mid - half > last[0]) run.push([mid - half, held.y]);
            else if (run.length > 1) run.pop();
            run.push([mid + half, current]);
        }
        held = { day, y: current };
    }
    close();
    return segments;
}

/**
 * One line over Days `from`..`to` as runs of one point per Day, for the curves that pass through
 * each Day's value. The line breaks wherever `y` is undefined.
 */
export function dailySegments(
    y: (day: number) => number | undefined,
    x: (day: number) => number,
    from: number,
    to: number,
): Point[][] {
    const segments: Point[][] = [];
    let run: Point[] = [];
    for (let day = from; day <= to; day++) {
        const current = y(day);
        if (current !== undefined) run.push([x(day), current]);
        else if (run.length > 0) {
            segments.push(run);
            run = [];
        }
    }
    if (run.length > 0) segments.push(run);
    return segments;
}

/** `window` moved `by` Days, stopping at Day 0 and `last` without changing its width. */
export function panned({ start, end }: DayWindow, by: number, last: number): DayWindow {
    const width = Math.min(end - start, last);
    const moved = Math.min(Math.max(start + by, 0), last - width);
    return { start: moved, end: moved + width };
}

/** How long the Scrobbles axis takes to close about two thirds of the gap to its target. */
const EASE_MS = 220;

/** A value moved toward `target` over `elapsed` ms of exponential easing, snapping when close. */
export function easeToward(current: number, target: number, elapsed: number): number {
    const next = target + (current - target) * Math.exp(-elapsed / EASE_MS);
    return Math.abs(next - target) <= Math.abs(target) * 0.002 ? target : next;
}

/** The Standings a log axis labels: 1, 2, 5, 10, 20, 50 and so on, then the last Standing. */
export function logStandingTicks(artistCount: number): number[] {
    const ticks = Array.from({ length: Math.ceil(Math.log10(artistCount + 1)) }, (_, decade) =>
        [1, 2, 5].map((step) => step * 10 ** decade),
    )
        .flat()
        .filter((standing) => standing < artistCount);
    return [...ticks, artistCount];
}
