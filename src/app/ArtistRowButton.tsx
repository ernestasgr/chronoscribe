import type { ReactNode } from "react";
import type { Standing } from "../standings";
import { Button } from "../ui";
import { standingLabel } from "./labels";
import { useServices } from "./services";

/** A row's look when it is the Spotlit Artist's, marked with `aria-current`. */
export const SPOTLIT_ROW = "-mx-1 rounded-md px-1 aria-[current=true]:bg-accent";

/**
 * An Artist's row as a button that opens the Spotlight on them: their Standing, their name, then
 * what the list reports of them.
 */
export function ArtistRowButton({
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
