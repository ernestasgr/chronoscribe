import { SpotlightIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { SPOTLIGHT_MODES, SpotlightModeChoice, type SpotlightMode } from "../settings";
import type { DayIndex, NamedArtist, StandingsTables } from "../standings";
import { Button, ToggleGroup, ToggleGroupItem } from "../ui";
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

/** Each Spotlight mode's name on its toggle. */
const MODE_NAMES: Record<SpotlightMode, string> = { static: "Static", dynamic: "Dynamic" };

/**
 * The Spotlight's header over the chart: the Spotlit Artist's name, the Static | Dynamic toggle,
 * saved app-wide, and a close control.
 */
export function SpotlightHeader({ artist, mode }: { artist: NamedArtist; mode: SpotlightMode }) {
    const { session, settings } = useServices();
    return (
        <header className="flex min-w-0 items-center gap-2 px-2 pt-1">
            <SpotlightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="min-w-0 flex-1 truncate font-semibold">{artist.artist}</h2>
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-label="Spotlight mode"
                value={mode}
                onValueChange={(value) => {
                    // An empty value is the pressed item clicked again, which keeps the mode.
                    const chosen = SpotlightModeChoice.safeParse(value);
                    if (chosen.success) settings.update({ spotlightMode: chosen.data });
                }}
            >
                {SPOTLIGHT_MODES.map((option) => (
                    <ToggleGroupItem key={option} value={option}>
                        {MODE_NAMES[option]}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
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
