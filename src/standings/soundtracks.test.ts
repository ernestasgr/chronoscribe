import { describe, expect, test } from "vitest";
import type { SoundtrackPick } from "../settings";
import { buildSoundtracks, dayIndex, soundtrackAt, type Soundtracks } from ".";

const uts = (iso: string) => Date.parse(iso) / 1000;
const scrobble = (iso: string, artist: string, track: string) => ({
    uts: uts(iso),
    artist,
    track,
});
/** `count` Scrobbles of one track, a minute apart from `iso`. */
const plays = (count: number, iso: string, artist: string, track: string) =>
    Array.from({ length: count }, (_, i) => ({ uts: uts(iso) + 60 * i, artist, track }));
/** The Soundtrack shown on `day`, as "Song — Artist". */
const shownOn = (soundtracks: Soundtracks, day: number) => {
    const first = soundtrackAt(soundtracks, dayIndex(day))?.tracks[0];
    return first && `${first.track} — ${first.artist}`;
};
const options = (
    windowDays: number,
    pick: SoundtrackPick = "artist",
    today = "2026-07-10T12:00:00Z",
) => ({
    timeZone: "UTC",
    today: uts(today),
    windowDays,
    pick,
});

describe("Windows", () => {
    // 4-Day Windows over 1–10 July: Days 0–3, 4–7, and a shorter 8–9.
    const soundtracks = buildSoundtracks(
        [
            scrobble("2026-07-01T10:00:00Z", "Air", "La Femme d'Argent"),
            scrobble("2026-07-05T10:00:00Z", "Bonobo", "Kerala"),
            scrobble("2026-07-09T10:00:00Z", "Caribou", "Odessa"),
        ],
        options(4),
    );

    test("are back-to-back blocks of x Days from the first Day, the last one shorter", () => {
        expect(
            [0, 3, 4, 7, 8, 9].map((day) => soundtrackAt(soundtracks, dayIndex(day))?.window),
        ).toEqual([0, 0, 1, 1, 2, 2]);
    });

    test("each have the most-played song of their most-played Artist", () => {
        expect([0, 4, 9].map((day) => shownOn(soundtracks, day))).toEqual([
            "La Femme d'Argent — Air",
            "Kerala — Bonobo",
            "Odessa — Caribou",
        ]);
    });

    test("move with the first Day when an earlier Scrobble moves it", () => {
        const moved = buildSoundtracks(
            [
                scrobble("2026-06-30T10:00:00Z", "Zero 7", "Destiny"),
                scrobble("2026-07-01T10:00:00Z", "Air", "La Femme d'Argent"),
                scrobble("2026-07-05T10:00:00Z", "Bonobo", "Kerala"),
            ],
            options(4),
        );
        // 30 June is now Day 0, so 1–3 July share its Window and 4–7 July make the next.
        expect(shownOn(moved, 0)).toBe("Destiny — Zero 7");
        expect(soundtrackAt(moved, dayIndex(5))).toMatchObject({
            window: 1,
            tracks: [{ artist: "Bonobo", track: "Kerala" }],
        });
    });

    test("count Days in the Listener's timezone", () => {
        const vilnius = buildSoundtracks(
            [
                scrobble("2026-07-01T10:00:00Z", "Air", "La Femme d'Argent"),
                // 22:30 UTC is already 2 July in Vilnius, the next 1-Day Window.
                scrobble("2026-07-01T22:30:00Z", "Bonobo", "Kerala"),
            ],
            { ...options(1), timeZone: "Europe/Vilnius" },
        );
        expect([0, 1].map((day) => shownOn(vilnius, day))).toEqual([
            "La Femme d'Argent — Air",
            "Kerala — Bonobo",
        ]);
    });
});

