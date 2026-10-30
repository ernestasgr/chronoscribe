// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
    LASTFM_ORIGIN,
    scrobbles,
    respondRecentTracks,
    type FixtureResponse,
    type FixtureUser,
} from "../../test-support/lastfm";
import { listenerId, openDb, type Db } from "../db";
import { unixSecondsAt } from "../lastfm";
import { createEventBus } from "../events";
import { createIngest, transition, type IngestEvents, type Job, type JobStatus } from ".";

const API_KEY = "fixture-key";
const NOW = Date.parse("2026-07-10T12:00:00Z");
const BRISTOL = listenerId("Bristol");
const TWINS = listenerId("Twins");

const request = (username: string, apiKey = API_KEY) => ({ username, apiKey, timeZone: "UTC" });

/** What a scripted request gets instead of the fixture's answer: a response, or no answer at all. */
type Scripted = FixtureResponse | "offline" | undefined;

/** A last.fm error body, as the real API sends it. */
const lastfmError = (error: number, status = 500): FixtureResponse => ({
    status,
    body: { error, message: `last.fm error ${error}` },
});

/** The fixture's answer, as if last.fm had capped the page at `perPage`. */
const cappedAt = (perPage: number, url: URL, users: FixtureUser[]): FixtureResponse => {
    const capped = new URL(url);
    capped.searchParams.set(
        "limit",
        String(Math.min(perPage, Number(url.searchParams.get("limit")))),
    );
    return respondRecentTracks(capped, users, API_KEY);
};

/** last.fm over `users` on a fake clock; `script` may answer any request, by index, instead. */
function fakeTransport(
    users: FixtureUser[],
    script: (url: URL, index: number) => Scripted = () => undefined,
) {
    let clock = NOW;
    const requests: { url: URL; at: number }[] = [];
    const sleeps: number[] = [];
    return {
        requests,
        sleeps,
        transport: {
            now: () => clock,
            sleep: async (ms: number) => {
                sleeps.push(ms);
                clock += ms;
            },
            fetch: async (input: string | URL | Request, init?: RequestInit) => {
                init?.signal?.throwIfAborted();
                const url = new URL(String(input));
                requests.push({ url, at: clock });
                if (url.origin !== LASTFM_ORIGIN) throw new TypeError("unexpected host");
                const scripted = script(url, requests.length - 1);
                if (scripted === "offline") throw new TypeError("Failed to fetch");
                const { status, body } = scripted ?? respondRecentTracks(url, users, API_KEY);
                clock += 40; // response latency
                return new Response(JSON.stringify(body), {
                    status,
                    headers: { "content-type": "application/json" },
                });
            },
        },
    };
}

/** Each stored Scrobble as one line, to compare a stored history with the fixture's. */
const lines = (rows: readonly { uts: number; track: string }[]) =>
    rows.map(({ uts, track }) => `${uts} ${track}`).toSorted();

