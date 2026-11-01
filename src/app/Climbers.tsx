import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon } from "lucide-react";
import { useRef } from "react";
import type { ClimbersMode } from "../settings";
import {
    climbers,
    type Climber,
    type DayIndex,
    type NamedArtist,
    type StandingsTables,
} from "../standings";
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui";
import { ArtistRowButton, SPOTLIT_ROW } from "./ArtistRowButton";
import { count } from "./labels";

/** A Climber row's height until it is measured, in pixels. */
const CLIMBER_ROW_PX = 24;
/** The room between Climber rows, in pixels. */
const CLIMBER_GAP_PX = 6;

/** The Focus Day's Climbers, with the long tail folded into one line or listed as `mode` says. */
export function Climbers({
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

/**
 * Climbers in a box of their own that scrolls once they outgrow it, rendering only the rows in
 * view, as "all (raw)" can list most of a history's Artists.
 */
function ClimberList({
    label,
    rows,
    spotlit,
}: {
    label: string;
    rows: Climber[];
    spotlit: NamedArtist | undefined;
}) {
    const scroller = useRef<HTMLDivElement>(null);
    // oxlint-disable-next-line react/incompatible-library -- no React Compiler memoizes here, and each render reads the virtualizer afresh
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scroller.current,
        estimateSize: () => CLIMBER_ROW_PX,
        getItemKey: (index) => rows[index]?.artist ?? index,
        gap: CLIMBER_GAP_PX,
        overscan: 8,
    });

    return (
        <div ref={scroller} className="-mx-1 max-h-[28rem] overflow-y-auto px-1">
            <ol
                aria-label={label}
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
            >
                {virtualizer.getVirtualItems().map((item) => (
                    <ClimberRow
                        key={item.key}
                        row={rows[item.index]}
                        index={item.index}
                        of={rows.length}
                        start={item.start}
                        spotlit={spotlit}
                        measure={virtualizer.measureElement}
                    />
                ))}
            </ol>
        </div>
    );
}

/** One Climber, placed at `start` in the virtual list and measured once rendered. */
function ClimberRow({
    row,
    index,
    of,
    start,
    spotlit,
    measure,
}: {
    row: Climber | undefined;
    index: number;
    of: number;
    start: number;
    spotlit: NamedArtist | undefined;
    measure: (element: HTMLLIElement | null) => void;
}) {
    if (!row) return null;
    return (
        <li
            ref={measure}
            data-index={index}
            aria-setsize={of}
            aria-posinset={index + 1}
            aria-current={row.id === spotlit?.id}
            className={`absolute inset-x-0 top-0 min-w-0 ${SPOTLIT_ROW}`}
            style={{ transform: `translateY(${start}px)` }}
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
    );
}
