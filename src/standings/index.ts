import type { ClimbersMode, LinesRule } from "../settings";
import { compareNames, DAY_SECONDS, dayIndexer, historyDays, isoDate } from "./days";

export {
    buildSoundtracks,
    soundtrackAt,
    windowAt,
    windowIndex,
    type Soundtrack,
    type SoundtrackTrack,
    type Soundtracks,
    type WindowIndex,
} from "./soundtracks";
export { daySpan, trackPlays, type TrackPlays } from "./trackPlays";

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

export interface TopXRow {
    id: ArtistId;
    artist: string;
    standing: Standing;
    cumulative: number;
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

/** The X Artists with the best Standings on `day`. */
export function topX(tables: StandingsTables, day: DayIndex, x: number): TopXRow[] {
    const artistCount = tables.artists.length;
    const base = day * artistCount;
    const rows: TopXRow[] = [];
    for (let rank = 0; rank < Math.min(x, artistCount); rank++) {
        const id = tables.rankOrder[base + rank]!;
        if (id === UNRANKED) break;
        rows.push({
            id: artistId(id),
            artist: tables.artists[id]!,
            standing: asStanding(rank + 1),
            cumulative: tables.cumulative[base + id]!,
        });
    }
    return rows;
}

/** An Artist's Scrobbles within `day`. */
export function dailyPlays(tables: StandingsTables, day: DayIndex, artist: ArtistId): number {
    const artistCount = tables.artists.length;
    const today = tables.cumulative[day * artistCount + artist]!;
    return day === 0 ? today : today - tables.cumulative[(day - 1) * artistCount + artist]!;
}

/** Every Scrobble within `day`, across all Artists. */
export const dayScrobbles = (tables: StandingsTables, day: DayIndex): number =>
    tables.dailyVolume[day] ?? 0;

/** How many Artists have a Standing on `day`, found by halving since the unranked come last. */
export function rankedCount(tables: StandingsTables, day: DayIndex): number {
    const artistCount = tables.artists.length;
    const base = day * artistCount;
    let low = 0;
    let high = artistCount;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (tables.rankOrder[base + middle] === UNRANKED) high = middle;
        else low = middle + 1;
    }
    return low;
}

/** The Artists with Standings `best` through `worst` on `day`, best first; ranks nobody holds are skipped. */
export function rankedBetween(
    tables: StandingsTables,
    day: DayIndex,
    best: Standing,
    worst: Standing,
): ArtistId[] {
    const first = Math.max(1, best);
    const last = Math.min(worst, rankedCount(tables, day));
    const base = day * tables.artists.length - 1;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) =>
        artistId(tables.rankOrder[base + first + i]!),
    );
}

