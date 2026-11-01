import { select } from "d3-selection";
import { useEffect, type RefObject } from "react";
import {
    dayIndex,
    daysOutsideTopX,
    drawnLines,
    type ArtistId,
    type DayIndex,
    type StandingsTables,
} from "../standings";
import type { Timeline, View } from "../timeline";
import { bandY, levelScale, scrobblesScale, spotlightY, type EasedEnd } from "./axes";
import { easeToward, standingLevel } from "./geometry";
import { hoveredLine } from "./hover";
import { dayScale, plotOf, type Size } from "./layout";
import {
    linesGeometry,
    mostScrobbles,
    strokeLines,
    type DashedSpans,
    type LinesScale,
    type LinesStyle,
} from "./lines";
import type { LineHover } from "./LineHover";
import type { ChartOptions, DrawnArtists, EasedEnds, PaintedParts } from "./options";
import { placeLabels, placeMarker, placeTimeAxis } from "./paint";
import { spotlightBand, spotlightBottom, spotlitLines } from "./spotlight";

/** A line's width, before the Spotlit Artist's is drawn thicker. */
const LINE_WIDTH = 1.8;
/** How far past the plot's top and bottom a line may run, so one at #1 isn't cut in half. */
const OVERHANG_PX = 4;
const NOT_DASHED: DashedSpans = new Map();

/** Where each Pinned Artist's line is dashed: across each Day from `from` to `to` they're outside the Top X. */
const dashedSpans = (
    tables: StandingsTables,
    pinned: readonly ArtistId[],
    x: number,
    dayX: (day: number) => number,
    from: DayIndex,
    to: DayIndex,
): DashedSpans =>
    new Map(
        pinned.map((id) => [
            id,
            daysOutsideTopX(tables, id, x, from, to).map(
                ({ start, end }) => [dayX(start - 0.5), dayX(end + 0.5)] as const,
            ),
        ]),
    );

/** What one frame draws: which lines, on what scale, styled how, and how far past the plot. */
interface FrameLines {
    artists: readonly ArtistId[];
    scale: LinesScale;
    style: Omit<LinesStyle, "emphasised">;
    /** How far past the plot's top and bottom the lines are drawn; none, clipped to a band. */
    overhang: number;
}

/** The Day the Scrobbles axis is fitted to: the playhead, kept within the Days drawn. */
const fittedDay = (playhead: number, from: DayIndex, to: DayIndex): DayIndex =>
    dayIndex(Math.min(to, Math.max(from, Math.floor(playhead))));

/**
 * Paints whenever the view changes, at most once per frame: the lines on the canvas, stopping at
 * the playhead if the future is hidden, then the time axis, the Focus Day marker and the Artist
 * labels riding the lines at the playhead. In Scrobbles mode it keeps painting while the
 * axis eases toward the most Scrobbles drawn up to the playhead, and in the Spotlight while its
 * bottom eases toward the Spotlit Artist's worst Standing, or its band toward their Standing at the
 * playhead. A hovered line is emphasised, and any
 * change to the view or to what is drawn closes its card.
 */
