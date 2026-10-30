import { describe, expect, test } from "vitest";
import {
    buildStandings,
    climbers,
    dailyPlays,
    dayDate,
    dayScrobbles,
    daysOutsideTopX,
    drawnLines,
    resolvePins,
    searchArtists,
    topX,
    valueAt,
    type StandingsTables,
} from ".";
import type { LinesRule } from "../settings";

const uts = (iso: string) => Date.parse(iso) / 1000;
const scrobble = (iso: string, artist: string) => ({ uts: uts(iso), artist });
const pad = (i: number) => String(i).padStart(2, "0");
const artists = (rows: { artist: string }[] | undefined) => rows?.map((row) => row.artist);
const names = (tables: StandingsTables, day: number) => artists(topX(tables, day, 10));

describe("buildStandings", () => {
    const timeZone = "Europe/Vilnius"; // UTC+3 in summer
    const tables = buildStandings(
        [
            scrobble("2026-07-01T10:00:00Z", "Massive Attack"),
            scrobble("2026-07-01T11:00:00Z", "Portishead"),
            scrobble("2026-07-01T12:00:00Z", "Portishead"),
            // 22:30 UTC is already 2 July in Vilnius
            scrobble("2026-07-01T22:30:00Z", "Massive Attack"),
            scrobble("2026-07-02T09:00:00Z", "Tricky"),
        ],
        { timeZone, today: uts("2026-07-04T12:00:00Z") },
    );
    const [massiveAttack, portishead, tricky] = ["Massive Attack", "Portishead", "Tricky"].map(
        (name) => tables.artists.indexOf(name),
    ) as [number, number, number];

    test("Days run from the first Scrobble's Day through today in the Listener's timezone", () => {
        expect(tables.dayCount).toBe(4);
        expect(tables.firstDay).toEqual({ date: "2026-07-01", timeZone });
        expect(dayDate(tables, 0)).toBe("2026-07-01");
        expect(dayDate(tables, 3)).toBe("2026-07-04");
    });

    test("Top X lists Artists by cumulative Scrobbles through the end of the Day", () => {
        expect(topX(tables, 0, 10)).toMatchObject([
            { artist: "Portishead", standing: 1, cumulative: 2 },
            { artist: "Massive Attack", standing: 2, cumulative: 1 },
        ]);
    });

    test("equal counts go to the Artist who reached that count first", () => {
        expect(topX(tables, 1, 10)).toMatchObject([
            { artist: "Portishead", standing: 1, cumulative: 2 },
            { artist: "Massive Attack", standing: 2, cumulative: 2 },
            { artist: "Tricky", standing: 3, cumulative: 1 },
        ]);
    });

    test("Top X is cut at X", () => {
        expect(topX(tables, 1, 1)).toMatchObject([
            { artist: "Portishead", standing: 1, cumulative: 2 },
        ]);
    });

    test("empty Days carry Standings forward", () => {
        expect(topX(tables, 3, 10)).toEqual(topX(tables, 1, 10));
    });

    test("an Artist is unranked before their first Scrobble", () => {
        expect(topX(tables, 0, 10).map((row) => row.artist)).not.toContain("Tricky");
        expect(valueAt(tables, tricky, 0, "standing")).toBeUndefined();
        expect(valueAt(tables, tricky, 0, "scrobbles")).toBe(0);
    });

    test("valueAt reads an Artist's Standing or cumulative Scrobbles on a Day", () => {
        expect(valueAt(tables, tricky, 1, "standing")).toBe(3);
        expect(valueAt(tables, tricky, 3, "standing")).toBe(3);
        expect(valueAt(tables, portishead, 3, "scrobbles")).toBe(2);
    });

    test("Daily plays count an Artist's Scrobbles within one Day", () => {
        expect(dailyPlays(tables, 0, portishead)).toBe(2);
        expect(dailyPlays(tables, 1, massiveAttack)).toBe(1);
        expect(dailyPlays(tables, 1, portishead)).toBe(0);
        expect(dailyPlays(tables, 2, tricky)).toBe(0);
    });

    test("a Day's Scrobbles total every Artist's Daily plays", () => {
        expect([0, 1, 2, 3].map((day) => dayScrobbles(tables, day))).toEqual([3, 2, 0, 0]);
    });
});

