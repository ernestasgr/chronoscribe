import type { RefObject } from "react";
import { dayDate, topX, type DayIndex, type NamedArtist, type StandingsTables } from "../standings";
import { useFocusDay } from "../timeline";
import { BandAxis, ScrobblesAxis, SpotlightAxis, StandingAxis } from "./axes";
import { plotOf, type Size } from "./layout";
import { colorOf } from "./lines";
import type { ChartMode, ChartOptions, EasedEnds, PaintedParts } from "./options";
import { ARTIST_LABEL_PX } from "./paint";
import { spotlitLines } from "./spotlight";

/**
 * The axes, the Focus Day marker and the Artist labels over the canvas. React renders them as the
 * Focus Day changes; the per-frame painter positions the time axis, the marker and the labels.
 */
export function Overlay({
    tables,
    x,
    options,
    mode,
    size,
    ends,
    paintedParts: { timeAxis, marker, labels },
}: {
    tables: StandingsTables;
    x: number;
    options: ChartOptions;
    mode: ChartMode;
    size: Size;
    ends: EasedEnds;
    paintedParts: PaintedParts;
}) {
    const focusDay = useFocusDay();
    const plot = plotOf(size);

    return (
        <svg
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 text-[11px] text-foreground"
        >
            {mode.kind === "spotlight" && options.spotlightMode === "dynamic" ? (
                <BandAxis plot={plot} best={ends.bandBest} neighbours={options.neighbours} />
            ) : mode.kind === "spotlight" ? (
                <SpotlightAxis plot={plot} bottom={ends.standingBottom} />
            ) : options.yAxis === "standing" ? (
                <StandingAxis
                    artistCount={tables.artists.length}
                    x={x}
                    below={options.belowTopX}
                    plot={plot}
                />
            ) : (
                <ScrobblesAxis plot={plot} top={ends.scrobblesTop} />
            )}
            <g
                ref={timeAxis}
                role="group"
                aria-label="Time axis"
                className="fill-muted-foreground"
            />
            <g ref={marker} role="group" aria-label="Focus Day marker">
                <line
                    x1={0}
                    x2={0}
                    y1={plot.top}
                    y2={plot.bottom}
                    stroke="currentColor"
                    strokeDasharray="3 3"
                />
                <text
                    y={plot.top}
                    dy={-4}
                    textAnchor="middle"
                    fill="currentColor"
                    fontWeight="bold"
                >
                    {dayDate(tables, focusDay)}
                </text>
            </g>
            <ArtistLabels
                artists={labelledArtists(tables, focusDay, x, options, mode)}
                group={labels}
            />
        </svg>
    );
}

/**
 * The Spotlit Artist alone or with their Neighbours on the Focus Day, or the Focus Day's Top X and
 * then the Pinned Artists outside it.
 */
const labelledArtists = (
    tables: StandingsTables,
    day: DayIndex,
    x: number,
    { spotlightMode, neighbours }: ChartOptions,
    mode: ChartMode,
): NamedArtist[] => {
    if (mode.kind === "spotlight" && spotlightMode === "dynamic")
        return spotlitLines(tables, mode.artist.id, day, neighbours).flatMap((id) => {
            const artist = tables.artists[id];
            return artist === undefined ? [] : [{ id, artist }];
        });
    if (mode.kind === "spotlight") return [mode.artist];
    const top = topX(tables, day, x);
    return [...top, ...mode.pins.filter((pin) => !top.some((row) => row.id === pin.id))];
};

/** A dot and a name for each labelled Artist, for the painter to put on its line. */
function ArtistLabels({
    artists,
    group,
}: {
    artists: readonly NamedArtist[];
    group: RefObject<SVGGElement | null>;
}) {
    return (
        <g ref={group} role="group" aria-label="Artist labels" className="text-xs font-semibold">
            {artists.map((row) => (
                <g key={row.id} data-artist={row.id}>
                    <line stroke={colorOf(row.id)} strokeWidth={1} />
                    <rect
                        height={ARTIST_LABEL_PX - 2}
                        rx={4}
                        stroke={colorOf(row.id)}
                        strokeWidth={1.5}
                        className="fill-card/90"
                    />
                    <circle
                        r={4}
                        fill={colorOf(row.id)}
                        strokeWidth={1.5}
                        className="stroke-card"
                    />
                    <text dominantBaseline="central" className="fill-foreground">
                        {row.artist}
                    </text>
                </g>
            ))}
        </g>
    );
}
