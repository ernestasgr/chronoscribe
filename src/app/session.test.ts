// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { respondRecentTracks, scrobbles, type FixtureUser } from "../../test-support/lastfm";
import { listenerId, openDb, type Db } from "../db";
import { unixSeconds, unixSecondsAt } from "../lastfm";
import { createEventBus } from "../events";
import { createIngest, type IngestEvents, type Job, type Outcome } from "../ingest";
import { buildSoundtracks, buildStandings } from "../standings";
import { createTimeline, type ListenerRef } from "../timeline";
import { createFailures } from "./failures";
import { createSession, transition, viewedListener, type SessionState } from "./session";
import { createSettings } from "./settings";

const API_KEY = "fixture-key";
const NOW = Date.parse("2026-07-10T12:00:00Z");
const BRISTOL = listenerId("Bristol");

const bristol: FixtureUser = {
    username: "Bristol",
    // 02:00 UTC on 1 July is still 30 June in Los Angeles.
    history: scrobbles("Massive Attack", 10, "2026-07-01T02:00:00Z"),
};
const hidden: FixtureUser = { username: "Hidden", history: [], hidden: true };
const bath: FixtureUser = {
    username: "Bath",
    history: scrobbles("Goldfrapp", 6, "2026-07-05T08:00:00Z"),
};
const avon: FixtureUser = {
    username: "Avon",
    history: scrobbles("Roni Size", 3, "2026-07-06T08:00:00Z"),
};
const BATH = listenerId("Bath");
const AVON = listenerId("Avon");

/** A session over real storage and services, with last.fm faked and builds run in-process. */
async function setUp(
    db: Db,
    {
        apiKey,
        network,
        holds = () => false,
    }: {
        apiKey?: string;
        network?: { offline: boolean };
        /** Which requests get no answer until they are aborted. */
        holds?: (url: URL) => boolean;
    } = {},
) {
    const requests: URL[] = [];
    const events = createEventBus<IngestEvents>();
    if (apiKey !== undefined) await db.saveSettings({ ...(await db.loadSettings()), apiKey });
    const failures = createFailures();
    const settings = await createSettings(db, failures);
    const ingest = createIngest({
        db,
        events,
        transport: {
            now: () => NOW,
            sleep: async () => {},
            fetch: async (input, init) => {
                if (network?.offline) throw new TypeError("Failed to fetch");
                const url = new URL(input);
                requests.push(url);
                if (holds(url))
                    return new Promise((_, reject) =>
                        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
                    );
                const { status, body } = respondRecentTracks(
                    url,
                    [bristol, bath, avon, hidden],
                    API_KEY,
                );
                return new Response(JSON.stringify(body), { status });
            },
        },
    });
    const soundtracksOf = async (listener: ListenerRef, today: number, windowDays: number) =>
        buildSoundtracks(await db.scrobblesOf(listener.id), {
            timeZone: listener.timeZone,
            today,
            windowDays,
        });
    const timeline = createTimeline({
        build: async (listener, today, windowDays) => ({
            tables: buildStandings(await db.scrobblesOf(listener.id), {
                timeZone: listener.timeZone,
                today,
            }),
            soundtracks: await soundtracksOf(listener, today, windowDays),
        }),
        buildSoundtracks: soundtracksOf,
        events,
        now: () => NOW,
        requestFrame: () => () => {},
        playback: () => settings.store.getState(),
    });
    // Each look at the clock is a millisecond later, so views are ordered.
    let clock = NOW;
    const session = createSession({
        db,
        events,
        ingest,
        timeline,
        settings,
        failures,
        listeners: await db.listeners(),
        defaultTimeZone: "UTC",
        now: () => ++clock,
    });
    const firstDay = () => timeline.store.getState().tables?.firstDay;
    return { requests, settings, ingest, timeline, session, failures, firstDay };
}

const storedKey = (settings: Awaited<ReturnType<typeof createSettings>>) =>
    settings.store.getState().apiKey;