describe("ties", () => {
    const options = { timeZone: "UTC", today: uts("2026-07-01T23:00:00Z") };

    test("equal counts reached a second apart go to the earlier one", () => {
        const tables = buildStandings(
            [scrobble("2026-07-01T10:00:01Z", "Air"), scrobble("2026-07-01T10:00:00Z", "Zero 7")],
            options,
        );
        expect(names(tables, 0)).toEqual(["Zero 7", "Air"]);
    });

    test("equal counts reached in the same second go by name, case-insensitively", () => {
        const tables = buildStandings(
            [
                scrobble("2026-07-01T10:00:00Z", "zero 7"),
                scrobble("2026-07-01T10:00:00Z", "Bonobo"),
                scrobble("2026-07-01T10:00:00Z", "air"),
            ],
            options,
        );
        expect(names(tables, 0)).toEqual(["air", "Bonobo", "zero 7"]);
    });

    test("names equal but for case go case-sensitively", () => {
        const tables = buildStandings(
            [scrobble("2026-07-01T10:00:00Z", "abba"), scrobble("2026-07-01T10:00:00Z", "ABBA")],
            options,
        );
        expect(names(tables, 0)).toEqual(["ABBA", "abba"]);
    });

    test("the tie is decided by the Scrobble that reached the count, not the first one", () => {
        const tables = buildStandings(
            [
                scrobble("2026-07-01T08:00:00Z", "Air"),
                scrobble("2026-07-01T09:00:00Z", "Zero 7"),
                scrobble("2026-07-01T10:00:00Z", "Zero 7"),
                scrobble("2026-07-01T11:00:00Z", "Air"),
            ],
            options,
        );
        expect(names(tables, 0)).toEqual(["Zero 7", "Air"]);
    });
});

/** `count` Scrobbles of `artist`, a second apart from `startIso`. */
const scrobblesOf = (artist: string, count: number, startIso: string) =>
    Array.from({ length: count }, (_, i) => ({ uts: uts(startIso) + i, artist }));

describe("Climbers", () => {
    const tables = buildStandings(
        [
            // 1 July: A 3, B 2, C 1
            ...scrobblesOf("A", 3, "2026-07-01T08:00:00Z"),
            ...scrobblesOf("B", 2, "2026-07-01T09:00:00Z"),
            ...scrobblesOf("C", 1, "2026-07-01T10:00:00Z"),
            // 2 July: C rises to #1; D debuts level with A but reaches 3 later; E debuts last
            ...scrobblesOf("C", 3, "2026-07-02T08:00:00Z"),
            ...scrobblesOf("D", 3, "2026-07-02T09:00:00Z"),
            ...scrobblesOf("E", 1, "2026-07-02T10:00:00Z"),
        ],
        { timeZone: "UTC", today: uts("2026-07-03T12:00:00Z") },
    );

    test("are ranked by positions gained since the previous Day", () => {
        expect(climbers(tables, 1, "all", 10).listed).toMatchObject([
            { artist: "C", standing: 1, previous: 3, gain: 2, debut: false, dailyPlays: 3 },
            { artist: "D", standing: 3, gain: 1, debut: true, dailyPlays: 3 },
        ]);
    });

    test("a debut climbs from just below the previous Day's last ranked Artist", () => {
        // Three were ranked on 1 July, so D debuting at #3 gains 4 − 3, and E at #5 gains nothing.
        const debut = climbers(tables, 1, "all", 10).listed.find((row) => row.artist === "D");
        expect(debut).toMatchObject({ gain: 1, debut: true });
        expect(debut?.previous).toBeUndefined();
    });

    test("a Day without Scrobbles has no Climbers", () => {
        expect(climbers(tables, 2, "all", 10).listed).toEqual([]);
    });

    test("the first Day has no Climbers", () => {
        expect(climbers(tables, 0, "all", 10).listed).toEqual([]);
    });
});

