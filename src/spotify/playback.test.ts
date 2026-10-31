import { describe, expect, test } from "vitest";
import { firstMatch, searchQueries, startPosition } from ".";

const item = (artists: string[], uri = `spotify:track:${artists.join("-")}`) => ({
    uri,
    duration_ms: 200_000,
    artists: artists.map((name) => ({ name })),
});

describe("a search result matches", () => {
    test("the first track whose artist is the last.fm Artist, ignoring case and accents", () => {
        const items = [item(["Portishead Tribute"]), item(["BJÖRK"], "first"), item(["Björk"])];
        expect(firstMatch(items, "Bjork")).toEqual({ uri: "first", durationMs: 200_000 });
    });

    test("when any of the track's artists is the Artist", () => {
        expect(firstMatch([item(["Massive Attack", "Tracey Thorn"], "x")], "tracey thorn")).toEqual(
            { uri: "x", durationMs: 200_000 },
        );
    });

    test("nothing when no track's artist is the Artist, whatever the titles", () => {
        expect(firstMatch([item(["Tricky"]), null], "Portishead")).toBeUndefined();
    });
});

describe("the searches for a track", () => {
    test("go by field first, then plain, without quotes the field search can't hold", () => {
        expect(searchQueries({ artist: "Sigur Rós", track: 'Svefn-g-"englar"' })).toEqual([
            'track:"Svefn-g-englar" artist:"Sigur Rós"',
            'Sigur Rós Svefn-g-"englar"',
        ]);
    });
});

describe("a Soundtrack starts", () => {
    test.each([
        [240_000, 30_000],
        [90_000, 30_000],
        [60_000, 20_000],
        [10_000, 3_333],
    ])("on a %i ms track at %i ms: 30 s in, or a third of a short one", (duration, position) => {
        expect(startPosition(duration)).toBe(position);
    });
});