describe("setup", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`session-${crypto.randomUUID()}`);
    });

    test("offers the browser's timezone", async () => {
        const { session } = await setUp(db);

        expect(session.defaultTimeZone).toBe("UTC");
    });

    test.each([
        ["Nobody", API_KEY, "UnknownUser"],
        ["Bristol", "wrong-key", "InvalidKey"],
        ["Hidden", API_KEY, "PrivateHistory"],
    ])("turns %s with key %s down as %s, before any import", async (username, apiKey, kind) => {
        const { session, settings, ingest } = await setUp(db);

        await session.addListener({ username, apiKey, timeZone: "UTC" });

        expect(session.store.getState().screen).toEqual({
            kind: "setup",
            status: { kind: "rejected", problem: { kind }, username },
        });
        expect(storedKey(settings)).toBe("");
        expect(ingest.store.getState().queue).toEqual([]);
    });

    test("saves the key and imports in the chosen timezone once the probe passes", async () => {
        const { session, settings, firstDay } = await setUp(db);

        await session.addListener({
            username: "Bristol",
            apiKey: API_KEY,
            timeZone: "America/Los_Angeles",
        });

        expect(storedKey(settings)).toBe(API_KEY);
        await expect.poll(() => session.store.getState().screen.kind).toBe("dashboard");
        await expect.poll(firstDay).toEqual({
            date: "2026-06-30",
            timeZone: "America/Los_Angeles",
        });
    });
});

describe("an unfinished import", () => {
    let db: Db;
    beforeEach(async () => {
        db = openDb(`session-${crypto.randomUUID()}`);
        // A reload stopped Bristol's import with only their 4 newest Scrobbles stored.
        await db.putListener({
            id: BRISTOL,
            username: "Bristol",
            timeZone: "UTC",
            pinnedArtists: [],
            importTo: unixSecondsAt(NOW),
            syncedAt: unixSecondsAt(NOW),
            importComplete: false,
            pageSize: 1000,
            lastViewedAt: NOW,
        });
        await db.addPage(
            BRISTOL,
            bristol.history.slice(-4).map((scrobble) => ({
                ...scrobble,
                listenerId: BRISTOL,
                uts: unixSeconds(scrobble.uts),
            })),
            { last: false },
        );
    });

    test("resumes on load behind the import screen, then shows the dashboard", async () => {
        const { session, requests } = await setUp(db, { apiKey: API_KEY });

        expect(session.store.getState().screen).toEqual({
            kind: "importing",
            listenerId: BRISTOL,
            username: "Bristol",
        });
        await expect.poll(() => session.store.getState().screen.kind).toBe("dashboard");
        expect(requests).toHaveLength(1);
        expect(await db.scrobblesOf(BRISTOL)).toHaveLength(10);
    });

    test("pauses on a refused key, then resumes once Settings has a key last.fm takes", async () => {
        const { session, ingest, settings } = await setUp(db, { apiKey: "wrong-key" });
        await expect.poll(() => ingest.store.getState().queue.at(-1)?.status).toBe("paused");
        expect(session.store.getState().screen.kind).toBe("importing");

        await session.changeApiKey(API_KEY);

        expect(storedKey(settings)).toBe(API_KEY);
        await expect.poll(() => session.store.getState().screen.kind).toBe("dashboard");
        expect(await db.scrobblesOf(BRISTOL)).toHaveLength(10);
    });

    test("pauses after a run of transient failures, then resumes when asked", async () => {
        const network = { offline: true };
        const { session, ingest } = await setUp(db, { apiKey: API_KEY, network });
        await expect.poll(() => ingest.store.getState().queue.at(-1)?.status).toBe("paused");
        expect(session.store.getState().screen.kind).toBe("importing");

        network.offline = false;
        await session.resumeImport();

        await expect.poll(() => session.store.getState().screen.kind).toBe("dashboard");
        expect(await db.scrobblesOf(BRISTOL)).toHaveLength(10);
    });
});

