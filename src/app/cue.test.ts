import { describe, expect, test } from "vitest";
import { listenerId } from "../db";
import { windowIndex, type Soundtrack } from "../standings";
import { deviceId, unixMs } from "../spotify";
import { resumes, sendableAt, transition, type Cue, type Playback } from "./cue";

describe("the next Soundtrack may be sent", () => {
    test("at once if none has been sent", () => {
        expect(sendableAt(undefined, unixMs(5_000))).toBe(5_000);
    });

    test("only once the last one has played for 2 seconds", () => {
        expect(sendableAt(unixMs(10_000), unixMs(10_700))).toBe(12_000);
        expect(sendableAt(unixMs(10_000), unixMs(12_500))).toBe(12_500);
    });
});

const soundtrack = (artist: string, window = 0): Soundtrack => ({
    window: windowIndex(window),
    tracks: [{ artist, track: `${artist} track 0` }],
});

const cue = (listener: string, window: number, artist = "Portishead"): Cue => ({
    listener: listenerId(listener),
    window: windowIndex(window),
    soundtrack: soundtrack(artist, window),
    deviceId: deviceId("device"),
});

const uri = "spotify:track:p";

describe("the player", () => {
    test("plays what was sent, pauses where the history paused, and resumes", () => {
        const playing = transition({ kind: "stopped" }, { type: "sent", uri });
        expect(playing).toEqual({ kind: "playing", uri });
        const paused = transition(playing, { type: "paused", at: cue("bristol", 2) });
        expect(paused).toEqual({ kind: "paused", uri, at: cue("bristol", 2) });
        expect(transition(paused, { type: "resumed" })).toEqual(playing);
    });

    test("ignores a pause or resume it isn't in a state to take", () => {
        const stopped: Playback = { kind: "stopped" };
        expect(transition(stopped, { type: "paused", at: cue("bristol", 0) })).toBe(stopped);
        expect(transition(stopped, { type: "resumed" })).toBe(stopped);
        const playing = transition(stopped, { type: "sent", uri });
        expect(transition(playing, { type: "resumed" })).toBe(playing);
    });

    test("resumes only in the same Listener's same Window it paused in", () => {
        const paused: Playback = { kind: "paused", uri, at: cue("bristol", 2) };
        expect(resumes(paused, cue("bristol", 2))).toBe(true);
        expect(resumes(paused, cue("bristol", 3))).toBe(false);
        expect(resumes(paused, cue("wildbunch", 2))).toBe(false);
        expect(resumes({ kind: "playing", uri }, cue("bristol", 2))).toBe(false);
    });
});