describe("a Window's Soundtrack", () => {
    test("counts all of the Window's Days, not only those up to the Focus Day", () => {
        const soundtracks = buildSoundtracks(
            [
                ...plays(2, "2026-07-01T10:00:00Z", "Air", "Playground Love"),
                ...plays(3, "2026-07-03T10:00:00Z", "Bonobo", "Kerala"),
            ],
            options(4),
        );
        expect(shownOn(soundtracks, 0)).toBe("Kerala — Bonobo");
    });

    test("counts only the Window's own Scrobbles", () => {
        const soundtracks = buildSoundtracks(
            [
                ...plays(5, "2026-07-01T10:00:00Z", "Air", "Playground Love"),
                ...plays(1, "2026-07-05T10:00:00Z", "Air", "Sexy Boy"),
                ...plays(2, "2026-07-05T11:00:00Z", "Bonobo", "Kerala"),
            ],
            options(4),
        );
        expect(shownOn(soundtracks, 4)).toBe("Kerala — Bonobo");
    });

    test("ignores Top X and Pinned Artists, picking from every Artist", () => {
        const soundtracks = buildSoundtracks(
            [
                ...plays(50, "2026-07-01T10:00:00Z", "Air", "Playground Love"),
                ...plays(2, "2026-07-05T10:00:00Z", "Air", "Sexy Boy"),
                ...plays(3, "2026-07-05T11:00:00Z", "Obscure Act", "B-Side"),
            ],
            options(4),
        );
        expect(shownOn(soundtracks, 4)).toBe("B-Side — Obscure Act");
    });

    test("lists the top Artist's top 3 tracks in order, ignoring other Artists' tracks", () => {
        const soundtracks = buildSoundtracks(
            [
                ...plays(4, "2026-07-01T10:00:00Z", "Air", "Sexy Boy"),
                ...plays(3, "2026-07-01T11:00:00Z", "Air", "Kelly Watch the Stars"),
                ...plays(2, "2026-07-01T12:00:00Z", "Air", "All I Need"),
                ...plays(1, "2026-07-01T13:00:00Z", "Air", "Talisman"),
                // Fewer Scrobbles than Air, though more than any one of Air's tracks.
                ...plays(9, "2026-07-01T14:00:00Z", "Bonobo", "Kerala"),
            ],
            options(4),
        );
        expect(soundtrackAt(soundtracks, dayIndex(0))).toEqual({
            window: 0,
            tracks: [
                { artist: "Air", track: "Sexy Boy" },
                { artist: "Air", track: "Kelly Watch the Stars" },
                { artist: "Air", track: "All I Need" },
            ],
        });
    });

    test("counts a track by its exact name, whatever its album", () => {
        const rows = [
            { ...scrobble("2026-07-01T10:00:00Z", "Air", "Sexy Boy"), album: "Moon Safari" },
            { ...scrobble("2026-07-01T11:00:00Z", "Air", "Sexy Boy"), album: "Twentyears" },
            { ...scrobble("2026-07-01T09:00:00Z", "Air", "Talisman"), album: "Moon Safari" },
            { ...scrobble("2026-07-01T12:00:00Z", "Air", "sexy boy"), album: "Moon Safari" },
        ];
        const tracks = soundtrackAt(buildSoundtracks(rows, options(4)), dayIndex(0))?.tracks;
        expect(tracks?.map(({ track }) => track)).toEqual(["Sexy Boy", "Talisman", "sexy boy"]);
    });
});

