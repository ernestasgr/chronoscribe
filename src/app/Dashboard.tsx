import { ChevronRightIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Chart, Minimap, type ChartOptions } from "../chart";
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
import { useFocusDay, useTables, useTimeline } from "../timeline";
import {
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
} from "../ui";
import { useServices, useSettings } from "./services";

const count = (n: number, noun: string) => `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;

const validX = (value: number) => Number.isInteger(value) && value >= 1 && value <= 100;

/** The Dashboard: the toolbar, the chart, and the Focus Day sidebar. */
export function Dashboard({ username }: { username: string }) {
    const tables = useTables();
    const x = useSettings((settings) => settings.x);
    const mode = useSettings((settings) => settings.climbers);
    const options = useSettings(
        useShallow(({ yAxis, belowTopX, lineShape, linesDrawn }): ChartOptions => ({
            yAxis,
            belowTopX,
            lineShape,
            linesDrawn,
        })),
    );
    const day = useFocusDay();

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
                username={username}
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
    username,
    tables,
    day,
    x,
    mode,
    options,
}: {
    username: string;
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
            <h1 className="text-xl font-semibold tracking-tight">{username}</h1>
            <div className="flex min-w-48 flex-1 items-center gap-3">
                <span className="text-sm font-medium whitespace-nowrap">Focus Day</span>
                <Slider
                    aria-label="Focus Day"
                    min={0}
                    max={tables.dayCount - 1}
                    value={[day]}
                    onValueChange={([value]) => value !== undefined && seek(value)}
                />
            </div>
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
        </header>
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

    return (
        <section className="grid gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Top {x}</h3>
            <ol aria-label="Top X" className="grid gap-2">
                {rows.map((row) => (
                    <li key={row.artist} className="grid gap-1">
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
                                className="block h-full rounded-full bg-primary transition-[width]"
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
