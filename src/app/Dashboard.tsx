import {
    ChevronLeftIcon,
    ChevronRightIcon,
    PauseIcon,
    PlayIcon,
    RefreshCwIcon,
    SettingsIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useShallow } from "zustand/react/shallow";
import { Chart, Minimap, type ChartOptions } from "../chart";
import { SECONDS_PER_DAY, SecondsPerDay, STEP_DAYS, StepDays, type ListenerRow } from "../db";
import { isSettled } from "../ingest";
import type { UnixSeconds } from "../lastfm";
import {
    climbers,
    climbersCut,
    dailyPlays,
    dayDate,
    dayScrobbles,
    topX,
    type Climber,
    type ClimbersMode,
    type StandingsTables,
} from "../standings";
import { useFocusDay, usePlaying, useTables, useTimeline, type Timeline } from "../timeline";
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Badge,
    Button,
    Card,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Input,
    Label,
    NativeSelect,
    NativeSelectOption,
    Separator,
    Slider,
    Switch,
} from "../ui";
import { ApiKeyForm, TimeZoneSelect } from "./fields";
import { useFlip } from "./flip";
import { useQueue, useServices, useSettings } from "./services";

const count = (n: number, noun: string) => `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;

const MINUTE_MS = 60_000;

/** How long ago a Listener was synced, as the toolbar puts it: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function syncAge(nowMs: number, syncedAt: UnixSeconds): string {
    const minutes = Math.floor((nowMs - syncedAt * 1000) / MINUTE_MS);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** The time now from the app's clock, refreshed every `everyMs`, for labels that count from it. */
function useNow(everyMs: number): number {
    const { now: clock } = useServices();
    const [now, setNow] = useState(clock);
    useEffect(() => {
        const timer = setInterval(() => setNow(clock()), everyMs);
        return () => clearInterval(timer);
    }, [clock, everyMs]);
    return now;
}

const validX = (value: number) => Number.isInteger(value) && value >= 1 && value <= 100;

/** The step sizes offered as presets, by label. */
const STEP_PRESETS: readonly (readonly [label: string, days: number])[] = [
    ["1d", 1],
    ["1w", 7],
    ["30d", 30],
    ["1y", 365],
];

/** What each player key does. */
const PLAYER_KEYS: Readonly<Record<string, (timeline: Timeline) => void>> = {
    " ": (timeline) => timeline.togglePlaying(),
    ",": (timeline) => timeline.step(-1),
    ".": (timeline) => timeline.step(1),
};

/** Whether a key pressed on `target` belongs to that control rather than to the player. */
const ownsKeys = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest("input, textarea, select, button, [contenteditable]") !== null;

/** Space plays and pauses, `,` and `.` step back and forward, anywhere but in a control. */
function usePlayerKeys(timeline: Timeline) {
    useEffect(() => {
        const press = (event: KeyboardEvent) => {
            const action = PLAYER_KEYS[event.key];
            if (!action || event.ctrlKey || event.metaKey || event.altKey) return;
            if (ownsKeys(event.target)) return;
            event.preventDefault();
            action(timeline);
        };
        addEventListener("keydown", press);
        return () => removeEventListener("keydown", press);
    }, [timeline]);
}

/** The Dashboard: the toolbar, the chart, and the Focus Day sidebar. */
export function Dashboard({ listener }: { listener: ListenerRow }) {
    const { username } = listener;
    const tables = useTables();
    const x = useSettings((settings) => settings.x);
    const mode = useSettings((settings) => settings.climbers);
    const options = useSettings(
        useShallow(({ yAxis, belowTopX, lineShape, linesDrawn, hideFuture }): ChartOptions => ({
            yAxis,
            belowTopX,
            lineShape,
            linesDrawn,
            hideFuture,
        })),
    );
    const day = useFocusDay();
    usePlayerKeys(useTimeline());

    if (!tables)
        return (
            <main className="grid min-h-svh place-items-center">
                <p role="status" className="text-sm text-muted-foreground">
                    Building {username}'s Standings…
                </p>
            </main>
        );

    return (
        <main className="grid min-h-svh grid-rows-[auto_minmax(20rem,1fr)_auto] gap-4 p-4 lg:h-svh lg:grid-cols-[1fr_22rem] lg:grid-rows-[auto_1fr]">
            <Toolbar
                listener={listener}
                tables={tables}
                day={day}
                x={x}
                mode={mode}
                options={options}
            />
            <Card className="min-h-80 gap-2 overflow-hidden p-2">
                <Chart tables={tables} x={x} options={options} />
                <Minimap tables={tables} />
            </Card>
            <Card
                role="region"
                aria-label="Focus Day"
                className="min-h-0 gap-4 overflow-y-auto px-5 py-5"
            >
                <header>
                    <h2 className="text-lg font-semibold tabular-nums">{dayDate(tables, day)}</h2>
                    <p className="text-sm text-muted-foreground">
                        {count(dayScrobbles(tables, day), "Scrobble")}
                    </p>
                </header>
                <Separator />
                <TopX tables={tables} day={day} x={x} />
                <Separator />
                <Climbers tables={tables} day={day} x={x} mode={mode} />
            </Card>
        </main>
    );
}

function Toolbar({
    listener,
    tables,
    day,
    x,
    mode,
    options,
}: {
    listener: ListenerRow;
    tables: StandingsTables;
    day: number;
    x: number;
    mode: ClimbersMode;
    options: ChartOptions;
}) {
    const { settings } = useServices();
    const inScrobblesMode = options.yAxis !== "standing";
    const { seek } = useTimeline();

    return (
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-2">
            <h1 className="text-xl font-semibold tracking-tight">{listener.username}</h1>
            <SyncControl listener={listener} />
            <div className="flex min-w-48 flex-1 items-center gap-3">
                <span className="text-sm font-medium whitespace-nowrap">Focus Day</span>
                <Slider
                    aria-label="Focus Day"
                    min={0}
                    max={tables.dayCount - 1}
                    value={[day]}
                    onValueChange={([value]) =>
                        value !== undefined && seek(value, { glide: false })
                    }
                />
            </div>
            <Player />
            <div className="flex items-center gap-2">
                <Label htmlFor="top-x">X</Label>
                <Input
                    id="top-x"
                    type="number"
                    min={1}
                    max={100}
                    value={x}
                    className="w-20"
                    onChange={(e) => {
                        const value = Number(e.target.value);
                        if (validX(value)) settings.update({ x: value });
                    }}
                />
            </div>
            <OptionSelect
                id="climbers-mode"
                label="Climbers"
                value={mode}
                choices={[
                    ["fold", "fold long tail"],
                    ["within", `within Top ${climbersCut(x)}`],
                    ["all", "all (raw)"],
                ]}
                onChange={(choice) => settings.update({ climbers: choice })}
            />
            <OptionSelect
                id="y-axis"
                label="Y axis"
                value={options.yAxis}
                choices={Y_AXIS_CHOICES}
                onChange={(yAxis) => settings.update({ yAxis })}
            />
            <OptionSelect
                id="below-top-x"
                label="Below the Top X"
                value={options.belowTopX}
                choices={BELOW_TOP_X_CHOICES}
                disabled={inScrobblesMode}
                onChange={(belowTopX) => settings.update({ belowTopX })}
            />
            <OptionSelect
                id="line-shape"
                label="Line shape"
                value={options.lineShape}
                choices={LINE_SHAPE_CHOICES}
                disabled={inScrobblesMode}
                onChange={(lineShape) => settings.update({ lineShape })}
            />
            <OptionSelect
                id="lines-drawn"
                label="Lines drawn"
                value={options.linesDrawn}
                choices={LINES_DRAWN_CHOICES}
                onChange={(linesDrawn) => settings.update({ linesDrawn })}
            />
            <div className="flex items-center gap-2">
                <Switch
                    id="hide-future"
                    checked={options.hideFuture}
                    onCheckedChange={(hideFuture) => settings.update({ hideFuture })}
                />
                <Label htmlFor="hide-future">Hide the future</Label>
            </div>
            <Collapsible className="contents">
                <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm">
                        <SettingsIcon />
                        Settings
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="basis-full">
                    <SettingsPanel listener={listener} />
                </CollapsibleContent>
            </Collapsible>
        </header>
    );
}

/** The Sync button and the Listener's sync age, a spinner while a Sync runs, and a Retry toast if one fails. */
function SyncControl({ listener }: { listener: ListenerRow }) {
    const { session } = useServices();
    const sync = useQueue(({ queue }) =>
        queue.findLast((job) => job.kind === "sync" && job.listenerId === listener.id),
    );
    const syncing = sync !== undefined && !isSettled(sync);
    const now = useNow(MINUTE_MS);
    const [dismissed, setDismissed] = useState<number>();

    return (
        <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={syncing} onClick={session.sync}>
                <RefreshCwIcon className={syncing ? "animate-spin" : undefined} />
                Sync
            </Button>
            {syncing ? (
                <span role="status" aria-label="Syncing" className="text-sm text-muted-foreground">
                    Syncing…
                </span>
            ) : (
                <span className="text-sm text-muted-foreground">
                    Synced {syncAge(now, listener.syncedAt)}
                </span>
            )}
            {sync?.status === "failed" && dismissed !== sync.id && (
                <Alert
                    variant="destructive"
                    className="fixed right-4 bottom-4 left-4 z-50 shadow-lg sm:left-auto sm:max-w-sm"
                >
                    <AlertTitle>Sync failed</AlertTitle>
                    <AlertDescription>
                        <p>{sync.error.message}</p>
                        <p>Nothing was changed.</p>
                        <div className="flex gap-2 pt-1">
                            <Button size="sm" onClick={session.sync}>
                                Retry
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDismissed(sync.id)}>
                                Dismiss
                            </Button>
                        </div>
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}

/** The API key, probed before it is saved, and the Listener's timezone. */
function SettingsPanel({ listener }: { listener: ListenerRow }) {
    const { session } = useServices();
    return (
        <Card className="flex-row flex-wrap items-start gap-x-6 gap-y-3 px-4 py-4">
            <ApiKeyForm id="settings-api-key" username={listener.username} />
            <div className="grid gap-2">
                <Label htmlFor="settings-time-zone">Timezone</Label>
                <TimeZoneSelect
                    id="settings-time-zone"
                    value={listener.timeZone}
                    onChange={(timeZone) => void session.changeTimeZone(timeZone)}
                />
            </div>
        </Card>
    );
}

/** Play and pause, the speed, and the "◀ N Days ▶" step control with its presets. */
function Player() {
    const { settings } = useServices();
    const { togglePlaying, step } = useTimeline();
    const playing = usePlaying();
    const stepDays = useSettings((s) => s.stepDays);
    const secondsPerDay = useSettings((s) => s.secondsPerDay);

    return (
        <div
            role="group"
            aria-label="Player"
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
            <Button
                variant="outline"
                size="icon"
                aria-label={playing ? "Pause" : "Play"}
                onClick={togglePlaying}
            >
                {playing ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Step back"
                    onClick={() => step(-1)}
                >
                    <ChevronLeftIcon />
                </Button>
                <NumberSetting
                    label="Step size"
                    value={stepDays}
                    min={STEP_DAYS.min}
                    max={STEP_DAYS.max}
                    step={1}
                    schema={StepDays}
                    onChange={(days) => settings.update({ stepDays: days })}
                    className="w-20"
                />
                <span className="text-sm">Days</span>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Step forward"
                    onClick={() => step(1)}
                >
                    <ChevronRightIcon />
                </Button>
                {STEP_PRESETS.map(([label, days]) => (
                    <Button
                        key={label}
                        variant={stepDays === days ? "secondary" : "ghost"}
                        size="xs"
                        aria-pressed={stepDays === days}
                        onClick={() => settings.update({ stepDays: days })}
                    >
                        {label}
                    </Button>
                ))}
            </div>
            <div className="flex items-center gap-2">
                <Label htmlFor="speed">Speed</Label>
                <NumberSetting
                    id="speed"
                    value={secondsPerDay}
                    min={SECONDS_PER_DAY.min}
                    max={SECONDS_PER_DAY.max}
                    step={0.01}
                    schema={SecondsPerDay}
                    onChange={(speed) => settings.update({ secondsPerDay: speed })}
                    className="w-20"
                />
                <span className="text-sm text-muted-foreground">s/Day</span>
            </div>
        </div>
    );
}

/**
 * A number input for a setting that keeps what is being typed, saving it only once it is valid,
 * so passing through an invalid value such as "0." on the way to "0.05" doesn't reset it.
 */
function NumberSetting({
    id,
    label,
    value,
    min,
    max,
    step,
    schema,
    onChange,
    className,
}: {
    id?: string;
    label?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** The rule a typed value must pass before it is saved. */
    schema: z.ZodType<number>;
    onChange: (value: number) => void;
    className?: string;
}) {
    const [draft, setDraft] = useState<string>();
    return (
        <Input
            id={id}
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            className={className}
            onChange={(e) => {
                setDraft(e.target.value);
                const typed = schema.safeParse(
                    e.target.value === "" ? Number.NaN : Number(e.target.value),
                );
                if (typed.success) onChange(typed.data);
            }}
            onBlur={() => setDraft(undefined)}
        />
    );
}

/** Each choice of a setting, as its stored value and its label. */
type Choices<T extends string> = readonly (readonly [value: T, label: string])[];

const Y_AXIS_CHOICES: Choices<ChartOptions["yAxis"]> = [
    ["standing", "Standing"],
    ["scrobbles", "Scrobbles"],
];
const BELOW_TOP_X_CHOICES: Choices<ChartOptions["belowTopX"]> = [
    ["gutter", "gutter"],
    ["slide-off", "slide off"],
    ["log", "log axis"],
];
const LINE_SHAPE_CHOICES: Choices<ChartOptions["lineShape"]> = [
    ["s-curves", "S-curves"],
    ["straight", "straight"],
    ["monotone", "monotone"],
    ["catmull-rom", "Catmull-Rom"],
    ["basis", "smoothed (basis)"],
];
const LINES_DRAWN_CHOICES: Choices<ChartOptions["linesDrawn"]> = [
    ["warm-up", "30-Day warm-up"],
    ["no-warm-up", "no warm-up"],
    ["seven-days", "at least 7 Days in Top X"],
];

/** A labelled select over a setting's choices, handing back only a value it offered. */
function OptionSelect<T extends string>({
    id,
    label,
    value,
    choices,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    value: T;
    choices: Choices<T>;
    disabled?: boolean;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Label htmlFor={id}>{label}</Label>
            <NativeSelect
                id={id}
                value={value}
                disabled={disabled}
                onChange={(e) => {
                    const chosen = choices.find(([choice]) => choice === e.target.value);
                    if (chosen) onChange(chosen[0]);
                }}
            >
                {choices.map(([choice, text]) => (
                    <NativeSelectOption key={choice} value={choice}>
                        {text}
                    </NativeSelectOption>
                ))}
            </NativeSelect>
        </div>
    );
}

function TopX({ tables, day, x }: { tables: StandingsTables; day: number; x: number }) {
    const rows = topX(tables, day, x).map((row) => ({
        ...row,
        dailyPlays: dailyPlays(tables, day, row.id),
    }));
    const most = Math.max(1, ...rows.map((row) => row.dailyPlays));
    const list = useRef<HTMLOListElement>(null);
    useFlip(list);

    return (
        <section className="grid gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Top {x}</h3>
            <ol ref={list} aria-label="Top X" className="grid gap-2">
                {rows.map((row) => (
                    <li key={row.artist} data-flip={row.artist} className="grid gap-1">
                        <div className="flex items-baseline gap-2 text-sm">
                            <span className="w-8 text-muted-foreground tabular-nums">
                                #{row.standing}
                            </span>{" "}
                            <span className="flex-1 truncate font-medium">{row.artist}</span>{" "}
                            <span className="text-muted-foreground tabular-nums">
                                · {row.cumulative.toLocaleString("en")}
                            </span>
                        </div>
                        <span
                            role="meter"
                            aria-label="Daily plays"
                            aria-valuenow={row.dailyPlays}
                            aria-valuemin={0}
                            aria-valuemax={most}
                            title={count(row.dailyPlays, "Daily play")}
                            className="ml-10 block h-1 overflow-hidden rounded-full bg-muted"
                        >
                            <span
                                className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-in-out"
                                style={{ width: `${(100 * row.dailyPlays) / most}%` }}
                            />
                        </span>
                    </li>
                ))}
            </ol>
        </section>
    );
}

function Climbers({
    tables,
    day,
    x,
    mode,
}: {
    tables: StandingsTables;
    day: number;
    x: number;
    mode: ClimbersMode;
}) {
    const { listed, folded } = climbers(tables, day, mode, x);

    return (
        <section className="grid gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Climbers</h3>
            <ClimberList label="Climbers" rows={listed} />
            {listed.length === 0 && !folded && (
                <p className="text-sm text-muted-foreground">Nobody climbed on this Day.</p>
            )}
            {folded && (
                <Collapsible>
                    <CollapsibleTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="group h-auto w-full justify-start px-1 py-1 text-left whitespace-normal text-muted-foreground"
                        >
                            <ChevronRightIcon className="transition-transform group-data-[state=open]:rotate-90" />
                            {count(folded.climbers.length, "long-tail jump")} beyond #
                            {folded.beyond} ({folded.singlePlay.toLocaleString("en")} on a single
                            play)
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                        <ClimberList label="Long-tail Climbers" rows={folded.climbers} />
                    </CollapsibleContent>
                </Collapsible>
            )}
        </section>
    );
}

function ClimberList({ label, rows }: { label: string; rows: Climber[] }) {
    return (
        <ol aria-label={label} className="grid gap-1.5">
            {rows.map((row) => (
                <li key={row.artist} className="flex items-center gap-2 text-sm">
                    <span className="w-8 text-muted-foreground tabular-nums">#{row.standing}</span>{" "}
                    <span className="flex-1 truncate font-medium">{row.artist}</span>{" "}
                    <span className="text-emerald-600 tabular-nums dark:text-emerald-400">
                        ↑{row.gain}
                    </span>
                    {row.debut && (
                        <>
                            {" "}
                            <Badge variant="secondary">debut</Badge>
                        </>
                    )}
                </li>
            ))}
        </ol>
    );
}
