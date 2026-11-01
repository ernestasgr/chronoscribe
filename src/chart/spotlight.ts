import {
    asStanding,
    dayIndex,
    rankedBetween,
    rankedCount,
    standingAt,
    worstStanding,
    type ArtistId,
    type DayIndex,
    type Standing,
    type StandingsTables,
} from "../standings";
import { logStandingTicks } from "./geometry";

/** The lowest the Spotlight's axis ever stops, so an Artist always at #1 still gets an axis. */
export const SPOTLIGHT_FLOOR = asStanding(10);
/** The share of the plot's height left above #1 and below the bottom. */
const PAD = 0.04;

/**
 * The bottom of the Spotlight's Standing axis: the Spotlit Artist's worst Standing after their
 * debut over the whole history or, with the future hidden, up to the playhead; never above #10.
 */
export function spotlightBottom(
    tables: StandingsTables,
    artist: ArtistId,
    { playhead, hideFuture }: { playhead: number; hideFuture: boolean },
): Standing {
    const last = tables.dayCount - 1;
    const through = hideFuture ? Math.min(last, Math.max(0, Math.floor(playhead))) : last;
    return asStanding(
        Math.max(
            SPOTLIGHT_FLOOR,
            worstStanding(tables, artist, dayIndex(through)) ?? SPOTLIGHT_FLOOR,
        ),
    );
}

/** The Standings the dynamic Spotlight's band shows, from its best to its worst. */
export interface Band {
    best: Standing;
    worst: Standing;
}

/**
 * The dynamic Spotlight's band on `day`: `neighbours` ranks either side of the Spotlit Artist's
 * Standing, stopping at #1. Before their debut it centres just below the Day's last ranked Artist,
 * where they would enter, as a debuting Climber is counted.
 */
export function spotlightBand(
    tables: StandingsTables,
    artist: ArtistId,
    day: DayIndex,
    neighbours: number,
): Band {
    const centre = standingAt(tables, artist, day) ?? rankedCount(tables, day) + 1;
    const best = Math.max(1, centre - neighbours);
    return { best: asStanding(best), worst: asStanding(best + 2 * neighbours) };
}

/**
 * Whose lines the dynamic Spotlight draws on `day`: the Artists inside the band, the Spotlit Artist
 * and their Neighbours, best Standing first, and the Spotlit Artist last while still unranked.
 */
export function spotlitLines(
    tables: StandingsTables,
    artist: ArtistId,
    day: DayIndex,
    neighbours: number,
): ArtistId[] {
    const { best, worst } = spotlightBand(tables, artist, day, neighbours);
    const inBand = rankedBetween(tables, day, best, worst);
    return inBand.includes(artist) ? inBand : [...inBand, artist];
}

/** How many rows the band holds: the Spotlit Artist's and `neighbours` either side. */
export const bandRows = (neighbours: number): number => 2 * neighbours + 1;

/**
 * Where a Standing sits in the band, from 0 at the top of the plot to 1 at the bottom, each
 * Standing centred in its row. `best` is a plain number, as it falls between two Standings while
 * the band eases.
 */
export const bandLevel = (standing: Standing, best: number, neighbours: number): number =>
    (standing - best + 0.5) / bandRows(neighbours);

/** Every Standing whose row centre is inside the band, as the band's axis labels them. */
export function bandStandings(best: number, neighbours: number): Standing[] {
    const first = Math.max(1, Math.ceil(best - 0.5));
    const last = Math.floor(best - 0.5 + bandRows(neighbours));
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => asStanding(first + i));
}

/** Where a Standing sits on the Spotlight's log axis, from 0 at the top of the plot to 1 at the bottom. */
export const spotlightLevel = (standing: Standing, bottom: number): number =>
    PAD + ((1 - 2 * PAD) * Math.log(standing)) / Math.log(bottom);

/** The Standings the Spotlight's axis labels: 1, 2, 5, 10, 20, 50 and so on, then the bottom. */
export const spotlightTicks = (bottom: number): Standing[] => logStandingTicks(Math.round(bottom));
