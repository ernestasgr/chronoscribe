// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { respondRecentTracks, scrobbles, type FixtureUser } from "../../test-support/lastfm";
import { openDb, type Db } from "../db";
import { createEventBus } from "../events";
import { createIngest, type IngestEvents } from "../ingest";
import { buildStandings } from "../standings";
import { createTimeline } from "../timeline";
import { createSession, transition, type SessionState } from "./session";
import { createSettings } from "./settings";

const API_KEY = "fixture-key";
const NOW = Date.parse("2026-07-10T12:00:00Z");

const bristol: FixtureUser = {
    username: "Bristol",
    // 02:00 UTC on 1 July is still 30 June in Los Angeles.
    history: scrobbles("Massive Attack", 10, "2026-07-01T02:00:00Z"),
};
const hidden: FixtureUser = { username: "Hidden", history: [], hidden: true };

/** A session over real storage and services, with last.fm faked and builds run in-process. */
async function setUp(db: Db) {
    const requests: URL[] = [];
    const events = createEventBus<IngestEvents>();
    const settings = await createSettings(db);
    const ingest = createIngest({
        db,
        events,
        transport: {
            now: () => NOW,
            sleep: async () => {},
            fetch: async (input) => {
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
        initial: undefined,
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
        expect(await db.listener("bristol")).toMatchObject({
            timeZone: "America/Los_Angeles",
            importComplete: true,
        });
        expect(await db.scrobblesOf("bristol")).toHaveLength(10);
    });
});

/** Bristol's Import job, settled with `status`. */
const job = (status: "done" | "failed" | "cancelled") => ({
    id: 1,
    kind: "import" as const,
    listenerId: "bristol",
    username: "Bristol",
    status,
});

describe("the session's transitions", () => {
    const bristolRow = {
        id: "bristol",
        username: "Bristol",
        timeZone: "UTC",
        pinnedArtists: [],
        importTo: NOW / 1000,
        importComplete: true,
        lastViewedAt: NOW,
    };
    const importing: SessionState = {
        screen: { kind: "importing", listenerId: "bristol", username: "Bristol" },
        apiKeyCheck: { kind: "idle" },
    };
    const dashboard: SessionState = {
        screen: { kind: "dashboard", listener: bristolRow },
        apiKeyCheck: { kind: "idle" },
    };

    test("a cancelled import is its own outcome, not a failure", () => {
        expect(
            transition(importing, {
                type: "jobSettled",
                job: job("cancelled"),
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
