import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { mostRecentlyViewed, openDb } from "../db";
import { createEventBus } from "../events";
import { createIngest, type IngestEvents } from "../ingest";
import { createTimeline, createWorkerBuild, TimelineContext } from "../timeline";
import { App } from "./App";
import { ServicesContext } from "./services";
import { createSession } from "./session";
import { createSettings } from "./settings";

/** The composition root: opens storage, builds every service once and renders the app. */
export async function boot(root: HTMLElement): Promise<void> {
    const db = openDb();
    const events = createEventBus<IngestEvents>();
    const settings = await createSettings(db);
    const ingest = createIngest({ db, events });
    const timeline = createTimeline({
        build: createWorkerBuild(),
        events,
        now: Date.now,
        requestFrame: (callback) => {
            const frame = requestAnimationFrame(callback);
            return () => cancelAnimationFrame(frame);
        },
        playback: () => settings.store.getState(),
    });
    const session = createSession({
        db,
        events,
        ingest,
        timeline,
        settings,
        initial: mostRecentlyViewed(await db.listeners()),
        defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    createRoot(root).render(
        <StrictMode>
            <ServicesContext value={{ ingest, settings, session }}>
                <TimelineContext value={timeline}>
                    <App />
                </TimelineContext>
            </ServicesContext>
        </StrictMode>,
    );
}
