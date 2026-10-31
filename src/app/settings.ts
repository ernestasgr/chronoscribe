import { createStore, type StoreApi } from "zustand";
import type { Db } from "../db";
import type { Subscriber } from "../events";
import type { AppSettings } from "../settings";
import type { ConnectionEvents } from "./connection";
import type { Failures } from "./failures";

/**
 * The app-wide settings, hydrated from Dexie and written back to it on every change. Spotify
 * failing turns the Soundtrack off; a finished sign-in, which only the switch starts, turns it on.
 */
export async function createSettings(
    db: Db,
    failures: Pick<Failures, "report">,
    spotify: Subscriber<ConnectionEvents>,
) {
    const stored = await db.loadSettings();
    const store: StoreApi<AppSettings> = createStore<AppSettings>(() => stored);
    store.subscribe((settings) =>
        db.saveSettings(settings).catch((error: unknown) => {
            failures.report("Couldn't save the settings", error);
        }),
    );

    spotify.on("spotifyFailed", () => store.setState({ soundtrack: false }));
    spotify.on("spotifySignedIn", () => store.setState({ soundtrack: true }));

    return {
        store,
        update: (changes: Partial<AppSettings>) => store.setState(changes),
    };
}

export type Settings = Awaited<ReturnType<typeof createSettings>>;