describe("Settings", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`session-${crypto.randomUUID()}`);
    });

    async function onDashboard() {
        const app = await setUp(db);
        await app.session.addListener({ username: "Bristol", apiKey: API_KEY, timeZone: "UTC" });
        await expect.poll(app.firstDay).toBeDefined();
        return app;
    }

    test("a new API key is probed and kept unsaved if last.fm refuses it", async () => {
        const { session, settings } = await onDashboard();

        await session.changeApiKey("wrong-key");

        expect(session.store.getState().apiKeyCheck).toEqual({
            kind: "rejected",
            apiKey: "wrong-key",
            problem: { kind: "InvalidKey" },
        });
        expect(storedKey(settings)).toBe(API_KEY);
    });

    test("a new API key is saved once the probe passes", async () => {
        const { session, settings, requests } = await onDashboard();
        settings.update({ apiKey: "old" });

        await session.changeApiKey(API_KEY);

        expect(session.store.getState().apiKeyCheck).toEqual({ kind: "saved", apiKey: API_KEY });
        expect(storedKey(settings)).toBe(API_KEY);
        expect(requests.at(-1)?.searchParams.get("user")).toBe("Bristol");
    });

    test("changing the timezone rebuilds the tables only, with no re-import", async () => {
        const { session, firstDay, requests } = await onDashboard();
        const requestsBefore = requests.length;

        await session.changeTimeZone("America/Los_Angeles");

        await expect.poll(firstDay).toEqual({
            date: "2026-06-30",
            timeZone: "America/Los_Angeles",
        });
        expect(requests).toHaveLength(requestsBefore);
        expect(await db.listener(BRISTOL)).toMatchObject({
            timeZone: "America/Los_Angeles",
            importComplete: true,
        });
        expect(await db.scrobblesOf(BRISTOL)).toHaveLength(10);
    });
});

/** Stores `user`'s whole history, or only their newest Scrobble if their import is unfinished. */
async function seed(
    db: Db,
    user: FixtureUser,
    { complete, lastViewedAt }: { complete: boolean; lastViewedAt: number },
) {
    const id = listenerId(user.username);
    await db.putListener({
        id,
        username: user.username,
        timeZone: "UTC",
        pinnedArtists: [],
        importTo: unixSecondsAt(NOW),
        syncedAt: unixSecondsAt(NOW),
        importComplete: false,
        pageSize: 1000,
        lastViewedAt,
    });
    const rows = complete ? user.history : user.history.slice(-1);
    await db.addPage(
        id,
        rows.map((scrobble) => ({ ...scrobble, listenerId: id, uts: unixSeconds(scrobble.uts) })),
        { last: complete },
    );
}

type TestSession = Awaited<ReturnType<typeof setUp>>["session"];

/** What the session shows, in a word and a Listener. */
const viewing = (session: TestSession) => {
    const { screen } = session.store.getState();
    if (screen.kind === "dashboard") return `dashboard ${screen.listenerId}`;
    return screen.kind === "importing" ? `importing ${screen.listenerId}` : "setup";
};

const listedIds = (session: TestSession) =>
    session.store.getState().listeners.map((listener) => listener.id);

/** A request for a page of Bath's history, rather than the probe's one Scrobble. */
const isBathPage = (url: URL) =>
    url.searchParams.get("user") === "Bath" && url.searchParams.get("limit") !== "1";

