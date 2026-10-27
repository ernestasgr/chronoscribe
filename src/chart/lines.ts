import { curveBumpX, line } from "d3-shape";
import { UNRANKED, type StandingsTables } from "../standings";
import { sCurveSegments, standingLevel, type Point } from "./geometry";

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
const colorOf = (artist: number): string => PALETTE[(artist * 7919) % PALETTE.length]!;

export interface LinesFrame {
    tables: StandingsTables;
    artists: readonly number[];
    x: number;
    /** The pixel x of a fractional Day. */
    dayX: (day: number) => number;
    /** The pixel y of a level from 0 (top of the plot) to 1 (bottom). */
    levelY: (level: number) => number;
    /** The Days to draw, a little wider than the window so lines run off its edges. */
    from: number;
    to: number;
}

/**
 * Strokes each Artist's Standing line onto `context`. This is the one loop allowed to read the
 * raw `standing` array, for speed; everything else goes through the `standings` queries.
 */
export function strokeStandingLines(
    context: CanvasRenderingContext2D,
    { tables, artists, x, dayX, levelY, from, to }: LinesFrame,
): void {
    const artistCount = tables.artists.length;
    const bump = line<Point>().curve(curveBumpX).context(context);
    for (const artist of artists) {
        const y = (day: number): number | undefined => {
            const standing = tables.standing[day * artistCount + artist]!;
            return standing === UNRANKED
                ? undefined
                : levelY(standingLevel(standing, x, artistCount));
        };
        context.strokeStyle = colorOf(artist);
        context.beginPath();
        for (const segment of sCurveSegments(y, dayX, from, to)) bump(segment);
        context.stroke();
    }
}
