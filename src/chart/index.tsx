import { useMemo, useRef, useState, type MouseEvent } from "react";
import { createStore } from "zustand";
import type { StandingsTables } from "../standings";
import { useTimeline } from "../timeline";
import { useFrames } from "./frames";
import { dayScale, plotOf, useSize } from "./layout";
import { createLineHover, LineHoverCard, lineHoverHandlers, type LineDetails } from "./LineHover";
import type { ChartMode, ChartOptions, DrawnArtists, EasedEnds, PaintedParts } from "./options";
import { Overlay } from "./Overlay";
import { SPOTLIGHT_FLOOR } from "./spotlight";
import { useTimeZoom } from "./zoom";

export { Minimap } from "./minimap";
export type { LineDay, LineDetails } from "./LineHover";
export type { ChartMode, ChartOptions } from "./options";

/**
 * The chart, in either mode. The Timeline draws one line per drawn Artist, by Standing or by
 * cumulative Scrobbles, always including the Pinned Artists; the static Spotlight draws the Spotlit
 * Artist's Standing alone on a log axis fixed to their worst, and the dynamic one draws them and
 * their Neighbours in a band of Standings following them. The wheel zooms and dragging pans
 * the time axis only; clicking glides the Focus Day there. Hovering a line while the view is still
 * opens a card of its details, as `renderDetails` renders them, on the Day under the pointer.
 */
export function Chart({
    tables,
    x,
    options,
    mode,
    renderDetails,
}: {
    tables: StandingsTables;
    x: number;
    options: ChartOptions;
    mode: ChartMode;
    renderDetails: LineDetails;
}) {
    const figure = useRef<HTMLElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const timeAxis = useRef<SVGGElement>(null);
    const marker = useRef<SVGGElement>(null);
    const labels = useRef<SVGGElement>(null);
    const [ends] = useState<EasedEnds>(() => ({
        scrobblesTop: createStore(() => ({ end: 1, easedAt: undefined })),
        standingBottom: createStore(() => ({ end: SPOTLIGHT_FLOOR, easedAt: undefined })),
        bandBest: createStore(() => ({ end: 1, easedAt: undefined })),
    }));
    const timeline = useTimeline();
    const size = useSize(figure);
    const pixelRatio = devicePixelRatio || 1;
    const paintedParts: PaintedParts = { timeAxis, marker, labels };
    const drawn = useMemo<DrawnArtists>(
        () =>
            mode.kind === "timeline"
                ? { kind: "timeline", pinned: mode.pins.map(({ id }) => id) }
                : { kind: "spotlight", artist: mode.artist.id },
        [mode],
    );
    const [hover] = useState(createLineHover);

    useFrames(timeline, canvas, paintedParts, tables, x, options, drawn, size, ends, hover);
    useTimeZoom(timeline, figure, tables, size);

    function focus(event: MouseEvent) {
        // A click in the hovered line's card, portalled out of the chart, isn't a click on a Day.
        const inChart = event.target instanceof Node && event.currentTarget.contains(event.target);
        if (!size || !inChart) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const { window } = timeline.getView();
        timeline.seek(
            Math.round(dayScale(window, plotOf(size)).invert(event.clientX - bounds.left)),
        );
    }

    return (
        <figure
            ref={figure}
            aria-label={mode.kind === "spotlight" ? "Spotlight" : "Timeline"}
            onClick={focus}
            {...lineHoverHandlers(hover, timeline)}
            className="relative m-0 min-h-0 flex-1 cursor-crosshair"
        >
            <canvas
                ref={canvas}
                width={Math.round((size?.width ?? 0) * pixelRatio)}
                height={Math.round((size?.height ?? 0) * pixelRatio)}
                className="absolute inset-0 size-full"
            />
            {size && (
                <Overlay
                    tables={tables}
                    x={x}
                    options={options}
                    size={size}
                    mode={mode}
                    ends={ends}
                    paintedParts={paintedParts}
                />
            )}
            <LineHoverCard hover={hover} chart={figure} renderDetails={renderDetails} />
        </figure>
    );
}
