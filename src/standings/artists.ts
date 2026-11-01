import { compareNames } from "./days";
import { artistId, UNRANKED, type ArtistId, type DayIndex, type StandingsTables } from "./tables";

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
                ? [{ artist, standing: tables.standing[base + id] ?? UNRANKED }]
                : [],
        )
        .toSorted((a, b) => a.standing - b.standing || compareNames(a.artist, b.artist))
        .slice(0, limit)
        .map(({ artist }) => artist);
}
