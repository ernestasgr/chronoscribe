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
import { dailySegments, sCurveSegments, standingLevel, yAlong, type Point } from "./geometry";

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

/** Each drawn Artist's line as runs of pixel points, in the shape the scale asks for. */
export type LinesGeometry = ReadonlyMap<number, Point[][]>;

/** The points of every drawn line in this frame, shared by the strokes and the dots that ride them. */
export function linesGeometry({
    tables,
    artists,
    dayX,
    scale,
    from,
    to,
}: LinesFrame): LinesGeometry {
    const segmentsOf = drawsSCurves(scale) ? sCurveSegments : dailySegments;
    const yOf = artistY(tables, scale);
    return new Map(artists.map((artist) => [artist, segmentsOf(yOf(artist), dayX, from, to)]));
}

/** The dash pattern of a Pinned Artist's line on the Days they are outside the Top X. */
const PINNED_DASH = [5, 4];
const SOLID: number[] = [];
/** Far enough past any canvas edge to stand for "everywhere" in a clip. */
const EVERYWHERE = 1e6;

/** The pixel spans, left to right, where each Pinned Artist's line is drawn dashed. */
export type DashedSpans = ReadonlyMap<number, readonly (readonly [left: number, right: number])[]>;

/** Clips `context` to `spans`, or with `outside` to everywhere but them. */
function clipToSpans(
    context: CanvasRenderingContext2D,
    spans: readonly (readonly [number, number])[],
    outside: boolean,
) {
    context.beginPath();
    if (outside) context.rect(-EVERYWHERE, -EVERYWHERE, 2 * EVERYWHERE, 2 * EVERYWHERE);
    for (const [left, right] of spans)
        context.rect(left, -EVERYWHERE, right - left, 2 * EVERYWHERE);
    context.clip("evenodd");
}

/**
 * Strokes each line of `geometry` onto `context` with the curve the scale asks for, dashed within
 * its `dashed` spans and solid elsewhere.
 */
export function strokeLines(
    context: CanvasRenderingContext2D,
    geometry: LinesGeometry,
    scale: LinesScale,
    dashed: DashedSpans,
): void {
    const curve =
        scale.yAxis === "scrobbles"
            ? curveMonotoneX
            : scale.shape === "s-curves"
              ? curveBumpX
              : DAILY_CURVES[scale.shape];
    const path = line<Point>().curve(curve).context(context);
    const stroke = (segments: Point[][], dash: number[]) => {
        context.setLineDash(dash);
        context.beginPath();
        for (const segment of segments) path(segment);
        context.stroke();
    };
    for (const [artist, segments] of geometry) {
        context.strokeStyle = colorOf(artist);
        const spans = dashed.get(artist) ?? [];
        if (spans.length === 0) {
            stroke(segments, SOLID);
            continue;
        }
        for (const [outside, dash] of [
            [true, SOLID],
            [false, PINNED_DASH],
        ] as const) {
            context.save();
            clipToSpans(context, spans, outside);
            stroke(segments, dash);
            context.restore();
        }
    }
    context.setLineDash(SOLID);
}

/** Where an Artist's drawn line is at pixel `x`, or undefined if it isn't drawn there. */
export const yOnLine = (
    geometry: LinesGeometry,
    scale: LinesScale,
    artist: number,
    x: number,
): number | undefined => {
    const segments = geometry.get(artist);
    return segments && yAlong(segments, x, drawsSCurves(scale));
};

/** The most cumulative Scrobbles any of `artists` has by the end of `day`. */
export const mostScrobbles = (
    tables: StandingsTables,
    artists: readonly number[],
    day: number,
): number =>
    artists.reduce((most, artist) => Math.max(most, valueAt(tables, artist, day, "scrobbles")!), 0);
