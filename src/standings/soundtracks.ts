import type { DayIndex } from ".";
import { compareNames, dayIndexer, historyDays } from "./days";

/** A Window's place in the history: Window n holds Days n·x through n·x + x − 1. */
export type WindowIndex = number & { readonly brand: "WindowIndex" };

/** Brands a whole number of Windows since the history's first Day. */
export const windowIndex = (index: number): WindowIndex => index as WindowIndex;

/** A Window's Soundtrack: its most-played Artist and their most-played tracks. */
export interface Soundtrack {
    /** The Window whose Scrobbles chose it. */
    window: WindowIndex;
    artist: string;
    /** The Artist's most-played track names in that Window, best first: the Soundtrack, then fallbacks. */
    tracks: readonly string[];
}

export interface Soundtracks {
    /** How many Days each Window holds. */
    windowDays: number;
    /** For each Window, the Soundtrack shown during it: its own, or after an empty Window the last one before. */
    shown: readonly (Soundtrack | undefined)[];
}

/** How many tracks a Soundtrack lists, so later steps have fallbacks. */
const CANDIDATE_TRACKS = 3;

interface Tally {
    count: number;
    /** The second the name reached its count; ties in count go to the earlier one. */
    reachedAt: number;
}

type SoundtrackScrobble = { uts: number; artist: string; track: string };

/** Each name's Scrobble count among `scrobbles`, with when it reached that count. */
function tally(
    scrobbles: readonly SoundtrackScrobble[],
    nameOf: (scrobble: SoundtrackScrobble) => string,
): Map<string, Tally> {
    // A hot loop over every Scrobble, so it updates the tallies it owns in place.
    const tallies = new Map<string, Tally>();
    for (const scrobble of scrobbles) {
        const name = nameOf(scrobble);
        const known = tallies.get(name);
        if (!known) tallies.set(name, { count: 1, reachedAt: scrobble.uts });
        else {
            known.count++;
            known.reachedAt = Math.max(known.reachedAt, scrobble.uts);
        }
    }
    return tallies;
}

/** Orders as Standings do: more Scrobbles first, then whoever reached the count first, then name. */
const byPlays = ([nameA, a]: [string, Tally], [nameB, b]: [string, Tally]): number =>
    b.count - a.count || a.reachedAt - b.reachedAt || compareNames(nameA, nameB);

/** The `limit` most-played names, best first. */
const mostPlayed = (tallies: Map<string, Tally>, limit: number): string[] =>
    [...tallies]
        .toSorted(byPlays)
        .slice(0, limit)
        .map(([name]) => name);

/** The most-played name, found in one pass rather than by sorting them all. */
const top = (tallies: Map<string, Tally>): string | undefined =>
    [...tallies].reduce<[string, Tally] | undefined>(
        (best, entry) => (best && byPlays(best, entry) <= 0 ? best : entry),
        undefined,
    )?.[0];

/** The Soundtrack chosen by a non-empty Window's Scrobbles. */
function soundtrackOf(window: WindowIndex, scrobbles: readonly SoundtrackScrobble[]): Soundtrack {
    const artist = top(tally(scrobbles, (scrobble) => scrobble.artist));
    if (artist === undefined) throw new Error(`Window ${window} has no Scrobbles to pick from`);
    const theirs = scrobbles.filter((scrobble) => scrobble.artist === artist);
    const tracks = mostPlayed(
        tally(theirs, (scrobble) => scrobble.track),
        CANDIDATE_TRACKS,
    );
    return { window, artist, tracks };
}

/** Each Soundtrack, or the last one before it where there is none. */
const carriedForward = (own: readonly (Soundtrack | undefined)[]): (Soundtrack | undefined)[] =>
    own.reduce<(Soundtrack | undefined)[]>((shown, soundtrack, i) => {
        shown[i] = soundtrack ?? shown[i - 1];
        return shown;
    }, []);

/** The first and last seconds scrobbled, if any; folded, as a spread would overflow the stack. */
const scrobbledSpan = (rows: readonly SoundtrackScrobble[]) =>
    rows.reduce<{ first: number; last: number } | undefined>(
        (span, { uts }) =>
            span
                ? { first: Math.min(span.first, uts), last: Math.max(span.last, uts) }
                : { first: uts, last: uts },
        undefined,
    );

/**
 * Cuts the history into back-to-back Windows of `windowDays` Days from its first Day, the last
 * one possibly shorter, and picks each Window's Soundtrack from all of its Scrobbles. Days are
 * counted in `timeZone` through `today`, as `buildStandings` counts them.
 */
export function buildSoundtracks(
    scrobbles: Iterable<SoundtrackScrobble>,
    { timeZone, today, windowDays }: { timeZone: string; today: number; windowDays: number },
): Soundtracks {
    const rows = Array.from(scrobbles);
    const epochDayOf = dayIndexer(timeZone);
    const { firstEpochDay, dayCount } = historyDays(epochDayOf, scrobbledSpan(rows), today);
    const windows: SoundtrackScrobble[][] = Array.from(
        { length: Math.ceil(dayCount / windowDays) },
        () => [],
    );
    for (const row of rows)
        windows[Math.floor((epochDayOf(row.uts) - firstEpochDay) / windowDays)]?.push(row);
    const own = windows.map((inWindow, i) =>
        inWindow.length > 0 ? soundtrackOf(windowIndex(i), inWindow) : undefined,
    );
    return { windowDays, shown: carriedForward(own) };
}

/** The Soundtrack shown on `day`: its Window's, or the last one before an empty Window. */
export const soundtrackAt = (soundtracks: Soundtracks, day: DayIndex): Soundtrack | undefined =>
    soundtracks.shown[
        Math.min(Math.floor(day / soundtracks.windowDays), soundtracks.shown.length - 1)
    ];
