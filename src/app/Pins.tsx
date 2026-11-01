import { PinIcon, SpotlightIcon, XIcon } from "lucide-react";
import type { ListenerRow } from "../db";
import { valueAt, type DayIndex, type PinnedArtist, type StandingsTables } from "../standings";
import { Badge, Button } from "../ui";
import { ArtistSearch } from "./ArtistSearch";
import { standingLabel } from "./labels";
import { useServices } from "./services";

/**
 * The toolbar's Artist search, which pins the Artist named, and a chip per Pinned Artist found in
 * the tables, with their Standing on the Focus Day and actions to spotlight and unpin them.
 */
export function Pins({
    listener,
    tables,
    day,
    pins,
}: {
    listener: ListenerRow;
    tables: StandingsTables;
    day: DayIndex;
    pins: readonly PinnedArtist[];
}) {
    const { session } = useServices();

    return (
        <div className="flex flex-wrap items-center gap-2">
            <ArtistSearch
                tables={tables}
                day={day}
                label="Search Artists"
                placeholder="Pin an Artist…"
                listId="artist-search-results"
                action="Pin"
                icon={<PinIcon />}
                chosen={(artist) => listener.pinnedArtists.includes(artist)}
                onChoose={(artist) => void session.pin(artist)}
            />
            <ul aria-label="Pinned Artists" className="flex flex-wrap gap-1">
                {pins.map(({ id, artist }) => (
                    <li key={artist}>
                        <Badge variant="secondary" className="gap-1 pr-0.5">
                            {artist}{" "}
                            <span className="text-muted-foreground tabular-nums">
                                {standingLabel(valueAt(tables, id, day, "standing"))}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Spotlight ${artist}`}
                                onClick={() => session.spotlight(artist)}
                            >
                                <SpotlightIcon />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Unpin ${artist}`}
                                onClick={() => void session.unpin(artist)}
                            >
                                <XIcon />
                            </Button>
                        </Badge>
                    </li>
                ))}
            </ul>
        </div>
    );
}
