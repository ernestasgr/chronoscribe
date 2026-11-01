import { unixSeconds, type UnixSeconds } from "../lastfm";
import { dayDate, type ArtistId, type DayIndex, type StandingsTables } from ".";
import { compareNames, DAY_SECONDS, dayIndexer } from "./days";
import { byPlays, tally } from "./tally";

/** A track's Track plays: its Scrobbles within one Day, by exact last.fm name whatever the album. */
export interface TrackPlays {
    track: string;
    plays: number;
}

type TrackScrobble = { uts: number; artist: string; track: string };

/** The furthest any timezone's midnight lies from UTC's, so a widened span holds a whole local Day. */
const MOST_OFFSET_SECONDS = 14 * 3600;

const epochDayOf = (tables: StandingsTables, day: DayIndex): number =>
    Date.parse(dayDate(tables, day)) / 1000 / DAY_SECONDS;

/**
 * Seconds from `from` through `to` that hold every Scrobble of `day` in the tables' timezone,
 * and some either side, for a range read that `trackPlays` then narrows to the Day.
 */
export function daySpan(
    tables: StandingsTables,
    day: DayIndex,
): { from: UnixSeconds; to: UnixSeconds } {
    const start = epochDayOf(tables, day) * DAY_SECONDS;
    return {
        from: unixSeconds(start - MOST_OFFSET_SECONDS),
        to: unixSeconds(start + DAY_SECONDS + MOST_OFFSET_SECONDS),
    };
}

/**
 * An Artist's Track plays on `day`, counted from `scrobbles` (any that fall outside the Day or
 * belong to other Artists are skipped), most first, ties broken as Standings break them.
 */
export function trackPlays(
    tables: StandingsTables,
    day: DayIndex,
    artist: ArtistId,
    scrobbles: readonly TrackScrobble[],
): TrackPlays[] {
    const name = tables.artists[artist];
    const epochDay = epochDayOf(tables, day);
    const dayOf = dayIndexer(tables.firstDay.timeZone);
    const theirs = scrobbles.filter((row) => row.artist === name && dayOf(row.uts) === epochDay);
    return tally(
        theirs,
        (row) => row.track,
        (row) => row.track,
    )
        .toSorted(byPlays(compareNames))
        .map(({ item, count }) => ({ track: item, plays: count }));
}
