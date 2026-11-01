import { SettingsIcon } from "lucide-react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Chart, Minimap, type ChartOptions } from "../chart";
import type { ListenerRow } from "../db";
import type { ClimbersMode } from "../settings";
import { resolvePins, type DayIndex, type PinnedArtist, type StandingsTables } from "../standings";
import { useBuild, useFocusDay, useTables, useTimeline } from "../timeline";
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Card,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Label,
    Slider,
} from "../ui";
import { ChartSettings } from "./ChartSettings";
import { ApiKeyForm, TimeZoneSelect } from "./fields";
import { FocusDayPanel } from "./FocusDayPanel";
import { LineCard } from "./LineCard";
import { ListenerMenu } from "./ListenerMenu";
import { Pins } from "./Pins";
import { Player, usePlayerKeys } from "./Player";
import { useServices, useSettings } from "./services";
import { SpotifySettings } from "./SpotifySettings";
import { SyncControl } from "./SyncControl";

/** The Dashboard: the toolbar, the chart, and the Focus Day sidebar. */
export function Dashboard({ listener }: { listener: ListenerRow }) {
    const { username } = listener;
    const tables = useTables();
    const x = useSettings((settings) => settings.x);
    const mode = useSettings((settings) => settings.climbers);
    const options = useSettings(
        useShallow(({ yAxis, belowTopX, lineShape, linesDrawn, hideFuture }): ChartOptions => ({
            yAxis,
            belowTopX,
            lineShape,
            linesDrawn,
            hideFuture,
        })),
    );
    const day = useFocusDay();
    usePlayerKeys(useTimeline());
    // Pins are resolved against each new tables object; one that no longer resolves stays hidden.
    const pins = useMemo(
        () => (tables ? resolvePins(tables, listener.pinnedArtists) : []),
        [tables, listener.pinnedArtists],
    );

    if (!tables) return <Building username={username} />;

    return (
        <main className="grid min-h-svh grid-rows-[auto_minmax(20rem,1fr)_auto] gap-4 p-4 lg:h-svh lg:grid-cols-[1fr_22rem] lg:grid-rows-[auto_1fr] 2xl:grid-cols-[1fr_34rem]">
            <Toolbar
                listener={listener}
                tables={tables}
                day={day}
                x={x}
                mode={mode}
                options={options}
                pins={pins}
            />
            <Card className="min-h-80 gap-2 overflow-hidden p-2">
                <Chart
                    tables={tables}
                    x={x}
                    options={options}
                    pins={pins}
                    renderDetails={(line) => (
                        <LineCard
                            listenerId={listener.id}
                            tables={tables}
                            artist={line.artist}
                            day={line.day}
                        />
                    )}
                />
                <Minimap tables={tables} />
            </Card>
            <FocusDayPanel tables={tables} day={day} x={x} mode={mode} />
        </main>
    );
}

/** The wait for a Listener's first tables, or why building them failed. */
function Building({ username }: { username: string }) {
    const build = useBuild();
    const { retry } = useTimeline();
    return (
        <main className="grid min-h-svh place-items-center p-4">
            {build.kind === "failed" ? (
                <Alert variant="destructive" className="max-w-md">
                    <AlertTitle>Couldn't build {username}'s Standings</AlertTitle>
                    <AlertDescription>
                        <p>{build.message}</p>
                        <Button size="sm" className="mt-1" onClick={retry}>
                            Retry
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : (
                <p role="status" className="text-sm text-muted-foreground">
                    Building {username}'s Standings…
                </p>
            )}
        </main>
    );
}

function Toolbar({
    listener,
    tables,
    day,
    x,
    mode,
    options,
    pins,
}: {
    listener: ListenerRow;
    tables: StandingsTables;
    day: DayIndex;
    x: number;
    mode: ClimbersMode;
    options: ChartOptions;
    pins: readonly PinnedArtist[];
}) {
    const { seek } = useTimeline();

    return (
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-2">
            <h1 className="text-xl font-semibold tracking-tight">
                <ListenerMenu current={listener}>{listener.username}</ListenerMenu>
            </h1>
            <SyncControl listener={listener} />
            <div className="flex min-w-48 flex-1 items-center gap-3">
                <span className="text-sm font-medium whitespace-nowrap">Focus Day</span>
                <Slider
                    aria-label="Focus Day"
                    min={0}
                    max={tables.dayCount - 1}
                    value={[day]}
                    onValueChange={([value]) =>
                        value !== undefined && seek(value, { glide: false })
                    }
                />
            </div>
            <Player />
            <Pins listener={listener} tables={tables} day={day} pins={pins} />
            <ChartSettings x={x} mode={mode} options={options} />
            <Collapsible className="contents">
                <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm">
                        <SettingsIcon />
                        Settings
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="basis-full">
                    <SettingsPanel listener={listener} />
                </CollapsibleContent>
            </Collapsible>
        </header>
    );
}

/** The API key, probed before it is saved, the Listener's timezone, and the Spotify connection. */
function SettingsPanel({ listener }: { listener: ListenerRow }) {
    const { session } = useServices();
    return (
        <Card className="flex-row flex-wrap items-start gap-x-6 gap-y-3 px-4 py-4">
            <ApiKeyForm id="settings-api-key" username={listener.username} />
            <div className="grid gap-2">
                <Label htmlFor="settings-time-zone">Timezone</Label>
                <TimeZoneSelect
                    id="settings-time-zone"
                    value={listener.timeZone}
                    onChange={(timeZone) => void session.changeTimeZone(timeZone)}
                />
            </div>
            <SpotifySettings />
        </Card>
    );
}