describe("several Listeners", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`session-${crypto.randomUUID()}`);
    });

    test("boot opens the most recently viewed Listener and resumes every unfinished import", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        await seed(db, bath, { complete: false, lastViewedAt: NOW - 2000 });
        await seed(db, avon, { complete: false, lastViewedAt: NOW - 3000 });

        const { session, ingest, firstDay } = await setUp(db, { apiKey: API_KEY });

        expect(viewing(session)).toBe("dashboard bristol");
        await expect.poll(firstDay).toEqual({ date: "2026-07-01", timeZone: "UTC" });
        expect(ingest.store.getState().queue.map((job) => job.listenerId)).toEqual([BATH, AVON]);
        await expect.poll(async () => (await db.listener(AVON))?.importComplete).toBe(true);
        expect(await db.countScrobblesOf(BATH)).toBe(6);
        expect(viewing(session)).toBe("dashboard bristol");
    });

    test("boot opens an unfinished Listener's import when they were viewed last", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 2000 });
        await seed(db, bath, { complete: false, lastViewedAt: NOW - 1000 });

        const { session } = await setUp(db, { apiKey: API_KEY });

        expect(viewing(session)).toBe("importing bath");
        await expect.poll(() => viewing(session)).toBe("dashboard bath");
    });

    test("lists every Listener, most recently viewed first", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 2000 });
        await seed(db, bath, { complete: true, lastViewedAt: NOW - 1000 });

        const { session } = await setUp(db, { apiKey: API_KEY });

        expect(listedIds(session)).toEqual([BATH, BRISTOL]);
    });

    test("switching Listeners rebuilds the tables, resets the Focus Day and window, and is remembered", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        await seed(db, bath, { complete: true, lastViewedAt: NOW - 2000 });
        const { session, timeline, firstDay } = await setUp(db, { apiKey: API_KEY });
        await expect.poll(firstDay).toEqual({ date: "2026-07-01", timeZone: "UTC" });
        timeline.seek(1, { glide: false });
        timeline.setWindow({ start: 1, end: 2 });

        await session.open(BATH);

        expect(viewing(session)).toBe("dashboard bath");
        await expect.poll(firstDay).toEqual({ date: "2026-07-05", timeZone: "UTC" });
        // 5 to 10 July: six Days, the last in focus and all in view.
        expect(timeline.getView()).toEqual({ playhead: 5, window: { start: 0, end: 5 } });
        expect(listedIds(session)).toEqual([BATH, BRISTOL]);
        const reopened = await setUp(db, { apiKey: API_KEY });
        expect(viewing(reopened.session)).toBe("dashboard bath");
    });

    test("a new Listener imports in the background while another is viewed", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        const { session, timeline } = await setUp(db, { apiKey: API_KEY });

        session.startAdding();
        expect(viewing(session)).toBe("setup");
        await session.addListener({ username: "Bath", apiKey: API_KEY, timeZone: "UTC" });
        expect(viewing(session)).toBe("importing bath");
        expect(timeline.store.getState().tables).toBeUndefined();
        await session.open(BRISTOL);

        await expect.poll(async () => (await db.listener(BATH))?.importComplete).toBe(true);
        await expect.poll(() => listedIds(session)).toEqual([BRISTOL, BATH]);
        expect(viewing(session)).toBe("dashboard bristol");
    });

    test("leaving setup goes back to the Listener viewed last", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        const { session } = await setUp(db, { apiKey: API_KEY });

        session.startAdding();
        await session.cancelAdding();

        expect(viewing(session)).toBe("dashboard bristol");
    });

    test.each(["Bristol", "BRISTOL", "bristol"])(
        "a username already added is refused as %s, before any request",
        async (username) => {
            await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
            const { session, requests } = await setUp(db, { apiKey: API_KEY });
            session.startAdding();

            await session.addListener({ username, apiKey: API_KEY, timeZone: "UTC" });

            expect(session.store.getState().screen).toEqual({
                kind: "setup",
                status: { kind: "rejected", problem: { kind: "ListenerTaken" }, username },
            });
            expect(requests).toEqual([]);
            expect(await db.countScrobblesOf(BRISTOL)).toBe(10);
        },
    );

    test("removing the current Listener deletes them and opens the one viewed most recently after", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        await seed(db, bath, { complete: true, lastViewedAt: NOW - 3000 });
        await seed(db, avon, { complete: true, lastViewedAt: NOW - 2000 });
        const { session, firstDay } = await setUp(db, { apiKey: API_KEY });
        expect(await session.scrobbleCount(BRISTOL)).toBe(10);

        await session.removeListener(BRISTOL);

        expect(viewing(session)).toBe("dashboard avon");
        await expect.poll(firstDay).toEqual({ date: "2026-07-06", timeZone: "UTC" });
        expect(await db.listener(BRISTOL)).toBeUndefined();
        expect(await db.countScrobblesOf(BRISTOL)).toBe(0);
        expect(listedIds(session)).toEqual([AVON, BATH]);
    });

    test("removing a Listener mid-import cancels it and leaves the current one in view", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        const { session, ingest } = await setUp(db, { apiKey: API_KEY, holds: isBathPage });
        session.startAdding();
        await session.addListener({ username: "Bath", apiKey: API_KEY, timeZone: "UTC" });
        await session.open(BRISTOL);
        await expect.poll(() => ingest.store.getState().queue.at(-1)?.status).toBe("running");

        await session.removeListener(BATH);

        expect(viewing(session)).toBe("dashboard bristol");
        expect(ingest.store.getState().queue.at(-1)).toMatchObject({
            listenerId: BATH,
            status: "cancelled",
        });
        expect(await db.listener(BATH)).toBeUndefined();
        expect(await db.countScrobblesOf(BATH)).toBe(0);
        expect(listedIds(session)).toEqual([BRISTOL]);
    });

    test("removing the only finished Listener opens one still importing, not setup", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        const { session } = await setUp(db, { apiKey: API_KEY, holds: isBathPage });
        session.startAdding();
        await session.addListener({ username: "Bath", apiKey: API_KEY, timeZone: "UTC" });
        await session.open(BRISTOL);

        await session.removeListener(BRISTOL);

        expect(viewing(session)).toBe("importing bath");
        session.startAdding();
        await session.cancelAdding();
        expect(viewing(session)).toBe("importing bath");
    });

    test("re-adding an unfinished Listener in another case resumes them under their own name", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        await seed(db, bath, { complete: false, lastViewedAt: NOW - 2000 });
        const { session, ingest } = await setUp(db, { apiKey: "wrong-key" });
        await expect.poll(() => ingest.store.getState().queue.at(-1)?.status).toBe("paused");
        session.startAdding();

        await session.addListener({ username: "BATH", apiKey: API_KEY, timeZone: "UTC" });

        expect(session.store.getState().screen).toEqual({
            kind: "importing",
            listenerId: BATH,
            username: "Bath",
        });
        await expect.poll(() => viewing(session)).toBe("dashboard bath");
        expect(listedIds(session)[0]).toBe(BATH);
    });

    test("removing the last Listener shows setup", async () => {
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        const { session, timeline } = await setUp(db, { apiKey: API_KEY });

        await session.removeListener(BRISTOL);

        expect(session.store.getState().screen).toEqual({
            kind: "setup",
            status: { kind: "editing" },
        });
        expect(timeline.store.getState().tables).toBeUndefined();
        expect(await db.listeners()).toEqual([]);
    });
});

