import { create } from "zustand";
import { DEFAULT_SETTINGS, type AppSettings, type Db } from "../db";

interface SettingsState extends AppSettings {
  update: (changes: Partial<AppSettings>) => void;
}

export const useSettings = create<SettingsState>()((set) => ({
  ...DEFAULT_SETTINGS,
  update: (changes) => set(changes),
}));

/** Loads the settings from Dexie, then writes every later change back to it. */
export async function hydrateSettings(db: Db): Promise<void> {
  useSettings.setState(await db.loadSettings());
  useSettings.subscribe(({ apiKey, x }) => void db.saveSettings({ apiKey, x }));
}
