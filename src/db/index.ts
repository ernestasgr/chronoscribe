import { Dexie, type EntityTable } from "dexie";
import { z } from "zod";
import { unixSeconds, type UnixSeconds } from "../lastfm";

/** A Listener's key: their last.fm username, lowercased. */
export type ListenerId = string & { readonly brand: "ListenerId" };

/** The Listener id for a last.fm username, which last.fm matches case-insensitively. */
export const listenerId = (username: string): ListenerId => username.toLowerCase() as ListenerId;

export interface ScrobbleRow {
    id?: number;
    listenerId: ListenerId;
    uts: UnixSeconds;
    artist: string;
    track: string;
    album: string;
}

/** The page sizes an import asks last.fm for, largest first. */
export const PAGE_SIZES = [1000, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** A stored Listener row; one from before page sizes were remembered asks for 1000. */
const ListenerRowSchema = z.object({
    id: z.string().transform(listenerId),
    username: z.string(),
    /** IANA timezone the Listener's Days are counted in. */
    timeZone: z.string(),
    pinnedArtists: z.array(z.string()),
    /** The fixed, exclusive `to` the import pages up to. */
    importTo: z.number().transform(unixSeconds),
    importComplete: z.boolean(),
    /** How many Scrobbles each import request asks for: 200 once last.fm has refused 1000. */
    pageSize: z.literal(PAGE_SIZES).catch(PAGE_SIZES[0]),
    lastViewedAt: z.number(),
});

export type ListenerRow = z.infer<typeof ListenerRowSchema>;

const parseListener = (row: unknown): ListenerRow | undefined => {
    const parsed = ListenerRowSchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
};

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
    /** Whether lines ahead of the playhead are hidden, so the future isn't given away. */
    hideFuture: boolean;
    /** Playback speed, in seconds per Day. */
    secondsPerDay: number;
    /** How many Days the step control and the `,` and `.` keys move by. */
    stepDays: number;
}

/** The playback speeds offered, in seconds per Day. */
export const SECONDS_PER_DAY = { min: 0.02, max: 2 } as const;
/** The step sizes offered, in Days. */
export const STEP_DAYS = { min: 1, max: 365 } as const;

/** A playback speed, for the stored row and for what the user types alike. */
export const SecondsPerDay = z.number().min(SECONDS_PER_DAY.min).max(SECONDS_PER_DAY.max);
/** A step size, for the stored row and for what the user types alike. */
export const StepDays = z.number().int().min(STEP_DAYS.min).max(STEP_DAYS.max);

export const DEFAULT_SETTINGS: AppSettings = {
    apiKey: "",
    x: 10,
    climbers: "fold",
    yAxis: "standing",
    belowTopX: "gutter",
    lineShape: "s-curves",
    linesDrawn: "warm-up",
    hideFuture: true,
    secondsPerDay: 0.1,
    stepDays: 1,
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
    hideFuture: z.boolean().catch(DEFAULT_SETTINGS.hideFuture),
    secondsPerDay: SecondsPerDay.catch(DEFAULT_SETTINGS.secondsPerDay),
    stepDays: StepDays.catch(DEFAULT_SETTINGS.stepDays),
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

/** The most recently viewed Listener whose import has finished. */
export const mostRecentlyViewed = (listeners: readonly ListenerRow[]): ListenerRow | undefined =>
    listeners
        .filter((listener) => listener.importComplete)
        .toSorted((a, b) => b.lastViewedAt - a.lastViewedAt)[0];

/** The app's storage. Every read and write of IndexedDB goes through here. */
export function openDb(name = "chronoscribe") {
    const dexie = openDexie(name);
    const scrobblesOf = (id: ListenerId) =>
        dexie.scrobbles.where("[listenerId+uts]").between([id, Dexie.minKey], [id, Dexie.maxKey]);

    return {
        async loadSettings(): Promise<AppSettings> {
            const parsed = SettingsRow.safeParse({ ...(await dexie.appSettings.get(SETTINGS_ID)) });
            return parsed.success ? parsed.data : DEFAULT_SETTINGS;
        },

        async saveSettings(settings: AppSettings): Promise<void> {
            await dexie.appSettings.put({ ...settings, id: SETTINGS_ID });
        },

        async listener(id: ListenerId): Promise<ListenerRow | undefined> {
            return parseListener(await dexie.listeners.get(id));
        },

        async listeners(): Promise<ListenerRow[]> {
            return (await dexie.listeners.toArray()).flatMap((row) => parseListener(row) ?? []);
        },

        async putListener(listener: ListenerRow): Promise<void> {
            await dexie.listeners.put(listener);
        },

        async updateListener(
            id: ListenerId,
            changes: Partial<Omit<ListenerRow, "id">>,
        ): Promise<void> {
            await dexie.listeners.update(id, changes);
        },

        /** Stores one page of a Listener's Scrobbles in one transaction, completing their import on the last. */
        async addPage(
            id: ListenerId,
            rows: Omit<ScrobbleRow, "id">[],
            { last }: { last: boolean },
        ): Promise<void> {
            await dexie.transaction("rw", dexie.scrobbles, dexie.listeners, async () => {
                await dexie.scrobbles.bulkAdd(rows);
                if (last) await dexie.listeners.update(id, { importComplete: true });
            });
        },

        async deleteScrobblesOf(id: ListenerId): Promise<void> {
            await scrobblesOf(id).delete();
        },

        /** The second of a Listener's oldest stored Scrobble, if they have any. */
        async oldestUtsOf(id: ListenerId): Promise<UnixSeconds | undefined> {
            return (await scrobblesOf(id).first())?.uts;
        },

        /** Deletes a Listener's Scrobbles from exactly the second `uts`. */
        async deleteScrobblesAt(id: ListenerId, uts: UnixSeconds): Promise<void> {
            await dexie.scrobbles.where("[listenerId+uts]").equals([id, uts]).delete();
        },

        countScrobblesOf(id: ListenerId): Promise<number> {
            return scrobblesOf(id).count();
        },

        /** A Listener's Scrobbles, oldest first. */
        async scrobblesOf(id: ListenerId): Promise<Omit<ScrobbleRow, "id">[]> {
            const rows = await scrobblesOf(id).toArray();
            return rows.map(({ id: _id, ...row }) => row);
        },

        close(): void {
            dexie.close();
        },
    };
}

export type Db = ReturnType<typeof openDb>;