describe("Climbers modes", () => {
    const tables = buildStandings(
        [
            // 1 July: Big 00–54 hold #1–#55 on 3 Scrobbles each; Tail 00–09 hold #56–#65 on 1 each
            ...Array.from({ length: 55 }, (_, i) =>
                scrobblesOf(`Big ${pad(i)}`, 3, `2026-07-01T08:${pad(i)}:00Z`),
            ).flat(),
            ...Array.from({ length: 10 }, (_, i) =>
                scrobblesOf(`Tail ${pad(i)}`, 1, `2026-07-01T10:${pad(i)}:00Z`),
            ).flat(),
            // 2 July: Big 54 jumps to #1; Tail 08 (two Scrobbles) and Tail 09 (one) jump within the tail
            ...scrobblesOf("Big 54", 2, "2026-07-02T08:00:00Z"),
            ...scrobblesOf("Tail 08", 2, "2026-07-02T09:00:00Z"),
            ...scrobblesOf("Tail 09", 1, "2026-07-02T10:00:00Z"),
        ],
        { timeZone: "UTC", today: uts("2026-07-02T12:00:00Z") },
    );

    test("all (raw) lists every Climber", () => {
        const report = climbers(tables, 1, "all", 10);
        expect(report.listed).toMatchObject([
            { artist: "Big 54", standing: 1, gain: 54 },
            { artist: "Tail 08", standing: 56, gain: 8, dailyPlays: 2 },
            { artist: "Tail 09", standing: 57, gain: 8, dailyPlays: 1 },
        ]);
        expect(report.folded).toBeUndefined();
    });

    test("within Top max(50, 5X) drops Climbers finishing beyond it", () => {
        const report = climbers(tables, 1, "within", 10);
        expect(artists(report.listed)).toEqual(["Big 54"]);
        expect(report.folded).toBeUndefined();
        expect(artists(climbers(tables, 1, "within", 12).listed)).toEqual([
            "Big 54",
            "Tail 08",
            "Tail 09",
        ]);
    });

    test("fold long tail folds Climbers beyond Top max(50, 5X) into a summary", () => {
        const report = climbers(tables, 1, "fold", 10);
        expect(artists(report.listed)).toEqual(["Big 54"]);
        expect(report.folded).toMatchObject({ beyond: 50, singlePlay: 1 });
        expect(artists(report.folded?.climbers)).toEqual(["Tail 08", "Tail 09"]);
    });

    test("fold long tail has no summary when nothing is beyond the cut", () => {
        expect(climbers(tables, 1, "fold", 12).folded).toBeUndefined();
    });
});

describe("Days at an offset that isn't a whole quarter-hour", () => {
    // Liberia kept local mean time, UTC−0:44:30, until 1972: 1 January began at 00:44:30 UTC.
    const tables = buildStandings(
        [scrobble("1970-01-01T00:44:20Z", "Air"), scrobble("1970-01-01T00:44:40Z", "Air")],
        { timeZone: "Africa/Monrovia", today: uts("1970-01-01T12:00:00Z") },
    );

    test("Scrobbles either side of local midnight land on different Days", () => {
        expect(tables.firstDay.date).toBe("1969-12-31");
        expect([0, 1].map((day) => dailyPlays(tables, day, tables.artists.indexOf("Air")))).toEqual(
            [1, 1],
        );
    });
});

