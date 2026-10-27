import * as Comlink from "comlink";
import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { Subscriber } from "../events";
import type { IngestEvents } from "../ingest";
import type { DayWindow, StandingsTables } from "../standings";
import type { StandingsWorker } from "./standings.worker";

export interface View {
    /** The fractional Day being inspected; the Focus Day is the Day nearest it. */
    playhead: number;
    /** The fractional Days the chart shows. */
    window: DayWindow;
}

export interface ListenerRef {
    id: string;
    timeZone: string;
}

export interface TimelineState extends View {
    /** The Listener whose tables the timeline holds. */
    listener: ListenerRef | undefined;
    tables: StandingsTables | undefined;
    /** The latest build started; an older build's result is dropped. */
    buildId: number;
}

/** Builds a Listener's Standings tables as of `today` (Unix seconds). */
export type BuildStandings = (listener: ListenerRef, today: number) => Promise<StandingsTables>;

const INITIAL: TimelineState = {
    listener: undefined,
    tables: undefined,
    buildId: 0,
    playhead: 0,
    window: { start: 0, end: 0 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lastDay = (tables: StandingsTables | undefined) => Math.max(0, (tables?.dayCount ?? 1) - 1);
const clampWindow = ({ start, end }: DayWindow, last: number): DayWindow => ({
    start: clamp(start, 0, last),
    end: clamp(end, 0, last),
});

/**
 * Swaps in a Listener's new tables. Fresh tables open on the whole history with the last Day in
 * focus; a rebuild of the same Listener's keeps the Focus Day and window.
 */
export function swapIn(state: TimelineState, tables: StandingsTables): Partial<TimelineState> {
    const last = lastDay(tables);
    return state.tables
        ? {
              tables,
              playhead: clamp(state.playhead, 0, last),
              window: clampWindow(state.window, last),
          }
        : { tables, playhead: last, window: { start: 0, end: last } };
}

const seekTo = ({ tables }: TimelineState, day: number): Partial<TimelineState> => ({
    playhead: clamp(day, 0, lastDay(tables)),
});

const showWindow = ({ tables }: TimelineState, window: DayWindow): Partial<TimelineState> => ({
    window: clampWindow(window, lastDay(tables)),
});

export interface TimelineDeps {
    build: BuildStandings;
    events: Subscriber<IngestEvents>;
    now: () => number;
}

/**
 * The main thread's hold on the current Listener's tables (build, swap, drop stale results) and
 * the view store. Rebuilds whenever ingest changes the current Listener's Scrobbles.
 */
export function createTimeline({ build, events, now }: TimelineDeps) {
    const store: StoreApi<TimelineState> = createStore<TimelineState>(() => INITIAL);

    async function rebuild(listener: ListenerRef): Promise<void> {
        const buildId = store.getState().buildId + 1;
        store.setState({ buildId });
        const tables = await build(listener, Math.floor(now() / 1000));
        if (store.getState().buildId === buildId) store.setState((state) => swapIn(state, tables));
    }

    /** Makes `listener` the one whose tables the timeline holds, rebuilding them. */
    function show(listener: ListenerRef): void {
        const switching = store.getState().listener?.id !== listener.id;
        store.setState(switching ? { listener, tables: undefined } : { listener });
        void rebuild(listener);
    }

    const dispose = events.on("scrobblesChanged", ({ listenerId }) => {
        const { listener } = store.getState();
        if (listener?.id === listenerId) void rebuild(listener);
    });

    return {
        store,
        show,
        dispose,
        /** Moves the playhead to `day`. */
        seek: (day: number) => store.setState((state) => seekTo(state, day)),
        /** Shows the Days in `window`, kept within the history. */
        setWindow: (window: DayWindow) => store.setState((state) => showWindow(state, window)),
        /** The current view, for code that reads it outside React. */
        getView: (): View => {
            const { playhead, window } = store.getState();
            return { playhead, window };
        },
        /** Calls `onChange` after every change to the view, for per-frame readers outside React. */
        subscribeView: (onChange: (view: View) => void): (() => void) =>
            store.subscribe((state, previous) => {
                if (state.playhead !== previous.playhead || state.window !== previous.window)
                    onChange({ playhead: state.playhead, window: state.window });
            }),
    };
}

export type Timeline = ReturnType<typeof createTimeline>;

/** Builds tables in a Web Worker that reads Dexie itself and hands them back zero-copy. */
export function createWorkerBuild(): BuildStandings {
    const worker = Comlink.wrap<StandingsWorker>(
        new Worker(new URL("./standings.worker.ts", import.meta.url), { type: "module" }),
    );
    return (listener, today) => worker.build(listener.id, listener.timeZone, today);
}

/** Provides the app's timeline to the components below. */
export const TimelineContext = createContext<Timeline | undefined>(undefined);

export function useTimeline(): Timeline {
    const timeline = useContext(TimelineContext);
    if (!timeline) throw new Error("useTimeline needs a TimelineContext above it");
    return timeline;
}

const useTimelineState = <T>(select: (state: TimelineState) => T): T =>
    useStore(useTimeline().store, select);

export const useTables = (): StandingsTables | undefined => useTimelineState((s) => s.tables);

/** The Focus Day: the Day nearest the playhead. */
export const useFocusDay = (): number => useTimelineState((s) => Math.round(s.playhead));

/** The chart's window, for React overlays that must follow every pan and zoom. */
export const useViewWindow = (): DayWindow => useTimelineState((s) => s.window);