/** Bristol's Import job, settled with `outcome`. */
const job = (outcome: Outcome): Job => ({
    id: 1,
    kind: "import",
    listenerId: BRISTOL,
    username: "Bristol",
    progress: { kind: "uncounted" },
    ...outcome,
});
const offline = { kind: "Transient", message: "Network error" } as const;

/** The Pinned Artists of the Listener the dashboard shows. */
const pinsOnScreen = (session: TestSession) =>
    viewedListener(session.store.getState())?.pinnedArtists;

describe("Pinned Artists", () => {
    let db: Db;
    beforeEach(async () => {
        db = openDb(`session-${crypto.randomUUID()}`);
        await seed(db, bristol, { complete: true, lastViewedAt: NOW - 1000 });
        await seed(db, bath, { complete: true, lastViewedAt: NOW - 2000 });
    });

    test("are kept by name on the Listener, once each, through a reload until unpinned", async () => {
        const { session } = await setUp(db, { apiKey: API_KEY });

        await session.pin("Massive Attack");
        await session.pin("Burial");
        await session.pin("Massive Attack");

        expect(pinsOnScreen(session)).toEqual(["Massive Attack", "Burial"]);
        const reopened = await setUp(db, { apiKey: API_KEY });
        expect(pinsOnScreen(reopened.session)).toEqual(["Massive Attack", "Burial"]);

        await reopened.session.unpin("Massive Attack");

        expect(pinsOnScreen(reopened.session)).toEqual(["Burial"]);
        expect((await db.listener(BRISTOL))?.pinnedArtists).toEqual(["Burial"]);
    });

    test("are kept for each Listener", async () => {
        const { session } = await setUp(db, { apiKey: API_KEY });
        await session.pin("Massive Attack");

        await session.open(BATH);
        expect(pinsOnScreen(session)).toEqual([]);
        await session.pin("Goldfrapp");
        await session.open(BRISTOL);

        expect(pinsOnScreen(session)).toEqual(["Massive Attack"]);
        expect((await db.listener(BATH))?.pinnedArtists).toEqual(["Goldfrapp"]);
    });

    test("a pin the browser's storage refuses is reported, and the screen keeps what is stored", async () => {
        const refusing: Db = {
            ...db,
            updateListener: () => Promise.reject(new Error("QuotaExceededError")),
        };
        const { session, failures } = await setUp(refusing, { apiKey: API_KEY });

        await session.pin("Massive Attack");

        expect(pinsOnScreen(session)).toEqual([]);
        expect(failures.store.getState().latest?.message).toBe(
            "Couldn't pin the Artist: Error: QuotaExceededError",
        );
    });

    test("survive a Sync", async () => {
        const { session, ingest } = await setUp(db, { apiKey: API_KEY });
        await session.pin("Massive Attack");

        session.sync();

        await expect.poll(() => ingest.store.getState().queue.at(-1)?.status).toBe("done");
        await expect.poll(() => pinsOnScreen(session)).toEqual(["Massive Attack"]);
        expect((await db.listener(BRISTOL))?.pinnedArtists).toEqual(["Massive Attack"]);
    });
});

