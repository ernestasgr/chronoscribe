import { z } from "zod";

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

/** The Top X sizes offered. */
export const TOP_X = { min: 1, max: 100 } as const;
/** The playback speeds offered, in seconds per Day. */
export const SECONDS_PER_DAY = { min: 0.02, max: 2 } as const;
/** The step sizes offered, in Days. */
export const STEP_DAYS = { min: 1, max: 365 } as const;
/** The Window sizes offered, in Days. */
export const SOUNDTRACK_DAYS = { min: 1, max: 3650 } as const;

/** A Top X size, for the stored row and for what the user types alike. */
export const TopXSize = z.number().int().min(TOP_X.min).max(TOP_X.max);
/** A playback speed, for the stored row and for what the user types alike. */
export const SecondsPerDay = z.number().min(SECONDS_PER_DAY.min).max(SECONDS_PER_DAY.max);
/** A step size, for the stored row and for what the user types alike. */
export const StepDays = z.number().int().min(STEP_DAYS.min).max(STEP_DAYS.max);
/** A Window size, for the stored row and for what the user types alike. */
export const SoundtrackDays = z.number().int().min(SOUNDTRACK_DAYS.min).max(SOUNDTRACK_DAYS.max);

/** The app-wide settings: the last.fm API key, the chart's options and the Player's. */
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
    /** How many Days each Window holds, so each Window gets its own Soundtrack. */
    soundtrackDays: number;
    /** Whether the Player names the Soundtrack while the history plays. */
    soundtrack: boolean;
}

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
    soundtrackDays: 30,
    soundtrack: false,
};

/** Stored settings; anything missing or unknown takes its default, field by field. */
const AppSettingsSchema = z.object({
    apiKey: z.string().catch(DEFAULT_SETTINGS.apiKey),
    x: TopXSize.catch(DEFAULT_SETTINGS.x),
    climbers: z.enum(CLIMBERS_MODES).catch(DEFAULT_SETTINGS.climbers),
    yAxis: z.enum(Y_AXES).catch(DEFAULT_SETTINGS.yAxis),
    belowTopX: z.enum(BELOW_TOP_X).catch(DEFAULT_SETTINGS.belowTopX),
    lineShape: z.enum(LINE_SHAPES).catch(DEFAULT_SETTINGS.lineShape),
    linesDrawn: z.enum(LINES_RULES).catch(DEFAULT_SETTINGS.linesDrawn),
    hideFuture: z.boolean().catch(DEFAULT_SETTINGS.hideFuture),
    secondsPerDay: SecondsPerDay.catch(DEFAULT_SETTINGS.secondsPerDay),
    stepDays: StepDays.catch(DEFAULT_SETTINGS.stepDays),
    soundtrackDays: SoundtrackDays.catch(DEFAULT_SETTINGS.soundtrackDays),
    soundtrack: z.boolean().catch(DEFAULT_SETTINGS.soundtrack),
}) satisfies z.ZodType<AppSettings>;

/** Settings read back from storage; a missing row reads as the defaults. */
export const parseSettings = (row: unknown): AppSettings => {
    const parsed = AppSettingsSchema.safeParse(typeof row === "object" && row !== null ? row : {});
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
};
