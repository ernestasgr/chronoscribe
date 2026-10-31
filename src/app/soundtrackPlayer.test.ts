// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createStore } from "zustand";
import {
    createFakeSpotify,
    fakeSpotifyFetch,
    FIXTURE_DEVICE_ID,
    type CatalogueTrack,
} from "../../test-support/spotify";
import { listenerId, openDb, type Db } from "../db";
import { createEventBus } from "../events";
import { windowIndex, type Soundtrack, type Soundtracks } from "../standings";
import type { TimelineState } from "../timeline";
import { createConnection, type ConnectionEvents } from "./connection";
import { createFailures } from "./failures";
import { createSettings } from "./settings";
import { createSoundtrackPlayer } from "./soundtrackPlayer";

const ROOT = "http://127.0.0.1:5273/";
const START = Date.parse("2026-07-10T12:00:00Z");
const WINDOW_DAYS = 7;

const track = (artist: string, name: string, durationMs = 240_000): CatalogueTrack => ({
    name,
    artists: [artist],
    uri: `spotify:track:${name.replaceAll(" ", "-").toLowerCase()}`,
    durationMs,
});

const CATALOGUE = [
    track("Portishead", "Glory Box"),
    track("Portishead", "Roads"),
    track("Tricky", "Hell Is Round the Corner (Remastered 2011)"),
    track("Massive Attack", "Teardrop"),
    track("Massive Attack", "Angel", 60_000),
    // Shares the Soundtrack's title, but by someone else, so it is never the match.
    track("Massive Attack Tribute Band", "Unfinished Sympathy"),
];

const soundtrack = (window: number, artist: string, tracks: string[]): Soundtrack => ({
    window: windowIndex(window),
    artist,
    tracks,
});

const PORTISHEAD = soundtrack(0, "Portishead", ["Glory Box", "Roads"]);
const TRICKY = soundtrack(1, "Tricky", ["Hell Is Round the Corner"]);
// Its top track isn't on Spotify, nor is its first fallback: the third is.
const MASSIVE = soundtrack(2, "Massive Attack", ["Unfinished Sympathy", "Karmacoma", "Teardrop"]);
const UNKNOWN = soundtrack(4, "Nobody", ["Nothing"]);

/** Windows of a week: Portishead, Tricky, Massive Attack, an empty one, then one not on Spotify. */
const SOUNDTRACKS: Soundtracks = {
    windowDays: WINDOW_DAYS,
    shown: [PORTISHEAD, TRICKY, MASSIVE, MASSIVE, UNKNOWN],
};

/** A clock and timers that move only when told to. */
function fakeClock() {
    const clock = { now: START, timers: [] as { at: number; run: () => void }[] };
    return {
        now: () => clock.now,
        setTimer: (run: () => void, ms: number) => {
            const timer = { at: clock.now + ms, run };
            clock.timers.push(timer);
            return () => {
                clock.timers = clock.timers.filter((t) => t !== timer);
            };
        },
        /** Moves time on by `ms`, running each timer that falls due on the way. */
        async advance(ms: number) {
            const until = clock.now + ms;
            for (;;) {
                const due = clock.timers
                    .filter((t) => t.at <= until)
                    .toSorted((a, b) => a.at - b.at)[0];
                if (!due) break;
                clock.timers = clock.timers.filter((t) => t !== due);
                clock.now = Math.max(clock.now, due.at);
                due.run();
                await settle();
            }
            clock.now = until;
        },
    };
}

/** Lets storage, the fake Spotify and the SDK's queued events finish. */
const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
};

const INITIAL_TIMELINE: TimelineState = {
    listener: undefined,
    tables: undefined,
    soundtracks: undefined,
    build: { kind: "idle" },
    pick: { kind: "idle" },
    buildId: 0,
    pickId: 0,
    playhead: 0,
    window: { start: 0, end: 0 },
    motion: { kind: "still" },
};

