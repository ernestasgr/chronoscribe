import { Dexie, type EntityTable } from "dexie";
import { z } from "zod";

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
export const CLIMBERS_MODES = ["fold", "within", "all"] as const;
export type ClimbersMode = (typeof CLIMBERS_MODES)[number];

/** What the chart's Y axis measures: Standing, or cumulative Scrobbles. */
export const Y_AXES = ["standing", "scrobbles"] as const;
export type YAxis = (typeof Y_AXES)[number];

/** Where Standing mode puts Artists below the Top X: a gutter band, off the bottom, or a log axis. */
export const BELOW_TOP_X = ["gutter", "slide-off", "log"] as const;
export type BelowTopX = (typeof BELOW_TOP_X)[number];

/** How Standing mode draws its lines between Days. */
export const LINE_SHAPES = ["s-curves", "straight", "monotone", "catmull-rom", "basis"] as const;
export type LineShape = (typeof LINE_SHAPES)[number];

/** Which Artists get a line: Top X after a 30-Day warm-up, with none, or on at least 7 Days. */
export const LINES_RULES = ["warm-up", "no-warm-up", "seven-days"] as const;
export type LinesRule = (typeof LINES_RULES)[number];

export interface AppSettings {
    apiKey: string;
    /** How many Artists the Top X shows. */
    x: number;
    climbers: ClimbersMode;
    yAxis: YAxis;
    belowTopX: BelowTopX;
    lineShape: LineShape;
    linesDrawn: LinesRule;
}

export const DEFAULT_SETTINGS: AppSettings = {
    apiKey: "",
    x: 10,
    climbers: "fold",
    yAxis: "standing",
    belowTopX: "gutter",
    lineShape: "s-curves",
    linesDrawn: "warm-up",
};

/** A stored settings row; anything missing or unknown takes its default, field by field. */
const SettingsRow = z.object({
    apiKey: z.string().catch(DEFAULT_SETTINGS.apiKey),
    x: z.number().int().min(1).max(100).catch(DEFAULT_SETTINGS.x),
    climbers: z.enum(CLIMBERS_MODES).catch(DEFAULT_SETTINGS.climbers),
    yAxis: z.enum(Y_AXES).catch(DEFAULT_SETTINGS.yAxis),
    belowTopX: z.enum(BELOW_TOP_X).catch(DEFAULT_SETTINGS.belowTopX),
    lineShape: z.enum(LINE_SHAPES).catch(DEFAULT_SETTINGS.lineShape),
    linesDrawn: z.enum(LINES_RULES).catch(DEFAULT_SETTINGS.linesDrawn),
});

const SETTINGS_ID = "app";

type ChronoscribeDexie = Dexie & {
    appSettings: EntityTable<AppSettings & { id: string }, "id">;
    listeners: EntityTable<ListenerRow, "id">;
    scrobbles: EntityTable<ScrobbleRow, "id">;
};

function openDexie(name: string): ChronoscribeDexie {
    const dexie = new Dexie(name) as ChronoscribeDexie;
    dexie.version(1).stores({
        appSettings: "id",
        listeners: "id",
        scrobbles: "++id, [listenerId+uts]",
    });
    return dexie;
}

export function listenerId(username: string): string {
    return username.toLowerCase();
}

/** The most recently viewed Listener whose import has finished. */
export const mostRecentlyViewed = (listeners: readonly ListenerRow[]): ListenerRow | undefined =>
    listeners
        .filter((listener) => listener.importComplete)
        .toSorted((a, b) => b.lastViewedAt - a.lastViewedAt)[0];

/** The app's storage. Every read and write of IndexedDB goes through here. */
export function openDb(name = "chronoscribe") {
    const dexie = openDexie(name);
    const scrobblesOf = (id: string) =>
        dexie.scrobbles.where("[listenerId+uts]").between([id, Dexie.minKey], [id, Dexie.maxKey]);

    return {
        async loadSettings(): Promise<AppSettings> {
            const parsed = SettingsRow.safeParse({ ...(await dexie.appSettings.get(SETTINGS_ID)) });
            return parsed.success ? parsed.data : DEFAULT_SETTINGS;
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
