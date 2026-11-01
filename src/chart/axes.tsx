import { scaleLinear } from "d3-scale";
import { useStore, type StoreApi } from "zustand";
import type { BelowTopX } from "../settings";
import { GUTTER_TOP, logStandingTicks, standingLevel } from "./geometry";
import type { Plot } from "./layout";
import { spotlightLevel, spotlightTicks } from "./spotlight";

/** The least room a Standing label needs, in pixels. */
const LABEL_PX = 14;

/**
 * An axis end as it eases, shared by the canvas loop and the axis labels: the top of the
 * Scrobbles axis or the bottom of the Spotlight's. It outlives each redraw effect, so a change of
 * X, rule, tables or size eases rather than jumps.
 */
export type EasedEnd = StoreApi<{ end: number; easedAt: number | undefined }>;

/** The pixel y of a level from 0 at the top of the plot to 1 at the bottom. */
export const levelScale = (plot: Plot) =>
    scaleLinear().domain([0, 1]).range([plot.top, plot.bottom]);
/** The pixel y of a cumulative Scrobble count, on an axis topped at `max`. */
export const scrobblesScale = (plot: Plot, max: number) =>
    scaleLinear().domain([0, max]).range([plot.bottom, plot.top]);

/** The pixel y of a Standing on the Spotlight's axis, down to `bottom`. */
export const spotlightY = (plot: Plot, bottom: number) => {
    const levelY = levelScale(plot);
    return (standing: number) => levelY(spotlightLevel(standing, bottom));
};

/** The Standings worth a label, each at least `LABEL_PX` below the last one kept. */
const spacedStandings = (candidates: number[], y: (standing: number) => number): number[] =>
    candidates.reduce<number[]>((kept, standing) => {
        const previous = kept.at(-1);
        return previous === undefined || y(standing) - y(previous) >= LABEL_PX
            ? [...kept, standing]
            : kept;
    }, []);

/** The labels for `rows` evenly spaced Standings, thinned to every n-th when rows are tight. */
function rowStandings(rows: number, rowHeight: number): number[] {
    const labelEvery = Math.ceil(LABEL_PX / Math.max(rowHeight, 1));
    return Array.from({ length: rows }, (_, i) => i + 1).filter(
        (standing) => standing === 1 || standing % labelEvery === 0,
    );
}

/** "#N" labels down the plot's left edge, each at its Standing's height. */
function StandingLabels({
    standings,
    y,
    plot,
}: {
    standings: number[];
    y: (standing: number) => number;
    plot: Plot;
}) {
    return standings.map((standing) => (
        <text
            key={standing}
            x={plot.left - 8}
            y={y(standing)}
            textAnchor="end"
            dominantBaseline="middle"
        >
            #{standing}
        </text>
    ));
}

/** The Standing labels for each way of showing the Artists below the Top X. */
export function StandingAxis({
    artistCount,
    x,
    below,
    plot,
}: {
    artistCount: number;
    x: number;
    below: BelowTopX;
    plot: Plot;
}) {
    const levelY = levelScale(plot);
    const y = (standing: number) => levelY(standingLevel(standing, x, artistCount, below));
    const rowsHeight = (plot.bottom - plot.top) * (below === "gutter" ? GUTTER_TOP : 1);
    const standings =
        below === "log"
            ? spacedStandings(logStandingTicks(artistCount), y)
            : rowStandings(x, rowsHeight / x);
    const gutter = below === "gutter" && artistCount > x;

    return (
        <g role="group" aria-label="Standing axis" className="fill-muted-foreground">
            <StandingLabels standings={standings} y={y} plot={plot} />
            {gutter && (
                <>
                    <rect
                        x={plot.left}
                        y={levelY(GUTTER_TOP)}
                        width={plot.right - plot.left}
                        height={plot.bottom - levelY(GUTTER_TOP)}
                        className="fill-muted-foreground"
                        opacity={0.08}
                    />
                    <text
                        x={plot.left - 8}
                        y={(levelY(GUTTER_TOP) + plot.bottom) / 2}
                        textAnchor="end"
                        dominantBaseline="middle"
                    >
                        below
                    </text>
                </>
            )}
        </g>
    );
}

/** The Spotlight's log Standing labels from #1, following its bottom as the canvas eases it. */
export function SpotlightAxis({ plot, bottom }: { plot: Plot; bottom: EasedEnd }) {
    const end = useStore(bottom, (state) => state.end);
    const y = spotlightY(plot, end);

    return (
        <g role="group" aria-label="Standing axis" className="fill-muted-foreground">
            <StandingLabels standings={spacedStandings(spotlightTicks(end), y)} y={y} plot={plot} />
        </g>
    );
}

/** The cumulative Scrobbles labels, following the axis top as the canvas eases it. */
export function ScrobblesAxis({ plot, top }: { plot: Plot; top: EasedEnd }) {
    const max = useStore(top, (state) => state.end);
    const scrobblesY = scrobblesScale(plot, max);
    const ticks = scrobblesY
        .ticks(Math.max(2, Math.floor((plot.bottom - plot.top) / 40)))
        .filter((scrobbles) => Number.isInteger(scrobbles) && scrobbles <= max);

    return (
        <g role="group" aria-label="Scrobbles axis" className="fill-muted-foreground">
            {ticks.map((scrobbles) => (
                <text
                    key={scrobbles}
                    x={plot.left - 8}
                    y={scrobblesY(scrobbles)}
                    textAnchor="end"
                    dominantBaseline="middle"
                >
                    {scrobbles.toLocaleString("en")}
                </text>
            ))}
        </g>
    );
}