export interface Climber {
    id: ArtistId;
    artist: string;
    standing: Standing;
    /** The previous Day's Standing, or undefined for a debut. */
    previous: Standing | undefined;
    gain: number;
    debut: boolean;
    dailyPlays: number;
}

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
    day: DayIndex,
    mode: ClimbersMode,
    x: number,
): ClimbersReport {
    if (day === 0) return { listed: [] };
    const artistCount = tables.artists.length;
    const base = day * artistCount;
    const previousBase = base - artistCount;
    const previouslyRanked = rankedCount(tables, dayIndex(day - 1));

    const rows: Climber[] = [];
    for (let id = 0; id < artistCount; id++) {
        const standing = tables.standing[base + id]!;
        if (standing === UNRANKED) continue;
        const before = tables.standing[previousBase + id]!;
        const debut = before === UNRANKED;
        const gain = (debut ? previouslyRanked + 1 : before) - standing;
        if (gain <= 0) continue;
        const artist = artistId(id);
        rows.push({
            id: artist,
            artist: tables.artists[id]!,
            standing: asStanding(standing),
            previous: debut ? undefined : asStanding(before),
            gain,
            debut,
            dailyPlays: dailyPlays(tables, day, artist),
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

/** An Artist's Standing at the end of `day`, undefined while unranked. */
export function standingAt(
    tables: StandingsTables,
    artist: ArtistId,
    day: DayIndex,
): Standing | undefined {
    const standing = tables.standing[day * tables.artists.length + artist]!;
    return standing === UNRANKED ? undefined : asStanding(standing);
}

/** An Artist's cumulative Scrobbles at the end of `day`, 0 before their first. */
export const scrobblesAt = (tables: StandingsTables, artist: ArtistId, day: DayIndex): number =>
    tables.cumulative[day * tables.artists.length + artist] ?? 0;

// The last Artist's worst Standing through each Day for each tables object; 0 before their debut.
const worstStandingsMemo = new WeakMap<
    StandingsTables,
    { artist: ArtistId; worst: Uint16Array<ArrayBuffer> }
>();

/** An Artist's worst Standing so far on each Day, counted once per Artist so a frame reads one entry. */
function worstStandingsOf(tables: StandingsTables, artist: ArtistId): Uint16Array<ArrayBuffer> {
    const known = worstStandingsMemo.get(tables);
    if (known?.artist === artist) return known.worst;
    const artistCount = tables.artists.length;
    const worst = new Uint16Array(tables.dayCount);
    let running = 0;
    for (let day = 0; day < tables.dayCount; day++) {
        const standing = tables.standing[day * artistCount + artist]!;
        if (standing !== UNRANKED && standing > running) running = standing;
        worst[day] = running;
    }
    worstStandingsMemo.set(tables, { artist, worst });
    return worst;
}

/** An Artist's worst Standing from their debut through `through`, undefined before the debut. */
export function worstStanding(
    tables: StandingsTables,
    artist: ArtistId,
    through: DayIndex,
): Standing | undefined {
    const worst = worstStandingsOf(tables, artist)[through] ?? 0;
    return worst === 0 ? undefined : asStanding(worst);
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

/** An Artist found in the tables by their exact name, such as the Spotlit Artist. */
export interface NamedArtist {
    id: ArtistId;
    artist: string;
}

/** A Pinned Artist found in the tables. */
export type PinnedArtist = NamedArtist;

// Each tables object's artist ids by name, built on the first lookup.
const artistIdsMemo = new WeakMap<StandingsTables, ReadonlyMap<string, ArtistId>>();

const indexByName = (tables: StandingsTables): ReadonlyMap<string, ArtistId> =>
    new Map(tables.artists.map((artist, id) => [artist, artistId(id)]));

function artistIdsOf(tables: StandingsTables): ReadonlyMap<string, ArtistId> {
    const known = artistIdsMemo.get(tables);
    if (known) return known;
    const ids = indexByName(tables);
    artistIdsMemo.set(tables, ids);
    return ids;
}

/** The Artist named exactly `name` in `tables`, if there is one. */
export function artistNamed(tables: StandingsTables, name: string): NamedArtist | undefined {
    const id = artistIdsOf(tables).get(name);
    return id === undefined ? undefined : { id, artist: name };
}

/** The pinned names that name an Artist in `tables`, in the order pinned; the rest stay hidden. */
export const resolvePins = (tables: StandingsTables, names: readonly string[]): PinnedArtist[] =>
    names.flatMap((name) => artistNamed(tables, name) ?? []);

/**
 * Up to `limit` Artist names containing `query` in any case, best Standing on `day` first and
 * the unranked last; a blank query matches nobody.
 */
export function searchArtists(
    tables: StandingsTables,
    query: string,
    day: DayIndex,
    limit: number,
): string[] {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    const base = day * tables.artists.length;
    return tables.artists
        .flatMap((artist, id) =>
            artist.toLowerCase().includes(needle)
                ? [{ artist, standing: tables.standing[base + id]! }]
                : [],
        )
        .toSorted((a, b) => a.standing - b.standing || compareNames(a.artist, b.artist))
        .slice(0, limit)
        .map(({ artist }) => artist);
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
