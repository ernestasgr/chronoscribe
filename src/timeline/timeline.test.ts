import { expect, test } from "vitest";
import { listenerId } from "../db";
import { createEventBus } from "../events";
import type { IngestEvents } from "../ingest";
import { buildStandings, type StandingsTables } from "../standings";
import { createTimeline, type BuildStandings } from ".";

const BRISTOL = { id: listenerId("Bristol"), timeZone: "UTC" };
const TABLES = buildStandings([{ uts: 0, artist: "Massive Attack" }], {
    timeZone: "UTC",
    today: 86_400,
});

/** A timeline whose builds answer from `builds` in turn, a function to throw or the tables. */
function setUp(builds: (() => StandingsTables)[]) {
    const build: BuildStandings = async () => {
        const next = builds.shift();
        if (!next) throw new Error("no more builds scripted");
        return next();
    };
    return createTimeline({
        build,
        events: createEventBus<IngestEvents>(),
        now: () => 86_400_000,
        requestFrame: () => () => {},
        playback: () => ({ secondsPerDay: 0.1, stepDays: 1 }),
    });
}

/** Lets a build's promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

test("a build that fails is reported, keeping no tables, and retrying builds again", async () => {
    const timeline = setUp([
        () => {
            throw new RangeError("Too many Artists");
        },
        () => TABLES,
    ]);

    timeline.show(BRISTOL);
    expect(timeline.store.getState().build).toEqual({ kind: "running" });
    await settle();
    expect(timeline.store.getState()).toMatchObject({
        tables: undefined,
        build: { kind: "failed", message: "RangeError: Too many Artists" },
    });

    timeline.retry();
    await settle();
    expect(timeline.store.getState()).toMatchObject({ tables: TABLES, build: { kind: "idle" } });
});

test("a failed build of a Listener no longer shown is dropped", async () => {
    const timeline = setUp([
        () => {
            throw new Error("boom");
        },
    ]);

    timeline.show(BRISTOL);
    timeline.clear();
    await settle();
    expect(timeline.store.getState().build).toEqual({ kind: "idle" });
});
