import { Dexie, type EntityTable } from "dexie";

export interface ScrobbleRow {
  id?: number;
  listenerId: string;
  uts: number;
  artist: string;
  track: string;
  album: string;
}

export interface ListenerRow {
  /** The lowercased last.fm username. */
  id: string;
  username: string;
  /** IANA timezone the Listener's Days are counted in. */
  timeZone: string;
  pinnedArtists: string[];
  /** The fixed, exclusive `to` the import pages up to, in Unix seconds. */
  importTo: number;
  importComplete: boolean;
  lastViewedAt: number;
}

/** fold long tail / within Top max(50, 5X) / all (raw) */
export type ClimbersMode = "fold" | "within" | "all";

export interface AppSettings {
  apiKey: string;
  /** How many Artists the Top X shows. */
  x: number;
  climbers: ClimbersMode;
}

export const DEFAULT_SETTINGS: AppSettings = { apiKey: "", x: 10, climbers: "fold" };

const SETTINGS_ID = "app";

class ChronoscribeDb extends Dexie {
  appSettings!: EntityTable<AppSettings & { id: string }, "id">;
  listeners!: EntityTable<ListenerRow, "id">;
  scrobbles!: EntityTable<ScrobbleRow, "id">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      appSettings: "id",
      listeners: "id",
      scrobbles: "++id, [listenerId+uts]",
    });
  }
}

export function listenerId(username: string): string {
  return username.toLowerCase();
}

/** The app's storage. Every read and write of IndexedDB goes through here. */
export function openDb(name = "chronoscribe") {
  const dexie = new ChronoscribeDb(name);
  const scrobblesOf = (id: string) =>
    dexie.scrobbles.where("[listenerId+uts]").between([id, Dexie.minKey], [id, Dexie.maxKey]);

  return {
    async loadSettings(): Promise<AppSettings> {
      const { id: _id, ...stored } = (await dexie.appSettings.get(SETTINGS_ID)) ?? {
        id: SETTINGS_ID,
      };
      return { ...DEFAULT_SETTINGS, ...stored };
    },

    async saveSettings(settings: AppSettings): Promise<void> {
      await dexie.appSettings.put({ ...settings, id: SETTINGS_ID });
    },

    listener(id: string): Promise<ListenerRow | undefined> {
      return dexie.listeners.get(id);
    },

    listeners(): Promise<ListenerRow[]> {
      return dexie.listeners.toArray();
    },

    async putListener(listener: ListenerRow): Promise<void> {
      await dexie.listeners.put(listener);
    },

    async updateListener(id: string, changes: Partial<Omit<ListenerRow, "id">>): Promise<void> {
      await dexie.listeners.update(id, changes);
    },

    /** Stores one page of a Listener's Scrobbles in a single transaction. */
    async addScrobbles(rows: Omit<ScrobbleRow, "id">[]): Promise<void> {
      await dexie.transaction("rw", dexie.scrobbles, () => dexie.scrobbles.bulkAdd(rows));
    },

    async deleteScrobblesOf(id: string): Promise<void> {
      await scrobblesOf(id).delete();
    },

    /** A Listener's Scrobbles, oldest first. */
    async scrobblesOf(id: string): Promise<Omit<ScrobbleRow, "id">[]> {
      const rows = await scrobblesOf(id).toArray();
      return rows.map(({ id: _id, ...row }) => row);
    },

    close(): void {
      dexie.close();
    },
  };
}

export type Db = ReturnType<typeof openDb>;
