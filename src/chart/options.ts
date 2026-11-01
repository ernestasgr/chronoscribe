import type { RefObject } from "react";
import type { AppSettings } from "../settings";
import type { ArtistId, NamedArtist, PinnedArtist } from "../standings";
import type { EasedEnd } from "./axes";

/** The chart settings, all app-wide. */
export type ChartOptions = Pick<
    AppSettings,
    | "yAxis"
    | "belowTopX"
    | "lineShape"
    | "linesDrawn"
    | "hideFuture"
    | "spotlightMode"
    | "neighbours"
>;

/**
 * What the chart card shows: the Timeline of every drawn Artist and the Pinned Artists, or the
 * Spotlight on one Artist's Standing alone.
 */
export type ChartMode =
    | { kind: "timeline"; pins: readonly PinnedArtist[] }
    | { kind: "spotlight"; artist: NamedArtist };

/** Whose lines the painter draws: the Timeline's, dashing the Pinned Artists', or the Spotlit Artist's. */
export type DrawnArtists =
    | { kind: "timeline"; pinned: readonly ArtistId[] }
    | { kind: "spotlight"; artist: ArtistId };

/**
 * The ends of the axes that ease: the Scrobbles axis's top, the static Spotlight's bottom and the
 * best Standing of the dynamic Spotlight's band.
 */
export interface EasedEnds {
    scrobblesTop: EasedEnd;
    standingBottom: EasedEnd;
    bandBest: EasedEnd;
}

/** The overlay parts the per-frame painter moves, which React renders but never positions. */
export interface PaintedParts {
    timeAxis: RefObject<SVGGElement | null>;
    marker: RefObject<SVGGElement | null>;
    labels: RefObject<SVGGElement | null>;
}