/** Each page request's page, limit and `to`. */
const pageRequests = (requests: readonly { url: URL }[]) =>
    requests.map(({ url }) => ({
        page: url.searchParams.get("page"),
        limit: url.searchParams.get("limit"),
        to: url.searchParams.get("to"),
    }));

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

    function setUp(
        users: FixtureUser[] = [bristol],
        script?: (url: URL, index: number) => Scripted,
    ) {
        const fake = fakeTransport(users, script);
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
        const stored = await db.scrobblesOf(BRISTOL);
        expect(stored).toHaveLength(2100);
        expect(stored.filter((s) => s.artist === "Tricky")).toEqual([]);
        expect(stored[0]).toEqual({
            listenerId: BRISTOL,
            uts: Date.parse("2026-07-01T08:00:00Z") / 1000,
            artist: "Massive Attack",
            track: "Massive Attack track 0",
            album: "Massive Attack album",
        });
        expect(await db.listener(BRISTOL)).toMatchObject({
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
                seen.push(
                    job.progress.kind === "counted"
                        ? { status: job.status, ...job.progress }
                        : { status: job.status },
                );
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
            if (job?.progress.kind === "counted" && job.status === "running")
                ingest.cancel(BRISTOL);
        });
        const job = await ingest.enqueueImport(request("Bristol"));
        unsubscribe();

        expect(job.status).toBe("cancelled");
        expect(requests).toHaveLength(1);
        expect(await db.listener(BRISTOL)).toMatchObject({ importComplete: false });
    });

    test("a Hard last.fm error pauses the job with that error and emits no change", async () => {
        const { ingest, events } = setUp();
        const changed: string[] = [];
        events.on("scrobblesChanged", (changedEvent) => changed.push(changedEvent.listenerId));

        const job = await ingest.enqueueImport(request("Bristol", "wrong-key"));

        expect(job).toMatchObject({ status: "paused", error: { kind: "Hard", code: 10 } });
        expect(changed).toEqual([]);
    });

    test.each([
        [
            "a page count that isn't a number",
            { recenttracks: { track: [], "@attr": { page: "x" } } },
        ],
        [
            "a Scrobble with no artist",
            {
                recenttracks: {
                    track: [{ name: "t", album: { "#text": "a" }, date: { uts: "1" } }],
                    "@attr": { page: "1", perPage: "1000", totalPages: "1", total: "1" },
                },
            },
        ],
        ["a body that isn't an object", "Bad gateway"],
    ])(
        "a malformed page (%s) pauses at once with a Hard error, storing nothing",
        async (_, body) => {
            const { ingest, requests } = setUp([bristol], () => ({ status: 200, body }));
            const job = await ingest.enqueueImport(request("Bristol"));

            expect(job).toMatchObject({ status: "paused", error: { kind: "Hard" } });
            expect(requests).toHaveLength(1);
            expect(await db.scrobblesOf(BRISTOL)).toEqual([]);
        },
    );

    test.each([6, 10, 17])(
        "a Hard error %i mid-run pauses at once, keeping the pages stored before it",
        async (code) => {
            const { ingest, requests, sleeps } = setUp([bristol], (_, index) =>
                index === 1 ? lastfmError(code, 400) : undefined,
            );

            const job = await ingest.enqueueImport(request("Bristol"));

            expect(job).toMatchObject({ status: "paused", error: { kind: "Hard", code } });
            expect(requests).toHaveLength(2);
            expect(sleeps.filter((ms) => ms >= 1000)).toEqual([]);
            expect(await db.scrobblesOf(BRISTOL)).toHaveLength(1000);
            expect(await db.listener(BRISTOL)).toMatchObject({ importComplete: false });
        },
    );

    // Two Scrobbles share the second that page 1 ends on: one lands on page 1, its twin on page 2.
    const twins: FixtureUser = (() => {
        const history = scrobbles("Goldfrapp", 1499, "2026-07-02T08:00:00Z");
        return { username: "Twins", history: [...history, { ...history[499]!, track: "Twin" }] };
    })();

    /** Runs `username`'s import until its first page is stored, then stops it, as a reload would. */
    async function interruptAfterFirstPage(username: string) {
        const { ingest } = setUp([twins, bristol]);
        const unsubscribe = ingest.store.subscribe(({ queue: [job] }) => {
            if (job?.progress.kind === "counted" && job.status === "running")
                ingest.cancel(listenerId(username));
        });
        await ingest.enqueueImport(request(username));
        unsubscribe();
    }

    test("resumes from the oldest stored second, with nothing dropped or duplicated", async () => {
        await interruptAfterFirstPage("Twins");
        const stored = await db.scrobblesOf(TWINS);
        expect(stored).toHaveLength(1000);
        const oldestUts = stored[0]!.uts;

        const { ingest, requests } = setUp([twins]);
        const job = await ingest.enqueueImport(request("Twins"));

        expect(job).toMatchObject({ status: "done", progress: { fetched: 1500, total: 1500 } });
        expect(requests.map(({ url }) => Object.fromEntries(url.searchParams))).toMatchObject([
            { page: "1", to: String(oldestUts + 1) },
        ]);
        expect(lines(await db.scrobblesOf(TWINS))).toEqual(lines(twins.history));
        expect(await db.listener(TWINS)).toMatchObject({
            importTo: unixSecondsAt(NOW),
            importComplete: true,
        });
    });

    /** Each Import job state `ingest` publishes, as the status line would read it. */
    function watch(ingest: ReturnType<typeof setUp>["ingest"]) {
        const seen: Job[] = [];
        const unsubscribe = ingest.store.subscribe(({ queue: [job] }) => {
            if (job) seen.push(job);
        });
        return { seen, unsubscribe };
    }

    test("retries transient errors with exponential backoff, counting failures afresh after each success", async () => {
        // Requests 1–4 and 6–9 fail, each run short of the 5 that would pause the import.
        const answers: Scripted[] = ["offline", lastfmError(29), lastfmError(8), lastfmError(16)];
        const { ingest, sleeps } = setUp([bristol], (_, index) =>
            index >= 1 && index <= 4
                ? answers[index - 1]
                : index >= 6 && index <= 9
                  ? lastfmError(11)
                  : undefined,
        );
        const { seen, unsubscribe } = watch(ingest);

        const job = await ingest.enqueueImport(request("Bristol"));
        unsubscribe();

        expect(job).toMatchObject({ status: "done", progress: { fetched: 2100, total: 2100 } });
        // The first failure is at 1000, and switching to 200 makes a new request that counts afresh.
        expect(sleeps.filter((ms) => ms >= 1000)).toEqual([
            1000, 1000, 2000, 4000, 1000, 2000, 4000, 8000,
        ]);
        expect(seen.flatMap((s) => (s.status === "retrying" ? [s.retry] : []))).toContainEqual({
            failures: 2,
            pausesAt: 5,
            inMs: 2000,
            error: expect.objectContaining({ kind: "Transient", code: 8 }),
        });
        expect(seen.at(-1)?.status).toBe("done");
        expect(lines(await db.scrobblesOf(BRISTOL))).toEqual(
            lines(bristol.history.filter(({ artist }) => artist !== "Tricky")),
        );
    });

    test("pauses after 5 transient failures in a row on one request, keeping every stored page", async () => {
        const { ingest, events, requests } = setUp([bristol], (_, index) =>
            index >= 1 && index <= 6 ? lastfmError(29) : undefined,
        );
        const changed: string[] = [];
        events.on("scrobblesChanged", (changedEvent) => changed.push(changedEvent.listenerId));

        const paused = await ingest.enqueueImport(request("Bristol"));

        expect(paused).toMatchObject({
            status: "paused",
            error: { kind: "Transient", code: 29 },
            progress: { fetched: 999, total: 2100 },
        });
        // One failure at 1000 switches to a new request of 200, which then fails 5 times in a row.
        expect(
            pageRequests(requests)
                .slice(1)
                .map(({ limit }) => limit),
        ).toEqual(["1000", "200", "200", "200", "200", "200"]);
        // Page 1 is kept, less its oldest second, which the switch to pages of 200 fetches again.
        expect(await db.scrobblesOf(BRISTOL)).toHaveLength(999);
        expect(await db.listener(BRISTOL)).toMatchObject({ importComplete: false });
        expect(changed).toEqual([]);

        const resumed = await ingest.enqueueImport(request("Bristol"));
        expect(resumed).toMatchObject({ status: "done", progress: { fetched: 2100, total: 2100 } });
        expect(lines(await db.scrobblesOf(BRISTOL))).toEqual(
            lines(bristol.history.filter(({ artist }) => artist !== "Tricky")),
        );
        expect(changed).toEqual(["bristol"]);
    });

    test("switches to pages of 200 for the rest of the run once last.fm caps perPage below 1000", async () => {
        const { ingest, requests } = setUp([bristol], (url, index) =>
            index >= 1 ? cappedAt(200, url, [bristol]) : undefined,
        );

        const job = await ingest.enqueueImport(request("Bristol"));

        expect(job).toMatchObject({ status: "done", progress: { fetched: 2100, total: 2100 } });
        const [first, capped, ...rest] = pageRequests(requests);
        expect(first).toMatchObject({ page: "1", limit: "1000" });
        expect(capped).toMatchObject({ page: "2", limit: "1000" });
        const oldestOfFirstPage = Date.parse("2026-07-01T08:00:00Z") / 1000 + 1100 * 60;
        expect(rest[0]).toEqual({ page: "1", limit: "200", to: String(oldestOfFirstPage + 1) });
        expect(rest.every(({ limit }) => limit === "200")).toBe(true);
        expect(lines(await db.scrobblesOf(BRISTOL))).toEqual(
            lines(bristol.history.filter(({ artist }) => artist !== "Tricky")),
        );
        expect(await db.listener(BRISTOL)).toMatchObject({ pageSize: 200 });
    });

    test("switches to pages of 200 when a page of 1000 fails, and remembers it for the Listener", async () => {
        const { ingest, requests } = setUp([bristol], (_, index) =>
            index === 1 ? lastfmError(8) : undefined,
        );

        const job = await ingest.enqueueImport(request("Bristol"));

        expect(job).toMatchObject({ status: "done", progress: { fetched: 2100, total: 2100 } });
        expect(pageRequests(requests).slice(1, 3)).toMatchObject([
            { page: "2", limit: "1000" },
            { page: "1", limit: "200" },
        ]);
        expect(lines(await db.scrobblesOf(BRISTOL))).toEqual(
            lines(bristol.history.filter(({ artist }) => artist !== "Tricky")),
        );

        const again = setUp();
        await again.ingest.enqueueImport(request("Bristol"));
        expect(pageRequests(again.requests)[0]).toMatchObject({ page: "1", limit: "200" });
    });

    test("queuing a Listener whose import hasn't settled joins that import", async () => {
        await interruptAfterFirstPage("Bristol");
        const { ingest, requests } = setUp();

        const [first, second] = await Promise.all([
            ingest.enqueueImport(request("Bristol")),
            ingest.enqueueImport(request("Bristol")),
        ]);

        expect(second).toBe(first);
        expect(first.status).toBe("done");
        expect(ingest.store.getState().queue).toHaveLength(1);
        expect(requests).toHaveLength(2);
        expect(await db.scrobblesOf(BRISTOL)).toHaveLength(2100);
    });

    test("emits scrobblesChanged once the Scrobbles are stored, then jobSettled", async () => {
        const { ingest, events } = setUp();
        const seen: string[] = [];
        const stored: number[] = [];
        events.on("scrobblesChanged", ({ listenerId: changed }) => {
            seen.push(`changed ${changed}`);
            void db.scrobblesOf(changed).then((rows) => stored.push(rows.length));
        });
        events.on("jobSettled", ({ job }) => seen.push(`settled ${job.listenerId} ${job.status}`));

        await ingest.enqueueImport(request("Bristol"));

        expect(seen).toEqual(["changed bristol", "settled bristol done"]);
        await expect.poll(() => stored).toEqual([2100]);
    });
});

