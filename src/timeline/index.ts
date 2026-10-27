import * as Comlink from "comlink";
import { createStore, useStore } from "zustand";
import { onScrobblesChanged } from "../ingest";
import type { DayWindow, StandingsTables } from "../standings";
import type { StandingsWorker } from "./standings.worker";

export interface View {
    /** The fractional Day being inspected; the Focus Day is the Day nearest it. */
    playhead: number;
    /** The fractional Days the chart shows. */
    window: DayWindow;
}

interface TimelineState extends View {
    tables: StandingsTables | undefined;
}

const store = createStore<TimelineState>(() => ({
    tables: undefined,
    playhead: 0,
    window: { start: 0, end: 0 },
}));

let worker: Comlink.Remote<StandingsWorker> | undefined;
let generation = 0;
let current: { id: string; timeZone: string } | undefined;

function standingsWorker(): Comlink.Remote<StandingsWorker> {
    worker ??= Comlink.wrap<StandingsWorker>(
        new Worker(new URL("./standings.worker.ts", import.meta.url), { type: "module" }),
    );
    return worker;
}

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
function swapIn(tables: StandingsTables): void {
    const { tables: previous, playhead, window } = store.getState();
    const last = lastDay(tables);
    if (!previous) {
        store.setState({ tables, playhead: last, window: { start: 0, end: last } });
        return;
    }
    store.setState({
        tables,
        playhead: clamp(playhead, 0, last),
        window: clampWindow(window, last),
    });
}

/**
 * Builds the current Listener's tables in the worker and swaps them in, unless a newer
 * rebuild has started meanwhile.
 */
async function rebuild(listener: { id: string; timeZone: string }): Promise<void> {
    const started = ++generation;
    const now = Math.floor(Date.now() / 1000);
    const tables = await standingsWorker().build(listener.id, listener.timeZone, now);
    if (started === generation) swapIn(tables);
}

/** Makes `listener` the one whose tables the timeline holds, rebuilding them. */
export function showListener(listener: { id: string; timeZone: string }): void {
    if (current?.id !== listener.id) store.setState({ tables: undefined });
    current = { id: listener.id, timeZone: listener.timeZone };
    void rebuild(current);
}

onScrobblesChanged((listenerId) => {
    if (current?.id === listenerId) void rebuild(current);
});

/** Moves the playhead to `day`. */
export function seek(day: number): void {
    store.setState(({ tables }) => ({ playhead: clamp(day, 0, lastDay(tables)) }));
}

/** Shows the Days in `window`, kept within the history. */
export function setWindow(window: DayWindow): void {
    store.setState(({ tables }) => ({ window: clampWindow(window, lastDay(tables)) }));
}

/** The current view, for code that reads it outside React. */
export function getView(): View {
    const { playhead, window } = store.getState();
    return { playhead, window };
}

/** Calls `onChange` after every change to the view, for per-frame readers outside React. */
export function subscribeView(onChange: (view: View) => void): () => void {
    return store.subscribe((state, previous) => {
        if (state.playhead !== previous.playhead || state.window !== previous.window)
            onChange({ playhead: state.playhead, window: state.window });
    });
}

export function useTables(): StandingsTables | undefined {
    return useStore(store, (state) => state.tables);
}

/** The Focus Day: the Day nearest the playhead. */
export function useFocusDay(): number {
    return useStore(store, (state) => Math.round(state.playhead));
}

/** The chart's window, for React overlays that must follow every pan and zoom. */
export function useViewWindow(): DayWindow {
    return useStore(store, (state) => state.window);
}
