import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { SECONDS_PER_DAY, SecondsPerDay, STEP_DAYS, StepDays } from "../settings";
import { usePlaying, useTimeline, type Timeline } from "../timeline";
import { Button, Input, Label } from "../ui";
import { useServices, useSettings } from "./services";

/** The step sizes offered as presets, by label. */
const STEP_PRESETS: readonly (readonly [label: string, days: number])[] = [
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

/** Play and pause, the speed, and the "◀ N Days ▶" step control with its presets. */
export function Player() {
    const { settings } = useServices();
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
                onClick={togglePlaying}
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
                {STEP_PRESETS.map(([label, days]) => (
                    <Button
                        key={label}
                        variant={stepDays === days ? "secondary" : "ghost"}
                        size="xs"
                        aria-pressed={stepDays === days}
                        onClick={() => settings.update({ stepDays: days })}
                    >
                        {label}
                    </Button>
                ))}
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
        </div>
    );
}

/**
 * A number input for a setting that keeps what is being typed, saving it only once it is valid,
 * so passing through an invalid value such as "0." on the way to "0.05" doesn't reset it.
 */
function NumberSetting({
    id,
    label,
    value,
    min,
    max,
    step,
    schema,
    onChange,
    className,
}: {
    id?: string;
    label?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** The rule a typed value must pass before it is saved. */
    schema: z.ZodType<number>;
    onChange: (value: number) => void;
    className?: string;
}) {
    const [draft, setDraft] = useState<string>();
    return (
        <Input
            id={id}
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            className={className}
            onChange={(e) => {
                setDraft(e.target.value);
                const typed = schema.safeParse(
                    e.target.value === "" ? Number.NaN : Number(e.target.value),
                );
                if (typed.success) onChange(typed.data);
            }}
            onBlur={() => setDraft(undefined)}
        />
    );
}