/** Whose history each run of requests was for, in order. */
const usersAsked = (requests: readonly { url: URL }[]) =>
    requests
        .map(({ url }) => url.searchParams.get("user"))
        .filter((user, index, users) => user !== users[index - 1]);

const isBristolPageTwo = (url: URL) =>
    url.searchParams.get("user") === "Bristol" && url.searchParams.get("page") === "2";

describe("several Listeners", () => {
    let db: Db;
    const bristol: FixtureUser = {
        username: "Bristol",
        history: scrobbles("Massive Attack", 2100, "2026-07-01T08:00:00Z"),
    };
    const bath: FixtureUser = {
        username: "Bath",
        history: scrobbles("Goldfrapp", 1500, "2026-07-02T08:00:00Z"),
    };
    const avon: FixtureUser = {
        username: "Avon",
        history: scrobbles("Roni Size", 300, "2026-07-03T08:00:00Z"),
    };
    const BATH = listenerId("Bath");

    /** last.fm over every fixture user; a request `hangs` picks waits for an abort; `hung` resolves once one is in flight. */
    function setUp(hangs: (url: URL) => boolean = () => false) {
        const fake = fakeTransport([bristol, bath, avon]);
        const inFlight = { now: 0, most: 0 };
        const onHung: (() => void)[] = [];
        const hung = new Promise<void>((resolve) => onHung.push(resolve));
        const aborted: URL[] = [];
        const fetch = async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            inFlight.now++;
            inFlight.most = Math.max(inFlight.most, inFlight.now);
            try {
                if (!hangs(url)) return await fake.transport.fetch(input, init);
                onHung.forEach((resolve) => resolve());
                return await new Promise<Response>((_, reject) =>
                    init?.signal?.addEventListener("abort", () => {
                        aborted.push(url);
                        reject(init.signal?.reason);
                    }),
                );
            } finally {
                inFlight.now--;
            }
        };
        const events = createEventBus<IngestEvents>();
        const settled: string[] = [];
        events.on("jobSettled", ({ job }) => settled.push(`${job.username} ${job.status}`));
        const ingest = createIngest({ db, events, transport: { ...fake.transport, fetch } });
        return { ...fake, ingest, inFlight, hung, aborted, settled };
    }

    beforeEach(() => {
        db = openDb(`ingest-${crypto.randomUUID()}`);
    });

    test("one app-wide queue fetches for one Listener at a time, in the order queued", async () => {
        const { ingest, requests, inFlight, settled } = setUp();
        await ingest.enqueueImport(request("Avon"));

        const jobs = await Promise.all([
            ingest.enqueueImport(request("Bristol")),
            ingest.enqueueSync({ username: "Avon", apiKey: API_KEY }),
            ingest.enqueueImport(request("Bath")),
        ]);

        expect(jobs.map((job) => `${job.kind} ${job.username} ${job.status}`)).toEqual([
            "import Bristol done",
            "sync Avon done",
            "import Bath done",
        ]);
        expect(usersAsked(requests)).toEqual(["Avon", "Bristol", "Avon", "Bath"]);
        expect(settled).toEqual(["Avon done", "Bristol done", "Avon done", "Bath done"]);
        expect(inFlight.most).toBe(1);
    });

    test("a queued job cancelled before its turn settles at once, and the queue moves on", async () => {
        const { ingest, requests, settled } = setUp();
        const bristolJob = ingest.enqueueImport(request("Bristol"));
        const bathJob = ingest.enqueueImport(request("Bath"));
        const avonJob = ingest.enqueueImport(request("Avon"));

        ingest.cancel(BATH);

        expect((await bathJob).status).toBe("cancelled");
        expect(settled).toEqual(["Bath cancelled"]);
        expect((await bristolJob).status).toBe("done");
        expect((await avonJob).status).toBe("done");
        expect(usersAsked(requests)).toEqual(["Bristol", "Avon"]);
        expect(await db.listener(BATH)).toBeUndefined();
    });

    test("removing a Listener mid-fetch aborts it, then deletes their Scrobbles and row", async () => {
        const { ingest, hung, aborted } = setUp(isBristolPageTwo);
        const bristolJob = ingest.enqueueImport(request("Bristol"));
        const bathJob = ingest.enqueueImport(request("Bath"));
        await hung;
        expect(await db.countScrobblesOf(BRISTOL)).toBe(1000);

        await ingest.removeListener(BRISTOL);

        expect(aborted.map((url) => url.searchParams.get("page"))).toEqual(["2"]);
        expect((await bristolJob).status).toBe("cancelled");
        expect(await db.listener(BRISTOL)).toBeUndefined();
        expect(await db.countScrobblesOf(BRISTOL)).toBe(0);
        expect((await bathJob).status).toBe("done");
        expect(await db.countScrobblesOf(BATH)).toBe(1500);
        expect(await db.countScrobblesOf(BRISTOL)).toBe(0);
    });

    test("removing a queued Listener doesn't wait for the running job", async () => {
        const { ingest, hung, settled } = setUp(
            (url) => url.searchParams.get("user") === "Bristol",
        );
        const bristolJob = ingest.enqueueImport(request("Bristol"));
        void ingest.enqueueImport(request("Bath"));
        await hung;

        await ingest.removeListener(BATH);

        expect(settled).toEqual(["Bath cancelled"]);
        ingest.cancel(BRISTOL);
        expect((await bristolJob).status).toBe("cancelled");
    });
});