describe("Days in the Listener's timezone", () => {
    const timeZone = "America/New_York";
    const tables = buildStandings(
        [
            // 23:30 EST on 7 March, the evening before clocks go forward
            scrobble("2026-03-08T04:30:00Z", "Air"),
            // 23:30 EDT on 8 March, after they have
            scrobble("2026-03-09T03:30:00Z", "Air"),
            // 00:30 EDT on 1 November, the night clocks go back
            scrobble("2026-11-01T04:30:00Z", "Air"),
            // 23:30 EST on 1 November
            scrobble("2026-11-02T04:30:00Z", "Air"),
        ],
        { timeZone, today: uts("2026-11-02T12:00:00Z") },
    );
    const air = tables.artists.indexOf("Air");
    const dayOf = (date: string) =>
        (Date.parse(date) - Date.parse(tables.firstDay.date)) / 86_400_000;

    test("Days run from the first Scrobble's local Day through today", () => {
        expect(tables.firstDay).toEqual({ date: "2026-03-07", timeZone });
        expect(dayDate(tables, tables.dayCount - 1)).toBe("2026-11-02");
    });

    test("Scrobbles land on their local Day across both DST changes", () => {
        expect(valueAt(tables, air, dayOf("2026-03-07"), "scrobbles")).toBe(1);
        expect(valueAt(tables, air, dayOf("2026-03-08"), "scrobbles")).toBe(2);
        expect(valueAt(tables, air, dayOf("2026-10-31"), "scrobbles")).toBe(2);
        expect(valueAt(tables, air, dayOf("2026-11-01"), "scrobbles")).toBe(4);
    });
});

describe("drawnLines", () => {
    // With X = 1: Opener leads Day 0 only, Early leads Days 1–34, Mid Days 35–49, Late from Day 50.
    const tables = buildStandings(
        [
            scrobble("2026-01-01T08:00:00Z", "Opener"),
            ...[0, 1, 2].map((i) => scrobble(`2026-01-02T08:0${i}:00Z`, "Early")),
            ...[0, 1, 2, 3, 4].map((i) => scrobble(`2026-02-05T08:0${i}:00Z`, "Mid")),
            ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
                scrobble(`2026-02-20T08:0${i}:00Z`, "Late"),
            ),
        ],
        { timeZone: "UTC", today: uts("2026-03-02T12:00:00Z") },
    );
    const idOf = (name: string) => tables.artists.indexOf(name);
    const lines = (
        start: number,
        end: number,
        x = 1,
        pinned: number[] = [],
        rule: LinesRule = "warm-up",
    ) =>
        drawnLines(tables, { start, end }, x, rule, pinned)
            .map((id) => tables.artists[id])
            .toSorted();

    test("every Artist in the Top X on any visible Day gets a line", () => {
        expect(lines(36, 45)).toEqual(["Mid"]);
        expect(lines(36, 60)).toEqual(["Late", "Mid"]);
        expect(lines(36, 60, 2)).toEqual(["Early", "Late", "Mid"]);
    });

    test("the first 30 Days of the history don't decide which lines are drawn", () => {
        expect(lines(0, 40)).toEqual(["Early", "Mid"]);
    });

    test("a window inside the first 30 Days still draws its Top X", () => {
        expect(lines(0, 20)).toEqual(["Early", "Opener"]);
    });

    test("Pinned Artists are drawn whether or not they're in the Top X", () => {
        expect(lines(36, 45, 1, [idOf("Opener"), idOf("Mid")])).toEqual(["Mid", "Opener"]);
        expect(lines(36, 45, 1, [idOf("Opener")], "seven-days")).toEqual(["Mid", "Opener"]);
    });

    test("with no warm-up, the first 30 Days decide lines like any others", () => {
        expect(lines(0, 40, 1, [], "no-warm-up")).toEqual(["Early", "Mid", "Opener"]);
    });

    test("the seven-Day rule draws only Artists in the Top X on at least 7 visible Days", () => {
        // Early leads Days 30–34, Mid 35–49 and Late from Day 50.
        expect(lines(30, 55, 1, [], "seven-days")).toEqual(["Mid"]);
        expect(lines(30, 56, 1, [], "seven-days")).toEqual(["Late", "Mid"]);
        expect(lines(0, 40, 1, [], "seven-days")).toEqual(["Early"]);
        expect(lines(0, 41, 1, [], "seven-days")).toEqual(["Early", "Mid"]);
    });

    test("a window under 7 Days long asks the seven-Day rule for every visible Day", () => {
        expect(lines(48, 51, 1, [], "seven-days")).toEqual([]);
        expect(lines(56, 60, 1, [], "seven-days")).toEqual(["Late"]);
    });

    const outside = (name: string, from: number, to: number, x = 1) =>
        daysOutsideTopX(tables, idOf(name), x, from, to);

    test("a Pinned Artist is outside the Top X on runs of Days, unranked Days included", () => {
        expect(outside("Early", 30, 40)).toEqual([{ start: 35, end: 40 }]);
        expect(outside("Mid", 30, 55)).toEqual([
            { start: 30, end: 34 },
            { start: 50, end: 55 },
        ]);
        expect(outside("Mid", 30, 55, 3)).toEqual([{ start: 30, end: 34 }]);
        expect(outside("Late", 40, 60)).toEqual([{ start: 40, end: 49 }]);
        expect(outside("Late", 50, 60)).toEqual([]);
    });

    test("is memoised on the integer window bounds, X, rule, pins and tables", () => {
        const pinned = [idOf("Opener")];
        const drawn = drawnLines(tables, { start: 35.2, end: 45.1 }, 1, "warm-up", pinned);
        expect(drawnLines(tables, { start: 35.9, end: 45.8 }, 1, "warm-up", [...pinned])).toBe(
            drawn,
        );
        expect(drawnLines(tables, { start: 36.1, end: 45.8 }, 1, "warm-up", pinned)).not.toBe(
            drawn,
        );
        expect(drawnLines(tables, { start: 35.2, end: 46.1 }, 1, "warm-up", pinned)).not.toBe(
            drawn,
        );
        expect(drawnLines(tables, { start: 35.2, end: 45.1 }, 2, "warm-up", pinned)).not.toBe(
            drawn,
        );
        expect(drawnLines(tables, { start: 35.2, end: 45.1 }, 1, "warm-up", [])).not.toBe(drawn);
        expect(drawnLines(tables, { start: 35.2, end: 45.1 }, 1, "no-warm-up", pinned)).not.toBe(
            drawn,
        );
        const rebuilt = { ...tables };
        expect(drawnLines(rebuilt, { start: 35.2, end: 45.1 }, 1, "warm-up", pinned)).not.toBe(
            drawn,
        );
    });
});

