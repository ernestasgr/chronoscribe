import * as Comlink from "comlink";
import { createContext, useContext, useEffect } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { ListenerId } from "../db";
import type { AppSettings, SoundtrackPick } from "../settings";
import type { Subscriber } from "../events";
import type { IngestEvents } from "../ingest";
import {
    dayIndex,
    firstDayShift,
    soundtrackAt,
    type DayIndex,
    type DayWindow,
    type Soundtrack,
    type Soundtracks,
    type StandingsTables,
} from "../standings";
import type { StandingsWorker } from "./standings.worker";
import { clamp, transition, withinHistory, type ViewEvent, type ViewState } from "./view";

export { panned } from "./view";

/** The part of the view the chart draws each frame. */
export type View = Pick<ViewState, "playhead" | "window">;

export interface ListenerRef {
    id: ListenerId;
    timeZone: string;
}

/** Where the latest build of the tables, or pick of the Soundtracks, is: none under way, running, or failed. */
export type BuildStatus =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "failed"; message: string };

export interface TimelineState extends ViewState {
    /** The Listener whose tables the timeline holds. */
    listener: ListenerRef | undefined;
    tables: StandingsTables | undefined;
    /** Each Window's Soundtrack, picked for the Window size in the settings. */
    soundtracks: Soundtracks | undefined;
    build: BuildStatus;
    /** Where the latest pick of the Soundtracks alone, for a new Window size, is. */
    pick: BuildStatus;
    /** The latest build started; an older build's result is dropped. */
    buildId: number;
    /** The latest Soundtrack pick started, by a build or alone; an older pick's result is dropped. */
    pickId: number;
}

/** What one build makes of a Listener's Scrobbles: their tables and each Window's Soundtrack. */
export interface Projection {
    tables: StandingsTables;
    soundtracks: Soundtracks;
}

/** Builds a Listener's tables and Soundtracks as of `today` (Unix seconds), in `windowDays` Windows picked by `pick`. */
export type BuildProjection = (
    listener: ListenerRef,
    today: number,
    windowDays: number,
    pick: SoundtrackPick,
) => Promise<Projection>;

/** Picks a Listener's Soundtracks alone, for when only the Window size or the pick has changed. */
export type BuildSoundtracks = (
    listener: ListenerRef,
    today: number,
    windowDays: number,
    pick: SoundtrackPick,
) => Promise<Soundtracks>;

/** Calls `callback` with the frame's time in ms before the next paint; returns a cancel. */
export type RequestFrame = (callback: (at: number) => void) => () => void;

/** The playback settings, read when they are needed. */
export type Playback = () => Pick<
    AppSettings,
    "secondsPerDay" | "stepDays" | "soundtrackDays" | "soundtrackPick"
>;

const INITIAL: TimelineState = {
    listener: undefined,
    tables: undefined,
    soundtracks: undefined,
    build: { kind: "idle" },
    pick: { kind: "idle" },
    buildId: 0,
    pickId: 0,
    playhead: 0,
    window: { start: 0, end: 0 },
    motion: { kind: "still" },
};

const lastDay = (tables: StandingsTables | undefined) => Math.max(0, (tables?.dayCount ?? 1) - 1);

/**
 * Swaps in a Listener's new tables. Fresh tables open on the whole history with the last Day in
 * focus; a rebuild of the same Listener's keeps the Focus Day's and window's dates, even when the
 * first Day has moved.
 */
export function swapIn(state: TimelineState, tables: StandingsTables): Partial<TimelineState> {
    const last = lastDay(tables);
    if (state.tables) {
        const shift = firstDayShift(state.tables, tables);
        const { start, end } = state.window;
        // A window that reached the last Day keeps reaching it, so a Sync's new Days come into view.
        const reachedLast = end >= lastDay(state.tables);
        return {
            tables,
            playhead: clamp(state.playhead - shift, 0, last),
            window: withinHistory(
                { start: start - shift, end: reachedLast ? last : end - shift },
                last,
            ),
            // A glide's Days are counted from the old first Day, so it stops where it is.
            ...(shift !== 0 && state.motion.kind === "gliding"
                ? { motion: { kind: "still" } }
                : {}),
        };
    }
    return {
        tables,
        playhead: last,
        window: { start: 0, end: last },
        motion: { kind: "still" },
    };
}

