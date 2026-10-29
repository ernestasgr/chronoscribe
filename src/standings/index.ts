import type { ClimbersMode, LinesRule, YAxis } from "../db";

/** The Standing stored for an Artist who has no Scrobbles yet on a Day. */
export const UNRANKED = 0xffff;

export interface StandingsTables {
    /** Artist names; an Artist's index here is its artist id. */
    artists: string[];
    dayCount: number;
    firstDay: { date: string; timeZone: string };
    /** Day-major, indexed `day * artists.length + artist`. */
    cumulative: Uint32Array;
    /** 1-based Standing, or UNRANKED. Day-major like `cumulative`. */
    standing: Uint16Array;
    /** Each Day's artist ids sorted by Standing, unranked slots filled with UNRANKED. */
    rankOrder: Uint16Array;
}

export interface TopXRow {
    id: number;
    artist: string;
    standing: number;
    cumulative: number;
}

const DAY_SECONDS = 86_400;
// Local dates are cached per quarter-hour: every modern offset is a whole number of them.
const QUARTER_HOUR = 900;

function dayIndexer(timeZone: string) {
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

function isoDate(epochDay: number): string {
    return new Date(epochDay * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

/**
 * Builds the Standings for every Day from the first Scrobble's Day through `today`,
 * both taken as Days in `timeZone`.
 */
export function buildStandings(
    scrobbles: Iterable<{ uts: number; artist: string }>,
    { timeZone, today }: { timeZone: string; today: number },
): StandingsTables {
    const sorted = Array.from(scrobbles).toSorted(
        (a, b) => a.uts - b.uts || compareNames(a.artist, b.artist),
    );
    const epochDayOf = dayIndexer(timeZone);
    const artistIds = new Map<string, number>();
    for (const { artist } of sorted)
        if (!artistIds.has(artist)) artistIds.set(artist, artistIds.size);
    const artists = [...artistIds.keys()];
    const artistCount = artists.length;
    if (artistCount >= UNRANKED)
        throw new RangeError(`Too many Artists (${artistCount}) for 16-bit Standings`);

    const firstEpochDay = sorted.length > 0 ? epochDayOf(sorted[0]!.uts) : epochDayOf(today);
    const dayCount =
        Math.max(epochDayOf(today), epochDayOf(sorted.at(-1)?.uts ?? today)) - firstEpochDay + 1;
    const cumulative = new Uint32Array(dayCount * artistCount);
    const standing = new Uint16Array(dayCount * artistCount).fill(UNRANKED);
    const rankOrder = new Uint16Array(dayCount * artistCount).fill(UNRANKED);

    const counts = new Uint32Array(artistCount);
    // When each Artist reached their current count; ties in count go to the earlier one.
    const reachedAt = new Float64Array(artistCount);
    const ranked: number[] = [];
    const byStanding = (a: number, b: number) =>
        counts[b]! - counts[a]! ||
        reachedAt[a]! - reachedAt[b]! ||
        compareNames(artists[a]!, artists[b]!);

    let next = 0;
    for (let day = 0; day < dayCount; day++) {
        const base = day * artistCount;
        let changed = false;
        while (next < sorted.length && epochDayOf(sorted[next]!.uts) - firstEpochDay === day) {
            const { uts, artist } = sorted[next++]!;
            const id = artistIds.get(artist)!;
            if (counts[id] === 0) ranked.push(id);
            counts[id]!++;
            reachedAt[id] = uts;
            changed = true;
        }
        if (changed) ranked.sort(byStanding);
        cumulative.set(counts, base);
        for (let rank = 0; rank < ranked.length; rank++) {
            const id = ranked[rank]!;
            standing[base + id] = rank + 1;
            rankOrder[base + rank] = id;
        }
    }

    return {
        artists,
        dayCount,
        firstDay: { date: isoDate(firstEpochDay), timeZone },
        cumulative,
        standing,
        rankOrder,
    };
}

/** Orders names case-insensitively, then case-sensitively. */
function compareNames(a: string, b: string): number {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/** The ISO date of a Day. */
export function dayDate(tables: StandingsTables, day: number): string {
    const first = Date.parse(tables.firstDay.date) / 1000 / DAY_SECONDS;
    return isoDate(first + day);
}

/** How many Days later `to`'s first Day falls than `from`'s, so a Day keeps its date across both. */
export const firstDayShift = (from: StandingsTables, to: StandingsTables): number =>
    (Date.parse(to.firstDay.date) - Date.parse(from.firstDay.date)) / 1000 / DAY_SECONDS;

/** The X Artists with the best Standings on `day`. */
export function topX(tables: StandingsTables, day: number, x: number): TopXRow[] {
    const artistCount = tables.artists.length;
    const base = day * artistCount;
    const rows: TopXRow[] = [];
    for (let rank = 0; rank < Math.min(x, artistCount); rank++) {
        const id = tables.rankOrder[base + rank]!;
        if (id === UNRANKED) break;
        rows.push({
            id,
            artist: tables.artists[id]!,
            standing: rank + 1,
            cumulative: tables.cumulative[base + id]!,
        });
    }
    return rows;
}

/** An Artist's Scrobbles within `day`. */
export function dailyPlays(tables: StandingsTables, day: number, artist: number): number {
    const artistCount = tables.artists.length;
    const today = tables.cumulative[day * artistCount + artist]!;
    return day === 0 ? today : today - tables.cumulative[(day - 1) * artistCount + artist]!;
}

/** Every Scrobble within `day`, across all Artists. */
export function dayScrobbles(tables: StandingsTables, day: number): number {
    let total = 0;
    for (let artist = 0; artist < tables.artists.length; artist++)
        total += dailyPlays(tables, day, artist);
    return total;
}

export interface Climber {
    id: number;
    artist: string;
    standing: number;
    /** The previous Day's Standing, or undefined for a debut. */
    previous: number | undefined;
    gain: number;
    debut: boolean;
    dailyPlays: number;
}

export type { ClimbersMode };

export interface ClimbersReport {
    listed: Climber[];
    /** In "fold" mode, the Climbers finishing beyond Top `beyond`, when there are any. */
    folded?: { climbers: Climber[]; beyond: number; singlePlay: number };
}

/** Where Climbers stop being listed outside "all" mode: Top max(50, 5X). */
export const climbersCut = (x: number): number => Math.max(50, 5 * x);

/**
 * The Artists whose Standing improved since the previous Day, most positions gained first.
 * A debut climbs from just below the previous Day's last ranked Artist.
 */
export function climbers(
    tables: StandingsTables,
    day: number,
    mode: ClimbersMode,
    x: number,
): ClimbersReport {
    if (day === 0) return { listed: [] };
    const artistCount = tables.artists.length;
    const base = day * artistCount;
    const previousBase = base - artistCount;
    let previouslyRanked = 0;
    while (
        previouslyRanked < artistCount &&
        tables.rankOrder[previousBase + previouslyRanked] !== UNRANKED
    )
        previouslyRanked++;

    const rows: Climber[] = [];
    for (let id = 0; id < artistCount; id++) {
        const standing = tables.standing[base + id]!;
        if (standing === UNRANKED) continue;
        const before = tables.standing[previousBase + id]!;
        const debut = before === UNRANKED;
        const gain = (debut ? previouslyRanked + 1 : before) - standing;
        if (gain <= 0) continue;
        rows.push({
            id,
            artist: tables.artists[id]!,
            standing,
            previous: debut ? undefined : before,
            gain,
            debut,
            dailyPlays: dailyPlays(tables, day, id),
        });
    }
    rows.sort((a, b) => b.gain - a.gain || a.standing - b.standing);
    if (mode === "all") return { listed: rows };

    const beyond = climbersCut(x);
    const listed = rows.filter((row) => row.standing <= beyond);
    const tail = rows.filter((row) => row.standing > beyond);
    if (mode === "within" || tail.length === 0) return { listed };
    return {
        listed,
        folded: {
            climbers: tail,
            beyond,
            singlePlay: tail.filter((row) => row.dailyPlays === 1).length,
        },
    };
}

export type { LinesRule, YAxis };

/** A span of fractional Days. */
export interface DayWindow {
    start: number;
    end: number;
}

/** The Days at the start of the history that the "warm-up" rule ignores. */
const WARM_UP_DAYS = 30;
/** The Days in the Top X within the window that the "seven-days" rule asks of an Artist. */
const SEVEN_DAYS = 7;

// The last drawn lines for each tables object, keyed on everything that decides them.
const drawnLinesMemo = new WeakMap<StandingsTables, { key: string; lines: readonly number[] }>();

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
    pinned: readonly number[],
): readonly number[] {
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
    pinned: readonly number[],
): readonly number[] {
    const artistCount = tables.artists.length;
    const daysIn = new Map<number, number>();
    for (let day = first; day <= last; day++)
        for (let rank = 0; rank < Math.min(x, artistCount); rank++) {
            const id = tables.rankOrder[day * artistCount + rank]!;
            if (id === UNRANKED) break;
            daysIn.set(id, (daysIn.get(id) ?? 0) + 1);
        }
    const drawn = new Set<number>(pinned);
    for (const [id, count] of daysIn) if (count >= days) drawn.add(id);
    return [...drawn].toSorted((a, b) => a - b);
}

/** An Artist's Standing (undefined while unranked) or cumulative Scrobbles at the end of `day`. */
export function valueAt(
    tables: StandingsTables,
    artist: number,
    day: number,
    yAxis: YAxis,
): number | undefined {
    const index = day * tables.artists.length + artist;
    if (yAxis === "scrobbles") return tables.cumulative[index];
    const standing = tables.standing[index]!;
    return standing === UNRANKED ? undefined : standing;
}

/** Every ArrayBuffer behind the tables, for a zero-copy transfer between threads. */
export function transferables(tables: StandingsTables): ArrayBuffer[] {
    return [
        tables.cumulative.buffer,
        tables.standing.buffer,
        tables.rankOrder.buffer,
    ] as ArrayBuffer[];
}
