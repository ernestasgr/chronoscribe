/** Seconds in a UTC day. */
export const DAY_SECONDS = 86_400;
// Local dates are cached per quarter-hour: every modern offset is a whole number of them.
const QUARTER_HOUR = 900;

/** A function giving the Days since the Unix epoch of the local calendar date in `timeZone` holding a second. */
export function dayIndexer(timeZone: string) {
    const format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const epochDayAt = (uts: number) => Date.parse(format.format(uts * 1000)) / 1000 / DAY_SECONDS;
    // Each quarter-hour's local date, or NaN for one that straddles local midnight.
    const cache = new Map<number, number>();
    // Days since the Unix epoch of the local calendar date holding `uts`.
    return (uts: number): number => {
        const quarter = Math.floor(uts / QUARTER_HOUR);
        let epochDay = cache.get(quarter);
        if (epochDay === undefined) {
            const start = epochDayAt(quarter * QUARTER_HOUR);
            epochDay = start === epochDayAt((quarter + 1) * QUARTER_HOUR - 1) ? start : Number.NaN;
            cache.set(quarter, epochDay);
        }
        return Number.isNaN(epochDay) ? epochDayAt(uts) : epochDay;
    };
}

/**
 * The history's first Day (days since the Unix epoch) and how many Days it holds: from the first
 * Scrobble's Day through today, or through the last Scrobble's Day if that is later.
 */
export function historyDays(
    epochDayOf: (uts: number) => number,
    scrobbled: { first: number; last: number } | undefined,
    today: number,
): { firstEpochDay: number; dayCount: number } {
    const firstEpochDay = epochDayOf(scrobbled?.first ?? today);
    const lastEpochDay = Math.max(epochDayOf(today), epochDayOf(scrobbled?.last ?? today));
    return { firstEpochDay, dayCount: lastEpochDay - firstEpochDay + 1 };
}

/** The ISO date of a Day since the Unix epoch. */
export function isoDate(epochDay: number): string {
    return new Date(epochDay * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

/** Orders names case-insensitively, then case-sensitively. */
export function compareNames(a: string, b: string): number {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
