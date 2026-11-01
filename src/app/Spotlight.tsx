import { SpotlightIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import type { DayIndex, NamedArtist, StandingsTables } from "../standings";
import { Button } from "../ui";
import { ArtistSearch } from "./ArtistSearch";
import { useServices } from "./services";
import type { Session } from "./session";

/** The toolbar's search for opening the Spotlight, apart from the pin search but matching alike. */
export function SpotlightSearch({
    tables,
    day,
    spotlit,
}: {
    tables: StandingsTables;
    day: DayIndex;
    spotlit: NamedArtist | undefined;
}) {
    const { session } = useServices();
    return (
        <ArtistSearch
            tables={tables}
            day={day}
            label="Spotlight an Artist"
            placeholder="Spotlight an Artist…"
            listId="spotlight-search-results"
            action="Spotlight"
            icon={<SpotlightIcon />}
            chosen={(artist) => artist === spotlit?.artist}
            onChoose={session.spotlight}
        />
    );
}

/** The Spotlight's header over the chart: the Spotlit Artist's name and a close control. */
export function SpotlightHeader({ artist }: { artist: NamedArtist }) {
    const { session } = useServices();
    return (
        <header className="flex min-w-0 items-center gap-2 px-2 pt-1">
            <SpotlightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="min-w-0 flex-1 truncate font-semibold">{artist.artist}</h2>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close the Spotlight"
                onClick={session.closeSpotlight}
            >
                <XIcon />
            </Button>
        </header>
    );
}

/** Esc closes the Spotlight while it is open, unless something else has already taken the key. */
export function useSpotlightKeys(session: Session, open: boolean) {
    useEffect(() => {
        if (!open) return;
        const press = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            session.closeSpotlight();
        };
        addEventListener("keydown", press);
        return () => removeEventListener("keydown", press);
    }, [session, open]);
}
