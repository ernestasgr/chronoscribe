import type { ListenerId } from "../db";
import { unixMs, type DeviceId, type UnixMs } from "../spotify";
import { dayIndex, soundtrackAt, windowAt, type Soundtrack, type WindowIndex } from "../standings";
import type { TimelineState } from "../timeline";

/** What Spotify should be playing: a Listener's Window's Soundtrack, on this tab's device. */
export interface Cue {
    listener: ListenerId;
    window: WindowIndex;
    soundtrack: Soundtrack;
    deviceId: DeviceId;
}

/** The Cue while the history plays with the Soundtrack on and this tab ready to play; none otherwise. */
export function cueOf(
    { listener, soundtracks, playhead, motion }: TimelineState,
    on: boolean,
    device: DeviceId | undefined,
): Cue | undefined {
    if (!on || motion.kind !== "playing" || !listener || !soundtracks || !device) return undefined;
    const day = dayIndex(Math.round(playhead));
    const soundtrack = soundtrackAt(soundtracks, day);
    return (
        soundtrack && {
            listener: listener.id,
            window: windowAt(soundtracks, day),
            soundtrack,
            deviceId: device,
        }
    );
}

/** Whether two Cues are in the same Listener's same Window. */
export const samePlace = (a: Cue, b: Cue): boolean =>
    a.listener === b.listener && a.window === b.window;

/** A Soundtrack's identity, whichever Window chose it: its tracks, each with its Artist. */
export const soundtrackKey = ({ tracks }: Soundtrack): string => JSON.stringify(tracks);

/** How long a Soundtrack plays at least before the next is sent, so bursts don't anger Spotify. */
export const MIN_PLAY_MS = 2_000;

/** The soonest the next Soundtrack may be sent, if the last was sent at `sentAt`. */
export const sendableAt = (sentAt: UnixMs | undefined, now: UnixMs): UnixMs =>
    sentAt === undefined ? now : unixMs(Math.max(now, sentAt + MIN_PLAY_MS));

/** What Spotify is doing for the app: nothing yet, playing a track, or paused where the history paused. */
export type Playback =
    | { kind: "stopped" }
    | { kind: "playing"; uri: string }
    | { kind: "paused"; uri: string; at: Cue };

/** What moves the player: a track sent to Spotify, the history pausing where it was, or resuming. */
export type PlaybackEvent =
    | { type: "sent"; uri: string }
    | { type: "paused"; at: Cue }
    | { type: "resumed" };

/** The player after `event`; an event the current state doesn't accept leaves it unchanged. */
export function transition(state: Playback, event: PlaybackEvent): Playback {
    switch (event.type) {
        case "sent":
            return { kind: "playing", uri: event.uri };
        case "paused":
            return state.kind === "playing"
                ? { kind: "paused", uri: state.uri, at: event.at }
                : state;
        case "resumed":
            return state.kind === "paused" ? { kind: "playing", uri: state.uri } : state;
    }
}

/** Whether playing from `cue` carries on the paused track: only in the Window it paused in. */
export const resumes = (state: Playback, cue: Cue): boolean =>
    state.kind === "paused" && samePlace(state.at, cue);
