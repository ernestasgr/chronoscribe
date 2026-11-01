import { ChevronRightIcon } from "lucide-react";
import { useRef } from "react";
import type { ClimbersMode } from "../settings";
import {
    climbers,
    dailyPlays,
    dayDate,
    dayScrobbles,
    topX,
    type Climber,
    type DayIndex,
    type StandingsTables,
} from "../standings";
import {
    Badge,
    Button,
    Card,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Separator,
} from "../ui";
import { useFlip } from "./flip";
import { count } from "./labels";

/** The Focus Day's date and Scrobbles, its Top X with their Daily plays, and its Climbers. */
export function FocusDayPanel({
    tables,
    day,
    x,
    mode,
}: {
    tables: StandingsTables;
    day: DayIndex;
    x: number;
    mode: ClimbersMode;
}) {
    return (
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
            <div className="grid gap-4 2xl:grid-cols-2 2xl:gap-8">
                <TopX tables={tables} day={day} x={x} />
                <Separator className="2xl:hidden" />
                <Climbers tables={tables} day={day} x={x} mode={mode} />
            </div>
        </Card>
    );
}

function TopX({ tables, day, x }: { tables: StandingsTables; day: DayIndex; x: number }) {
    const rows = topX(tables, day, x).map((row) => ({
        ...row,
        dailyPlays: dailyPlays(tables, day, row.id),
    }));
    const most = Math.max(1, ...rows.map((row) => row.dailyPlays));
    const list = useRef<HTMLOListElement>(null);
    useFlip(list);

    return (
        <section className="grid min-w-0 content-start gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Top {x}</h3>
            <ol ref={list} aria-label="Top X" className="grid grid-cols-1 gap-2">
                {rows.map((row) => (
                    <li key={row.artist} data-flip={row.artist} className="grid min-w-0 gap-1">
                        <div className="flex min-w-0 items-baseline gap-2 text-sm">
                            <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                                #{row.standing}
                            </span>{" "}
                            <span className="min-w-0 flex-1 truncate font-medium">
                                {row.artist}
                            </span>{" "}
                            <span className="shrink-0 font-medium tabular-nums">
                                +{row.dailyPlays.toLocaleString("en")}
                            </span>
                        </div>{" "}
                        <div className="ml-10 flex min-w-0 items-center gap-2">
                            <span
                                role="meter"
                                aria-label="Daily plays"
                                aria-valuenow={row.dailyPlays}
                                aria-valuemin={0}
                                aria-valuemax={most}
                                title={count(row.dailyPlays, "Daily play")}
                                className="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                            >
                                <span
                                    className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-in-out"
                                    style={{ width: `${(100 * row.dailyPlays) / most}%` }}
                                />
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {row.cumulative.toLocaleString("en")}
                            </span>
                        </div>
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
    day: DayIndex;
    x: number;
    mode: ClimbersMode;
}) {
    const { listed, folded } = climbers(tables, day, mode, x);

    return (
        <section className="grid min-w-0 content-start gap-2">
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
        <ol aria-label={label} className="grid grid-cols-1 gap-1.5">
            {rows.map((row) => (
                <li key={row.artist} className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                        #{row.standing}
                    </span>{" "}
                    <span className="min-w-0 flex-1 truncate font-medium">{row.artist}</span>{" "}
                    <span className="shrink-0 text-emerald-600 tabular-nums dark:text-emerald-400">
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
