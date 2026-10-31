import { createStore, type StoreApi } from "zustand";
import type { Db } from "../db";
import type { Subscriber } from "../events";
import {
    playTrack,
    searchTrack,
    startPosition,
    unixMs,
    type Fetch,
    type SpotifyResult,
    type TrackMatch,
    type TrackName,
    type UnixMs,
} from "../spotify";
import type { Soundtrack } from "../standings";
import type { Timeline } from "../timeline";
import { readyDevice, type Connection, type ConnectionEvents } from "./connection";
import {
    cueOf,
    resumes,
    samePlace,
    sendableAt,
    soundtrackKey,
    transition,
    type Cue,
    type Playback,
    type PlaybackEvent,
} from "./cue";
import type { Failures } from "./failures";
import type { Settings } from "./settings";

/** Whether Spotify lets the app play: freely, or not until the moment a 429 named. */
export type Limit = { kind: "free" } | { kind: "limited"; until: UnixMs };

export const FREE: Limit = { kind: "free" };

/** What Spotify is doing for the app, and whether a 429 is holding the Soundtrack off. */
export interface SoundtrackPlayerState {
    playback: Playback;
    limit: Limit;
}

/** Calls `run` after `ms`; returns a cancel. */
export type SetTimer = (run: () => void, ms: number) => () => void;

/** What the player follows, what it reaches Spotify and storage through, and its clock. */
export interface SoundtrackPlayerDeps {
    timeline: Pick<Timeline, "store">;
    settings: Pick<Settings, "store">;
    connection: Pick<Connection, "store" | "accessToken" | "pause" | "resume" | "fail">;
    events: Subscriber<ConnectionEvents>;
    db: Pick<Db, "spotifyMatch" | "saveSpotifyMatch" | "clearSpotifyMatches" | "saveSpotifyLimit">;
    fetch: Fetch;
    now: () => number;
    setTimer: SetTimer;
    failures: Pick<Failures, "report">;
    /** When the last 429 lets the app ask Spotify again, read at boot. */
    limitedUntil: UnixMs | undefined;
}

const notFound = { ok: true, value: undefined } as const;

/**
 * Plays each Window's Soundtrack on this tab's Spotify device while the history plays with the
 * Soundtrack on, and pauses and resumes it with the history. A Soundtrack plays at least
 * `MIN_PLAY_MS` before the next is sent, and only the newest waiting one is sent.
 */
