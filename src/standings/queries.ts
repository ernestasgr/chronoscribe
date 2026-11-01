import {
    artistId,
    asStanding,
    UNRANKED,
    type ArtistId,
    type DayIndex,
    type Standing,
    type StandingsTables,
} from "./tables";

export interface TopXRow {
    id: ArtistId;
    artist: string;
    standing: Standing;
    cumulative: number;
}

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