/** The player with the Soundtrack switched on and signed in, over a history of `SOUNDTRACKS`. */
async function setUp(db: Db) {
    const clock = fakeClock();
    const spotify = createFakeSpotify({
        clientId: "client",
        redirectUri: ROOT,
        catalogue: CATALOGUE,
    });
    const events = createEventBus<ConnectionEvents>();
    const failures = createFailures();
    const settings = await createSettings(db, failures, events);
    const visits: string[] = [];
    // While held, Spotify's replies wait, as a slow network's would.
    const gate: { held: Promise<void> | undefined; release: () => void } = {
        held: undefined,
        release: () => {},
    };
    const hold = () => {
        gate.held = new Promise((resolve) => {
            gate.release = () => {
                gate.held = undefined;
                resolve();
            };
        });
    };
    const answer = fakeSpotifyFetch(spotify);
    const port = {
        fetch: async (input: string, init?: RequestInit) => {
            await gate.held;
            return answer(input, init);
        },
        navigate: (url: string) => visits.push(url),
        replaceAddress: () => {},
        createPlayer: spotify.players.create,
    };
    const connection = createConnection({
        db,
        port,
        events,
        failures,
        clientId: "client",
        redirectUri: ROOT,
        now: clock.now,
        stored: undefined,
    });
    settings.update({ soundtrack: true });
    await connection.switchedOn();
    await connection.finishSignIn(await spotify.authorize(new URL(visits.at(-1) ?? "")));
    await settle();

    const timeline = { store: createStore<TimelineState>(() => INITIAL_TIMELINE) };
    timeline.store.setState({
        listener: { id: listenerId("Bristol"), timeZone: "UTC" },
        soundtracks: SOUNDTRACKS,
    });
    const startPlayer = async () =>
        createSoundtrackPlayer({
            timeline,
            settings,
            connection,
            events,
            db,
            fetch: port.fetch,
            now: clock.now,
            setTimer: clock.setTimer,
            failures,
            limitedUntil: await db.loadSpotifyLimit(),
        });
    const player = await startPlayer();
    const sdk = spotify.players.latest();
    if (!sdk) throw new Error("the connection made no player");

    /** The history: playing from, moving to and pausing on a Day. */
    const history = {
        async play(day: number) {
            timeline.store.setState({ playhead: day, motion: { kind: "playing", at: undefined } });
            await settle();
        },
        async moveTo(day: number) {
            timeline.store.setState({ playhead: day });
            await settle();
        },
        async pause() {
            timeline.store.setState({ motion: { kind: "still" } });
            await settle();
        },
    };

    const played = () => spotify.plays.map(({ uris, positionMs }) => [uris[0], positionMs]);

    return {
        player,
        spotify,
        sdk,
        clock,
        history,
        timeline,
        settings,
        failures,
        played,
        hold,
        release: async () => {
            gate.release();
            await settle();
        },
        /** The player as a reload of the tab makes it, from what is stored. */
        reload: async () => {
            player.dispose();
            return startPlayer();
        },
    };
}

const uri = (name: string) => `spotify:track:${name.replaceAll(" ", "-").toLowerCase()}`;

describe("playing the Soundtrack", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`player-${crypto.randomUUID()}`);
    });

    test("plays the Window's Soundtrack on this tab's device, 30 s in, once the history plays", async () => {
        const { spotify, history, played } = await setUp(db);
        expect(spotify.plays).toEqual([]);

        await history.play(3);

        expect(spotify.plays).toEqual([
            { deviceId: FIXTURE_DEVICE_ID, uris: [uri("Glory Box")], positionMs: 30_000 },
        ]);
        expect(spotify.searches).toEqual(['track:"Glory Box" artist:"Portishead"']);
        expect(played()).toHaveLength(1);
    });

    test("matches by Artist whatever the title, searching plain when the field search finds nothing", async () => {
        const { spotify, history, clock, played } = await setUp(db);
        await history.play(WINDOW_DAYS);
        expect(played()).toEqual([[uri("Hell Is Round the Corner (Remastered 2011)"), 30_000]]);
        await clock.advance(2_000);

        await history.moveTo(2 * WINDOW_DAYS);
        expect(spotify.searches.slice(1)).toEqual([
            'track:"Unfinished Sympathy" artist:"Massive Attack"',
            "Massive Attack Unfinished Sympathy",
            'track:"Karmacoma" artist:"Massive Attack"',
            "Massive Attack Karmacoma",
            'track:"Teardrop" artist:"Massive Attack"',
        ]);
        expect(played().at(-1)).toEqual([uri("Teardrop"), 30_000]);
    });

    test("keeps playing through an empty Window and one with nothing on Spotify", async () => {
        const { history, clock, played } = await setUp(db);
        await history.play(2 * WINDOW_DAYS);
        await clock.advance(2_000);
        await history.moveTo(3 * WINDOW_DAYS);
        await clock.advance(2_000);
        await history.moveTo(4 * WINDOW_DAYS);
        await clock.advance(2_000);

        expect(played()).toEqual([[uri("Teardrop"), 30_000]]);
    });

    test("keeps playing the same Soundtrack into the next Window without starting it again", async () => {
        const { history, clock, timeline, played } = await setUp(db);
        const twice = {
            windowDays: WINDOW_DAYS,
            shown: [PORTISHEAD, { ...PORTISHEAD, window: windowIndex(1) }],
        };
        timeline.store.setState({ soundtracks: twice });
        await history.play(0);
        await clock.advance(2_000);
        await history.moveTo(WINDOW_DAYS);
        await clock.advance(2_000);

        expect(played()).toEqual([[uri("Glory Box"), 30_000]]);
    });

    test("starts a short track a third of the way in", async () => {
        const { history, timeline, played } = await setUp(db);
        timeline.store.setState({
            soundtracks: {
                windowDays: WINDOW_DAYS,
                shown: [soundtrack(0, "Massive Attack", ["Angel"])],
            },
        });
        await history.play(0);
        expect(played()).toEqual([[uri("Angel"), 20_000]]);
    });

    test("plays nothing while the history is still, or with the Soundtrack switched off", async () => {
        const { spotify, history, settings } = await setUp(db);
        await history.moveTo(WINDOW_DAYS);
        settings.update({ soundtrack: false });
        await history.play(0);
        expect(spotify.plays).toEqual([]);
        expect(spotify.searches).toEqual([]);
    });
});

