import { describe, expect, test } from "vitest";
import { artistNamed, buildStandings, dayIndex, type StandingsTables } from "../standings";
import {
    spotlightBand,
    spotlightBottom,
    spotlightLevel,
    spotlightTicks,
    spotlitLines,
} from "./spotlight";

const at = (iso: string) => Date.parse(iso) / 1000;
const plays = (artist: string, count: number, iso: string) =>
    Array.from({ length: count }, (_, i) => ({ uts: at(iso) + i, artist }));
const pad = (i: number) => String(i).padStart(2, "0");

// 1 July: Top leads, Act 01–12 follow on 12 down to 1 Scrobble each.
// 2 July: Late debuts last, at #14. 3 July: twenty New Artists pass Late, down to #34.
// 4 July: Late takes #1.
const tables: StandingsTables = buildStandings(
    [
        ...plays("Top", 10_000, "2026-07-01T08:00:00Z"),
        ...Array.from({ length: 12 }, (_, i) =>
            plays(`Act ${pad(i + 1)}`, 12 - i, `2026-07-01T10:${pad(i)}:00Z`),
        ).flat(),
        ...plays("Late", 1, "2026-07-02T08:00:00Z"),
        ...Array.from({ length: 20 }, (_, i) =>
            plays(`New ${pad(i + 1)}`, 50, `2026-07-03T08:${pad(i)}:00Z`),
        ).flat(),
        ...plays("Late", 5_000, "2026-07-04T08:00:00Z"),
    ],
    { timeZone: "UTC", today: at("2026-07-04T12:00:00Z") },
);

const idOf = (name: string) => {
    const found = artistNamed(tables, name);
    if (!found) throw new Error(`No Artist named ${name}`);
    return found.id;
};

describe("spotlightBottom", () => {
    test("reaches the worst Standing after the debut over the whole history", () => {
        expect(spotlightBottom(tables, idOf("Late"), { playhead: 0, hideFuture: false })).toBe(34);
    });

    test("with the future hidden, reaches only the worst Standing up to the playhead", () => {
        const late = idOf("Late");
        expect(spotlightBottom(tables, late, { playhead: 1, hideFuture: true })).toBe(14);
        expect(spotlightBottom(tables, late, { playhead: 1.9, hideFuture: true })).toBe(14);
        expect(spotlightBottom(tables, late, { playhead: 2, hideFuture: true })).toBe(34);
        expect(spotlightBottom(tables, late, { playhead: 3, hideFuture: true })).toBe(34);
    });

    test("is never above #10, so an Artist always at #1 still gets an axis", () => {
        expect(spotlightBottom(tables, idOf("Top"), { playhead: 3, hideFuture: false })).toBe(10);
    });

    test("is #10 before the debut, with the future hidden", () => {
        expect(spotlightBottom(tables, idOf("Late"), { playhead: 0, hideFuture: true })).toBe(10);
    });
});

describe("spotlightTicks", () => {
    test("label #1, 2, 5, 10, 20, 50, 100 and so on, down to the bottom", () => {
        expect(spotlightTicks(10)).toEqual([1, 2, 5, 10]);
        expect(spotlightTicks(34)).toEqual([1, 2, 5, 10, 20, 34]);
        expect(spotlightTicks(100)).toEqual([1, 2, 5, 10, 20, 50, 100]);
        expect(spotlightTicks(1234)).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 1234]);
    });

    test("end on the nearest Standing while the bottom eases between two", () => {
        expect(spotlightTicks(33.6)).toEqual([1, 2, 5, 10, 20, 34]);
    });
});

describe("spotlightBand", () => {
    test("centres on the Spotlit Artist's Standing, Neighbours ranks either side", () => {
        // 3 July: Late is #34.
        expect(spotlightBand(tables, idOf("Late"), dayIndex(2), 5)).toEqual({
            best: 29,
            worst: 39,
        });
    });

    test("stops at #1, leaving the Spotlit Artist off-centre near the top", () => {
        // 4 July: Late is #2, behind Top.
        expect(spotlightBand(tables, idOf("Late"), dayIndex(3), 5)).toEqual({ best: 1, worst: 11 });
        expect(spotlightBand(tables, idOf("Top"), dayIndex(3), 2)).toEqual({ best: 1, worst: 5 });
    });

    test("before the debut, centres just below the last ranked Artist that Day", () => {
        // 1 July: Top and Act 01–12 hold #1–#13, so Late would enter at #14.
        expect(spotlightBand(tables, idOf("Late"), dayIndex(0), 5)).toEqual({ best: 9, worst: 19 });
    });
});

/** The names of whose lines the dynamic Spotlight on `artist` draws on `day`. */
const linesNamed = (artist: string, day: number, neighbours: number) =>
    spotlitLines(tables, idOf(artist), dayIndex(day), neighbours).map((id) => tables.artists[id]);

describe("spotlitLines", () => {
    test("are the Spotlit Artist and the Neighbours inside the band, best Standing first", () => {
        // 3 July: Act 01–12 hold #22–#33, so Act 06 at #27 has Act 04–08 within two ranks.
        expect(linesNamed("Act 06", 2, 2)).toEqual([
            "Act 04",
            "Act 05",
            "Act 06",
            "Act 07",
            "Act 08",
        ]);
    });

    test("near the top, are the band from #1 down", () => {
        expect(linesNamed("Top", 0, 1)).toEqual(["Top", "Act 01", "Act 02"]);
    });

    test("leave out the band's unfilled ranks below the last ranked Artist", () => {
        // 2 July: Late is last, at #14.
        expect(linesNamed("Late", 1, 2)).toEqual(["Act 11", "Act 12", "Late"]);
    });

    test("before the debut, are the last ranked Artists and the Spotlit Artist", () => {
        expect(linesNamed("Late", 0, 2)).toEqual(["Act 11", "Act 12", "Late"]);
    });
});

describe("spotlightLevel", () => {
    test("puts #1 near the top and the bottom near the bottom, on a log scale", () => {
        expect(spotlightLevel(1, 34)).toBeGreaterThan(0);
        expect(spotlightLevel(1, 34)).toBeLessThan(0.1);
        expect(spotlightLevel(34, 34)).toBeGreaterThan(0.9);
        expect(spotlightLevel(34, 34)).toBeLessThan(1);
        // Each tenfold of Standing takes the same height.
        expect(spotlightLevel(10, 1000) - spotlightLevel(1, 1000)).toBeCloseTo(
            spotlightLevel(100, 1000) - spotlightLevel(10, 1000),
        );
    });
});
