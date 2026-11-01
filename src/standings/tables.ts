import { compareNames, DAY_SECONDS, dayIndexer, historyDays, isoDate } from "./days";

/** The Standing stored for an Artist who has no Scrobbles yet on a Day. */
export const UNRANKED = 0xffff;

/** A whole Day of the tables, counted from the Day of the first Scrobble. */
export type DayIndex = number & { readonly brand: "DayIndex" };

/** Brands a whole number of Days since the tables' first Day. */
export const dayIndex = (day: number): DayIndex => day as DayIndex;

/** An Artist's 1-based rank on a Day, #1 the most Scrobbled. */
export type Standing = number & { readonly brand: "Standing" };

/** Brands a 1-based rank; not `standing`, which locals throughout are named. */
export const asStanding = (rank: number): Standing => rank as Standing;

/** An Artist's index in the tables' `artists`. */
export type ArtistId = number & { readonly brand: "ArtistId" };

/** Brands an index into the tables' `artists`. */
export const artistId = (index: number): ArtistId => index as ArtistId;

export interface StandingsTables {
    /** Artist names; an Artist's index here is its artist id. */
    artists: string[];
    dayCount: number;
    firstDay: { date: string; timeZone: string };
    /** Day-major, indexed `day * artists.length + artist`. */
    cumulative: Uint32Array<ArrayBuffer>;
    /** 1-based Standing, or UNRANKED. Day-major like `cumulative`. */
    standing: Uint16Array<ArrayBuffer>;
    /** Each Day's artist ids sorted by Standing, unranked slots filled with UNRANKED. */
    rankOrder: Uint16Array<ArrayBuffer>;
    /** Each Day's Daily volume, so it isn't summed over every Artist each time it is asked for. */
    dailyVolume: Uint32Array<ArrayBuffer>;
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

    const { firstEpochDay, dayCount } = historyDays(
        epochDayOf,
        sorted.length > 0 ? { first: sorted[0]!.uts, last: sorted.at(-1)!.uts } : undefined,
        today,
    );
    const cumulative = new Uint32Array(dayCount * artistCount);
    const standing = new Uint16Array(dayCount * artistCount).fill(UNRANKED);
    const rankOrder = new Uint16Array(dayCount * artistCount).fill(UNRANKED);
    const dailyVolume = new Uint32Array(dayCount);

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
            dailyVolume[day]!++;
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
        dailyVolume,
    };
}

/** The ISO date of a Day. */
export function dayDate(tables: StandingsTables, day: DayIndex): string {
    const first = Date.parse(tables.firstDay.date) / 1000 / DAY_SECONDS;
    return isoDate(first + day);
}

/** How many Days later `to`'s first Day falls than `from`'s, so a Day keeps its date across both. */
export const firstDayShift = (from: StandingsTables, to: StandingsTables): number =>
    (Date.parse(to.firstDay.date) - Date.parse(from.firstDay.date)) / 1000 / DAY_SECONDS;

/** A span of fractional Days. */
export interface DayWindow {
    start: number;
    end: number;
}

/** Every ArrayBuffer behind the tables, for a zero-copy transfer between threads. */
export function transferables(tables: StandingsTables): ArrayBuffer[] {
    return [
        tables.cumulative.buffer,
        tables.standing.buffer,
        tables.rankOrder.buffer,
        tables.dailyVolume.buffer,
    ];
}