/** The view after `event`, over the tables held. */
const afterViewEvent = (state: TimelineState, event: ViewEvent): Partial<TimelineState> => {
    const { playhead, window, motion } = transition(state, event, lastDay(state.tables));
    return { playhead, window, motion };
};

export interface TimelineDeps {
    build: BuildProjection;
    buildSoundtracks: BuildSoundtracks;
    events: Subscriber<IngestEvents>;
    now: () => number;
    requestFrame: RequestFrame;
    playback: Playback;
}

/** What a build or pick came to: its value, or why it failed. */
type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Settles `promise` as an attempt, so its failure is kept as a value rather than thrown. */
const attempt = <T>(promise: Promise<T>): Promise<Attempt<T>> =>
    promise.then(
        (value) => ({ ok: true, value }) as const,
        (error: unknown) => ({ ok: false, error: String(error) }) as const,
    );

/**
 * The main thread's hold on the current Listener's tables and Soundtracks (build, swap, drop
 * stale results) and the view store, with the player that moves it frame by frame while playing
 * or gliding. Rebuilds whenever ingest changes the current Listener's Scrobbles.
 */
export function createTimeline({
    build,
    buildSoundtracks,
    events,
    now,
    requestFrame,
    playback,
}: TimelineDeps) {
    const store: StoreApi<TimelineState> = createStore<TimelineState>(() => INITIAL);
    const dispatch = (event: ViewEvent) => store.setState((state) => afterViewEvent(state, event));
    let cancelFrame: (() => void) | undefined;

    // Asks for the next frame for as long as the playhead is moving.
    const animate = ({ motion }: TimelineState) => {
        if (motion.kind === "still" || cancelFrame) return;
        cancelFrame = requestFrame((at) => {
            cancelFrame = undefined;
            dispatch({ type: "frame", at, msPerDay: playback().secondsPerDay * 1000 });
        });
    };
    const stopAnimating = store.subscribe(animate);

    const today = () => Math.floor(now() / 1000);
    const windowDays = () => playback().soundtrackDays;
    const soundtrackPick = () => playback().soundtrackPick;

    /**
     * Builds the Listener's tables and Soundtracks; never rejects, as a failure is kept in
     * `build`. Its Soundtracks are dropped if the Window size changed while it ran.
     */
    async function rebuild(listener: ListenerRef): Promise<void> {
        const buildId = store.getState().buildId + 1;
        const pickId = store.getState().pickId + 1;
        store.setState({ buildId, pickId, build: { kind: "running" } });
        const built = await attempt(build(listener, today(), windowDays(), soundtrackPick()));
        if (store.getState().buildId !== buildId) return;
        store.setState((state) =>
            built.ok
                ? {
                      ...swapIn(state, built.value.tables),
                      ...(state.pickId === pickId
                          ? { soundtracks: built.value.soundtracks, pick: { kind: "idle" } }
                          : {}),
                      build: { kind: "idle" },
                  }
                : { build: { kind: "failed", message: built.error } },
        );
    }

    /**
     * Picks the held Listener's Soundtracks again for the Window size and pick now set, keeping
     * their tables; never rejects, as a failure is kept in `pick`.
     */
    async function repickSoundtracks(): Promise<void> {
        const { listener } = store.getState();
        if (!listener) return;
        const pickId = store.getState().pickId + 1;
        store.setState({ pickId, pick: { kind: "running" } });
        const picked = await attempt(
            buildSoundtracks(listener, today(), windowDays(), soundtrackPick()),
        );
        if (store.getState().pickId !== pickId) return;
        store.setState(
            picked.ok
                ? { soundtracks: picked.value, pick: { kind: "idle" } }
                : { pick: { kind: "failed", message: picked.error } },
        );
    }

    /** Makes `listener` the one whose tables the timeline holds, rebuilding them. */
    function show(listener: ListenerRef): void {
        const switching = store.getState().listener?.id !== listener.id;
        store.setState(
            switching ? { listener, tables: undefined, soundtracks: undefined } : { listener },
        );
        void rebuild(listener);
    }

    /** Lets go of the Listener and their tables, dropping any build still running. */
    function clear(): void {
        store.setState(({ buildId, pickId }) => ({
            ...INITIAL,
            buildId: buildId + 1,
            pickId: pickId + 1,
        }));
    }

    /** Builds the held Listener's tables again, such as after a failed build. */
    function retry(): void {
        const { listener } = store.getState();
        if (listener) void rebuild(listener);
    }

    const stopRebuilding = events.on("scrobblesChanged", ({ listenerId }) => {
        const { listener } = store.getState();
        if (listener?.id === listenerId) void rebuild(listener);
    });

    return {
        store,
        show,
        clear,
        retry,
        repickSoundtracks,
        dispose: () => {
            stopRebuilding();
            stopAnimating();
            cancelFrame?.();
        },
        play: () => dispatch({ type: "play" }),
        pause: () => dispatch({ type: "pause" }),
        /** Plays if paused, pauses if playing. */
        togglePlaying: () => dispatch({ type: "toggle" }),
        /** Moves the playhead to `day`, gliding there unless `glide` is false. */
        seek: (day: number, { glide = true }: { glide?: boolean } = {}) =>
            dispatch({ type: "seek", day, glide }),
        /** Glides the step size's Days forward (1) or back (-1). */
        step: (direction: 1 | -1) =>
            dispatch({ type: "step", days: direction * playback().stepDays }),
        /** Shows the Days in `window`, kept within the history. */
        setWindow: (window: DayWindow) => dispatch({ type: "setWindow", window }),
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

/** Builds in a Web Worker that reads Dexie itself and hands the tables back zero-copy. */
export function createWorkerBuild(): Pick<TimelineDeps, "build" | "buildSoundtracks"> {
    const worker = Comlink.wrap<StandingsWorker>(
        new Worker(new URL("./standings.worker.ts", import.meta.url), { type: "module" }),
    );
    return {
        build: (listener, today, windowDays, pick) =>
            worker.build(listener.id, listener.timeZone, today, windowDays, pick),
        buildSoundtracks: (listener, today, windowDays, pick) =>
            worker.soundtracks(listener.id, listener.timeZone, today, windowDays, pick),
    };
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

/** Where the latest build of the tables is. */
export const useBuild = (): BuildStatus => useTimelineState((s) => s.build);

/** The Focus Day: the Day nearest the playhead. */
export const useFocusDay = (): DayIndex =>
    useTimelineState((s) => dayIndex(Math.round(s.playhead)));

/** The Soundtrack of the Focus Day's Window, or the last one before an empty Window. */
export const useSoundtrack = (): Soundtrack | undefined =>
    useTimelineState(
        (s) => s.soundtracks && soundtrackAt(s.soundtracks, dayIndex(Math.round(s.playhead))),
    );

/** Where the latest pick of the Soundtracks alone is. */
export const usePick = (): BuildStatus => useTimelineState((s) => s.pick);

/** Whether the history is playing. */
export const usePlaying = (): boolean => useTimelineState((s) => s.motion.kind === "playing");

/** Calls `onFrame` with the view now and after each change, for per-frame readers outside React. */
export function useViewFrames(onFrame: (view: View) => void): void {
    const { getView, subscribeView } = useTimeline();
    useEffect(() => {
        onFrame(getView());
        return subscribeView(onFrame);
    }, [getView, subscribeView, onFrame]);
}