describe("pausing", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`player-${crypto.randomUUID()}`);
    });

    test("pauses Spotify, and resuming in the same Window carries on where it paused", async () => {
        const { history, clock, sdk, played } = await setUp(db);
        await history.play(1);
        await clock.advance(5_000);
        await history.pause();
        expect(sdk.pauses).toBe(1);

        await history.play(2);
        expect(sdk.resumes).toBe(1);
        expect(played()).toEqual([[uri("Glory Box"), 30_000]]);
    });

    test("resuming in another Window starts its Soundtrack at the offset, even the same one", async () => {
        const { history, clock, sdk, played } = await setUp(db);
        await history.play(2 * WINDOW_DAYS);
        await clock.advance(5_000);
        await history.pause();
        await history.play(3 * WINDOW_DAYS);

        expect(sdk.resumes).toBe(0);
        expect(played()).toEqual([
            [uri("Teardrop"), 30_000],
            [uri("Teardrop"), 30_000],
        ]);
    });

    test("resuming in another Window whose Soundtrack isn't on Spotify carries on the paused one", async () => {
        const { history, clock, sdk, played } = await setUp(db);
        await history.play(0);
        await clock.advance(5_000);
        await history.pause();
        await history.play(4 * WINDOW_DAYS);

        expect(sdk.resumes).toBe(1);
        expect(played()).toEqual([[uri("Glory Box"), 30_000]]);
    });

    test("a track still being looked up when the history pauses is never played", async () => {
        const { history, sdk, played, hold, release } = await setUp(db);
        hold();
        await history.play(0);
        await history.pause();
        await history.play(WINDOW_DAYS);
        await release();

        expect(played()).toEqual([[uri("Hell Is Round the Corner (Remastered 2011)"), 30_000]]);
        expect(sdk.pauses).toBe(0);
    });

    test("pauses Spotify when the timeline stops by itself or its Listener changes", async () => {
        const { history, clock, sdk, timeline } = await setUp(db);
        await history.play(0);
        await clock.advance(2_000);
        // The last Day stops the history as a pause does.
        await history.pause();
        expect(sdk.pauses).toBe(1);

        await history.play(0);
        timeline.store.setState({
            listener: { id: listenerId("Other"), timeZone: "UTC" },
            soundtracks: undefined,
        });
        await settle();
        expect(sdk.pauses).toBe(2);
    });
});

describe("a Sync rebuild while playing", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`player-${crypto.randomUUID()}`);
    });

    test("changes the track only if the Soundtrack worked out again is different", async () => {
        const { history, clock, timeline, played } = await setUp(db);
        await history.play(0);
        await clock.advance(2_000);

        timeline.store.setState({ soundtracks: { ...SOUNDTRACKS, shown: [...SOUNDTRACKS.shown] } });
        await settle();
        // Roads is now its most-played; Glory Box, still the match for it, keeps playing.
        timeline.store.setState({
            soundtracks: {
                ...SOUNDTRACKS,
                shown: [soundtrack(0, "Portishead", ["Glory Box", "Sour Times"])],
            },
        });
        await settle();
        expect(played()).toEqual([[uri("Glory Box"), 30_000]]);

        timeline.store.setState({
            soundtracks: { ...SOUNDTRACKS, shown: [soundtrack(0, "Portishead", ["Roads"])] },
        });
        await settle();
        await clock.advance(2_000);
        expect(played().at(-1)).toEqual([uri("Roads"), 30_000]);
    });
});

