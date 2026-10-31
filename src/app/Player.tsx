import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect } from "react";
import { SECONDS_PER_DAY, SecondsPerDay, STEP_DAYS, StepDays } from "../settings";
import { usePlaying, useTimeline, type Timeline } from "../timeline";
import { Button, Label } from "../ui";
import { DayPresets, NumberSetting, type DayPreset } from "./fields";
import { useServices, useSettings } from "./services";
import { SoundtrackLine, SoundtrackSettings } from "./Soundtrack";

/** The step sizes offered as presets, by label. */
const STEP_PRESETS: readonly DayPreset[] = [
    ["1d", 1],
    ["1w", 7],
    ["30d", 30],
    ["1y", 365],
];

/** What each player key does. */
const PLAYER_KEYS: Readonly<Record<string, (timeline: Timeline) => void>> = {
    " ": (timeline) => timeline.togglePlaying(),
    ",": (timeline) => timeline.step(-1),
    ".": (timeline) => timeline.step(1),
};

/** Whether a key pressed on `target` belongs to that control rather than to the player. */
const ownsKeys = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest("input, textarea, select, button, [contenteditable]") !== null;

/** Space plays and pauses, `,` and `.` step back and forward, anywhere but in a control. */
export function usePlayerKeys(timeline: Timeline) {
    useEffect(() => {
        const press = (event: KeyboardEvent) => {
            const action = PLAYER_KEYS[event.key];
            if (!action || event.ctrlKey || event.metaKey || event.altKey) return;
            if (ownsKeys(event.target)) return;
            event.preventDefault();
            action(timeline);
        };
        addEventListener("keydown", press);
        return () => removeEventListener("keydown", press);
    }, [timeline]);
}

/**
 * Play and pause, the speed, the "◀ N Days ▶" step control with its presets, and the
 * Soundtrack's switch and Window size, with the Soundtrack named while playing.
 */
export function Player() {
    const { settings, spotify } = useServices();
    const { togglePlaying, step } = useTimeline();
    const playing = usePlaying();
    const stepDays = useSettings((s) => s.stepDays);
    const secondsPerDay = useSettings((s) => s.secondsPerDay);

    return (
        <div
            role="group"
            aria-label="Player"
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
            <Button
                variant="outline"
                size="icon"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => {
                    // Browsers let Spotify play only once a click has unlocked its audio.
                    if (!playing) spotify?.unlockAudio();
                    togglePlaying();
                }}
            >
                {playing ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Step back"
                    onClick={() => step(-1)}
                >
                    <ChevronLeftIcon />
                </Button>
                <NumberSetting
                    label="Step size"
                    value={stepDays}
                    min={STEP_DAYS.min}
                    max={STEP_DAYS.max}
                    step={1}
                    schema={StepDays}
                    onChange={(days) => settings.update({ stepDays: days })}
                    className="w-20"
                />
                <span className="text-sm">Days</span>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Step forward"
                    onClick={() => step(1)}
                >
                    <ChevronRightIcon />
                </Button>
                <DayPresets
                    presets={STEP_PRESETS}
                    value={stepDays}
                    onChoose={(days) => settings.update({ stepDays: days })}
                />
            </div>
            <div className="flex items-center gap-2">
                <Label htmlFor="speed">Speed</Label>
                <NumberSetting
                    id="speed"
                    value={secondsPerDay}
                    min={SECONDS_PER_DAY.min}
                    max={SECONDS_PER_DAY.max}
                    step={0.01}
                    schema={SecondsPerDay}
                    onChange={(speed) => settings.update({ secondsPerDay: speed })}
                    className="w-20"
                />
                <span className="text-sm text-muted-foreground">s/Day</span>
            </div>
            <SoundtrackSettings />
            <SoundtrackLine />
        </div>
    );
}
