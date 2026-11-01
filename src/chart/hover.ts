import type { ScaleLinear } from "d3-scale";
import {
    dayIndex,
    valueAt,
    type ArtistId,
    type DayIndex,
    type StandingsTables,
} from "../standings";
import type { Plot } from "./layout";
import { yOnLine, type LinesGeometry, type LinesScale } from "./lines";

/** How far from a line, in pixels, the pointer still hovers it. */
const REACH_PX = 8;

/** An Artist's line hovered on a Day, with the pixel point on that Day where its dot sits. */
export interface HoveredLine {
    artist: ArtistId;
    day: DayIndex;
    x: number;
    y: number;
}

/** What the chart last painted, which the pointer is tested against. */
export interface HitFrame {
    tables: StandingsTables;
    geometry: LinesGeometry;
    scale: LinesScale;
    dayX: ScaleLinear<number, number>;
    plot: Plot;
    /** The rightmost pixel the lines are drawn to: the playhead's when the future is hidden. */
    right: number;
}

/** An Artist's Standing on `day` for breaking ties, unranked last. */
const tieRank = (tables: StandingsTables, artist: ArtistId, day: DayIndex): number =>
    valueAt(tables, artist, day, "standing") ?? Number.POSITIVE_INFINITY;

/** The Day nearest pixel `x`, kept within the history and left of the lines' right end. */
function dayNear({ tables, dayX, right }: HitFrame, x: number): DayIndex {
    const nearest = Math.min(tables.dayCount - 1, Math.max(0, Math.round(dayX.invert(x))));
    return dayIndex(dayX(nearest) > right ? Math.max(0, nearest - 1) : nearest);
}

/**
 * The drawn line nearest the pointer at `[x, y]` within `REACH_PX`, on the Day nearest it; equally
 * near lines go to the better Standing. None outside the plot or past the lines' right end.
 */
export function lineAt(
    frame: HitFrame,
    [x, y]: readonly [number, number],
): HoveredLine | undefined {
    const { tables, geometry, scale, dayX, plot, right } = frame;
    const inPlot =
        x >= plot.left && x <= right && y >= plot.top - REACH_PX && y <= plot.bottom + REACH_PX;
    if (!inPlot) return undefined;
    const day = dayNear(frame, x);
    const nearest = [...geometry.keys()]
        .flatMap((artist) => {
            const lineY = yOnLine(geometry, scale, artist, x);
            const distance = lineY === undefined ? Number.POSITIVE_INFINITY : Math.abs(lineY - y);
            return distance <= REACH_PX ? [{ artist, distance, lineY }] : [];
        })
        .toSorted(
            (a, b) =>
                a.distance - b.distance ||
                tieRank(tables, a.artist, day) - tieRank(tables, b.artist, day),
        )[0];
    if (!nearest) return undefined;
    const dotX = dayX(day);
    const dotY = yOnLine(geometry, scale, nearest.artist, dotX) ?? nearest.lineY ?? y;
    return { artist: nearest.artist, day, x: dotX, y: dotY };
}

/**
 * Where the pointer is in relation to a line's card: on the line, on the card, or between the two
 * with the card held open for a grace period.
 */
export type HoverState =
    | { kind: "none" }
    | { kind: "onLine"; line: HoveredLine }
    | { kind: "leaving"; line: HoveredLine }
    | { kind: "onCard"; line: HoveredLine };

export type HoverEvent =
    /** The pointer moved over the chart, onto a line or off every line. */
    | { type: "pointed"; line: HoveredLine | undefined }
    | { type: "graceEnded" }
    | { type: "cardEntered" }
    | { type: "cardLeft" }
    /** The view moved, the tables or settings changed, or the pointer is dragging. */
    | { type: "dismissed" };

export const NOT_HOVERING: HoverState = { kind: "none" };

const sameLine = (a: HoveredLine, b: HoveredLine) => a.artist === b.artist && a.day === b.day;

/** The hover after `event`; an event the state doesn't accept leaves it as it is. */
export function hoverTransition(state: HoverState, event: HoverEvent): HoverState {
    switch (event.type) {
        case "pointed":
            if (event.line)
                return state.kind === "onLine" && sameLine(state.line, event.line)
                    ? state
                    : { kind: "onLine", line: event.line };
            return state.kind === "onLine" ? { kind: "leaving", line: state.line } : state;
        case "graceEnded":
            return state.kind === "leaving" ? NOT_HOVERING : state;
        case "cardEntered":
            return state.kind === "onLine" || state.kind === "leaving"
                ? { kind: "onCard", line: state.line }
                : state;
        case "cardLeft":
            return state.kind === "onCard" ? { kind: "leaving", line: state.line } : state;
        case "dismissed":
            return NOT_HOVERING;
    }
}

/** The line whose card is open, if any. */
export const hoveredLine = (state: HoverState): HoveredLine | undefined =>
    state.kind === "none" ? undefined : state.line;