describe("the Sync job", () => {
    let db: Db;
    const DAY_MS = 86_400_000;
    const SYNC_AT = Date.parse("2026-07-13T12:00:00Z");
    const oldHistory = scrobbles("Cocteau Twins", 300, "2026-05-01T08:00:00Z");
    const recentHistory = scrobbles("Lush", 1500, "2026-07-05T08:00:00Z");
    let twins: FixtureUser;

    /** Imports Twins at NOW, then moves the clock on to SYNC_AT. */
    async function imported(script?: (url: URL, index: number) => Scripted) {
        const fake = fakeTransport([twins], script);
        const events = createEventBus<IngestEvents>();
        const ingest = createIngest({ db, events, transport: fake.transport });
        await ingest.enqueueImport(request("Twins"));
        await fake.transport.sleep(SYNC_AT - fake.transport.now());
        const changed: string[] = [];
        events.on("scrobblesChanged", ({ listenerId: id }) => changed.push(id));
        return { ...fake, ingest, changed, importRequests: fake.requests.length };
    }

    /** What last.fm holds after the import: an old and a recent deletion, a late Scrobble and new ones. */
    const editedOnLastfm = () => [
        ...oldHistory.slice(1),
        ...recentHistory.filter((_, i) => i !== 10),
        ...scrobbles("Slowdive", 2, "2026-07-08T08:00:00Z"),
        ...scrobbles("Ride", 5, "2026-07-11T08:00:00Z"),
    ];

    beforeEach(() => {
        db = openDb(`sync-${crypto.randomUUID()}`);
        twins = { username: "Twins", history: [...oldHistory, ...recentHistory] };
    });

    test("replaces the last 14 days with last.fm's, reconciling late and deleted Scrobbles", async () => {
        const { ingest, changed, requests, importRequests } = await imported();
        twins.history = editedOnLastfm();

        const job = await ingest.enqueueSync(request("Twins"));

        expect(job).toMatchObject({ kind: "sync", status: "done" });
        // Older than the window, so a deletion there is left alone.
        const kept = oldHistory;
        const fetched = editedOnLastfm().filter(
            (s) => s.uts >= Date.parse("2026-06-29T12:00:00Z") / 1000,
        );
        expect(lines(await db.scrobblesOf(TWINS))).toEqual(lines([...kept, ...fetched]));
        expect(await db.listener(TWINS)).toMatchObject({ syncedAt: unixSecondsAt(SYNC_AT) });
        expect(changed).toEqual([TWINS]);
        const syncRequests = requests.slice(importRequests).map(({ url }) => url.searchParams);
        expect(syncRequests.map((params) => params.get("from"))).toEqual(
            syncRequests.map(() => String(unixSecondsAt(SYNC_AT - 14 * DAY_MS))),
        );
    });

    test("a failure on any page changes nothing", async () => {
        let failing = false;
        const { ingest, changed } = await imported((url) =>
            failing && url.searchParams.get("page") === "2" ? lastfmError(10, 403) : undefined,
        );
        const before = lines(await db.scrobblesOf(TWINS));
        twins.history = editedOnLastfm();
        failing = true;

        const job = await ingest.enqueueSync(request("Twins"));

        expect(job).toMatchObject({ kind: "sync", status: "failed", error: { kind: "Hard" } });
        expect(lines(await db.scrobblesOf(TWINS))).toEqual(before);
        expect(await db.listener(TWINS)).toMatchObject({ syncedAt: unixSecondsAt(NOW) });
        expect(changed).toEqual([]);
    });

    test("a Sync that drops to pages of 200 and then fails remembers nothing", async () => {
        let failing = false;
        const { ingest } = await imported((url, index) => {
            if (!failing) return undefined;
            if (url.searchParams.get("limit") === "1000") return cappedAt(200, url, [twins]);
            return index % 2 === 0 ? "offline" : lastfmError(10, 403);
        });
        failing = true;

        const job = await ingest.enqueueSync(request("Twins"));

        expect(job).toMatchObject({ status: "failed" });
        expect(await db.listener(TWINS)).toMatchObject({ pageSize: 1000 });
    });

    test("a Sync whose request keeps failing transiently gives up, changing nothing", async () => {
        let failing = false;
        const { ingest, changed } = await imported(() => (failing ? "offline" : undefined));
        const before = lines(await db.scrobblesOf(TWINS));
        failing = true;

        const job = await ingest.enqueueSync(request("Twins"));

        expect(job).toMatchObject({ status: "failed", error: { kind: "Transient" } });
        expect(lines(await db.scrobblesOf(TWINS))).toEqual(before);
        expect(changed).toEqual([]);
    });

    test("fetches everything since the last Sync when that was more than 14 days ago", async () => {
        const { ingest, requests, importRequests, transport } = await imported();
        await transport.sleep(30 * DAY_MS);

        await ingest.enqueueSync(request("Twins"));

        const froms = requests.slice(importRequests).map(({ url }) => url.searchParams.get("from"));
        expect(new Set(froms)).toEqual(new Set([String(unixSecondsAt(NOW))]));
    });
});

