import { expect, test } from "vitest";
import { listenerId } from "../db";
import { createEventBus } from "../events";
import type { IngestEvents } from "../ingest";
import {
    buildSoundtracks,
    buildStandings,
    type Soundtracks,
    type StandingsTables,
} from "../standings";
import { createTimeline, type BuildProjection, type BuildSoundtracks } from ".";

const BRISTOL = { id: listenerId("Bristol"), timeZone: "UTC" };
const SCROBBLES = [{ uts: 0, artist: "Massive Attack", track: "Teardrop" }];
const TABLES = buildStandings(SCROBBLES, { timeZone: "UTC", today: 86_400 });
const soundtracksOf = (windowDays: number) =>
    buildSoundtracks(SCROBBLES, { timeZone: "UTC", today: 86_400, windowDays });

/** A build's answer, settled by hand: resolve it with a value, or reject it. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
}

/**
 * A timeline whose builds answer from `builds` in turn, a function to throw or the tables, and
 * whose Soundtrack picks answer from `picks` in turn, each given the Window size asked for.
 */
function setUp(
    builds: (() => StandingsTables)[],
    picks: ((windowDays: number) => Promise<Soundtracks>)[] = [],
) {
    const settings = { secondsPerDay: 0.1, stepDays: 1, soundtrackDays: 30 };
    const build: BuildProjection = async (_listener, _today, windowDays) => {
        const next = builds.shift();
        if (!next) throw new Error("no more builds scripted");
        return { tables: next(), soundtracks: soundtracksOf(windowDays) };
    };
    const pickSoundtracks: BuildSoundtracks = async (_listener, _today, windowDays) => {
        const next = picks.shift();
        if (!next) throw new Error("no more Soundtrack picks scripted");
        return next(windowDays);
    };
    const timeline = createTimeline({
        build,
        buildSoundtracks: pickSoundtracks,
        events: createEventBus<IngestEvents>(),
        now: () => 86_400_000,
        requestFrame: () => () => {},
        playback: () => settings,
    });
    /** Sets a new Window size and picks the Soundtracks for it, as the app does. */
    const resize = (soundtrackDays: number) => {
        settings.soundtrackDays = soundtrackDays;
        void timeline.repickSoundtracks();
    };
    return { timeline, resize };
}

/** Lets a build's promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

test("a build that fails is reported, keeping no tables, and retrying builds again", async () => {
    const { timeline } = setUp([
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
    const { timeline } = setUp([
        () => {
            throw new Error("boom");
        },
    ]);

    timeline.show(BRISTOL);
    timeline.clear();
    await settle();
    expect(timeline.store.getState().build).toEqual({ kind: "idle" });
});

test("a build picks the Soundtracks for the Window size the settings hold", async () => {
    const { timeline } = setUp([() => TABLES]);

    timeline.show(BRISTOL);
    await settle();
    expect(timeline.store.getState().soundtracks?.windowDays).toBe(30);
});

test("a new Window size picks the Soundtracks again, keeping the tables", async () => {
    const { timeline, resize } = setUp(
        [() => TABLES],
        [async (windowDays) => soundtracksOf(windowDays)],
    );
    timeline.show(BRISTOL);
    await settle();

    resize(7);
    expect(timeline.store.getState().pick).toEqual({ kind: "running" });
    await settle();
    expect(timeline.store.getState()).toMatchObject({
        tables: TABLES,
        soundtracks: { windowDays: 7 },
        pick: { kind: "idle" },
    });
});

test("Soundtracks picked for a Window size since changed are dropped", async () => {
    const slow = deferred<Soundtracks>();
    const { timeline, resize } = setUp(
        [() => TABLES],
        [() => slow.promise, async (windowDays) => soundtracksOf(windowDays)],
    );
    timeline.show(BRISTOL);
    await settle();

    resize(7);
    resize(90);
    await settle();
    slow.resolve(soundtracksOf(7));
    await settle();
    expect(timeline.store.getState().soundtracks?.windowDays).toBe(90);
});

test("a build under way when the Window size changes keeps its tables but not its Soundtracks", async () => {
    const { timeline, resize } = setUp(
        [() => TABLES],
        [async (windowDays) => soundtracksOf(windowDays)],
    );

    timeline.show(BRISTOL);
    resize(7);
    await settle();
    expect(timeline.store.getState()).toMatchObject({
        tables: TABLES,
        soundtracks: { windowDays: 7 },
    });
});

test("a failed Soundtrack pick is reported apart from the tables' build, and can be retried", async () => {
    const { timeline, resize } = setUp(
        [() => TABLES],
        [
            () => Promise.reject(new Error("IndexedDB closed")),
            async (windowDays) => soundtracksOf(windowDays),
        ],
    );
    timeline.show(BRISTOL);
    await settle();

    resize(7);
    await settle();
    expect(timeline.store.getState()).toMatchObject({
        soundtracks: { windowDays: 30 },
        build: { kind: "idle" },
        pick: { kind: "failed", message: "Error: IndexedDB closed" },
    });

    void timeline.repickSoundtracks();
    await settle();
    expect(timeline.store.getState()).toMatchObject({
        soundtracks: { windowDays: 7 },
        pick: { kind: "idle" },
    });
});
