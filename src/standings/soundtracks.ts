import type { SoundtrackPick } from "../settings";
import type { DayIndex } from ".";
import { compareNames, dayIndexer, historyDays } from "./days";
import { byPlays, tally, type Tally } from "./tally";

/** A Window's place in the history: Window n holds Days n·x through n·x + x − 1. */
export type WindowIndex = number & { readonly brand: "WindowIndex" };

/** Brands a whole number of Windows since the history's first Day. */
export const windowIndex = (index: number): WindowIndex => index as WindowIndex;

/** A track by its Artist, as last.fm names them. */
export interface SoundtrackTrack {
    artist: string;
    track: string;
}

/** A Window's Soundtrack: its most-played tracks, the first played and the rest as fallbacks. */
export interface Soundtrack {
    /** The Window whose Scrobbles chose it. */
    window: WindowIndex;
    /** The Soundtrack first, then fallbacks, best first. */
    tracks: readonly SoundtrackTrack[];
}

export interface Soundtracks {
    /** How many Days each Window holds. */
    windowDays: number;
    /** For each Window, the Soundtrack shown during it: its own, or after an empty Window the last one before. */
    shown: readonly (Soundtrack | undefined)[];
}

/** How many tracks a Soundtrack lists, so later steps have fallbacks. */
const CANDIDATE_TRACKS = 3;

type SoundtrackScrobble = { uts: number; artist: string; track: string };

/** The `limit` most-played items, best first. */
const mostPlayed = <T>(
    tallies: Tally<T>[],
    compare: (a: Tally<T>, b: Tally<T>) => number,
    limit: number,
): T[] =>
    tallies
        .toSorted(compare)
        .slice(0, limit)
        .map(({ item }) => item);

/** The most-played item, found in one pass rather than by sorting them all. */
const top = <T>(
    tallies: Tally<T>[],
    compare: (a: Tally<T>, b: Tally<T>) => number,
): T | undefined =>
    tallies.reduce<Tally<T> | undefined>(
        (best, entry) => (best && compare(best, entry) <= 0 ? best : entry),
        undefined,
    )?.item;

const byTrackName = (a: SoundtrackTrack, b: SoundtrackTrack): number =>
    compareNames(a.track, b.track) || compareNames(a.artist, b.artist);

/** The most-played tracks of the Window's most-played Artist, each by that Artist. */
const topArtistsTracks = (scrobbles: readonly SoundtrackScrobble[]): SoundtrackTrack[] => {
    const artist = top(
        tally(
            scrobbles,
            (scrobble) => scrobble.artist,
            (scrobble) => scrobble.artist,
        ),
        byPlays(compareNames),
    );
    if (artist === undefined) return [];
    const theirs = scrobbles.filter((scrobble) => scrobble.artist === artist);
    return mostPlayed(
        tally(
            theirs,
            (scrobble) => scrobble.track,
            (scrobble) => scrobble.track,
        ),
        byPlays(compareNames),
        CANDIDATE_TRACKS,
    ).map((track) => ({ artist, track }));
};

/** The most-played tracks of the Window, whoever their Artist. */
const topTracks = (scrobbles: readonly SoundtrackScrobble[]): SoundtrackTrack[] =>
    mostPlayed(
        tally(
            scrobbles,
            // The JSON keeps an Artist and a track apart whatever characters their names hold.
            ({ artist, track }) => JSON.stringify([artist, track]),
            ({ artist, track }) => ({ artist, track }),
        ),
        byPlays(byTrackName),
        CANDIDATE_TRACKS,
    );

/** The Soundtrack chosen by a non-empty Window's Scrobbles, by `pick`. */
function soundtrackOf(
    window: WindowIndex,
    scrobbles: readonly SoundtrackScrobble[],
    pick: SoundtrackPick,
): Soundtrack {
    const tracks = pick === "track" ? topTracks(scrobbles) : topArtistsTracks(scrobbles);
    if (tracks.length === 0) throw new Error(`Window ${window} has no Scrobbles to pick from`);
    return { window, tracks };
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
 * one possibly shorter, and picks each Window's Soundtrack from all of its Scrobbles, by `pick`.
 * Days are counted in `timeZone` through `today`, as `buildStandings` counts them.
 */
export function buildSoundtracks(
    scrobbles: Iterable<SoundtrackScrobble>,
    {
        timeZone,
        today,
        windowDays,
        pick,
    }: { timeZone: string; today: number; windowDays: number; pick: SoundtrackPick },
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
        inWindow.length > 0 ? soundtrackOf(windowIndex(i), inWindow, pick) : undefined,
    );
    return { windowDays, shown: carriedForward(own) };
}

/** The Window holding `day`; a Day past the history counts as in the last Window. */
export const windowAt = (soundtracks: Soundtracks, day: DayIndex): WindowIndex =>
    windowIndex(Math.min(Math.floor(day / soundtracks.windowDays), soundtracks.shown.length - 1));

/** The Soundtrack shown on `day`: its Window's, or the last one before an empty Window. */
export const soundtrackAt = (soundtracks: Soundtracks, day: DayIndex): Soundtrack | undefined =>
    soundtracks.shown[windowAt(soundtracks, day)];
