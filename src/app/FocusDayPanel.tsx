import { ChevronRightIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { ClimbersMode } from "../settings";
import {
    climbers,
    dailyPlays,
    dayDate,
    dayScrobbles,
    topX,
    standingAt,
    type Climber,
    type DayIndex,
    type NamedArtist,
    type Standing,
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
import { count, standingLabel } from "./labels";
import { useServices } from "./services";

/** A row's look when it is the Spotlit Artist's, marked with `aria-current`. */
const SPOTLIT_ROW = "-mx-1 rounded-md px-1 aria-[current=true]:bg-accent";

/**
 * An Artist's row as a button that opens the Spotlight on them: their Standing, their name, then
 * what the list reports of them.
 */
function ArtistRowButton({
    artist,
    standing,
    children,
}: {
    artist: string;
    standing: Standing | undefined;
    children: ReactNode;
}) {
    const { session } = useServices();
    return (
        <Button
            variant="ghost"
            aria-label={`Spotlight ${artist}`}
            onClick={() => session.spotlight(artist)}
            className="group h-auto w-full min-w-0 justify-start gap-2 p-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
        >
            <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                {standingLabel(standing)}
            </span>{" "}
            <span className="min-w-0 flex-1 truncate font-medium group-hover:underline">
                {artist}
            </span>{" "}
            {children}
        </Button>
    );
}

/**
 * The Focus Day's date and Scrobbles, its Top X with their Daily plays, and its Climbers. Clicking
 * an Artist's row opens the Spotlight on them; the Spotlit Artist's rows are highlighted, and
 * shown under the Top X when they're outside it.
 */
export function FocusDayPanel({
    tables,
    day,
    x,
    mode,
    spotlit,
}: {
    tables: StandingsTables;
    day: DayIndex;
    x: number;
    mode: ClimbersMode;
    spotlit: NamedArtist | undefined;
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
                <TopX tables={tables} day={day} x={x} spotlit={spotlit} />
                <Separator className="2xl:hidden" />
                <Climbers tables={tables} day={day} x={x} mode={mode} spotlit={spotlit} />
            </div>
        </Card>
    );
}

function TopX({
    tables,
    day,
    x,
    spotlit,
}: {
    tables: StandingsTables;
    day: DayIndex;
    x: number;
    spotlit: NamedArtist | undefined;
}) {
    const rows = topX(tables, day, x).map((row) => ({
        ...row,
        dailyPlays: dailyPlays(tables, day, row.id),
    }));
    const most = Math.max(1, ...rows.map((row) => row.dailyPlays));
    const list = useRef<HTMLOListElement>(null);
    useFlip(list);
    const spotlitOutside = spotlit && !rows.some((row) => row.id === spotlit.id);

    return (
        <section className="grid min-w-0 content-start gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Top {x}</h3>
            <ol ref={list} aria-label="Top X" className="grid grid-cols-1 gap-2">
                {rows.map((row) => (
                    <li
                        key={row.artist}
                        data-flip={row.artist}
                        aria-current={row.id === spotlit?.id}
                        className={`grid min-w-0 gap-1 ${SPOTLIT_ROW}`}
                    >
                        <ArtistRowButton artist={row.artist} standing={row.standing}>
                            <span className="shrink-0 font-medium tabular-nums">
                                +{row.dailyPlays.toLocaleString("en")}
                            </span>
                        </ArtistRowButton>{" "}
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
            {spotlitOutside && <SpotlitOutsideTopX tables={tables} day={day} spotlit={spotlit} />}
        </section>
    );
}

/** The Spotlit Artist's Standing (or "unranked") and Daily plays, when they're outside the Top X. */
function SpotlitOutsideTopX({
    tables,
    day,
    spotlit,
}: {
    tables: StandingsTables;
    day: DayIndex;
    spotlit: NamedArtist;
}) {
    const standing = standingAt(tables, spotlit.id, day);
    return (
        <div
            role="group"
            aria-label="Spotlit Artist"
            className="-mx-1 flex min-w-0 items-baseline gap-2 rounded-md bg-accent px-1 py-1 text-sm"
        >
            <span className="min-w-8 shrink-0 text-muted-foreground tabular-nums">
                {standingLabel(standing)}
            </span>{" "}
            <span className="min-w-0 flex-1 truncate font-medium">{spotlit.artist}</span>{" "}
            <span className="shrink-0 font-medium tabular-nums">
                +{dailyPlays(tables, day, spotlit.id).toLocaleString("en")}
            </span>
        </div>
    );
}

function Climbers({
    tables,
    day,
    x,
    mode,
    spotlit,
}: {
    tables: StandingsTables;
    day: DayIndex;
    x: number;
    mode: ClimbersMode;
    spotlit: NamedArtist | undefined;
}) {
    const { listed, folded } = climbers(tables, day, mode, x);

    return (
        <section className="grid min-w-0 content-start gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Climbers</h3>
            <ClimberList label="Climbers" rows={listed} spotlit={spotlit} />
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
                        <ClimberList
                            label="Long-tail Climbers"
                            rows={folded.climbers}
                            spotlit={spotlit}
                        />
                    </CollapsibleContent>
                </Collapsible>
            )}
        </section>
    );
}

function ClimberList({
    label,
    rows,
    spotlit,
}: {
    label: string;
    rows: Climber[];
    spotlit: NamedArtist | undefined;
}) {
    return (
        <ol aria-label={label} className="grid grid-cols-1 gap-1.5">
            {rows.map((row) => (
                <li
                    key={row.artist}
                    aria-current={row.id === spotlit?.id}
                    className={`min-w-0 ${SPOTLIT_ROW}`}
                >
                    <ArtistRowButton artist={row.artist} standing={row.standing}>
                        <span className="shrink-0 text-emerald-600 tabular-nums dark:text-emerald-400">
                            ↑{row.gain}
                        </span>
                        {row.debut && (
                            <>
                                {" "}
                                <Badge variant="secondary">debut</Badge>
                            </>
                        )}
                    </ArtistRowButton>
                </li>
            ))}
        </ol>
    );
}
