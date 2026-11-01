import { dayIndex, worstStanding, type ArtistId, type StandingsTables } from "../standings";
import { logStandingTicks } from "./geometry";

/** The lowest the Spotlight's axis ever stops, so an Artist always at #1 still gets an axis. */
export const SPOTLIGHT_FLOOR = 10;
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
): number {
    const last = tables.dayCount - 1;
    const through = hideFuture ? Math.min(last, Math.max(0, Math.floor(playhead))) : last;
    return Math.max(
        SPOTLIGHT_FLOOR,
        worstStanding(tables, artist, dayIndex(through)) ?? SPOTLIGHT_FLOOR,
    );
}

/** Where a Standing sits on the Spotlight's log axis, from 0 at the top of the plot to 1 at the bottom. */
export const spotlightLevel = (standing: number, bottom: number): number =>
    PAD + ((1 - 2 * PAD) * Math.log(standing)) / Math.log(bottom);

/** The Standings the Spotlight's axis labels: 1, 2, 5, 10, 20, 50 and so on, then the bottom. */
export const spotlightTicks = (bottom: number): number[] => logStandingTicks(Math.round(bottom));
