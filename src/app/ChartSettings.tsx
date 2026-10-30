import type { ChartOptions } from "../chart";
import { TOP_X, TopXSize, type ClimbersMode } from "../settings";
import { climbersCut } from "../standings";
import { Input, Label, NativeSelect, NativeSelectOption, Switch } from "../ui";
import { useServices } from "./services";

/** The Top X size and the chart's options, each saved as soon as it is changed. */
export function ChartSettings({
    x,
    mode,
    options,
}: {
    x: number;
    mode: ClimbersMode;
    options: ChartOptions;
}) {
    const { settings } = useServices();
    const inScrobblesMode = options.yAxis !== "standing";

    return (
        <>
            <div className="flex items-center gap-2">
                <Label htmlFor="top-x">X</Label>
                <Input
                    id="top-x"
                    type="number"
                    min={TOP_X.min}
                    max={TOP_X.max}
                    value={x}
                    className="w-20"
                    onChange={(e) => {
                        const typed = TopXSize.safeParse(Number(e.target.value));
                        if (typed.success) settings.update({ x: typed.data });
                    }}
                />
            </div>
            <OptionSelect
                id="climbers-mode"
                label="Climbers"
                value={mode}
                choices={[
                    ["fold", "fold long tail"],
                    ["within", `within Top ${climbersCut(x)}`],
                    ["all", "all (raw)"],
                ]}
                onChange={(choice) => settings.update({ climbers: choice })}
            />
            <OptionSelect
                id="y-axis"
                label="Y axis"
                value={options.yAxis}
                choices={Y_AXIS_CHOICES}
                onChange={(yAxis) => settings.update({ yAxis })}
            />
            <OptionSelect
                id="below-top-x"
                label="Below the Top X"
                value={options.belowTopX}
                choices={BELOW_TOP_X_CHOICES}
                disabled={inScrobblesMode}
                onChange={(belowTopX) => settings.update({ belowTopX })}
            />
            <OptionSelect
                id="line-shape"
                label="Line shape"
                value={options.lineShape}
                choices={LINE_SHAPE_CHOICES}
                disabled={inScrobblesMode}
                onChange={(lineShape) => settings.update({ lineShape })}
            />
            <OptionSelect
                id="lines-drawn"
                label="Lines drawn"
                value={options.linesDrawn}
                choices={LINES_DRAWN_CHOICES}
                onChange={(linesDrawn) => settings.update({ linesDrawn })}
            />
            <div className="flex items-center gap-2">
                <Switch
                    id="hide-future"
                    checked={options.hideFuture}
                    onCheckedChange={(hideFuture) => settings.update({ hideFuture })}
                />
                <Label htmlFor="hide-future">Hide the future</Label>
            </div>
        </>
    );
}

/** Each choice of a setting, as its stored value and its label. */
type Choices<T extends string> = readonly (readonly [value: T, label: string])[];

const Y_AXIS_CHOICES: Choices<ChartOptions["yAxis"]> = [
    ["standing", "Standing"],
    ["scrobbles", "Scrobbles"],
];
const BELOW_TOP_X_CHOICES: Choices<ChartOptions["belowTopX"]> = [
    ["gutter", "gutter"],
    ["slide-off", "slide off"],
    ["log", "log axis"],
];
const LINE_SHAPE_CHOICES: Choices<ChartOptions["lineShape"]> = [
    ["s-curves", "S-curves"],
    ["straight", "straight"],
    ["monotone", "monotone"],
    ["catmull-rom", "Catmull-Rom"],
    ["basis", "smoothed (basis)"],
];
const LINES_DRAWN_CHOICES: Choices<ChartOptions["linesDrawn"]> = [
    ["warm-up", "30-Day warm-up"],
    ["no-warm-up", "no warm-up"],
    ["seven-days", "at least 7 Days in Top X"],
];

/** A labelled select over a setting's choices, handing back only a value it offered. */
function OptionSelect<T extends string>({
    id,
    label,
    value,
    choices,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    value: T;
    choices: Choices<T>;
    disabled?: boolean;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Label htmlFor={id}>{label}</Label>
            <NativeSelect
                id={id}
                value={value}
                disabled={disabled}
                onChange={(e) => {
                    const chosen = choices.find(([choice]) => choice === e.target.value);
                    if (chosen) onChange(chosen[0]);
                }}
            >
                {choices.map(([choice, text]) => (
                    <NativeSelectOption key={choice} value={choice}>
                        {text}
                    </NativeSelectOption>
                ))}
            </NativeSelect>
        </div>
    );
}
