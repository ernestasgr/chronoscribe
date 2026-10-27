// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
    LASTFM_ORIGIN,
    scrobbles,
    respondRecentTracks,
    type FixtureUser,
} from "../../test-support/lastfm";
import { openDb, type Db } from "../db";
import { createEventBus } from "../events";
import { createIngest, type IngestEvents, type JobStatus } from ".";

const API_KEY = "fixture-key";
const NOW = Date.parse("2026-07-10T12:00:00Z");

const request = (username: string, apiKey = API_KEY) => ({ username, apiKey, timeZone: "UTC" });

function fakeTransport(users: FixtureUser[]) {
    let clock = NOW;
    const requests: { url: URL; at: number }[] = [];
    return {
        requests,
        transport: {
            now: () => clock,
            sleep: async (ms: number) => {
                clock += ms;
            },
            fetch: async (input: string | URL | Request, init?: RequestInit) => {
                init?.signal?.throwIfAborted();
                const url = new URL(String(input));
                requests.push({ url, at: clock });
                if (url.origin !== LASTFM_ORIGIN) throw new TypeError("unexpected host");
                const { status, body } = respondRecentTracks(url, users, API_KEY);
                clock += 40; // response latency
                return new Response(JSON.stringify(body), {
                    status,
                    headers: { "content-type": "application/json" },
                });
            },
        },
    };
}

