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
import { importListener } from ".";

const API_KEY = "fixture-key";
const NOW = Date.parse("2026-07-10T12:00:00Z");

function fakeTransport(users: FixtureUser[]) {
  let clock = NOW;
  const requests: { url: URL; at: number }[] = [];
  return {
    requests,
    deps: {
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

describe("importListener", () => {
  let db: Db;
  const history = [
    ...scrobbles("Massive Attack", 1200, "2026-07-01T08:00:00Z"),
    ...scrobbles("Portishead", 900, "2026-07-03T08:00:00Z"),
    // Scrobbled after the import starts, so outside its fixed `to`
    ...scrobbles("Tricky", 3, "2026-07-10T12:30:00Z"),
  ];
  const user: FixtureUser = {
    username: "Bristol",
    history,
    nowPlaying: { artist: "Tricky", track: "Overcome", album: "Maxinquaye" },
  };

  beforeEach(async () => {
    db = openDb(`ingest-${crypto.randomUUID()}`);
  });

  test("imports every Scrobble up to the start of the import, skipping the now-playing entry", async () => {
    const { deps } = fakeTransport([user]);
    await importListener(db, { username: "Bristol", apiKey: API_KEY, timeZone: "UTC" }, deps);

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
    const { deps, requests } = fakeTransport([user]);
    await importListener(db, { username: "Bristol", apiKey: API_KEY, timeZone: "UTC" }, deps);

    expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    for (const { url } of requests) {
      expect(url.searchParams.get("limit")).toBe("1000");
      expect(url.searchParams.get("to")).toBe(String(NOW / 1000));
    }
  });

  test("makes at most 4 requests per second", async () => {
    const { deps, requests } = fakeTransport([user]);
    await importListener(db, { username: "Bristol", apiKey: API_KEY, timeZone: "UTC" }, deps);

    const gaps = requests.slice(1).map((request, i) => request.at - requests[i]!.at);
    expect(gaps.every((gap) => gap >= 250)).toBe(true);
  });

  test("stops when its AbortSignal is aborted", async () => {
    const { deps, requests } = fakeTransport([user]);
    const controller = new AbortController();
    const importing = importListener(
      db,
      { username: "Bristol", apiKey: API_KEY, timeZone: "UTC" },
      deps,
      { signal: controller.signal, onProgress: () => controller.abort() },
    );

    await expect(importing).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toHaveLength(1);
    expect(await db.listener("bristol")).toMatchObject({ importComplete: false });
  });
});
