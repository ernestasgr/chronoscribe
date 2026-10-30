import { describe, expect, test } from "vitest";
import type { BelowTopX } from "../settings";
import { dailySegments, sCurveSegments, spreadLabels, standingLevel, yAlong } from "./geometry";

// With X = 10 and 1,000 Artists.
const levelOf = (below: BelowTopX) => (standing: number) =>
    standingLevel(standing, 10, 1000, below);
const tenPx = (day: number) => day * 10;
const twentyPx = (day: number) => day * 20;

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

describe("sCurveSegments", () => {
    test("keeps every Day's level when Days are wider than a curve", () => {
        const values = [1, 2, 3, 3];
        expect(sCurveSegments((day) => values[day], twentyPx, 0, 3)).toEqual([
            [
                [0, 1],
                [20, 2],
                [40, 3],
                [60, 3],
            ],
        ]);
    });

    test("curves straight on past a Day whose curves would overlap", () => {
        const values = [1, 2, 3];
        expect(sCurveSegments((day) => values[day], tenPx, 0, 2)).toEqual([
            [
                [0, 1],
                [22, 3],
            ],
        ]);
    });
});

describe("yAlong", () => {
    const segments: [number, number][][] = [
        [
            [0, 10],
            [20, 30],
        ],
        [
            [40, 0],
            [60, 0],
        ],
    ];

    test("follows straight segments linearly", () => {
        expect(yAlong(segments, 5, false)).toBeCloseTo(15);
    });

    test("follows an S-curve, flat at its ends and halfway up at its middle", () => {
        expect(yAlong(segments, 0, true)).toBeCloseTo(10);
        expect(yAlong(segments, 2, true)).toBeLessThan(11);
        expect(yAlong(segments, 10, true)).toBeCloseTo(20);
        expect(yAlong(segments, 18, true)).toBeGreaterThan(29);
        expect(yAlong(segments, 20, true)).toBeCloseTo(30);
    });

    test("is undefined where the line breaks or ends", () => {
        expect(yAlong(segments, 30, true)).toBeUndefined();
        expect(yAlong(segments, 50, true)).toBe(0);
        expect(yAlong(segments, 70, false)).toBeUndefined();
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
