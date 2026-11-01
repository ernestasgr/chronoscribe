import type { ChartMode, ChartOptions } from "../chart";
import { NeighbourCount, NEIGHBOURS, TOP_X, TopXSize, type ClimbersMode } from "../settings";
import { climbersCut } from "../standings";
import { Input, Label, Switch } from "../ui";
import { NumberSetting, OptionSelect, type Choices } from "./fields";
import { useServices } from "./services";

/**
 * The Top X size and the chart's options, each saved as soon as it is changed. While the
 * Spotlight is open, only Line shape, hiding the future and, in dynamic mode, Neighbours apply to
 * it; the rest are disabled. Neighbours apply to nothing else.
 */
export function ChartSettings({
    x,
    mode,
    options,
    showing,
}: {
    x: number;
    mode: ClimbersMode;
    options: ChartOptions;
    /** What the chart card shows: the Timeline, or the Spotlight. */
    showing: ChartMode["kind"];
}) {
    const { settings } = useServices();
    const spotlit = showing === "spotlight";
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
                    disabled={spotlit}
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
                disabled={spotlit}
                onChange={(yAxis) => settings.update({ yAxis })}
            />
            <OptionSelect
                id="below-top-x"
                label="Below the Top X"
                value={options.belowTopX}
                choices={BELOW_TOP_X_CHOICES}
                disabled={inScrobblesMode || spotlit}
                onChange={(belowTopX) => settings.update({ belowTopX })}
            />
            <OptionSelect
                id="line-shape"
                label="Line shape"
                value={options.lineShape}
                choices={LINE_SHAPE_CHOICES}
                disabled={inScrobblesMode && !spotlit}
                onChange={(lineShape) => settings.update({ lineShape })}
            />
            <OptionSelect
                id="lines-drawn"
                label="Lines drawn"
                value={options.linesDrawn}
                choices={LINES_DRAWN_CHOICES}
                disabled={spotlit}
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
            <div className="flex items-center gap-2">
                <Label htmlFor="neighbours">Neighbours</Label>
                <NumberSetting
                    id="neighbours"
                    min={NEIGHBOURS.min}
                    max={NEIGHBOURS.max}
                    step={1}
                    schema={NeighbourCount}
                    value={options.neighbours}
                    disabled={!spotlit || options.spotlightMode === "static"}
                    className="w-20"
                    onChange={(neighbours) => settings.update({ neighbours })}
                />
            </div>
        </>
    );
}

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
