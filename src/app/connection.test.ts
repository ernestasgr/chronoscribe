// oxlint-disable-next-line import/no-unassigned-import -- installs the IndexedDB globals Dexie needs
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
    ACCOUNTS_ORIGIN,
    createFakeSpotify,
    fakeSpotifyFetch,
    FIXTURE_DEVICE_ID,
    type FakeSpotifyOptions,
} from "../../test-support/spotify";
import { openDb, type Db } from "../db";
import { createEventBus } from "../events";
import { deviceId, type SpotifyFailure } from "../spotify";
import { createConnection, readyDevice, transition, type ConnectionEvents } from "./connection";
import { createFailures } from "./failures";
import { createSettings } from "./settings";

const CLIENT_ID = "fixture-client";
const ROOT = "http://127.0.0.1:5273/";
const NOW = Date.parse("2026-07-10T12:00:00Z");
const HOUR = 3_600_000;

/** Waits until the SDK's queued events have been handled. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

/** A connection over real storage, with Spotify and the browser faked, as one tab would hold it. */
async function setUp(
    db: Db,
    spotify = createFakeSpotify({ clientId: CLIENT_ID, redirectUri: ROOT }),
) {
    const clock = { now: NOW };
    const visits: string[] = [];
    const address = { href: ROOT };
    const events = createEventBus<ConnectionEvents>();
    const failed: SpotifyFailure[] = [];
    const signedIn: number[] = [];
    events.on("spotifyFailed", ({ failure }) => failed.push(failure));
    events.on("spotifySignedIn", () => signedIn.push(clock.now));
    const failures = createFailures();
    const settings = await createSettings(db, failures, events);
    const connection = createConnection({
        db,
        events,
        failures,
        clientId: CLIENT_ID,
        redirectUri: ROOT,
        now: () => clock.now,
        stored: await db.loadSpotify(),
        port: {
            fetch: fakeSpotifyFetch(spotify),
            navigate: (url) => visits.push(url),
            replaceAddress: (url) => {
                address.href = url;
            },
            createPlayer: spotify.players.create,
        },
    });

    /** Follows the sign-in page back to the app's root, which then loads, as the browser would. */
    async function returnFromSpotify(): Promise<void> {
        const visited = visits.at(-1);
        if (!visited) throw new Error("the app never sent the browser to Spotify");
        address.href = await spotify.authorize(new URL(visited));
        await connection.finishSignIn(address.href);
    }

    return {
        connection,
        spotify,
        clock,
        visits,
        address,
        failed,
        signedIn,
        failures,
        settings,
        returnFromSpotify,
    };
}

const fake = (options: Partial<FakeSpotifyOptions>) =>
    createFakeSpotify({ clientId: CLIENT_ID, redirectUri: ROOT, ...options });

describe("signing in", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`connection-${crypto.randomUUID()}`);
    });

    test("switching the Soundtrack on signs in with PKCE and readies this tab as a device", async () => {
        const { connection, visits, address, signedIn, failed, returnFromSpotify } =
            await setUp(db);
        expect(connection.store.getState()).toEqual({ kind: "disconnected" });

        await connection.switchedOn();
        const authorize = new URL(visits[0] ?? "");
        expect(authorize.origin + authorize.pathname).toBe(`${ACCOUNTS_ORIGIN}/authorize`);
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
        expect(connection.store.getState()).toEqual({ kind: "signingIn" });

        await returnFromSpotify();
        await settle();

        expect(address.href).toBe(ROOT);
        expect(signedIn).toHaveLength(1);
        expect(failed).toEqual([]);
        expect(connection.store.getState()).toEqual({
            kind: "connected",
            device: { kind: "ready", deviceId: FIXTURE_DEVICE_ID },
        });
    });
});

/** Signs in through the fake, leaving a ready device. */
async function signIn(db: Db, spotify = fake({})) {
    const tab = await setUp(db, spotify);
    await tab.connection.switchedOn();
    await tab.returnFromSpotify();
    await settle();
    return tab;
}

