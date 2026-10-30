import { describe, expect, test } from "vitest";
import {
    buildStandings,
    climbers,
    dailyPlays,
    dayDate,
    dayIndex,
    dayScrobbles,
    topX,
    type StandingsTables,
} from ".";

const DAY_SECONDS = 86_400;
const DAYS = 2_400;
const ARTISTS = 1_300;
const SCROBBLES = 100_000;

/** A seeded PRNG (mulberry32), so the fixture is the same on every run. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
}

/**
 * A history shaped like the measured one: about 100k Scrobbles of 1,300 Artists over
 * 2,400 Days, 29% of them empty, with a few Artists taking most of the plays.
 */
function syntheticHistory(): { uts: number; artist: string }[] {
    const next = random(2339);
    const start = Date.parse("2020-01-01T00:00:00Z") / 1000;
    const listeningDays = Array.from({ length: DAYS }, (_, day) => day).filter(
        () => next() >= 0.29,
    );
    return Array.from({ length: SCROBBLES }, (_, i) => {
        const day = listeningDays[i % listeningDays.length]!;
        const artist = Math.floor(ARTISTS * next() ** 3);
        return {
            uts: start + day * DAY_SECONDS + Math.floor(next() * DAY_SECONDS),
            artist: `Artist ${String(artist).padStart(4, "0")}`,
        };
    });
}

function time(run: () => void): number {
    const started = performance.now();
    run();
    return performance.now() - started;
}

describe("benchmark on a history shaped like the measured one", () => {
    const history = syntheticHistory();
    const today = Date.parse("2020-01-01T00:00:00Z") / 1000 + (DAYS - 1) * DAY_SECONDS + 3_600;
    const options = { timeZone: "Europe/Vilnius", today };
    // The first build is the one timed, before the JIT has warmed to it.
    let tables!: StandingsTables;
    const rebuild = time(() => (tables = buildStandings(history, options)));

    test("the fixture has the measured shape", () => {
        expect(tables.dayCount).toBeGreaterThanOrEqual(DAYS);
        expect(tables.artists.length).toBeGreaterThan(1_250);
    });

    test("a full rebuild takes under 1 s", () => {
        expect(rebuild).toBeLessThan(1_000);
    });

    test("a Focus Day report takes under 5 ms", () => {
        const x = 10;
        const report = (n: number) => {
            const day = dayIndex(n);
            dayDate(tables, day);
            dayScrobbles(tables, day);
            for (const row of topX(tables, day, x)) dailyPlays(tables, day, row.id);
            climbers(tables, day, "fold", x);
        };
        // Warm up, then time a spread of Days and take the slowest.
        for (let day = 0; day < 100; day++) report(day);
        const days = Array.from({ length: 200 }, (_, i) => Math.floor((i * tables.dayCount) / 200));
        expect(Math.max(...days.map((day) => time(() => report(day))))).toBeLessThan(5);
    });
});
