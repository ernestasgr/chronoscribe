import { createStore, type StoreApi } from "zustand";
import type { AppSettings, Db } from "../db";
import type { Failures } from "./failures";

/** The app-wide settings, hydrated from Dexie and written back to it on every change. */
export async function createSettings(db: Db, failures: Pick<Failures, "report">) {
    const stored = await db.loadSettings();
    const store: StoreApi<AppSettings> = createStore<AppSettings>(() => stored);
    store.subscribe((settings) =>
        db.saveSettings(settings).catch((error: unknown) => {
            failures.report("Couldn't save the settings", error);
        }),
    );

    return {
        store,
        update: (changes: Partial<AppSettings>) => store.setState(changes),
    };
}

export type Settings = Awaited<ReturnType<typeof createSettings>>;
