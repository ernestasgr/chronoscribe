import { createStore, type StoreApi } from "zustand";
import type { AppSettings, Db } from "../db";

/** The app-wide settings, hydrated from Dexie and written back to it on every change. */
export async function createSettings(db: Db) {
    const stored = await db.loadSettings();
    const store: StoreApi<AppSettings> = createStore<AppSettings>(() => stored);
    store.subscribe((settings) => void db.saveSettings(settings));

    return {
        store,
        update: (changes: Partial<AppSettings>) => store.setState(changes),
    };
}

export type Settings = Awaited<ReturnType<typeof createSettings>>;