describe("Spotify's rate limits", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`player-${crypto.randomUUID()}`);
    });

    test("a Soundtrack plays 2 s before the next is sent, and only the newest is sent", async () => {
        const { spotify, history, clock, played } = await setUp(db);
        // At 0.1 s per Day, week-long Windows pass every 0.7 s.
        await history.play(0);
        await clock.advance(700);
        await history.moveTo(WINDOW_DAYS);
        await clock.advance(700);
        await history.moveTo(2 * WINDOW_DAYS);
        expect(played()).toEqual([[uri("Glory Box"), 30_000]]);

        await clock.advance(599);
        expect(played()).toHaveLength(1);
        await clock.advance(1);
        expect(played()).toEqual([
            [uri("Glory Box"), 30_000],
            [uri("Teardrop"), 30_000],
        ]);
        // Tricky's Window went by in between, unsearched.
        expect(spotify.searches.some((q) => q.includes("Tricky"))).toBe(false);
    });

    test("matches and misses are kept, so replaying searches nothing until they're forgotten", async () => {
        const { spotify, history, clock, player } = await setUp(db);
        await history.play(2 * WINDOW_DAYS);
        await clock.advance(2_000);
        await history.moveTo(4 * WINDOW_DAYS);
        await clock.advance(2_000);
        const searched = spotify.searches.length;

        await history.pause();
        await history.play(0);
        await clock.advance(2_000);
        await history.moveTo(2 * WINDOW_DAYS);
        await clock.advance(2_000);
        await history.moveTo(4 * WINDOW_DAYS);
        await clock.advance(2_000);
        expect(spotify.searches.slice(searched)).toEqual(['track:"Glory Box" artist:"Portishead"']);

        await player.forgetMatches();
        await history.pause();
        await history.play(2 * WINDOW_DAYS);
        expect(spotify.searches.length).toBeGreaterThan(searched + 1);
    });

    test("a 429 turns the Soundtrack off until its Retry-After has passed", async () => {
        const { spotify, history, clock, settings, player, failures, sdk } = await setUp(db);
        spotify.rateLimit(3_600);
        await history.play(0);

        expect(settings.store.getState().soundtrack).toBe(false);
        expect(player.store.getState().limit).toEqual({
            kind: "limited",
            until: START + 3_600_000,
        });
        expect(failures.store.getState().latest?.message).toContain("slow down");
        expect(sdk.pauses).toBe(0);

        // It never tries again by itself.
        await clock.advance(3_599_999);
        expect(spotify.searches).toEqual([]);
        expect(player.store.getState().limit.kind).toBe("limited");
        await clock.advance(1);
        expect(player.store.getState().limit).toEqual({ kind: "free" });
    });

    test("a 429's wait outlasts a reload", async () => {
        const { spotify, history, clock, reload } = await setUp(db);
        spotify.rateLimit(3_600);
        await history.play(0);

        await clock.advance(60_000);
        expect((await reload()).store.getState().limit).toEqual({
            kind: "limited",
            until: START + 3_600_000,
        });
        await clock.advance(3_540_000);
        expect((await reload()).store.getState().limit).toEqual({ kind: "free" });
    });

    test("2 s are counted from when the last Soundtrack started playing, not from its search", async () => {
        const { history, clock, played, hold, release } = await setUp(db);
        hold();
        await history.play(0);
        await clock.advance(1_500);
        await release();
        expect(played()).toEqual([[uri("Glory Box"), 30_000]]);

        await history.moveTo(WINDOW_DAYS);
        await clock.advance(1_999);
        expect(played()).toHaveLength(1);
        await clock.advance(1);
        expect(played().at(-1)).toEqual([
            uri("Hell Is Round the Corner (Remastered 2011)"),
            30_000,
        ]);
    });
});

describe("a Spotify that can't be reached", () => {
    test("turns the Soundtrack off and says why", async () => {
        const db = openDb(`player-${crypto.randomUUID()}`);
        const { history, settings, failures, spotify } = await setUp(db);
        spotify.revoke();
        vi.spyOn(spotify, "api").mockReturnValue({
            status: 500,
            body: { error: { status: 500, message: "Server error" } },
        });
        await history.play(0);

        expect(settings.store.getState().soundtrack).toBe(false);
        expect(failures.store.getState().latest?.message).toContain("Server error");
    });
});