describe("the probe", () => {
    const bristol: FixtureUser = {
        username: "Bristol",
        history: scrobbles("Massive Attack", 1200, "2026-07-01T08:00:00Z"),
    };
    const hidden: FixtureUser = { username: "Hidden", history: [], hidden: true };

    function setUp() {
        const fake = fakeTransport([bristol, hidden]);
        const db = openDb(`probe-${crypto.randomUUID()}`);
        const events = createEventBus<IngestEvents>();
        return { ...fake, db, ingest: createIngest({ db, events, transport: fake.transport }) };
    }

    test("checks a username and API key with one limit=1 request, storing nothing", async () => {
        const { ingest, requests, db } = setUp();

        expect(await ingest.probe("Bristol", API_KEY)).toEqual({ ok: true });
        expect(requests.map(({ url }) => url.searchParams.get("limit"))).toEqual(["1"]);
        expect(await db.listeners()).toEqual([]);
        expect(ingest.store.getState().queue).toEqual([]);
    });

    test.each([
        ["Nobody", API_KEY, "UnknownUser"],
        ["Bristol", "wrong-key", "InvalidKey"],
        ["Hidden", API_KEY, "PrivateHistory"],
    ])("rejects %s with key %s as %s", async (username, apiKey, kind) => {
        const { ingest } = setUp();

        expect(await ingest.probe(username, apiKey)).toEqual({ ok: false, problem: { kind } });
    });

    test("a suspended API key (error 26) is an InvalidKey", async () => {
        const fake = fakeTransport([bristol]);
        const ingest = createIngest({
            db: openDb(`probe-${crypto.randomUUID()}`),
            events: createEventBus<IngestEvents>(),
            transport: {
                ...fake.transport,
                fetch: async () =>
                    new Response(JSON.stringify({ error: 26, message: "Suspended API key" }), {
                        status: 403,
                    }),
            },
        });

        expect(await ingest.probe("Bristol", API_KEY)).toEqual({
            ok: false,
            problem: { kind: "InvalidKey" },
        });
    });

    test("a request that can't reach last.fm is Unavailable", async () => {
        const fake = fakeTransport([bristol]);
        const ingest = createIngest({
            db: openDb(`probe-${crypto.randomUUID()}`),
            events: createEventBus<IngestEvents>(),
            transport: { ...fake.transport, fetch: () => Promise.reject(new TypeError("offline")) },
        });

        expect(await ingest.probe("Bristol", API_KEY)).toMatchObject({
            ok: false,
            problem: { kind: "Unavailable" },
        });
    });
});