describe("Pinned Artists", () => {
    const tables = buildStandings(
        [
            scrobble("2026-07-01T08:00:00Z", "Massive Attack"),
            scrobble("2026-07-01T09:00:00Z", "Portishead"),
            scrobble("2026-07-01T10:00:00Z", "Portishead"),
            scrobble("2026-07-02T08:00:00Z", "Tricky"),
        ],
        { timeZone: "UTC", today: uts("2026-07-02T12:00:00Z") },
    );

    test("resolve by exact name in the order pinned, hiding names the tables don't have", () => {
        expect(
            resolvePins(tables, ["Tricky", "Burial", "massive attack", "Massive Attack"]),
        ).toEqual([
            { id: tables.artists.indexOf("Tricky"), artist: "Tricky" },
            { id: tables.artists.indexOf("Massive Attack"), artist: "Massive Attack" },
        ]);
    });

    test("search matches any part of a name in any case, best Standing on the Day first", () => {
        // On 1 July Portishead lead Massive Attack, and Tricky is unranked until 2 July.
        expect(searchArtists(tables, "T", 0, 10)).toEqual([
            "Portishead",
            "Massive Attack",
            "Tricky",
        ]);
        expect(searchArtists(tables, "tt", 0, 10)).toEqual(["Massive Attack"]);
        expect(searchArtists(tables, "t", 0, 2)).toEqual(["Portishead", "Massive Attack"]);
        expect(searchArtists(tables, "  ", 0, 10)).toEqual([]);
    });
});
