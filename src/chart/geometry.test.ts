import { describe, expect, test } from "vitest";
import type { BelowTopX } from "../db";
import { dailySegments, panned, standingLevel } from "./geometry";

// With X = 10 and 1,000 Artists.
const levelOf = (below: BelowTopX) => (standing: number) =>
    standingLevel(standing, 10, 1000, below);
const tenPx = (day: number) => day * 10;

describe("standingLevel", () => {
    test("the gutter keeps the Top X in even rows and squeezes every lower Standing under #X", () => {
        const level = levelOf("gutter");
        expect(level(1)).toBeCloseTo(0.0425);
        expect(level(10)).toBeCloseTo(0.8075);
        expect(level(11)).toBeGreaterThan(level(10));
        expect(level(1000)).toBeCloseTo(1);
    });

    test("slide-off spreads the Top X over the whole height and drops the rest off the bottom", () => {
        const level = levelOf("slide-off");
        expect(level(1)).toBeCloseTo(0.05);
        expect(level(10)).toBeCloseTo(0.95);
        expect(level(11)).toBeGreaterThan(1);
        expect(level(1000)).toBe(level(11));
    });

    test("a log axis spaces every Standing down to the last, wider near the top", () => {
        const level = levelOf("log");
        expect(level(1)).toBeGreaterThan(0);
        expect(level(1000)).toBeLessThan(1);
        expect(level(2) - level(1)).toBeGreaterThan(level(11) - level(10));
        // Each tenfold of Standing takes the same height.
        expect(level(100) - level(10)).toBeCloseTo(level(1000) - level(100));
    });
});

describe("dailySegments", () => {
    test("puts a point on every Day and breaks the line where it has no value", () => {
        const values = [undefined, 3, 2, undefined, 1, 1];
        expect(dailySegments((day) => values[day], tenPx, 0, 5)).toEqual([
            [
                [10, 3],
                [20, 2],
            ],
            [
                [40, 1],
                [50, 1],
            ],
        ]);
    });
});

describe("panned", () => {
    test("moves a window by whole and fractional Days without changing its width", () => {
        expect(panned({ start: 10, end: 30 }, 5.5, 100)).toEqual({ start: 15.5, end: 35.5 });
        expect(panned({ start: 10, end: 30 }, -4, 100)).toEqual({ start: 6, end: 26 });
    });

    test("stops at either end of the history and keeps its width there", () => {
        expect(panned({ start: 10, end: 30 }, -50, 100)).toEqual({ start: 0, end: 20 });
        expect(panned({ start: 10, end: 30 }, 500, 100)).toEqual({ start: 80, end: 100 });
    });
});
