import { PinIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ListenerRow } from "../db";
import {
    artistNamed,
    searchArtists,
    valueAt,
    type PinnedArtist,
    type StandingsTables,
} from "../standings";
import { Badge, Button, Input } from "../ui";
import { useServices } from "./services";

/** How many matching Artists the search offers at once. */
const OFFERED = 20;

/** A Standing as a chip shows it. */
const standingLabel = (standing: number | undefined) =>
    standing === undefined ? "unranked" : `#${standing}`;

/**
 * The toolbar's Artist search, which pins the Artist named, and a chip per Pinned Artist found in
 * the tables, with their Standing on the Focus Day.
 */
export function Pins({
    listener,
    tables,
    day,
    pins,
}: {
    listener: ListenerRow;
    tables: StandingsTables;
    day: number;
    pins: readonly PinnedArtist[];
}) {
    const { session } = useServices();
    const [query, setQuery] = useState("");
    const offered = searchArtists(tables, query, day, OFFERED);
    const named = artistNamed(tables, query)?.artist;

    function pin(event: FormEvent) {
        event.preventDefault();
        if (named === undefined) return;
        void session.pin(named);
        setQuery("");
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <form role="search" onSubmit={pin} className="flex items-center gap-1">
                <Input
                    aria-label="Search Artists"
                    placeholder="Pin an Artist…"
                    list="artist-search-results"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-48"
                />
                <datalist id="artist-search-results">
                    {offered.map((artist) => (
                        <option key={artist} value={artist} />
                    ))}
                </datalist>
                <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Pin"
                    disabled={named === undefined || listener.pinnedArtists.includes(named)}
                >
                    <PinIcon />
                </Button>
            </form>
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
