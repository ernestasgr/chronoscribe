import { createStore, type StoreApi } from "zustand";
import type { Db } from "../db";
import type { Emitter } from "../events";
import {
    authorizeUrl,
    challengeOf,
    checkAccount,
    deviceEventOf,
    exchangeCode,
    newState,
    newVerifier,
    PLAYER_EVENTS,
    refreshTokens,
    signInCallback,
    type DeviceEvent,
    type DeviceId,
    type SpotifyFailure,
    type SpotifyPort,
    type SpotifyResult,
    type SpotifyTokens,
    type StoredSpotify,
    type UnixMs,
    type WebPlayer,
} from "../spotify";
import type { Failures } from "./failures";

/** This tab as a Spotify Connect device: registering, ready to play on, or refused by the SDK. */
export type Device =
    | { kind: "connecting" }
    | { kind: "ready"; deviceId: DeviceId }
    | { kind: "unavailable" };

/** The app's one Spotify connection: none, a sign-in under way, or signed in with this tab's device. */
export type ConnectionState =
    | { kind: "disconnected" }
    | { kind: "signingIn" }
    | { kind: "connected"; device: Device };

/** Everything that moves the connection along. */
export type ConnectionEvent =
    | { type: "signInStarted" }
    | { type: "signedIn" }
    | { type: "signInFailed" }
    | { type: "disconnected" }
    | { type: "deviceReady"; deviceId: DeviceId }
    | { type: "deviceLost" }
    | { type: "deviceFailed" };

/** The facts the connection publishes. */
export interface ConnectionEvents {
    /** A sign-in finished and the tokens are stored. */
    spotifySignedIn: Record<string, never>;
    /** Spotify can't be used, for the reason given. */
    spotifyFailed: { failure: SpotifyFailure };
}

const DISCONNECTED: ConnectionState = { kind: "disconnected" };

const withDevice = (state: ConnectionState, device: Device): ConnectionState =>
    state.kind === "connected" ? { kind: "connected", device } : state;

/** The connection after `event`; an event the current state doesn't accept leaves it unchanged. */
export function transition(state: ConnectionState, event: ConnectionEvent): ConnectionState {
    switch (event.type) {
        case "signInStarted":
            return state.kind === "disconnected" ? { kind: "signingIn" } : state;
        case "signedIn":
            return state.kind === "signingIn"
                ? { kind: "connected", device: { kind: "connecting" } }
                : state;
        case "signInFailed":
            return state.kind === "signingIn" ? DISCONNECTED : state;
        case "disconnected":
            return state.kind === "disconnected" ? state : DISCONNECTED;
        case "deviceReady":
            return withDevice(state, { kind: "ready", deviceId: event.deviceId });
        case "deviceLost":
            return withDevice(state, { kind: "connecting" });
        case "deviceFailed":
            return withDevice(state, { kind: "unavailable" });
    }
}

/** The device to start tracks on, once this tab is ready to play. */
export const readyDevice = (state: ConnectionState): DeviceId | undefined =>
    state.kind === "connected" && state.device.kind === "ready" ? state.device.deviceId : undefined;

/** A moment as the user's clock shows it. */
export const timeOf = (at: UnixMs): string => new Date(at).toLocaleTimeString();

/** What the user is told when Spotify can't be used, and what to do about it. */
export function describeFailure(failure: SpotifyFailure): string {
    switch (failure.kind) {
        case "SignInRefused":
            return `Spotify didn't sign you in (${failure.message}).`;
        case "SignInExpired":
            return "Spotify signed you out. Turn the Soundtrack on to sign in again.";
        case "NotAllowlisted":
            return "This Spotify account isn't on Chronoscribe's allowlist. Ask the app's owner to add it.";
        case "PremiumRequired":
            return "Playing the Soundtrack needs Spotify Premium.";
        case "Unsupported":
            return `This browser can't play Spotify, which needs DRM support (${failure.message}).`;
        case "AutoplayBlocked":
            return "The browser blocked Spotify from playing. Press Play to try again.";
        case "RateLimited":
            return `Spotify asked Chronoscribe to slow down. The Soundtrack can go back on at ${timeOf(failure.until)}.`;
        case "Unavailable":
            return `Couldn't reach Spotify (${failure.message}).`;
    }
}

/** Access tokens this close to expiring are refreshed before they are handed out. */
const REFRESH_MARGIN_MS = 60_000;