export function createSoundtrackPlayer({
    timeline,
    settings,
    connection,
    events,
    db,
    fetch,
    now,
    setTimer,
    failures,
    limitedUntil,
}: SoundtrackPlayerDeps) {
    const store: StoreApi<SoundtrackPlayerState> = createStore<SoundtrackPlayerState>(() => ({
        playback: { kind: "stopped" },
        limit: FREE,
    }));
    // The send queue's handles and timing, which nothing outside the player reads.
    const held: {
        /** What should be playing now, if anything. */
        cue: Cue | undefined;
        /** The newest Cue waiting its turn to be sent. */
        waiting: Cue | undefined;
        /** The key of the last Soundtrack worked out, whether it was played or wasn't on Spotify. */
        settledKey: string | undefined;
        /** When the last track started playing. */
        sentAt: UnixMs | undefined;
        sending: boolean;
        /** Counts the history's stops, so a send that outlived one knows it is stale. */
        stops: number;
        cancelSend: (() => void) | undefined;
        cancelLimit: (() => void) | undefined;
    } = {
        cue: undefined,
        waiting: undefined,
        settledKey: undefined,
        sentAt: undefined,
        sending: false,
        stops: 0,
        cancelSend: undefined,
        cancelLimit: undefined,
    };

    const playback = (): Playback => store.getState().playback;
    const dispatch = (event: PlaybackEvent): void =>
        store.setState((state) => ({ playback: transition(state.playback, event) }));
    const reporting = (what: string) => (error: unknown) => failures.report(what, error);

    /** Holds the Soundtrack off until `until`, then lets it be turned on again. */
    function limitUntil(until: UnixMs): void {
        held.cancelLimit?.();
        if (until <= now()) return store.setState({ limit: FREE });
        store.setState({ limit: { kind: "limited", until } });
        held.cancelLimit = setTimer(() => store.setState({ limit: FREE }), until - now());
    }

    /** A track's match: from storage if it was searched for before, else searched and stored. */
    async function lookUp(name: TrackName): Promise<SpotifyResult<TrackMatch | undefined>> {
        const stored = await db.spotifyMatch(name);
        if (stored)
            return {
                ok: true,
                value:
                    stored.kind === "found"
                        ? { uri: stored.uri, durationMs: stored.durationMs }
                        : undefined,
            };
        const token = await connection.accessToken();
        if (!token.ok) return token;
        const searched = await searchTrack(name, token.value, fetch, now);
        if (searched.ok)
            await db.saveSpotifyMatch(
                name,
                searched.value ? { kind: "found", ...searched.value } : { kind: "notFound" },
            );
        return searched;
    }

    /** The first of the Soundtrack's tracks on Spotify: the Soundtrack, else its fallbacks in turn. */
    const findTrack = ({ artist, tracks }: Soundtrack) =>
        tracks.reduce<Promise<SpotifyResult<TrackMatch | undefined>>>(async (previous, track) => {
            const found = await previous;
            return !found.ok || found.value ? found : lookUp({ artist, track });
        }, Promise.resolve(notFound));

    /** Pauses Spotify where the history paused, if it is playing. */
    function pauseAt(at: Cue): void {
        if (playback().kind !== "playing") return;
        dispatch({ type: "paused", at });
        connection.pause().catch(reporting("Couldn't pause Spotify"));
    }

    /** Carries on the paused track. */
    function resume(): void {
        dispatch({ type: "resumed" });
        connection.resume().catch(reporting("Couldn't resume Spotify"));
    }

    /** Works out `cue`'s track and plays it, unless it's what is already playing or isn't on Spotify. */
    async function send(cue: Cue): Promise<void> {
        const stops = held.stops;
        // The history stopped since this send began, so what it found is no longer wanted.
        const stale = () => held.stops !== stops;
        const found = await findTrack(cue.soundtrack);
        if (!found.ok) return connection.fail(found.error);
        if (stale()) return;
        held.settledKey = soundtrackKey(cue.soundtrack);
        const match = found.value;
        // Not on Spotify: the previous Soundtrack keeps playing, carrying on if it was paused.
        if (!match) return playback().kind === "paused" ? resume() : undefined;
        const current = playback();
        if (current.kind === "playing" && current.uri === match.uri) return;
        const token = await connection.accessToken();
        if (!token.ok) return connection.fail(token.error);
        const played = await playTrack(
            { deviceId: cue.deviceId, uri: match.uri, positionMs: startPosition(match.durationMs) },
            token.value,
            fetch,
            now,
        );
        if (!played.ok) return connection.fail(played.error);
        held.sentAt = unixMs(now());
        dispatch({ type: "sent", uri: match.uri });
        // The history stopped while the track was sent: Spotify stops with it.
        if (stale() && !held.cue) pauseAt(cue);
    }

    /** Sends the waiting Cue once the last Soundtrack has played long enough. */
    function schedule(): void {
        held.cancelSend?.();
        held.cancelSend = undefined;
        const cue = held.waiting;
        if (!cue || held.sending) return;
        const wait = sendableAt(held.sentAt, unixMs(now())) - now();
        if (wait > 0) {
            held.cancelSend = setTimer(schedule, wait);
            return;
        }
        held.waiting = undefined;
        held.sending = true;
        send(cue)
            .catch((error: unknown) => {
                // Settled anyway, so a broken lookup isn't tried again and again.
                held.settledKey = soundtrackKey(cue.soundtrack);
                failures.report("Couldn't play the Soundtrack", error);
            })
            .finally(() => {
                held.sending = false;
                // The history came back to another Soundtrack while this one was sent.
                const latest = held.cue;
                if (latest && !held.waiting && soundtrackKey(latest.soundtrack) !== held.settledKey)
                    held.waiting = latest;
                schedule();
            });
    }

    /** Makes `cue` the newest to send, in place of any waiting. */
    function want(cue: Cue): void {
        held.waiting = cue;
        schedule();
    }

    /** Drops whatever is waiting to be sent. */
    function dropWaiting(): void {
        held.waiting = undefined;
        held.cancelSend?.();
        held.cancelSend = undefined;
    }

    /** The history started playing: carries on in the Window it paused in, else sends this Window's. */
    function started(cue: Cue): void {
        const sameSoundtrack = held.settledKey === soundtrackKey(cue.soundtrack);
        if (resumes(playback(), cue) && sameSoundtrack) resume();
        else want(cue);
    }

    /** The playing history reached another Window, or its Soundtracks were worked out again. */
    function moved(cue: Cue): void {
        const same = soundtrackKey(cue.soundtrack) === held.settledKey;
        if (same && playback().kind === "playing") dropWaiting();
        else want(cue);
    }

    /** The history stopped, or the switch or device went: Spotify pauses where it was. */
    function stopped(at: Cue): void {
        held.stops++;
        dropWaiting();
        pauseAt(at);
    }

    /** Follows the history, the switch and the device to what should be playing now. */
    function follow(): void {
        const before = held.cue;
        const limited = store.getState().limit.kind === "limited";
        const cue = cueOf(
            timeline.store.getState(),
            settings.store.getState().soundtrack && !limited,
            readyDevice(connection.store.getState()),
        );
        held.cue = cue;
        if (!cue) return before && stopped(before);
        if (!before) return started(cue);
        if (!samePlace(before, cue) || before.soundtrack !== cue.soundtrack) moved(cue);
    }

    if (limitedUntil !== undefined) limitUntil(limitedUntil);

    const unsubscribe = [
        timeline.store.subscribe(follow),
        settings.store.subscribe(follow),
        connection.store.subscribe(follow),
        // A 429 from any of Spotify's endpoints holds the Soundtrack off, past a reload too.
        events.on("spotifyFailed", ({ failure }) => {
            if (failure.kind !== "RateLimited") return;
            limitUntil(failure.until);
            db.saveSpotifyLimit(failure.until).catch(reporting("Couldn't remember Spotify's wait"));
        }),
    ];

    return {
        store,

        /** Forgets every Spotify search result, so tracks are searched for again. */
        forgetMatches: (): Promise<void> =>
            db.clearSpotifyMatches().catch(reporting("Couldn't forget the Spotify matches")),

        dispose: (): void => {
            unsubscribe.forEach((stop) => stop());
            held.cancelSend?.();
            held.cancelLimit?.();
        },
    };
}

export type SoundtrackPlayer = ReturnType<typeof createSoundtrackPlayer>;
