import { ChevronRightIcon } from "lucide-react";
import { Chart } from "../chart";
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
            <Toolbar username={username} tables={tables} day={day} x={x} mode={mode} />
            <Card className="min-h-80 overflow-hidden p-2">
                <Chart tables={tables} x={x} />
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
}: {
    username: string;
    tables: StandingsTables;
    day: number;
    x: number;
    mode: ClimbersMode;
}) {
    const { settings } = useServices();
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
            <div className="flex items-center gap-2">
                <Label htmlFor="climbers-mode">Climbers</Label>
                <NativeSelect
                    id="climbers-mode"
                    value={mode}
                    onChange={(e) => settings.update({ climbers: e.target.value as ClimbersMode })}
                >
                    <NativeSelectOption value="fold">fold long tail</NativeSelectOption>
                    <NativeSelectOption value="within">
                        within Top {climbersCut(x)}
                    </NativeSelectOption>
                    <NativeSelectOption value="all">all (raw)</NativeSelectOption>
                </NativeSelect>
            </div>
        </header>
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