describe("the session's transitions", () => {
    const bristolRow = {
        id: BRISTOL,
        username: "Bristol",
        timeZone: "UTC",
        pinnedArtists: [],
        importTo: unixSecondsAt(NOW),
        syncedAt: unixSecondsAt(NOW),
        importComplete: true,
        pageSize: 1000 as const,
        lastViewedAt: NOW,
    };
    const importing: SessionState = {
        screen: { kind: "importing", listenerId: BRISTOL, username: "Bristol" },
        apiKeyCheck: { kind: "idle" },
        listeners: [],
    };
    const dashboard: SessionState = {
        screen: { kind: "dashboard", listenerId: BRISTOL },
        apiKeyCheck: { kind: "idle" },
        listeners: [bristolRow],
    };

    test("a paused import stays behind the import screen", () => {
        expect(
            transition(importing, {
                type: "jobSettled",
                job: job({ status: "paused", error: offline }),
                listener: undefined,
            }),
        ).toBe(importing);
    });

    test("a cancelled import is its own outcome, not a failure", () => {
        expect(
            transition(importing, {
                type: "jobSettled",
                job: job({ status: "cancelled" }),
                listener: undefined,
            }).screen,
        ).toEqual({
            kind: "setup",
            status: { kind: "rejected", problem: { kind: "ImportCancelled" }, username: "Bristol" },
        });
    });

    test("an event the state doesn't accept leaves it unchanged", () => {
        expect(transition(dashboard, { type: "submitted" })).toBe(dashboard);
        expect(
            transition(dashboard, { type: "keyProbed", apiKey: "k", result: { ok: true } }),
        ).toBe(dashboard);
        expect(
            transition(importing, {
                type: "listenerChanged",
                listener: { ...bristolRow, timeZone: "Europe/Vilnius" },
            }),
        ).toBe(importing);
    });

    test.each([
        [{ kind: "UnknownUser" } as const, "saved"],
        [{ kind: "PrivateHistory" } as const, "saved"],
        [{ kind: "InvalidKey" } as const, "rejected"],
        [{ kind: "Unavailable", message: "offline" } as const, "rejected"],
    ])("a new key the probe answers with %o is %s", (problem, kind) => {
        const checking = transition(dashboard, { type: "keySubmitted", apiKey: "k" });

        expect(
            transition(checking, {
                type: "keyProbed",
                apiKey: "k",
                result: { ok: false, problem },
            }).apiKeyCheck.kind,
        ).toBe(kind);
    });
});
