import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openDb } from "../db";
import { createEventBus } from "../events";
import { createIngest, type IngestEvents } from "../ingest";
import { createTimeline, createWorkerBuild, TimelineContext } from "../timeline";
import { App } from "./App";
import { createFailures } from "./failures";
import { ServicesContext } from "./services";
import { createSession } from "./session";
import { createSettings } from "./settings";

/** The composition root: opens storage, builds every service once and renders the app. */
export async function boot(root: HTMLElement): Promise<void> {
    const db = openDb();
    const events = createEventBus<IngestEvents>();
    const failures = createFailures();
    const settings = await createSettings(db, failures);
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
    // A new Window size picks the Soundtracks again; the tables stay as they are.
    settings.store.subscribe((now, before) => {
        if (now.soundtrackDays !== before.soundtrackDays) void timeline.repickSoundtracks();
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

    createRoot(root).render(
        <StrictMode>
            <ServicesContext value={{ ingest, settings, session, failures, now: Date.now }}>
                <TimelineContext value={timeline}>
                    <App />
                </TimelineContext>
            </ServicesContext>
        </StrictMode>,
    );
}
