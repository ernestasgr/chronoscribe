import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openDb, type Db } from "../db";
import { createEventBus, type Emitter } from "../events";
import { createIngest, type IngestEvents } from "../ingest";
import { browserSpotify, spotifyClientId } from "../spotify";
import { daySpan, trackPlays } from "../standings";
import { createTimeline, createWorkerBuild, TimelineContext } from "../timeline";
import { App } from "./App";
import { createConnection, type ConnectionEvents } from "./connection";
import { createFailures, type Failures } from "./failures";
import { ServicesContext, type ReadTrackPlays } from "./services";
import { createSession } from "./session";
import { createSettings } from "./settings";
import { createSoundtrackPlayer, type SetTimer } from "./soundtrackPlayer";

/**
 * The Spotify connection and the port it reaches Spotify through, if the build has a Client ID;
 * the connection finishes a sign-in Spotify sent back.
 */
async function connectSpotify(db: Db, events: Emitter<ConnectionEvents>, failures: Failures) {
    const clientId = spotifyClientId(import.meta.env);
    if (clientId === undefined) return undefined;
    const port = browserSpotify();
    const connection = createConnection({
        db,
        port,
        events,
        failures,
        clientId,
        redirectUri: new URL(import.meta.env.BASE_URL, location.origin).toString(),
        now: Date.now,
        stored: await db.loadSpotify(),
    });
    void connection.finishSignIn(location.href);
    return { connection, port };
}

/** Reads only the stored Scrobbles around the Day, then counts the Artist's Track plays in it. */
const trackPlaysFrom =
    (db: Db): ReadTrackPlays =>
    async (listenerId, tables, day, artist) => {
        const { from, to } = daySpan(tables, day);
        return trackPlays(tables, day, artist, await db.scrobblesBetween(listenerId, from, to));
    };

const setTimer: SetTimer = (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
};

/** The composition root: opens storage, builds every service once and renders the app. */
export async function boot(root: HTMLElement): Promise<void> {
    const db = openDb();
    const events = createEventBus<IngestEvents & ConnectionEvents>();
    const failures = createFailures();
    const settings = await createSettings(db, failures, events);
    const spotify = await connectSpotify(db, events, failures);
    const ingest = createIngest({ db, events });
    const timeline = createTimeline({
        ...createWorkerBuild(),
        events,
        now: Date.now,
        requestFrame: (callback) => {
            const frame = requestAnimationFrame(callback);
            return () => cancelAnimationFrame(frame);
        },
        playback: () => settings.store.getState(),
    });
    // A new Window size or pick picks the Soundtracks again; the tables stay as they are.
    settings.store.subscribe((now, before) => {
        const repicks =
            now.soundtrackDays !== before.soundtrackDays ||
            now.soundtrackPick !== before.soundtrackPick;
        if (repicks) void timeline.repickSoundtracks();
    });
    const session = createSession({
        db,
        events,
        ingest,
        timeline,
        settings,
        failures,
        listeners: await db.listeners(),
        defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: Date.now,
    });
    const soundtrackPlayer =
        spotify &&
        createSoundtrackPlayer({
            timeline,
            settings,
            connection: spotify.connection,
            events,
            db,
            fetch: spotify.port.fetch,
            now: Date.now,
            setTimer,
            failures,
            limitedUntil: await db.loadSpotifyLimit(),
        });

    createRoot(root).render(
        <StrictMode>
            <ServicesContext
                value={{
                    ingest,
                    settings,
                    session,
                    failures,
                    spotify: spotify?.connection,
                    soundtrackPlayer,
                    now: Date.now,
                    readTrackPlays: trackPlaysFrom(db),
                }}
            >
                <TimelineContext value={timeline}>
                    <App />
                </TimelineContext>
            </ServicesContext>
        </StrictMode>,
    );
}
