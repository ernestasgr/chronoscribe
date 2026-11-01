import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { useEffect, type RefObject } from "react";
import type { DayWindow, StandingsTables } from "../standings";
import type { Timeline } from "../timeline";
import { dayScale, plotOf, type Size } from "./layout";

/** The fewest Days the window can be zoomed in to. */
const MIN_WINDOW_DAYS = 14;

/** Drives the window from the wheel and drags through d3-zoom, on the time axis only. */
export function useTimeZoom(
    { getView, setWindow, subscribeView }: Timeline,
    figure: RefObject<HTMLElement | null>,
    tables: StandingsTables,
    size: Size | undefined,
) {
    useEffect(() => {
        const element = figure.current;
        if (!element || !size) return;
        const plot = plotOf(size);
        const last = tables.dayCount - 1;
        const full = dayScale({ start: 0, end: last }, plot);
        const extent: [[number, number], [number, number]] = [
            [plot.left, 0],
            [plot.right, size.height],
        ];
        let gesturing = false;
        const behaviour: ZoomBehavior<HTMLElement, unknown> = zoom<HTMLElement, unknown>()
            .scaleExtent([1, Math.max(1, last / MIN_WINDOW_DAYS)])
            .extent(extent)
            .translateExtent(extent)
            .on("zoom", ({ transform, sourceEvent }) => {
                // Only the user's own wheel and drags move the window; syncs from it don't echo.
                if (!sourceEvent) return;
                // cast: d3 types a linear scale's domain as number[], though it always has two ends.
                const [start, end] = transform.rescaleX(full).domain() as [number, number];
                gesturing = true;
                setWindow({ start, end });
                gesturing = false;
            });
        const selection = select(element).call(behaviour).on("dblclick.zoom", null);

        // Moves d3-zoom's transform to a window set elsewhere, so the next gesture starts from it.
        const follow = ({ start, end }: DayWindow) => {
            if (last <= 0) return;
            const k = last / Math.max(end - start, 1e-9);
            selection.call(
                behaviour.transform,
                zoomIdentity.translate(plot.left - k * full(start), 0).scale(k),
            );
        };
        follow(getView().window);
        const unsubscribe = subscribeView(({ window }) => {
            if (!gesturing) follow(window);
        });
        return () => {
            unsubscribe();
            selection.on(".zoom", null);
        };
    }, [getView, setWindow, subscribeView, figure, tables, size]);
}
