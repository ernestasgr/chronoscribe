export type Point = [x: number, y: number];

/** The narrowest S-curve a change of Standing is drawn with: adjacent Days are often < 1 px apart. */
const MIN_CURVE_PX = 14;

/** The share of the plot's height given to the gutter under #X. */
const GUTTER_SHARE = 0.15;

/**
 * Where a Standing sits, from 0 at the top of the plot to 1 at the bottom. The Top X share the
 * upper rows evenly; every lower Standing, down to `#artistCount`, is squeezed into a log-scaled
 * gutter band under #X.
 */
export function standingLevel(standing: number, x: number, artistCount: number): number {
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
