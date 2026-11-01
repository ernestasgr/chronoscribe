import type { LinesRule } from "../settings";
import { standingAt } from "./queries";
import {
    artistId,
    dayIndex,
    UNRANKED,
    type ArtistId,
    type DayIndex,
    type DayWindow,
    type StandingsTables,
} from "./tables";

/** The Days at the start of the history that the "warm-up" rule ignores. */
const WARM_UP_DAYS = 30;
/** The Days in the Top X within the window that the "seven-days" rule asks of an Artist. */
const SEVEN_DAYS = 7;

// The last drawn lines for each tables object, keyed on everything that decides them.
const drawnLinesMemo = new WeakMap<StandingsTables, { key: string; lines: readonly ArtistId[] }>();

/**
 * The ids of the Artists the chart draws a line for over `window`, in ascending order, plus the
 * Pinned Artists. By `rule`: every Artist in the Top X on a visible Day after the 30-Day warm-up
 * ("warm-up"; a window wholly inside it draws its own Top X, so a young history isn't left blank),
 * the same from the first Day ("no-warm-up"), or every Artist in the Top X on at least 7 visible
 * Days ("seven-days"; a shorter window asks for all of them).
 * Memoised on the integer window bounds, `x`, `rule`, `pinned` and `tables`.
 */
export function drawnLines(
    tables: StandingsTables,
    window: DayWindow,
    x: number,
    rule: LinesRule,
    pinned: readonly ArtistId[],
): readonly ArtistId[] {
    const first = Math.max(0, Math.ceil(window.start));
    const last = Math.min(tables.dayCount - 1, Math.floor(window.end));
    const key = [first, last, x, rule, pinned.toSorted((a, b) => a - b).join()].join("|");
    const memo = drawnLinesMemo.get(tables);
    if (memo?.key === key) return memo.lines;
    const lines = linesOver(tables, linesSpan(rule, first, last), x, pinned);
    drawnLinesMemo.set(tables, { key, lines });
    return lines;
}

interface LinesSpan {
    first: number;
    last: number;
    /** How many of those Days an Artist must be in the Top X on to get a line. */
    days: number;
}

const linesSpan = (rule: LinesRule, first: number, last: number): LinesSpan => {
    switch (rule) {
        case "warm-up":
            return {
                first: last >= WARM_UP_DAYS ? Math.max(first, WARM_UP_DAYS) : first,
                last,
                days: 1,
            };
        case "no-warm-up":
            return { first, last, days: 1 };
        case "seven-days":
            return { first, last, days: Math.min(SEVEN_DAYS, last - first + 1) };
    }
};

/** Every Artist in the Top X on at least `days` of the Days `first` through `last`, plus `pinned`. */
function linesOver(
    tables: StandingsTables,
    { first, last, days }: LinesSpan,
    x: number,
    pinned: readonly ArtistId[],
): readonly ArtistId[] {
    const artistCount = tables.artists.length;
    const daysIn = new Map<number, number>();
    for (let day = first; day <= last; day++)
        for (let rank = 0; rank < Math.min(x, artistCount); rank++) {
            const id = tables.rankOrder[day * artistCount + rank]!;
            if (id === UNRANKED) break;
            daysIn.set(id, (daysIn.get(id) ?? 0) + 1);
        }
    const drawn = new Set<ArtistId>(pinned);
    for (const [id, count] of daysIn) if (count >= days) drawn.add(artistId(id));
    return [...drawn].toSorted((a, b) => a - b);
}

/** The runs of Days `from` through `to` on which `artist` is outside the Top X, unranked included. */
export function daysOutsideTopX(
    tables: StandingsTables,
    artist: ArtistId,
    x: number,
    from: DayIndex,
    to: DayIndex,
): DayWindow[] {
    const outside = (day: number) => (standingAt(tables, artist, dayIndex(day)) ?? x + 1) > x;
    return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).reduce<
        DayWindow[]
    >((runs, day) => {
        if (!outside(day)) return runs;
        const last = runs.at(-1);
        return last?.end === day - 1
            ? [...runs.slice(0, -1), { start: last.start, end: day }]
            : [...runs, { start: day, end: day }];
    }, []);
}