describe("staying signed in", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`connection-${crypto.randomUUID()}`);
    });

    test("a reload keeps the connection and readies the device without signing in again", async () => {
        const first = await signIn(db);

        const reloaded = await setUp(db, first.spotify);
        await settle();

        expect(reloaded.visits).toEqual([]);
        expect(reloaded.connection.store.getState()).toEqual({
            kind: "connected",
            device: { kind: "ready", deviceId: FIXTURE_DEVICE_ID },
        });
        expect(await reloaded.spotify.players.latest()?.token()).toBe("access-1");
    });

    test("an access token is refreshed a minute before it expires, not sooner", async () => {
        const { connection, spotify, clock } = await signIn(db);

        clock.now += HOUR - 61_000;
        expect(await connection.accessToken()).toEqual({ ok: true, value: "access-1" });
        expect(spotify.refreshes()).toBe(0);

        clock.now += 2_000;
        expect(await connection.accessToken()).toEqual({ ok: true, value: "access-2" });
        expect(spotify.refreshes()).toBe(1);
    });

    test("the SDK's requests for a token share one refresh", async () => {
        const { spotify, clock } = await signIn(db);
        const player = spotify.players.latest();

        clock.now += HOUR;
        const tokens = await Promise.all([player?.token(), player?.token()]);

        expect(tokens).toEqual(["access-2", "access-2"]);
        expect(spotify.refreshes()).toBe(1);
    });

    test("a rotated refresh token replaces the old one, in storage too", async () => {
        const { connection, spotify, clock } = await signIn(db);

        clock.now += HOUR;
        await connection.accessToken();
        clock.now += HOUR;
        expect(await connection.accessToken()).toEqual({ ok: true, value: "access-3" });

        // The old refresh tokens are used up, so a reload works only with the stored new one.
        const reloaded = await setUp(db, spotify);
        reloaded.clock.now = clock.now + HOUR;
        expect(await reloaded.connection.accessToken()).toEqual({ ok: true, value: "access-4" });
        expect(reloaded.failed).toEqual([]);
    });

    test("a refresh that keeps the refresh token keeps using it", async () => {
        const { connection, clock, failed } = await signIn(
            db,
            fake({ rotatesRefreshTokens: false }),
        );

        clock.now += HOUR;
        await connection.accessToken();
        clock.now += HOUR;

        expect(await connection.accessToken()).toEqual({ ok: true, value: "access-3" });
        expect(failed).toEqual([]);
    });

    test("an invalid_grant signs out and asks to sign in again", async () => {
        const { connection, spotify, clock, failed } = await signIn(db);
        const player = spotify.players.latest();

        spotify.revoke();
        clock.now += HOUR;

        expect(await connection.accessToken()).toEqual({
            ok: false,
            error: { kind: "SignInExpired" },
        });
        expect(failed).toEqual([{ kind: "SignInExpired" }]);
        expect(connection.store.getState()).toEqual({ kind: "disconnected" });
        expect(player?.connected).toBe(false);
        expect(await db.loadSpotify()).toBeUndefined();

        // Switching on again starts a new sign-in.
        await connection.switchedOn();
        expect(connection.store.getState()).toEqual({ kind: "signingIn" });
    });
});

describe("signing in fails", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`connection-${crypto.randomUUID()}`);
    });

    test("when the user declines on Spotify's page", async () => {
        const tab = await setUp(db, fake({ consents: false }));

        await tab.connection.switchedOn();
        await tab.returnFromSpotify();

        expect(tab.failed).toEqual([{ kind: "SignInRefused", message: "access_denied" }]);
        expect(tab.address.href).toBe(ROOT);
        expect(tab.connection.store.getState()).toEqual({ kind: "disconnected" });
        expect(await db.loadSpotify()).toBeUndefined();
    });

    test("when the account isn't on the app's allowlist", async () => {
        const tab = await setUp(db, fake({ allowlisted: false }));
        tab.settings.update({ soundtrack: true });

        await tab.connection.switchedOn();
        await tab.returnFromSpotify();

        expect(tab.failed).toEqual([{ kind: "NotAllowlisted" }]);
        expect(tab.settings.store.getState().soundtrack).toBe(false);
        expect(tab.failures.store.getState().latest?.message).toBe(
            "The Soundtrack is off: This Spotify account isn't on Chronoscribe's allowlist. Ask the app's owner to add it.",
        );
        expect(tab.signedIn).toEqual([]);
        expect(tab.connection.store.getState()).toEqual({ kind: "disconnected" });
        expect(await db.loadSpotify()).toBeUndefined();
    });

    test("when the answer is for another sign-in than the one stored", async () => {
        const tab = await setUp(db);

        await tab.connection.switchedOn();
        await tab.connection.finishSignIn(`${ROOT}?code=stolen&state=forged`);

        expect(tab.failed).toEqual([
            { kind: "SignInRefused", message: "the answer was for another sign-in" },
        ]);
        expect(tab.connection.store.getState()).toEqual({ kind: "disconnected" });
    });

    test("an old sign-in address loaded again is cleared and otherwise ignored", async () => {
        const tab = await setUp(db);

        await tab.connection.finishSignIn(`${ROOT}?code=old&state=old`);

        expect(tab.address.href).toBe(ROOT);
        expect(tab.failed).toEqual([]);
        expect(tab.connection.store.getState()).toEqual({ kind: "disconnected" });
    });
});

