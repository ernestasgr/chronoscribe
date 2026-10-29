// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { respondRecentTracks, scrobbles, type FixtureUser } from "../../test-support/lastfm";
import { listenerId, openDb, type Db } from "../db";
import { unixSeconds, unixSecondsAt } from "../lastfm";
import { createEventBus } from "../events";
import { createIngest, type IngestEvents, type Job, type Outcome } from "../ingest";
import { buildStandings } from "../standings";
import { createTimeline } from "../timeline";
import { createSession, transition, type SessionState } from "./session";
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

/** A session over real storage and services, with last.fm faked and builds run in-process. */
async function setUp(
    db: Db,
    { apiKey, network }: { apiKey?: string; network?: { offline: boolean } } = {},
) {
    const requests: URL[] = [];
    const events = createEventBus<IngestEvents>();
    if (apiKey !== undefined) await db.saveSettings({ ...(await db.loadSettings()), apiKey });
    const settings = await createSettings(db);
    const ingest = createIngest({
        db,
        events,
        transport: {
            now: () => NOW,
            sleep: async () => {},
            fetch: async (input) => {
                if (network?.offline) throw new TypeError("Failed to fetch");
                const url = new URL(input);
                requests.push(url);
                const { status, body } = respondRecentTracks(url, [bristol, hidden], API_KEY);
                return new Response(JSON.stringify(body), { status });
            },
        },
    });
    const timeline = createTimeline({
        build: async (listener, today) =>
            buildStandings(await db.scrobblesOf(listener.id), {
                timeZone: listener.timeZone,
                today,
            }),
        events,
        now: () => NOW,
        requestFrame: () => () => {},
        playback: () => settings.store.getState(),
    });
    const session = createSession({
        db,
        events,
        ingest,
        timeline,
        settings,
        listeners: await db.listeners(),
        defaultTimeZone: "UTC",
    });
    const firstDay = () => timeline.store.getState().tables?.firstDay;
    return { requests, settings, ingest, timeline, session, firstDay };
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

describe("the session's transitions", () => {
    const bristolRow = {
        id: BRISTOL,
        username: "Bristol",
        timeZone: "UTC",
        pinnedArtists: [],
        importTo: unixSecondsAt(NOW),
        importComplete: true,
        pageSize: 1000 as const,
        lastViewedAt: NOW,
    };
    const importing: SessionState = {
        screen: { kind: "importing", listenerId: BRISTOL, username: "Bristol" },
        apiKeyCheck: { kind: "idle" },
    };
    const dashboard: SessionState = {
        screen: { kind: "dashboard", listener: bristolRow },
        apiKeyCheck: { kind: "idle" },
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
