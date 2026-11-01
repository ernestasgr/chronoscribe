import { useState, type FormEvent, type ReactNode } from "react";
import { artistNamed, searchArtists, type DayIndex, type StandingsTables } from "../standings";
import { Button, Input } from "../ui";

/** How many matching Artists a search offers at once. */
const OFFERED = 20;

/**
 * A toolbar search for an Artist by name in any case, offering matches best Standing on the Focus
 * Day first. Submitting it chooses the Artist named exactly, unless they're already chosen.
 */
export function ArtistSearch({
    tables,
    day,
    label,
    placeholder,
    listId,
    action,
    icon,
    chosen,
    onChoose,
}: {
    tables: StandingsTables;
    day: DayIndex;
    label: string;
    placeholder: string;
    /** The id of the list of matches the input offers. */
    listId: string;
    /** The submit button's name. */
    action: string;
    icon: ReactNode;
    /** Whether choosing `artist` would change nothing, which disables the action. */
    chosen: (artist: string) => boolean;
    onChoose: (artist: string) => void;
}) {
    const [query, setQuery] = useState("");
    const offered = searchArtists(tables, query, day, OFFERED);
    const named = artistNamed(tables, query)?.artist;

    function choose(event: FormEvent) {
        event.preventDefault();
        if (named === undefined) return;
        onChoose(named);
        setQuery("");
    }

    return (
        <form role="search" onSubmit={choose} className="flex items-center gap-1">
            <Input
                aria-label={label}
                placeholder={placeholder}
                list={listId}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-48"
            />
            <datalist id={listId}>
                {offered.map((artist) => (
                    <option key={artist} value={artist} />
                ))}
            </datalist>
            <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                aria-label={action}
                disabled={named === undefined || chosen(named)}
            >
                {icon}
            </Button>
        </form>
    );
}
