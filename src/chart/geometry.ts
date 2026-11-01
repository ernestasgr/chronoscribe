import type { BelowTopX } from "../settings";
import { asStanding, type Standing } from "../standings";

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
    standing: Standing,
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

/** How close two curves' ends must be to count as touching rather than overlapping. */
const TOUCH_PX = 0.5;

/** The share of a bump-x curve's width covered at progress `u` along it, both from 0 to 1. */
const bumpXFraction = (u: number) => 1.5 * u * (1 - u) + u ** 3;

/** The progress `u` along a bump-x curve at `fraction` of its width, by bisection. */
function bumpProgress(fraction: number): number {
    let [low, high] = [0, 1];
    for (let i = 0; i < 20; i++) {
        const u = (low + high) / 2;
        if (bumpXFraction(u) < fraction) low = u;
        else high = u;
    }
    return (low + high) / 2;
}

/**
 * The height of a drawn line at pixel `x`, along its S-curves (bump-x) or its straight segments;
 * undefined where the line breaks or ends. This keeps a playhead's dot on the line it rides.
 */
export function yAlong(segments: readonly Point[][], x: number, sCurve: boolean) {
    const run = segments.find((r) => x >= r[0]![0] - TOUCH_PX && x <= r.at(-1)![0] + TOUCH_PX);
    if (!run) return undefined;
    const next = run.findIndex(([px]) => px >= x);
    if (next <= 0) return run.at(next)![1];
    const [[ax, ay], [bx, by]] = [run[next - 1]!, run[next]!];
    const fraction = (x - ax) / (bx - ax);
    if (!sCurve) return ay + (by - ay) * fraction;
    const u = bumpProgress(fraction);
    return ay + (by - ay) * (3 * u * u - 2 * u ** 3);
}

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
            const start = mid - half;
            const last = run.at(-1)!;
            // Changes closer together than a curve's width curve straight on from the last one;
            // curves that only touch, as on Days wider than a curve, each keep their Day's level.
            if (start > last[0] + TOUCH_PX) run.push([start, held.y]);
            else if (start < last[0] - TOUCH_PX && run.length > 1) run.pop();
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

/** A run of labels stacked `gap` apart from `top`, centred on where its members would sit. */
interface Stack {
    members: number[];
    /** The sum of where its members would sit. */
    wantedSum: number;
    top: number;
}

/**
 * Label heights `gap` apart at least, between `top` and `bottom`, each overlapping run spread
 * evenly around where its labels would sit. Returned in the order given, the labels kept in order.
 */
export function spreadLabels(ys: readonly number[], gap: number, top: number, bottom: number) {
    const order = ys.map((_, i) => i).toSorted((a, b) => ys[a]! - ys[b]!);
    const placed = (members: number[], wantedSum: number): Stack => ({
        members,
        wantedSum,
        top: Math.max(
            top,
            Math.min(
                bottom - (members.length - 1) * gap,
                wantedSum / members.length - ((members.length - 1) * gap) / 2,
            ),
        ),
    });
    const stacks = order.reduce<Stack[]>((kept, i) => {
        let stack = placed([i], ys[i]!);
        // Merges the new label's stack into the ones above it for as long as they overlap.
        while (kept.length > 0) {
            const above = kept.at(-1)!;
            if (above.top + above.members.length * gap <= stack.top) break;
            kept.pop();
            stack = placed([...above.members, ...stack.members], above.wantedSum + stack.wantedSum);
        }
        return [...kept, stack];
    }, []);
    const spread = Array.from<number>({ length: ys.length });
    for (const stack of stacks)
        stack.members.forEach((i, rank) => (spread[i] = stack.top + rank * gap));
    return spread;
}

/** How long the Scrobbles axis takes to close about two thirds of the gap to its target. */
const EASE_MS = 220;

/** A value moved toward `target` over `elapsed` ms of exponential easing, snapping when close. */
export function easeToward(current: number, target: number, elapsed: number): number {
    const next = target + (current - target) * Math.exp(-elapsed / EASE_MS);
    return Math.abs(next - target) <= Math.abs(target) * 0.002 ? target : next;
}

/** The Standings a log axis labels: 1, 2, 5, 10, 20, 50 and so on, then the last Standing. */
export function logStandingTicks(artistCount: number): Standing[] {
    const ticks = Array.from({ length: Math.ceil(Math.log10(artistCount + 1)) }, (_, decade) =>
        [1, 2, 5].map((step) => step * 10 ** decade),
    )
        .flat()
        .filter((standing) => standing < artistCount)
        .map(asStanding);
    return [...ticks, asStanding(artistCount)];
}
