import type { ClimbersMode } from "../settings";
import { dailyPlays, rankedCount } from "./queries";
import {
    artistId,
    asStanding,
    dayIndex,
    UNRANKED,
    type ArtistId,
    type DayIndex,
    type Standing,
    type StandingsTables,
} from "./tables";

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
