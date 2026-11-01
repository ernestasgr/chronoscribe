export interface Tally<T> {
    item: T;
    count: number;
    /** The second the item reached its count; ties in count go to the earlier one. */
    reachedAt: number;
}

/** Each distinct item's Scrobble count among `scrobbles`, with when it reached that count. */
export function tally<S extends { uts: number }, T>(
    scrobbles: readonly S[],
    keyOf: (scrobble: S) => string,
    itemOf: (scrobble: S) => T,
): Tally<T>[] {
    // A hot loop over every Scrobble, so it updates the tallies it owns in place.
    const tallies = new Map<string, Tally<T>>();
    for (const scrobble of scrobbles) {
        const key = keyOf(scrobble);
        const known = tallies.get(key);
        if (!known) tallies.set(key, { item: itemOf(scrobble), count: 1, reachedAt: scrobble.uts });
        else {
            known.count++;
            known.reachedAt = Math.max(known.reachedAt, scrobble.uts);
        }
    }
    return [...tallies.values()];
}

/** Orders as Standings do: more Scrobbles first, then whoever reached the count first, then by name. */
export const byPlays =
    <T>(compareItems: (a: T, b: T) => number) =>
    (a: Tally<T>, b: Tally<T>): number =>
        b.count - a.count || a.reachedAt - b.reachedAt || compareItems(a.item, b.item);
