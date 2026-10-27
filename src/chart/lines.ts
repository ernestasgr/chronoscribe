import {
    curveBasis,
    curveBumpX,
    curveCatmullRom,
    curveLinear,
    curveMonotoneX,
    line,
    type CurveFactory,
} from "d3-shape";
import type { BelowTopX, LineShape } from "../db";
import { UNRANKED, valueAt, type StandingsTables } from "../standings";
import { between, dailySegments, sCurveSegments, standingLevel, type Point } from "./geometry";

const PALETTE = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
    "#ff9da7",
    "#9c755f",
    "#5fa2ce",
    "#d37295",
    "#8cd17d",
    "#b6992d",
    "#499894",
    "#86bcb6",
    "#e19d9a",
];

/** How faintly lines are drawn ahead of the playhead. */
const GHOST_ALPHA = 0.22;

/** An Artist's line colour, fixed by its id so it doesn't change as the window moves. */
export const colorOf = (artist: number): string => PALETTE[(artist * 7919) % PALETTE.length]!;

/** Whether lines are drawn as S-curves, which pass between Days rather than through them. */
const drawsSCurves = (scale: LinesScale): boolean =>
    scale.yAxis === "standing" && scale.shape === "s-curves";

/** The curves drawn through one point per Day, for every Standing shape but the S-curves. */
const DAILY_CURVES: Record<Exclude<LineShape, "s-curves">, CurveFactory> = {
    straight: curveLinear,
    monotone: curveMonotoneX,
    "catmull-rom": curveCatmullRom,
    basis: curveBasis,
};

/** How the lines map onto the plot's height, in each Y axis mode. */
export type LinesScale =
    | {
          yAxis: "standing";
          x: number;
          below: BelowTopX;
          shape: LineShape;
          /** The pixel y of a level from 0 (top of the plot) to 1 (bottom). */
          levelY: (level: number) => number;
      }
    | {
          yAxis: "scrobbles";
          /** The pixel y of a cumulative Scrobble count. */
          scrobblesY: (scrobbles: number) => number;
      };

export interface LinesFrame {
    tables: StandingsTables;
    artists: readonly number[];
    /** The pixel x of a fractional Day. */
    dayX: (day: number) => number;
    scale: LinesScale;
    /** The Days to draw, a little wider than the window so lines run off its edges. */
    from: number;
    to: number;
    /** The pixel x beyond which lines are ghosted, or undefined to draw them all solid. */
    ghostFrom: number | undefined;
}

/** An Artist's pixel y on a Day, undefined before their first Scrobble. */
type ArtistY = (artist: number) => (day: number) => number | undefined;

/**
 * The y of every Artist's line. This is the one loop allowed to read the raw `standing` and
 * `cumulative` arrays, for speed; everything else goes through the `standings` queries.
 */
function artistY(tables: StandingsTables, scale: LinesScale): ArtistY {
    const artistCount = tables.artists.length;
    if (scale.yAxis === "scrobbles")
        return (artist) => (day) => {
            const scrobbles = tables.cumulative[day * artistCount + artist]!;
            return scrobbles === 0 ? undefined : scale.scrobblesY(scrobbles);
        };
    const { x, below, levelY } = scale;
    return (artist) => (day) => {
        const standing = tables.standing[day * artistCount + artist]!;
        return standing === UNRANKED
            ? undefined
            : levelY(standingLevel(standing, x, artistCount, below));
    };
}

/** The plane left and right of `x`, as clip paths that leave the current path alone. */
function halves(x: number): [behind: Path2D, ahead: Path2D] {
    const behind = new Path2D();
    behind.rect(x - 1e6, -1e6, 1e6, 2e6);
    const ahead = new Path2D();
    ahead.rect(x, -1e6, 1e6, 2e6);
    return [behind, ahead];
}

/** Strokes the current path, solid behind `ghostFrom` and ghosted ahead of it. */
function strokeGhosted(context: CanvasRenderingContext2D, split: [Path2D, Path2D] | undefined) {
    if (!split) return context.stroke();
    const [behind, ahead] = split;
    context.save();
    context.clip(behind);
    context.stroke();
    context.restore();
    context.save();
    context.clip(ahead);
    context.globalAlpha = GHOST_ALPHA;
    context.stroke();
    context.restore();
}

/** Strokes each drawn Artist's line onto `context` in the shape the scale asks for. */
export function strokeLines(
    context: CanvasRenderingContext2D,
    { tables, artists, dayX, scale, from, to, ghostFrom }: LinesFrame,
): void {
    const sCurves = drawsSCurves(scale);
    const curve =
        scale.yAxis === "scrobbles"
            ? curveMonotoneX
            : scale.shape === "s-curves"
              ? curveBumpX
              : DAILY_CURVES[scale.shape];
    const segmentsOf = sCurves ? sCurveSegments : dailySegments;
    const path = line<Point>().curve(curve).context(context);
    const yOf = artistY(tables, scale);
    const split = ghostFrom === undefined ? undefined : halves(ghostFrom);
    for (const artist of artists) {
        context.strokeStyle = colorOf(artist);
        context.beginPath();
        for (const segment of segmentsOf(yOf(artist), dayX, from, to)) path(segment);
        strokeGhosted(context, split);
    }
}

/**
 * An Artist's pixel y at a fractional Day, between its two Days the way its line runs (eased for
 * S-curves, straight otherwise); undefined before their first Scrobble.
 */
export function yAtPlayhead(
    tables: StandingsTables,
    scale: LinesScale,
    artist: number,
    playhead: number,
): number | undefined {
    const yOf = artistY(tables, scale)(artist);
    const before = Math.floor(playhead);
    const after = Math.min(before + 1, tables.dayCount - 1);
    const from = yOf(before);
    const to = yOf(after);
    if (from === undefined || to === undefined) return from;
    return between(from, to, playhead - before, drawsSCurves(scale));
}

/** The most cumulative Scrobbles any of `artists` has by the end of `day`. */
export const mostScrobbles = (
    tables: StandingsTables,
    artists: readonly number[],
    day: number,
): number =>
    artists.reduce((most, artist) => Math.max(most, valueAt(tables, artist, day, "scrobbles")!), 0);
