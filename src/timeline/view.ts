import type { DayWindow } from "../standings";

/** A glide's move of the window, made only when its target Day lies outside the window. */
export interface Pan {
    from: DayWindow;
    to: DayWindow;
}

/** How the playhead is moving. Frame times are unknown until the first frame after a start. */
export type Motion =
    | { kind: "still" }
    | { kind: "playing"; at: number | undefined }
    | {
          kind: "gliding";
          from: number;
          to: number;
          pan: Pan | undefined;
          ms: number;
          startedAt: number | undefined;
      };

export interface ViewState {
    /** The fractional Day being inspected; the Focus Day is the Day nearest it. */
    playhead: number;
    /** The fractional Days the chart shows. */
    window: DayWindow;
    motion: Motion;
}

/** The commands and frames that move the view; `msPerDay` is the playback speed. */
export type ViewEvent =
    | { type: "play" }
    | { type: "pause" }
    | { type: "toggle" }
    | { type: "seek"; day: number; glide: boolean }
    | { type: "step"; days: number }
    | { type: "setWindow"; window: DayWindow }
    | { type: "frame"; at: number; msPerDay: number };

/** Where in the window's width the playhead holds while playing. */
const PLAYHEAD_HOLD = 0.8;
/** The most of a frame's gap playback counts, so a stalled tab doesn't leap ahead on return. */
const MAX_FRAME_MS = 250;
/** The shortest and longest glides; one Day takes the shortest, about a month the longest. */
const GLIDE_MS = { min: 280, max: 900 };
const GLIDE_MS_PER_DOUBLING = 135;
const STILL: Motion = { kind: "still" };

export const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

/** `window` moved `by` Days, stopping at Day 0 and `last` without changing its width. */
export function panned({ start, end }: DayWindow, by: number, last: number): DayWindow {
    const width = Math.min(end - start, last);
    const moved = clamp(start + by, 0, last - width);
    return { start: moved, end: moved + width };
}

/** The window kept within the history, Day 0 through `last`. */
export const withinHistory = ({ start, end }: DayWindow, last: number): DayWindow => ({
    start: clamp(start, 0, last),
    end: clamp(end, 0, last),
});

/** The window while playing: it scrolls once the playhead passes 80% of its width, to hold it there. */
function followed(window: DayWindow, playhead: number, last: number): DayWindow {
    const hold = window.start + (window.end - window.start) * PLAYHEAD_HOLD;
    return playhead > hold || playhead < window.start
        ? panned(window, playhead - hold, last)
        : window;
}

/** How long a glide over `days` takes, growing with each doubling of the distance. */
const glideMs = (days: number): number =>
    clamp(
        GLIDE_MS.min + GLIDE_MS_PER_DOUBLING * Math.log2(Math.max(days, 1)),
        GLIDE_MS.min,
        GLIDE_MS.max,
    );

/** Cubic ease-in-out over progress from 0 to 1. */
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2);

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

const centredOn = (window: DayWindow, day: number, last: number): DayWindow =>
    panned(window, day - (window.start + window.end) / 2, last);

/** A glide from the playhead to `to`, panning to centre it if it lies outside the window. */
function glide(state: ViewState, to: number, last: number): ViewState {
    const { playhead, window } = state;
    if (to === playhead) return { ...state, motion: STILL };
    const outside = to < window.start || to > window.end;
    const pan = outside ? { from: window, to: centredOn(window, to, last) } : undefined;
    return {
        ...state,
        motion: {
            kind: "gliding",
            from: playhead,
            to,
            pan,
            ms: glideMs(Math.abs(to - playhead)),
            startedAt: undefined,
        },
    };
}

/** The view moved to `day`: a jump while playing (which plays on) or when asked, else a glide. */
function seek(state: ViewState, day: number, glides: boolean, last: number): ViewState {
    const to = clamp(day, 0, last);
    if (state.motion.kind === "playing")
        return { ...state, playhead: to, window: followed(state.window, to, last) };
    if (!glides) return { ...state, playhead: to, motion: STILL };
    if (state.motion.kind === "still" && to === state.playhead) return state;
    return glide(state, to, last);
}

/** The Day a step counts from: the glide's target if one is under way, else the Focus Day. */
const stepBase = ({ playhead, motion }: ViewState): number =>
    motion.kind === "gliding" ? motion.to : Math.round(playhead);

function glideFrame(state: ViewState, at: number): ViewState {
    if (state.motion.kind !== "gliding") return state;
    const { from, to, pan, ms, startedAt } = state.motion;
    if (startedAt === undefined) return { ...state, motion: { ...state.motion, startedAt: at } };
    const progress = Math.min(1, (at - startedAt) / ms);
    const eased = easeInOut(progress);
    const window = pan
        ? {
              start: lerp(pan.from.start, pan.to.start, eased),
              end: lerp(pan.from.end, pan.to.end, eased),
          }
        : state.window;
    return progress < 1
        ? { ...state, playhead: lerp(from, to, eased), window }
        : { playhead: to, window: pan ? pan.to : window, motion: STILL };
}

/** The motion with any glide's pan dropped, once something else has moved the window. */
const unpanned = (motion: Motion): Motion =>
    motion.kind === "gliding" && motion.pan ? { ...motion, pan: undefined } : motion;

function play(state: ViewState, last: number): ViewState {
    if (state.motion.kind === "playing") return state;
    const playhead = state.playhead >= last ? 0 : state.playhead;
    return {
        playhead,
        window: followed(state.window, playhead, last),
        motion: { kind: "playing", at: undefined },
    };
}

const pause = (state: ViewState): ViewState =>
    state.motion.kind === "playing" ? { ...state, motion: STILL } : state;

function playFrame(state: ViewState, at: number, msPerDay: number, last: number): ViewState {
    if (state.motion.kind !== "playing") return state;
    const { at: previous } = state.motion;
    if (previous === undefined) return { ...state, motion: { kind: "playing", at } };
    const advance = Math.min(at - previous, MAX_FRAME_MS) / msPerDay;
    const playhead = Math.min(last, state.playhead + advance);
    return {
        playhead,
        window: followed(state.window, playhead, last),
        motion: playhead >= last ? STILL : { kind: "playing", at },
    };
}

/**
 * The view after `event`, over a history whose last Day is `last`. An event the current motion
 * doesn't accept leaves the state unchanged.
 */
export function transition(state: ViewState, event: ViewEvent, last: number): ViewState {
    switch (event.type) {
        case "play":
            return play(state, last);
        case "pause":
            return pause(state);
        case "toggle":
            return state.motion.kind === "playing" ? pause(state) : play(state, last);
        case "seek":
            return seek(state, event.day, event.glide, last);
        case "step":
            return seek(state, stepBase(state) + event.days, true, last);
        case "setWindow":
            return {
                ...state,
                window: withinHistory(event.window, last),
                motion: unpanned(state.motion),
            };
        case "frame":
            return state.motion.kind === "gliding"
                ? glideFrame(state, event.at)
                : playFrame(state, event.at, event.msPerDay, last);
    }
}