describe("the Job's transitions", () => {
    const queued: Job = {
        id: 1,
        kind: "import",
        listenerId: BRISTOL,
        username: "Bristol",
        progress: { kind: "uncounted" },
        status: "queued",
    };
    const running = transition(queued, { type: "started" });
    const counted = { type: "counted", fetched: 1000, total: 2100, etaMs: 750 } as const;
    const failure = { kind: "Transient", message: "Rate limit exceeded", code: 29 } as const;
    const retry = { failures: 1, pausesAt: 5, inMs: 1000, error: failure };

    test("a queued job starts running, uncounted, or is cancelled before it starts", () => {
        expect(running).toEqual({ ...queued, status: "running" });
        expect(
            transition(queued, { type: "settled", outcome: { status: "cancelled" } }).status,
        ).toBe("cancelled");
    });

    test("a stored page counts the job's progress, ending any retry", () => {
        const retrying = transition(running, { type: "retrying", retry });
        expect(retrying).toMatchObject({ status: "retrying", retry });

        const after = transition(retrying, counted);
        expect(after).toEqual({
            ...queued,
            status: "running",
            progress: { kind: "counted", fetched: 1000, total: 2100, etaMs: 750 },
        });
        expect(after).not.toHaveProperty("retry");
    });

    test("pausing keeps the count and carries the error, dropping the retry", () => {
        const retrying = transition(transition(running, counted), { type: "retrying", retry });

        const paused = transition(retrying, {
            type: "settled",
            outcome: { status: "paused", error: failure },
        });

        expect(paused).toEqual({
            ...queued,
            status: "paused",
            error: failure,
            progress: { kind: "counted", fetched: 1000, total: 2100, etaMs: 750 },
        });
    });

    test("an event the state doesn't accept leaves it unchanged", () => {
        const done = transition(running, { type: "settled", outcome: { status: "done" } });

        expect(transition(queued, counted)).toBe(queued);
        expect(transition(queued, { type: "retrying", retry })).toBe(queued);
        expect(transition(queued, { type: "settled", outcome: { status: "done" } })).toBe(queued);
        expect(transition(running, { type: "started" })).toBe(running);
        expect(transition(done, { type: "started" })).toBe(done);
        expect(transition(done, counted)).toBe(done);
        expect(
            transition(done, { type: "settled", outcome: { status: "paused", error: failure } }),
        ).toBe(done);
    });
});
