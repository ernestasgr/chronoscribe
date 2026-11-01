import { describe, expect, test } from "vitest";
import { artistId, buildStandings, dayIndex, daySpan, trackPlays, type StandingsTables } from ".";

const uts = (iso: string) => Date.parse(iso) / 1000;
const scrobble = (iso: string, artist: string, track: string) => ({
    uts: uts(iso),
    artist,
    track,
});
const idOf = (tables: StandingsTables, name: string) => artistId(tables.artists.indexOf(name));

describe("trackPlays", () => {
    const timeZone = "Europe/Vilnius"; // UTC+3 in summer
    const history = [
        scrobble("2026-07-01T09:00:00Z", "Portishead", "Roads"),
        scrobble("2026-07-01T10:00:00Z", "Portishead", "Glory Box"),
        scrobble("2026-07-01T10:05:00Z", "Massive Attack", "Teardrop"),
        scrobble("2026-07-01T11:00:00Z", "Portishead", "Roads"),
        scrobble("2026-07-01T12:00:00Z", "Portishead", "Sour Times"),
        scrobble("2026-07-01T13:00:00Z", "Portishead", "Glory Box"),
        // 22:30 UTC is already 2 July in Vilnius
        scrobble("2026-07-01T22:30:00Z", "Portishead", "Roads"),
        scrobble("2026-07-02T09:00:00Z", "Portishead", "Sour Times"),
    ];
    const tables = buildStandings(history, { timeZone, today: uts("2026-07-03T12:00:00Z") });
    const portishead = idOf(tables, "Portishead");

    test("counts an Artist's Scrobbles of each track on a Day in the Listener's timezone, most first", () => {
        expect(trackPlays(tables, dayIndex(0), portishead, history)).toEqual([
            { track: "Roads", plays: 2 },
            { track: "Glory Box", plays: 2 },
            { track: "Sour Times", plays: 1 },
        ]);
        expect(trackPlays(tables, dayIndex(1), portishead, history)).toEqual([
            { track: "Roads", plays: 1 },
            { track: "Sour Times", plays: 1 },
        ]);
    });

    test("breaks ties as Standings do: whichever reached its count first, then by name", () => {
        const sameSecond = [
            scrobble("2026-07-01T09:00:00Z", "Portishead", "b"),
            scrobble("2026-07-01T09:00:00Z", "Portishead", "A"),
            scrobble("2026-07-01T08:00:00Z", "Portishead", "c"),
        ];
        expect(
            trackPlays(tables, dayIndex(0), portishead, sameSecond).map(({ track }) => track),
        ).toEqual(["c", "A", "b"]);
    });

    test("groups a track by its exact name, whatever the album", () => {
        const albums = [
            { ...scrobble("2026-07-01T09:00:00Z", "Portishead", "Roads"), album: "Dummy" },
            { ...scrobble("2026-07-01T10:00:00Z", "Portishead", "Roads"), album: "Roseland NYC" },
            { ...scrobble("2026-07-01T11:00:00Z", "Portishead", "roads"), album: "Dummy" },
        ];
        expect(trackPlays(tables, dayIndex(0), portishead, albums)).toEqual([
            { track: "Roads", plays: 2 },
            { track: "roads", plays: 1 },
        ]);
    });

    test("is empty on a Day the Artist has no Scrobbles", () => {
        expect(trackPlays(tables, dayIndex(2), portishead, history)).toEqual([]);
    });

    test("the Day's span holds every second of the Day in its timezone", () => {
        const { from, to } = daySpan(tables, dayIndex(1));
        // 2 July in Vilnius runs from 1 July 21:00 UTC to 2 July 20:59:59 UTC.
        expect(from).toBeLessThanOrEqual(uts("2026-07-01T21:00:00Z"));
        expect(to).toBeGreaterThanOrEqual(uts("2026-07-02T20:59:59Z"));
        expect(to - from).toBeLessThan(3 * 86_400);
    });
});
