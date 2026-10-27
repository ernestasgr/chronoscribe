import { describe, expect, test } from "vitest";
import { panned, transition, type ViewEvent, type ViewState } from "./view";

const LAST = 100;
const still = (playhead: number, start = 0, end = LAST): ViewState => ({
    playhead,
    window: { start, end },
    motion: { kind: "still" },
});
const run = (state: ViewState, ...events: ViewEvent[]) =>
    events.reduce((current, event) => transition(current, event, LAST), state);
/** A frame at `at` ms, played at 100 ms per Day. */
const frame = (at: number): ViewEvent => ({ type: "frame", at, msPerDay: 100 });
const seek = (day: number, glide = true): ViewEvent => ({ type: "seek", day, glide });
const step = (days: number): ViewEvent => ({ type: "step", days });
/** The view `at` ms into a glide or playback whose first frame came at 0 ms. */
const glidingAt = (state: ViewState, at: number) => run(state, frame(0), frame(at));

describe("playing", () => {
    test("moves the playhead one Day per Day's worth of frames, from the first frame on", () => {
        const played = run(still(10), { type: "play" }, frame(1000), frame(1050), frame(1300));
        expect(played.playhead).toBeCloseTo(13);
        expect(played.motion.kind).toBe("playing");
    });

    test("stops on the last Day", () => {
        const played = run(still(99), { type: "play" }, frame(0), frame(100), frame(200));
        expect(played.playhead).toBe(LAST);
        expect(played.motion).toEqual({ kind: "still" });
    });

    test("crosses the window to 80% of its width, then scrolls the window under it", () => {
        // 80% of Days 10 to 30 is Day 26.
        const start = run(still(24, 10, 30), { type: "play" }, frame(0));
        expect(run(start, frame(100)).window).toEqual({ start: 10, end: 30 });
        const held = run(start, frame(100), frame(200), frame(300), frame(400), frame(500));
        expect(held.playhead).toBeCloseTo(29);
        expect(held.window.start).toBeCloseTo(13);
        expect(held.window.end).toBeCloseTo(33);
    });

    test("keeps the window inside the history, so the playhead runs on to the last Day", () => {
        const played = run(still(95, 80, 100), { type: "play" }, frame(0), frame(200));
        expect(played.window).toEqual({ start: 80, end: 100 });
        expect(played.playhead).toBeCloseTo(97);
    });

    test("holds the playhead at 80% of a window zoomed during playback", () => {
        const zoomed = run(
            still(50, 30, 55),
            { type: "play" },
            frame(0),
            { type: "setWindow", window: { start: 30, end: 50 } },
            frame(100),
        );
        expect(zoomed.motion.kind).toBe("playing");
        expect(zoomed.playhead).toBeCloseTo(51);
        expect(zoomed.window.start).toBeCloseTo(35);
        expect(zoomed.window.end).toBeCloseTo(55);
    });

    test("starts again from Day 0 when played from the last Day", () => {
        const replayed = run(still(LAST, 60, 100), { type: "play" });
        expect(replayed.playhead).toBe(0);
        expect(replayed.window).toEqual({ start: 0, end: 40 });
    });

    test("pauses, and toggles between playing and paused", () => {
        const paused = run(still(10), { type: "play" }, frame(0), frame(100), { type: "pause" });
        expect(paused.motion).toEqual({ kind: "still" });
        expect(run(paused, frame(500)).playhead).toBeCloseTo(11);
        expect(run(paused, { type: "toggle" }).motion.kind).toBe("playing");
        expect(run(paused, { type: "toggle" }, { type: "toggle" }).motion.kind).toBe("still");
    });

    test("ignores a pause or a frame while still", () => {
        const state = still(10);
        expect(run(state, { type: "pause" })).toBe(state);
        expect(run(state, frame(100))).toBe(state);
    });
});

describe("seeking", () => {
    test("glides one Day over 280 ms, easing in and out", () => {
        const gliding = run(still(10), seek(11));
        expect(glidingAt(gliding, 70).playhead).toBeLessThan(10.25);
        expect(glidingAt(gliding, 140).playhead).toBeCloseTo(10.5);
        expect(glidingAt(gliding, 210).playhead).toBeGreaterThan(10.75);
        expect(glidingAt(gliding, 280)).toEqual(still(11));
    });

    test("takes longer over longer glides, up to 900 ms", () => {
        const month = run(still(10), seek(40));
        expect(glidingAt(month, 280).playhead).toBeLessThan(40);
        expect(glidingAt(month, 900).playhead).toBe(40);
        const history = run(still(0, 0, 10), seek(LAST));
        expect(glidingAt(history, 899).playhead).toBeLessThan(LAST);
        expect(glidingAt(history, 900).playhead).toBe(LAST);
    });

    test("pans the window only when the target is outside it, centring the target", () => {
        expect(glidingAt(run(still(10, 0, 40), seek(30)), 140).window).toEqual({
            start: 0,
            end: 40,
        });
        const panning = run(still(10, 0, 40), seek(70));
        expect(glidingAt(panning, 2000).window).toEqual({ start: 50, end: 90 });
        const halfway = glidingAt(panning, 1000 / 2).window;
        expect(halfway.start).toBeGreaterThan(0);
        expect(halfway.start).toBeLessThan(50);
    });

    test("stops panning when the window is moved during a glide", () => {
        const moved = run(still(10, 0, 40), seek(70), frame(0), {
            type: "setWindow",
            window: { start: 5, end: 45 },
        });
        expect(run(moved, frame(2000))).toEqual(still(70, 5, 45));
    });

    test("jumps without a glide when asked, within the history", () => {
        expect(run(still(10), seek(42, false))).toEqual(still(42));
        expect(run(still(10), seek(-5, false))).toEqual(still(0));
    });

    test("jumps while playing and plays on from there", () => {
        const jumped = run(still(10, 0, 40), { type: "play" }, frame(0), seek(70));
        expect(jumped.playhead).toBe(70);
        expect(jumped.window).toEqual({ start: 38, end: 78 });
        expect(jumped.motion.kind).toBe("playing");
    });
});

describe("stepping", () => {
    test("glides N Days from the Focus Day", () => {
        expect(run(still(10.4), step(7), frame(0), frame(2000))).toEqual(still(17));
        expect(run(still(10.6), step(-7), frame(0), frame(2000))).toEqual(still(4));
    });

    test("adds up steps taken during a glide, and stops at the ends of the history", () => {
        expect(run(still(10), step(7), frame(0), step(7), frame(100), frame(2000))).toEqual(
            still(24),
        );
        expect(run(still(98), step(7), frame(0), frame(2000))).toEqual(still(LAST));
        expect(run(still(2), step(-7), frame(0), frame(2000))).toEqual(still(0));
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
