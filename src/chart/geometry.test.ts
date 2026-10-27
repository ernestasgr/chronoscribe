import { describe, expect, test } from "vitest";
import type { BelowTopX } from "../db";
import { dailySegments, spreadLabels, standingLevel } from "./geometry";

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

describe("spreadLabels", () => {
    test("leaves labels that don't overlap where they are", () => {
        expect(spreadLabels([10, 40, 25], 10, 0, 100)).toEqual([10, 40, 25]);
    });

    test("spreads overlapping labels evenly around where they'd sit, keeping their order", () => {
        expect(spreadLabels([50, 52, 48], 10, 0, 100)).toEqual([50, 60, 40]);
    });

    test("pushes labels back up from the bottom edge", () => {
        expect(spreadLabels([95, 97, 99], 10, 0, 100)).toEqual([80, 90, 100]);
    });
});