/** The name this tab shows under in the user's Spotify Connect devices. */
const DEVICE_NAME = "Chronoscribe";

export interface ConnectionDeps {
    db: Db;
    port: SpotifyPort;
    events: Emitter<ConnectionEvents>;
    /** Where failures that aren't Spotify's, such as storage refusing a write, are reported. */
    failures: Pick<Failures, "report">;
    /** The build's Spotify Client ID. */
    clientId: string;
    /** The app's root, where Spotify sends the browser back to. */
    redirectUri: string;
    now: () => number;
    /** The stored connection, read at boot. */
    stored: StoredSpotify | undefined;
}

/** The app's one Spotify connection: PKCE sign-in, tokens kept fresh, and this tab as a device. */
export function createConnection({
    db,
    port,
    events,
    failures,
    clientId,
    redirectUri,
    now,
    stored,
}: ConnectionDeps) {
    const storedTokens = stored?.kind === "connected" ? stored.tokens : undefined;
    const store: StoreApi<ConnectionState> = createStore<ConnectionState>(() =>
        storedTokens ? { kind: "connected", device: { kind: "connecting" } } : DISCONNECTED,
    );
    // The SDK asks for tokens often and expects a quick answer, so the stored ones are held here too.
    const held: {
        tokens: SpotifyTokens | undefined;
        refreshing: Promise<SpotifyResult<string>> | undefined;
        player: WebPlayer | undefined;
    } = { tokens: storedTokens, refreshing: undefined, player: undefined };

    const dispatch = (event: ConnectionEvent): void =>
        store.setState(transition(store.getState(), event), true);

    /** Says why Spotify can't be used, and publishes it, which turns the Soundtrack off. */
    const fail = (failure: SpotifyFailure): void => {
        failures.report("The Soundtrack is off", describeFailure(failure));
        events.emit("spotifyFailed", { failure });
    };

    /** `action`, reporting a failure as `what` rather than rejecting, since nobody awaits it. */
    const guarded =
        <Args extends unknown[]>(what: string, action: (...args: Args) => Promise<void>) =>
        (...args: Args): Promise<void> =>
            action(...args).catch((error: unknown) => failures.report(what, error));

    /** Lets go of the player and the tokens, and clears the stored connection. */
    async function forget(): Promise<void> {
        held.player?.disconnect();
        held.player = undefined;
        held.tokens = undefined;
        await db.clearSpotify();
        dispatch({ type: "disconnected" });
    }

    /** Renews the tokens and stores them; a lapsed sign-in forgets the connection. */
    async function refresh(tokens: SpotifyTokens): Promise<SpotifyResult<string>> {
        const result = await refreshTokens(clientId, tokens, port.fetch, now);
        // Disconnected while the refresh was under way: its tokens must not be stored again.
        if (held.tokens !== tokens) return { ok: false, error: { kind: "SignInExpired" } };
        if (!result.ok) {
            if (result.error.kind === "SignInExpired") await forget();
            fail(result.error);
            return result;
        }
        await db.saveSpotify({ kind: "connected", tokens: result.value });
        held.tokens = result.value;
        return { ok: true, value: result.value.accessToken };
    }

    /** An access token with time left on it, refreshed first if it is about to expire. */
    async function accessToken(): Promise<SpotifyResult<string>> {
        const { tokens } = held;
        if (!tokens) return { ok: false, error: { kind: "SignInExpired" } };
        if (tokens.expiresAt - REFRESH_MARGIN_MS > now())
            return { ok: true, value: tokens.accessToken };
        // Concurrent callers share one refresh, since a rotated refresh token works only once.
        held.refreshing ??= refresh(tokens).finally(() => {
            held.refreshing = undefined;
        });
        return held.refreshing;
    }

    const onDeviceEvent = (event: DeviceEvent): void => {
        switch (event.type) {
            case "ready":
                return dispatch({ type: "deviceReady", deviceId: event.deviceId });
            case "notReady":
                return dispatch({ type: "deviceLost" });
            case "unusable":
                dispatch({ type: "deviceFailed" });
                return fail(event.failure);
            case "blocked":
                return fail(event.failure);
        }
    };

    /** Registers this tab as a Spotify Connect device through the Web Playback SDK. */
    async function startDevice(): Promise<void> {
        const player = await port.createPlayer({
            name: DEVICE_NAME,
            getOAuthToken: (callback) =>
                void accessToken()
                    .then((token) => token.ok && callback(token.value))
                    .catch((error: unknown) =>
                        failures.report("Couldn't renew Spotify's sign-in", error),
                    ),
        });
        // Disconnected while the SDK loaded: the player is no longer wanted.
        if (!held.tokens) return;
        held.player = player;
        PLAYER_EVENTS.forEach((name) =>
            player.addListener(name, (payload) => onDeviceEvent(deviceEventOf(name, payload))),
        );
        if (!(await player.connect())) dispatch({ type: "deviceFailed" });
    }

    const connectDevice = () =>
        startDevice().catch((error: unknown) => {
            dispatch({ type: "deviceFailed" });
            fail({ kind: "Unavailable", message: String(error) });
        });

    /** Sends the browser to Spotify's sign-in page, remembering the PKCE verifier for its return. */
    async function signIn(): Promise<void> {
        if (store.getState().kind !== "disconnected") return;
        dispatch({ type: "signInStarted" });
        const verifier = newVerifier();
        const state = newState();
        await db.saveSpotify({ kind: "signingIn", verifier, state });
        port.navigate(
            authorizeUrl({ clientId, redirectUri, challenge: await challengeOf(verifier), state }),
        );
    }

    /** Ends a sign-in that didn't finish, for `failure`. */
    async function abandon(failure: SpotifyFailure): Promise<void> {
        await db.clearSpotify();
        dispatch({ type: "signInFailed" });
        fail(failure);
    }

    /** Finishes a sign-in from the address Spotify sent the browser back to, then clears it from the address bar. */
    async function finishSignIn(href: string): Promise<void> {
        const callback = signInCallback(href);
        if (callback.kind === "none") return;
        port.replaceAddress(callback.cleaned);
        const pending = await db.loadSpotify();
        // An old address loaded again, with no sign-in waiting for it.
        if (pending?.kind !== "signingIn") return;
        dispatch({ type: "signInStarted" });
        if (callback.state !== pending.state)
            return abandon({
                kind: "SignInRefused",
                message: "the answer was for another sign-in",
            });
        if (callback.kind === "refused")
            return abandon({ kind: "SignInRefused", message: callback.error });
        const exchanged = await exchangeCode(
            { clientId, redirectUri, code: callback.code, verifier: pending.verifier },
            port.fetch,
            now,
        );
        if (!exchanged.ok) return abandon(exchanged.error);
        const account = await checkAccount(exchanged.value.accessToken, port.fetch, now);
        if (!account.ok) return abandon(account.error);
        await db.saveSpotify({ kind: "connected", tokens: exchanged.value });
        held.tokens = exchanged.value;
        dispatch({ type: "signedIn" });
        events.emit("spotifySignedIn", {});
        void connectDevice();
    }

    /** Tries again to register a device the SDK refused, with a new player. */
    function retryDevice(): void {
        if (store.getState().kind !== "connected") return;
        held.player?.disconnect();
        held.player = undefined;
        dispatch({ type: "deviceLost" });
        void connectDevice();
    }

    /** Unlocks audio for the tab, on the click of a control that may start playing. */
    function unlockAudio(): void {
        held.player
            ?.activateElement()
            .catch((error: unknown) => failures.report("Couldn't unlock Spotify's audio", error));
    }

    if (held.tokens) void connectDevice();

    return {
        store,

        /**
         * The Soundtrack switch was turned on: signs in if need be, tries an unavailable device
         * again, else unlocks audio.
         */
        switchedOn: guarded("Couldn't sign in to Spotify", async () => {
            const state = store.getState();
            if (state.kind === "disconnected") await signIn();
            else if (state.kind === "connected" && state.device.kind === "unavailable")
                retryDevice();
            else unlockAudio();
        }),

        unlockAudio,

        retryDevice,

        fail,

        /** Pauses this tab's player, keeping its place. */
        pause: (): Promise<void> => held.player?.pause() ?? Promise.resolve(),

        /** Carries on playing this tab's player from where it paused. */
        resume: (): Promise<void> => held.player?.resume() ?? Promise.resolve(),

        finishSignIn: guarded("Couldn't finish signing in to Spotify", finishSignIn),

        /** Signs out: this tab stops being a device and the stored tokens are cleared. */
        disconnect: guarded("Couldn't disconnect Spotify", forget),

        accessToken,
    };
}

export type Connection = ReturnType<typeof createConnection>;