describe("the device", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`connection-${crypto.randomUUID()}`);
    });

    test.each([
        ["without Premium", { premium: false }, { kind: "PremiumRequired" }],
        [
            "without DRM",
            { drm: false },
            { kind: "Unsupported", message: "Failed to initialize player" },
        ],
    ])("is unavailable %s, and turns the Soundtrack off", async (_, options, failure) => {
        const { connection, failed, settings, failures } = await signIn(db, fake(options));

        expect(failed).toEqual([failure]);
        expect(connection.store.getState()).toEqual({
            kind: "connected",
            device: { kind: "unavailable" },
        });
        expect(settings.store.getState().soundtrack).toBe(false);
        expect(failures.store.getState().latest?.message).toMatch(/^The Soundtrack is off: /);
    });

    test("is tried again with a new player when the switch is turned back on", async () => {
        const { connection, spotify, failed, visits } = await signIn(db, fake({ drm: false }));

        await connection.switchedOn();
        await settle();

        expect(spotify.players.made).toHaveLength(2);
        expect(spotify.players.made[0]?.connected).toBe(false);
        expect(failed).toHaveLength(2);
        expect(visits).toHaveLength(1);
    });

    test("stays ready when the browser blocks autoplay, and turns the Soundtrack off", async () => {
        const { connection, spotify, failed, settings } = await signIn(db);
        expect(settings.store.getState().soundtrack).toBe(true);

        spotify.players.latest()?.emit("autoplay_failed", undefined);

        expect(failed).toEqual([{ kind: "AutoplayBlocked" }]);
        expect(settings.store.getState().soundtrack).toBe(false);
        expect(connection.store.getState()).toMatchObject({ device: { kind: "ready" } });
    });

    test("is unlocked for audio by the switch while connected, without signing in again", async () => {
        const { connection, spotify, visits } = await signIn(db);

        await connection.switchedOn();
        connection.unlockAudio();

        expect(spotify.players.latest()?.activations).toBe(2);
        expect(visits).toHaveLength(1);
    });
});

describe("disconnecting", () => {
    let db: Db;
    beforeEach(() => {
        db = openDb(`connection-${crypto.randomUUID()}`);
    });

    test("clears the connection, so a reload is signed out", async () => {
        const { connection, spotify } = await signIn(db);

        await connection.disconnect();

        expect(connection.store.getState()).toEqual({ kind: "disconnected" });
        expect(spotify.players.latest()?.connected).toBe(false);
        const reloaded = await setUp(db, spotify);
        expect(reloaded.connection.store.getState()).toEqual({ kind: "disconnected" });
        expect(spotify.players.made).toHaveLength(1);
    });

    test("during a refresh keeps the refreshed tokens from being stored again", async () => {
        const { connection, clock } = await signIn(db);

        clock.now += HOUR;
        const refreshing = connection.accessToken();
        await connection.disconnect();

        expect(await refreshing).toEqual({ ok: false, error: { kind: "SignInExpired" } });
        expect(await db.loadSpotify()).toBeUndefined();
        expect(connection.store.getState()).toEqual({ kind: "disconnected" });
    });
});

describe("transition", () => {
    const ready = {
        kind: "connected",
        device: { kind: "ready", deviceId: deviceId("d") },
    } as const;

    test.each([
        ["a sign-in while connected", ready, { type: "signInStarted" }],
        ["a sign-in finishing that never started", { kind: "disconnected" }, { type: "signedIn" }],
        [
            "a device while disconnected",
            { kind: "disconnected" },
            { type: "deviceReady", deviceId: deviceId("d") },
        ],
        ["a failed sign-in while connected", ready, { type: "signInFailed" }],
    ] as const)("ignores %s", (_, state, event) => {
        expect(transition(state, event)).toBe(state);
    });

    test("a lost device waits to be ready again, and only a ready one is played on", () => {
        const lost = transition(ready, { type: "deviceLost" });

        expect(lost).toEqual({ kind: "connected", device: { kind: "connecting" } });
        expect(readyDevice(lost)).toBeUndefined();
        expect(readyDevice(ready)).toBe("d");
    });
});
