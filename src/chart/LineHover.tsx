import { useEffect, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createStore, useStore } from "zustand";
import type { ArtistId, DayIndex } from "../standings";
import type { Timeline } from "../timeline";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui";
import {
    hoveredLine,
    hoverTransition,
    lineAt,
    NOT_HOVERING,
    type HitFrame,
    type HoverEvent,
    type HoverState,
} from "./hover";
import { colorOf } from "./lines";

/** How long a card stays open after the pointer leaves its line or itself, to cross between them. */
const GRACE_MS = 150;

/** The Artist and Day a hovered line's card is about. */
export interface LineDay {
    artist: ArtistId;
    day: DayIndex;
}

/** What a hovered line's card shows, which the app fills in. */
export type LineDetails = (line: LineDay) => ReactNode;

/** Which line the pointer hovers, tested against the frame the chart last painted. */
export function createLineHover() {
    const store = createStore<HoverState>(() => NOT_HOVERING);
    let frame: HitFrame | undefined;
    return {
        store,
        dispatch: (event: HoverEvent) =>
            store.setState((state) => hoverTransition(state, event), true),
        /** Keeps the frame just painted, for the pointer to be tested against. */
        painted: (next: HitFrame) => {
            frame = next;
        },
        /** Tests a pointer at `[x, y]` within the chart against the last frame painted. */
        point: (pointer: readonly [number, number]) => frame && lineAt(frame, pointer),
    };
}

export type LineHover = ReturnType<typeof createLineHover>;

/** Whether an event's target is in the chart's own DOM, not a card portalled out of it. */
const withinChart = (event: { target: EventTarget; currentTarget: Element }) =>
    event.target instanceof Node && event.currentTarget.contains(event.target);

/**
 * The chart's pointer handlers for hovering lines: with a mouse or pen, while the view is still
 * and no button is held. Touch keeps to tapping the Focus Day.
 */
export function lineHoverHandlers(hover: LineHover, timeline: Timeline) {
    return {
        onPointerMove(event: PointerEvent<HTMLElement>) {
            if (event.pointerType === "touch" || !withinChart(event)) return;
            const still = timeline.store.getState().motion.kind === "still";
            if (event.buttons !== 0 || !still) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const pointer = [event.clientX - bounds.left, event.clientY - bounds.top] as const;
            hover.dispatch({ type: "pointed", line: hover.point(pointer) });
        },
        onPointerLeave() {
            hover.dispatch({ type: "pointed", line: undefined });
        },
    };
}

/** Ends the grace period of a card the pointer has left, unless it comes back in time. */
function useGrace(hover: LineHover) {
    const leaving = useStore(hover.store, (state) => state.kind === "leaving");
    useEffect(() => {
        if (!leaving) return;
        const timer = setTimeout(() => hover.dispatch({ type: "graceEnded" }), GRACE_MS);
        return () => clearTimeout(timer);
    }, [hover, leaving]);
}

/**
 * The hovered line's dot on its Day and the card beside it, flipping inside the chart's edges.
 * The card grows with its content up to 20rem or the chart's height, and the app's details scroll.
 */
export function LineHoverCard({
    hover,
    chart,
    renderDetails,
}: {
    hover: LineHover;
    chart: RefObject<HTMLElement | null>;
    renderDetails: LineDetails;
}) {
    const line = useStore(hover.store, hoveredLine);
    useGrace(hover);
    if (!line) return null;

    return (
        // Keyed on the line, so a new one is placed afresh and its details start over.
        <HoverCard key={`${line.artist}@${line.day}`} open>
            <HoverCardTrigger asChild>
                <span
                    aria-hidden
                    className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full border-2 border-card"
                    style={{ left: line.x, top: line.y, backgroundColor: colorOf(line.artist) }}
                />
            </HoverCardTrigger>
            <HoverCardContent
                role="region"
                aria-label="Hovered line"
                side="right"
                sideOffset={10}
                collisionBoundary={chart.current}
                collisionPadding={8}
                onPointerEnter={() => hover.dispatch({ type: "cardEntered" })}
                onPointerLeave={() => hover.dispatch({ type: "cardLeft" })}
                className="flex max-h-[min(20rem,var(--radix-hover-card-content-available-height))] w-72 flex-col gap-0 overflow-hidden p-0"
            >
                {renderDetails({ artist: line.artist, day: line.day })}
            </HoverCardContent>
        </HoverCard>
    );
}
