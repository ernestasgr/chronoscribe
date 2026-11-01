import { SpotlightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ListenerId } from "../db";
import {
    dailyPlays,
    dayDate,
    valueAt,
    type ArtistId,
    type DayIndex,
    type StandingsTables,
    type TrackPlays,
} from "../standings";
import { Button } from "../ui";
import { count } from "./labels";
import { useServices } from "./services";

/** Where the read of a Day's Track plays is. */
type TrackPlaysRead =
    | { kind: "loading" }
    | { kind: "read"; plays: readonly TrackPlays[] }
    | { kind: "failed"; message: string };

interface LineCardProps {
    listenerId: ListenerId;
    tables: StandingsTables;
    artist: ArtistId;
    day: DayIndex;
}

/**
 * A hovered line's card: the Artist on the Day with an action to spotlight them, their Daily plays,
 * Standing and cumulative Scrobbles from the tables, then every track they were scrobbled for that
 * Day with its Track plays.
 */
export function LineCard({ listenerId, tables, artist, day }: LineCardProps) {
    const { session } = useServices();
    const name = tables.artists[artist];
    const plays = dailyPlays(tables, day, artist);
    const standing = valueAt(tables, artist, day, "standing");

    return (
        <>
            <header className="grid gap-2 border-b px-4 py-3">
                <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <h3 className="font-semibold break-words">{name}</h3>
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {dayDate(tables, day)}
                        </p>
                    </div>
                    {name !== undefined && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => session.spotlight(name)}
                        >
                            <SpotlightIcon />
                            Spotlight
                        </Button>
                    )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Daily plays" value={plays.toLocaleString("en")} />
                    <Stat label="Standing" value={standing === undefined ? "–" : `#${standing}`} />
                    <Stat
                        label="Scrobbles"
                        value={(valueAt(tables, artist, day, "scrobbles") ?? 0).toLocaleString(
                            "en",
                        )}
                    />
                </dl>
            </header>
            {plays === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No Scrobbles this Day</p>
            ) : (
                <TrackPlaysRetried
                    listenerId={listenerId}
                    tables={tables}
                    artist={artist}
                    day={day}
                />
            )}
        </>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium tabular-nums">{value}</dd>
        </div>
    );
}

/** The Day's Track plays, read afresh on each retry. */
function TrackPlaysRetried(props: LineCardProps) {
    const [attempt, setAttempt] = useState(0);
    return <TrackPlaysList key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

/** The Day's Track plays, read when the card opens, with a way to retry a failed read. */
function TrackPlaysList({
    listenerId,
    tables,
    artist,
    day,
    retry,
}: LineCardProps & { retry: () => void }) {
    const { readTrackPlays } = useServices();
    const [read, setRead] = useState<TrackPlaysRead>({ kind: "loading" });

    useEffect(() => {
        let current = true;
        readTrackPlays(listenerId, tables, day, artist).then(
            (plays) => current && setRead({ kind: "read", plays }),
            (error: unknown) => current && setRead({ kind: "failed", message: String(error) }),
        );
        return () => {
            current = false;
        };
    }, [readTrackPlays, listenerId, tables, day, artist]);

    switch (read.kind) {
        case "loading":
            return (
                <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
                    Reading Track plays…
                </p>
            );
        case "failed":
            return (
                <div role="alert" className="grid justify-items-start gap-2 px-4 py-3 text-sm">
                    <p>Couldn't read this Day's Scrobbles: {read.message}</p>
                    <Button size="sm" onClick={retry}>
                        Retry
                    </Button>
                </div>
            );
        case "read":
            return (
                <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1 py-2">
                    <h4 className="px-4 text-xs font-medium text-muted-foreground">Track plays</h4>
                    <ol aria-label="Track plays" className="grid gap-1 overflow-y-auto px-4 pb-1">
                        {read.plays.map(({ track, plays }) => (
                            <li
                                key={track}
                                title={count(plays, "Track play")}
                                className="flex min-w-0 items-baseline gap-3 text-sm"
                            >
                                <span className="min-w-0 flex-1 break-words">{track}</span>
                                <span className="shrink-0 font-medium tabular-nums">
                                    {plays.toLocaleString("en")}
                                </span>
                            </li>
                        ))}
                    </ol>
                </section>
            );
    }
}