describe("the track pick", () => {
    // Air's Sexy Boy, Talisman and All I Need tie at 3 Scrobbles, but Bonobo's Kerala has 4.
    const rows = [
        ...plays(3, "2026-07-01T10:00:00Z", "Air", "Sexy Boy"),
        ...plays(3, "2026-07-01T11:00:00Z", "Air", "Talisman"),
        ...plays(3, "2026-07-01T12:00:00Z", "Air", "All I Need"),
        ...plays(4, "2026-07-01T14:00:00Z", "Bonobo", "Kerala"),
    ];

    test("is the most-played track outright, whoever its Artist", () => {
        expect(soundtrackAt(buildSoundtracks(rows, options(4, "track")), dayIndex(0))).toEqual({
            window: 0,
            tracks: [
                { artist: "Bonobo", track: "Kerala" },
                { artist: "Air", track: "Sexy Boy" },
                { artist: "Air", track: "Talisman" },
            ],
        });
    });

    test("is the top Artist's top track under the artist pick, which keeps the Artist's own", () => {
        expect(shownOn(buildSoundtracks(rows, options(4, "artist")), 0)).toBe("Sexy Boy — Air");
    });

    test("keeps a track name apart by its Artist", () => {
        const soundtrack = soundtrackAt(
            buildSoundtracks(
                [
                    ...plays(2, "2026-07-01T10:00:00Z", "Air", "Sexy Boy"),
                    ...plays(2, "2026-07-01T11:00:00Z", "Bonobo", "Sexy Boy"),
                ],
                options(4, "track"),
            ),
            dayIndex(0),
        );
        expect(soundtrack?.tracks).toEqual([
            { artist: "Air", track: "Sexy Boy" },
            { artist: "Bonobo", track: "Sexy Boy" },
        ]);
    });
});

describe("ties", () => {
    test("between Artists go to whoever reached the count first", () => {
        const soundtracks = buildSoundtracks(
            [
                scrobble("2026-07-01T10:00:00Z", "Zero 7", "Destiny"),
                scrobble("2026-07-01T11:00:00Z", "Air", "Sexy Boy"),
                scrobble("2026-07-01T12:00:00Z", "Air", "Sexy Boy"),
                scrobble("2026-07-01T09:00:00Z", "Zero 7", "Destiny"),
            ],
            options(4),
        );
        expect(shownOn(soundtracks, 0)).toBe("Destiny — Zero 7");
    });

    test("between Artists reaching the count in the same second go by name", () => {
        const soundtracks = buildSoundtracks(
            [
                scrobble("2026-07-01T10:00:00Z", "zero 7", "Destiny"),
                scrobble("2026-07-01T10:00:00Z", "Bonobo", "Kerala"),
            ],
            options(4),
        );
        expect(shownOn(soundtracks, 0)).toBe("Kerala — Bonobo");
    });

    test("between tracks go to whichever reached the count first, then by name", () => {
        const soundtracks = buildSoundtracks(
            [
                scrobble("2026-07-01T12:00:00Z", "Air", "Talisman"),
                scrobble("2026-07-01T10:00:00Z", "Air", "Sexy Boy"),
                scrobble("2026-07-01T11:00:00Z", "Air", "Sexy Boy"),
                scrobble("2026-07-01T12:00:00Z", "Air", "All I Need"),
            ],
            options(4),
        );
        const tracks = soundtrackAt(soundtracks, dayIndex(0))?.tracks;
        expect(tracks?.map(({ track }) => track)).toEqual(["Sexy Boy", "All I Need", "Talisman"]);
    });
});

describe("an empty Window", () => {
    // 2-Day Windows: Days 0–1 and 6–7 have Scrobbles, Days 2–5 and 8–9 don't.
    const soundtracks = buildSoundtracks(
        [
            scrobble("2026-07-01T10:00:00Z", "Air", "Sexy Boy"),
            scrobble("2026-07-07T10:00:00Z", "Bonobo", "Kerala"),
        ],
        options(2),
    );

    test("keeps showing the previous Window's Soundtrack, through any run of empty ones", () => {
        expect(
            [0, 2, 5, 6, 9].map((day) => soundtrackAt(soundtracks, dayIndex(day))?.window),
        ).toEqual([0, 0, 0, 3, 3]);
        expect(shownOn(soundtracks, 5)).toBe("Sexy Boy — Air");
    });

    test("has no Soundtrack in a history with no Scrobbles", () => {
        expect(soundtrackAt(buildSoundtracks([], options(2)), dayIndex(0))).toBeUndefined();
    });
});