describe("the Import job", () => {
    let db: Db;
    const bristol: FixtureUser = {
        username: "Bristol",
        history: [
            ...scrobbles("Massive Attack", 1200, "2026-07-01T08:00:00Z"),
            ...scrobbles("Portishead", 900, "2026-07-03T08:00:00Z"),
            // Scrobbled after the import starts, so outside its fixed `to`
            ...scrobbles("Tricky", 3, "2026-07-10T12:30:00Z"),
        ],
        nowPlaying: { artist: "Tricky", track: "Overcome", album: "Maxinquaye" },
    };
    const bath: FixtureUser = {
        username: "Bath",
        history: scrobbles("Goldfrapp", 1500, "2026-07-02T08:00:00Z"),
    };

    function setUp(users: FixtureUser[] = [bristol]) {
        const fake = fakeTransport(users);
        const events = createEventBus<IngestEvents>();
        return { ...fake, events, ingest: createIngest({ db, events, transport: fake.transport }) };
    }

    beforeEach(() => {
        db = openDb(`ingest-${crypto.randomUUID()}`);
    });

    test("imports every Scrobble up to the start of the job, skipping the now-playing entry", async () => {
        const { ingest } = setUp();
        const job = await ingest.enqueueImport(request("Bristol"));

        expect(job).toMatchObject({ status: "done", progress: { fetched: 2100, total: 2100 } });
        const stored = await db.scrobblesOf("bristol");
        expect(stored).toHaveLength(2100);
        expect(stored.filter((s) => s.artist === "Tricky")).toEqual([]);
        expect(stored[0]).toEqual({
            listenerId: "bristol",
            uts: Date.parse("2026-07-01T08:00:00Z") / 1000,
            artist: "Massive Attack",
            track: "Massive Attack track 0",
            album: "Massive Attack album",
        });
        expect(await db.listener("bristol")).toMatchObject({
            username: "Bristol",
            timeZone: "UTC",
            importComplete: true,
        });
    });

    test("pages newest-first with limit=1000 and a fixed `to`", async () => {
        const { ingest, requests } = setUp();
        await ingest.enqueueImport(request("Bristol"));

        expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
        for (const { url } of requests) {
            expect(url.searchParams.get("limit")).toBe("1000");
            expect(url.searchParams.get("to")).toBe(String(NOW / 1000));
        }
    });

    test("makes at most 4 requests per second across every job", async () => {
        const { ingest, requests } = setUp([bristol, bath]);
        await Promise.all([
            ingest.enqueueImport(request("Bristol")),
            ingest.enqueueImport(request("Bath")),
        ]);

        expect(requests).toHaveLength(5);
        const gaps = requests.slice(1).map((r, i) => r.at - requests[i]!.at);
        expect(gaps.every((gap) => gap >= 250)).toBe(true);
    });

    test("publishes each job's progress and ETA to the queue", async () => {
        const { ingest } = setUp();
        const seen: { status: JobStatus; fetched?: number; etaMs?: number }[] = [];
        const unsubscribe = ingest.store.subscribe(({ queue: [job] }) => {
            if (job)
                seen.push({ status: job.status, fetched: job.progress?.fetched, etaMs: job.etaMs });
        });
        await ingest.enqueueImport(request("Bristol"));
        unsubscribe();

        expect(seen.slice(0, 2).map((s) => s.status)).toEqual(["queued", "running"]);
        expect(new Set(seen.map((s) => s.fetched).filter(Boolean))).toEqual(
            new Set([1000, 2000, 2100]),
        );
        expect(seen.find((s) => s.fetched === 1000)!.etaMs).toBeGreaterThan(0);
        expect(seen.at(-1)).toMatchObject({ status: "done", etaMs: 0 });
    });

    test("runs one job at a time, in the order queued", async () => {
        const { ingest } = setUp([bristol, bath]);
        const started: string[] = [];
        let mostRunning = 0;
        const unsubscribe = ingest.store.subscribe(({ queue }) => {
            const running = queue.filter((job) => job.status === "running");
            mostRunning = Math.max(mostRunning, running.length);
            running
                .filter((job) => !started.includes(job.username))
                .forEach((job) => started.push(job.username));
        });
        const jobs = [
            ingest.enqueueImport(request("Bristol")),
            ingest.enqueueImport(request("Bath")),
        ];
        expect(ingest.store.getState().queue.map((job) => job.status)).toEqual([
            "queued",
            "queued",
        ]);

        const settled = await Promise.all(jobs);
        unsubscribe();
        expect(settled.map((job) => job.status)).toEqual(["done", "done"]);
        expect(started).toEqual(["Bristol", "Bath"]);
        expect(mostRunning).toBe(1);
    });

    test("cancelling a Listener aborts their running job and keeps it incomplete", async () => {
        const { ingest, requests } = setUp();
        const unsubscribe = ingest.store.subscribe(({ queue: [job] }) => {
            if (job?.progress && job.status === "running") ingest.cancel("bristol");
        });
        const job = await ingest.enqueueImport(request("Bristol"));
        unsubscribe();

        expect(job.status).toBe("cancelled");
        expect(requests).toHaveLength(1);
        expect(await db.listener("bristol")).toMatchObject({ importComplete: false });
    });

    test("a Hard last.fm error fails the job with that error and emits no change", async () => {
        const { ingest, events } = setUp();
        const changed: string[] = [];
        events.on("scrobblesChanged", ({ listenerId }) => changed.push(listenerId));

        const job = await ingest.enqueueImport(request("Bristol", "wrong-key"));

        expect(job).toMatchObject({ status: "failed", error: { kind: "Hard", code: 10 } });
        expect(changed).toEqual([]);
    });

    test("emits scrobblesChanged once the Scrobbles are stored, then jobSettled", async () => {
        const { ingest, events } = setUp();
        const seen: string[] = [];
        const stored: number[] = [];
        events.on("scrobblesChanged", ({ listenerId }) => {
            seen.push(`changed ${listenerId}`);
            void db.scrobblesOf(listenerId).then((rows) => stored.push(rows.length));
        });
        events.on("jobSettled", ({ job }) => seen.push(`settled ${job.listenerId} ${job.status}`));

        await ingest.enqueueImport(request("Bristol"));

        expect(seen).toEqual(["changed bristol", "settled bristol done"]);
        await expect.poll(() => stored).toEqual([2100]);
    });
});
