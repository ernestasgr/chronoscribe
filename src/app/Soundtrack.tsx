import { SOUNDTRACK_DAYS, SoundtrackDays, type SoundtrackPick } from "../settings";
import { usePick, usePlaying, useSoundtrack, useTimeline } from "../timeline";
import { Button, Label, Switch } from "../ui";
import { DayPresets, NumberSetting, OptionSelect, type Choices, type DayPreset } from "./fields";
import { timeOf } from "./connection";
import { useServices, useSettings, useSoundtrackPlayer } from "./services";
import { FREE, type Limit, type SoundtrackPlayer } from "./soundtrackPlayer";

/** The Window sizes offered as presets, by label. */
const WINDOW_PRESETS: readonly DayPreset[] = [
    ["1w", 7],
    ["30d", 30],
    ["90d", 90],
    ["1y", 365],
];

/** How a Window's Soundtrack is picked, by label. */
const PICK_CHOICES: Choices<SoundtrackPick> = [
    ["artist", "top artist's top song"],
    ["track", "most-played song"],
];

/** The Soundtrack switch, held off while Spotify has asked the app to wait, saying until when. */
function SoundtrackSwitch({ limit }: { limit: Limit }) {
    const { settings, spotify } = useServices();
    const on = useSettings((s) => s.soundtrack);
    return (
        <>
            <Switch
                id="soundtrack"
                checked={on}
                disabled={limit.kind === "limited"}
                aria-describedby={limit.kind === "limited" ? "soundtrack-limit" : undefined}
                onCheckedChange={(soundtrack) => {
                    settings.update({ soundtrack });
                    // Signs in first if need be, else unlocks audio on this click.
                    if (soundtrack) void spotify?.switchedOn();
                }}
            />
            <Label htmlFor="soundtrack">Soundtrack</Label>
            {limit.kind === "limited" && (
                <span id="soundtrack-limit" className="text-sm text-muted-foreground">
                    Spotify asked to wait: back on at {timeOf(limit.until)}
                </span>
            )}
        </>
    );
}

/** The switch, following the Soundtrack player's limit. */
function PlayerSwitch({ player }: { player: SoundtrackPlayer }) {
    return <SoundtrackSwitch limit={useSoundtrackPlayer(player, (s) => s.limit)} />;
}

/** The Soundtrack switch and the Window size, with its presets, each saved as soon as it changes. */
export function SoundtrackSettings() {
    const { settings, soundtrackPlayer } = useServices();
    const windowDays = useSettings((s) => s.soundtrackDays);
    const pick = useSettings((s) => s.soundtrackPick);

    return (
        <div className="flex flex-wrap items-center gap-2">
            {soundtrackPlayer ? (
                <PlayerSwitch player={soundtrackPlayer} />
            ) : (
                <SoundtrackSwitch limit={FREE} />
            )}
            <div className="flex items-center gap-1">
                <NumberSetting
                    label="Window size"
                    value={windowDays}
                    min={SOUNDTRACK_DAYS.min}
                    max={SOUNDTRACK_DAYS.max}
                    step={1}
                    schema={SoundtrackDays}
                    onChange={(days) => settings.update({ soundtrackDays: days })}
                    className="w-20"
                />
                <span className="text-sm">Day Windows</span>
                <DayPresets
                    presets={WINDOW_PRESETS}
                    value={windowDays}
                    onChoose={(days) => settings.update({ soundtrackDays: days })}
                    name={(label) => `${label} Windows`}
                />
            </div>
            <OptionSelect
                id="soundtrack-pick"
                label="Pick"
                value={pick}
                choices={PICK_CHOICES}
                onChange={(soundtrackPick) => settings.update({ soundtrackPick })}
            />
            <PickFailure />
        </div>
    );
}

/** Why picking the Soundtracks for a new Window size failed, with a way to try again. */
function PickFailure() {
    const pick = usePick();
    const { repickSoundtracks } = useTimeline();
    if (pick.kind !== "failed") return null;
    return (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            Couldn't pick the Soundtracks: {pick.message}
            <Button size="xs" variant="outline" onClick={() => void repickSoundtracks()}>
                Retry
            </Button>
        </p>
    );
}

/** "♪ Song — Artist" for the Focus Day's Window, while the history plays with the switch on. */
export function SoundtrackLine() {
    const on = useSettings((s) => s.soundtrack);
    const playing = usePlaying();
    const first = useSoundtrack()?.tracks[0];
    if (!on || !playing || !first) return null;
    return (
        <output aria-label="Soundtrack" className="basis-full truncate text-sm">
            ♪ {first.track} — {first.artist}
        </output>
    );
}
