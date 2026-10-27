import { useState } from "react";
import {
    climbers,
    climbersCut,
    dailyPlays,
    dayDate,
    dayScrobbles,
    topX,
    type Climber,
    type ClimbersMode,
    type StandingsTables,
} from "../standings";
import { useTables } from "../timeline";
import { useSettings } from "./settings";

const count = (n: number, noun: string) => `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;

export function FocusDayPanel({ username }: { username: string }) {
    const tables = useTables();
    const x = useSettings((state) => state.x);
    const mode = useSettings((state) => state.climbers);
    const update = useSettings((state) => state.update);
    const [focusDay, setFocusDay] = useState<number | undefined>(undefined);

    if (!tables) return <p role="status">Building {username}'s Standings…</p>;
    const day = Math.min(focusDay ?? tables.dayCount - 1, tables.dayCount - 1);

    return (
        <main>
            <h1>{username}</h1>
            <label>
                Focus Day{" "}
                <input
                    type="range"
                    min={0}
                    max={tables.dayCount - 1}
                    value={day}
                    onChange={(e) => setFocusDay(Number(e.target.value))}
                />
            </label>
            <label>
                X{" "}
                <input
                    type="number"
                    min={1}
                    max={100}
                    value={x}
                    onChange={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isInteger(value) && value >= 1 && value <= 100)
                            update({ x: value });
                    }}
                />
            </label>
            <label>
                Climbers{" "}
                <select
                    value={mode}
                    onChange={(e) => update({ climbers: e.target.value as ClimbersMode })}
                >
                    <option value="fold">fold long tail</option>
                    <option value="within">within Top {climbersCut(x)}</option>
                    <option value="all">all (raw)</option>
                </select>
            </label>
            <section aria-label="Focus Day">
                <h2>{dayDate(tables, day)}</h2>
                <p>{count(dayScrobbles(tables, day), "Scrobble")}</p>
                <TopX tables={tables} day={day} x={x} />
                <Climbers tables={tables} day={day} x={x} mode={mode} />
            </section>
        </main>
    );
}

function TopX({ tables, day, x }: { tables: StandingsTables; day: number; x: number }) {
    const rows = topX(tables, day, x).map((row) => ({
        ...row,
        dailyPlays: dailyPlays(tables, day, row.id),
    }));
    const most = Math.max(1, ...rows.map((row) => row.dailyPlays));

    return (
        <ol aria-label="Top X">
            {rows.map((row) => (
                <li key={row.artist}>
                    #{row.standing} {row.artist} · {row.cumulative.toLocaleString("en")}
                    <span
                        role="meter"
                        aria-label="Daily plays"
                        aria-valuenow={row.dailyPlays}
                        aria-valuemin={0}
                        aria-valuemax={most}
                        title={count(row.dailyPlays, "Daily play")}
                        style={{ display: "block", width: "100%", height: 4 }}
                    >
                        <span
                            style={{
                                display: "block",
                                height: "100%",
                                width: `${(100 * row.dailyPlays) / most}%`,
                                background: "currentColor",
                            }}
                        />
                    </span>
                </li>
            ))}
        </ol>
    );
}

function Climbers({
    tables,
    day,
    x,
    mode,
}: {
    tables: StandingsTables;
    day: number;
    x: number;
    mode: ClimbersMode;
}) {
    const { listed, folded } = climbers(tables, day, mode, x);

    return (
        <>
            <h3>Climbers</h3>
            <ClimberList label="Climbers" rows={listed} />
            {folded && (
                <details>
                    <summary>
                        {count(folded.climbers.length, "long-tail jump")} beyond #{folded.beyond} (
                        {folded.singlePlay.toLocaleString("en")} on a single play)
                    </summary>
                    <ClimberList label="Long-tail Climbers" rows={folded.climbers} />
                </details>
            )}
        </>
    );
}

function ClimberList({ label, rows }: { label: string; rows: Climber[] }) {
    return (
        <ol aria-label={label}>
            {rows.map((row) => (
                <li key={row.artist}>
                    #{row.standing} {row.artist} ↑{row.gain}
                    {row.debut && (
                        <>
                            {" "}
                            <strong>debut</strong>
                        </>
                    )}
                </li>
            ))}
        </ol>
    );
}