export function useFrames(
    { getView, subscribeView }: Timeline,
    canvas: RefObject<HTMLCanvasElement | null>,
    { timeAxis, marker, labels }: PaintedParts,
    tables: StandingsTables,
    x: number,
    {
        yAxis,
        belowTopX,
        lineShape,
        linesDrawn,
        hideFuture,
        spotlightMode,
        neighbours,
    }: ChartOptions,
    drawn: DrawnArtists,
    size: Size | undefined,
    { scrobblesTop, standingBottom, bandBest }: EasedEnds,
    hover: LineHover,
) {
    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context || !size?.width) return;
        const dpr = element.width / size.width;
        const plot = plotOf(size);
        const levelY = levelScale(plot);
        const artistCount = tables.artists.length;
        const last = tables.dayCount - 1;
        let frame: number | undefined;
        // Each name's rendered width, measured once per element since its text never changes.
        const nameWidths = new WeakMap<SVGTextElement, number>();
        const widthOf = (name: SVGTextElement): number => {
            const known = nameWidths.get(name);
            if (known !== undefined) return known;
            const width = name.getComputedTextLength();
            nameWidths.set(name, width);
            return width;
        };
        // Ticks laid out from older tables would keep their old dates.
        if (timeAxis.current) select(timeAxis.current).selectAll("text").remove();

        const schedule = () => {
            frame ??= requestAnimationFrame((now) => {
                frame = undefined;
                draw(now);
            });
        };

        // This frame's end of an eased axis, eased from the last frame's toward `target`.
        const ease = (axisEnd: EasedEnd, target: number, now: number): number => {
            const { end, easedAt } = axisEnd.getState();
            const eased = easedAt === undefined ? target : easeToward(end, target, now - easedAt);
            axisEnd.setState({ end: eased, easedAt: now });
            if (eased !== target) schedule();
            return eased;
        };

        const scaleOf = (artists: readonly ArtistId[], day: DayIndex, now: number): LinesScale =>
            yAxis === "standing"
                ? {
                      yAxis,
                      shape: lineShape,
                      standingY: (standing) =>
                          levelY(standingLevel(standing, x, artistCount, belowTopX)),
                  }
                : {
                      yAxis,
                      scrobblesY: scrobblesScale(
                          plot,
                          ease(scrobblesTop, Math.max(1, mostScrobbles(tables, artists, day)), now),
                      ),
                  };

        // The Timeline's drawn lines, each Pinned Artist's dashed where they're outside the Top X.
        const timelineLines = (
            pinned: readonly ArtistId[],
            { window, playhead }: View,
            dayX: (day: number) => number,
            from: DayIndex,
            to: DayIndex,
            now: number,
        ): FrameLines => {
            const artists = drawnLines(tables, window, x, linesDrawn, pinned);
            return {
                artists,
                scale: scaleOf(artists, fittedDay(playhead, from, to), now),
                style: {
                    dashed: dashedSpans(tables, pinned, x, dayX, from, to),
                    featured: undefined,
                },
                overhang: OVERHANG_PX,
            };
        };

        // The Spotlit Artist's line alone, on a log axis down to their worst Standing so far.
        const staticSpotlightLines = (
            artist: ArtistId,
            { playhead }: View,
            now: number,
        ): FrameLines => {
            const bottom = spotlightBottom(tables, artist, { playhead, hideFuture });
            return {
                artists: [artist],
                scale: {
                    yAxis: "standing",
                    shape: lineShape,
                    standingY: spotlightY(plot, ease(standingBottom, bottom, now)),
                },
                style: { dashed: NOT_DASHED, featured: artist },
                overhang: OVERHANG_PX,
            };
        };

        // The Spotlit Artist and their Neighbours on the Day nearest the playhead, in a band
        // following the Spotlit Artist there and clipped to it.
        const dynamicSpotlightLines = (
            artist: ArtistId,
            { playhead }: View,
            now: number,
        ): FrameLines => {
            const day = dayIndex(Math.min(last, Math.max(0, Math.round(playhead))));
            const { best } = spotlightBand(tables, artist, day, neighbours);
            return {
                artists: spotlitLines(tables, artist, day, neighbours),
                scale: {
                    yAxis: "standing",
                    shape: lineShape,
                    standingY: bandY(plot, ease(bandBest, best, now), neighbours),
                },
                style: { dashed: NOT_DASHED, featured: artist },
                overhang: 0,
            };
        };

        const spotlightLines =
            spotlightMode === "dynamic" ? dynamicSpotlightLines : staticSpotlightLines;

        const draw = (now: number) => {
            const view = getView();
            const { window, playhead } = view;
            const dayX = dayScale(window, plot);
            const from = dayIndex(Math.max(0, Math.floor(window.start) - 1));
            const to = dayIndex(Math.min(last, Math.ceil(hideFuture ? playhead : window.end) + 1));
            const { artists, scale, style, overhang } =
                drawn.kind === "timeline"
                    ? timelineLines(drawn.pinned, view, dayX, from, to, now)
                    : spotlightLines(drawn.artist, view, now);
            const playheadX = dayX(playhead);
            const inView = playheadX >= plot.left - 0.5 && playheadX <= plot.right + 0.5;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, size.width, size.height);
            context.save();
            context.beginPath();
            // Hiding the future is clipping the lines at the playhead.
            const right = hideFuture ? Math.min(plot.right, playheadX) : plot.right;
            context.rect(
                plot.left,
                plot.top - overhang,
                Math.max(0, right - plot.left),
                plot.bottom - plot.top + 2 * overhang,
            );
            context.clip();
            context.lineWidth = LINE_WIDTH;
            const geometry = linesGeometry({ tables, artists, dayX, scale, from, to });
            strokeLines(context, geometry, scale, {
                ...style,
                emphasised: hoveredLine(hover.store.getState())?.artist,
            });
            context.restore();
            hover.painted({ tables, geometry, scale, dayX, plot, right, overhang });
            if (timeAxis.current) placeTimeAxis(timeAxis.current, tables, dayX, size);
            if (marker.current) placeMarker(marker.current, playheadX, inView, size);
            if (labels.current)
                placeLabels(labels.current, {
                    geometry,
                    scale,
                    playheadX: inView ? playheadX : undefined,
                    plot,
                    widthOf,
                });
        };

        // An axis end out of use starts afresh when next shown, rather than easing from where it was.
        if (drawn.kind === "spotlight" || yAxis === "standing")
            scrobblesTop.setState({ easedAt: undefined });
        if (drawn.kind === "timeline" || spotlightMode === "dynamic")
            standingBottom.setState({ easedAt: undefined });
        if (drawn.kind === "timeline" || spotlightMode === "static")
            bandBest.setState({ easedAt: undefined });
        hover.dispatch({ type: "dismissed" });
        draw(performance.now());
        const unsubscribe = subscribeView(() => {
            hover.dispatch({ type: "dismissed" });
            schedule();
        });
        const unhover = hover.store.subscribe(schedule);
        return () => {
            unsubscribe();
            unhover();
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [
        getView,
        subscribeView,
        canvas,
        timeAxis,
        marker,
        labels,
        tables,
        x,
        yAxis,
        belowTopX,
        lineShape,
        linesDrawn,
        hideFuture,
        spotlightMode,
        neighbours,
        drawn,
        size,
        scrobblesTop,
        standingBottom,
        bandBest,
        hover,
    ]);
}
