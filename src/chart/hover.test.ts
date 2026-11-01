import { scaleLinear } from "d3-scale";
import { describe, expect, test } from "vitest";
import { artistId, buildStandings, dayIndex, type StandingsTables } from "../standings";
import {
    hoverTransition,
    lineAt,
    NOT_HOVERING,
    type HitFrame,
    type HoveredLine,
    type HoverEvent,
    type HoverState,
} from "./hover";
import { standingLevel } from "./geometry";
import { linesGeometry, type LinesScale } from "./lines";

const uts = (iso: string) => Date.parse(iso) / 1000;
const scrobble = (iso: string, artist: string) => ({ uts: uts(iso), artist });
const timeZone = "UTC";
const today = uts("2026-07-03T12:00:00Z");
const idOf = (tables: StandingsTables, name: string) => artistId(tables.artists.indexOf(name));

/** Days 0, 1 and 2 at 0, 50 and 100 px, on a plot 100 px square. */
const plot = { left: 0, right: 100, top: 0, bottom: 100 };
const dayX = scaleLinear().domain([0, 2]).range([0, 100]);

/** The frame a chart would hit-test, its lines drawn as `scale` asks, up to `right` px. */
function frameOf(tables: StandingsTables, scale: LinesScale, right = plot.right): HitFrame {
    const artists = tables.artists.map((_, i) => artistId(i));
    const geometry = linesGeometry({ tables, artists, dayX, scale, from: 0, to: 2 });
    return { tables, geometry, scale, dayX, plot, right };
}

describe("lineAt", () => {
    // On every Day: Massive Attack #1, Portishead #2, Tricky #3.
    const tables = buildStandings(
        [
            ...["09", "10", "11"].map((h) => scrobble(`2026-07-01T${h}:00:00Z`, "Massive Attack")),
            ...["12", "13"].map((h) => scrobble(`2026-07-01T${h}:00:00Z`, "Portishead")),
            scrobble("2026-07-01T14:00:00Z", "Tricky"),
        ],
        { timeZone, today },
    );
    // With X = 3, Standings #1, #2 and #3 sit at about 17, 50 and 83 px.
    const standing: LinesScale = {
        yAxis: "standing",
        shape: "straight",
        standingY: (rank) =>
            scaleLinear().domain([0, 1]).range([0, 100])(
                standingLevel(rank, 3, tables.artists.length, "slide-off"),
            ),
    };
    const frame = frameOf(tables, standing);

    test("finds the line nearest the pointer and the Day nearest it, its dot on that Day", () => {
        expect(lineAt(frame, [48, 54])).toEqual({
            artist: idOf(tables, "Portishead"),
            day: dayIndex(1),
            x: 50,
            y: 50,
        });
    });

    test("finds nothing more than 8 px from every line", () => {
        expect(lineAt(frame, [48, 66])).toBeUndefined();
        expect(lineAt(frame, [48, 59])).toBeUndefined();
        expect(lineAt(frame, [48, 58])?.artist).toBe(idOf(tables, "Portishead"));
    });

    test("finds nothing outside the plot", () => {
        expect(lineAt(frame, [-5, 50])).toBeUndefined();
        expect(lineAt(frame, [105, 50])).toBeUndefined();
    });

    test("finds nothing past the lines' right end, as when the future is hidden", () => {
        const hidden = frameOf(tables, standing, 40);
        expect(lineAt(hidden, [48, 50])).toBeUndefined();
        // Nearer Day 1, which is hidden, so the dot goes on Day 0.
        expect(lineAt(hidden, [30, 50])).toMatchObject({ day: dayIndex(0), x: 0 });
    });

    test("gives lines the pointer is equally near to the better Standing", () => {
        // Portishead appears first, but Massive Attack reaches 2 Scrobbles first and so ranks #1.
        const tied = buildStandings(
            [
                scrobble("2026-07-01T09:00:00Z", "Portishead"),
                scrobble("2026-07-01T09:10:00Z", "Massive Attack"),
                scrobble("2026-07-01T09:20:00Z", "Massive Attack"),
                scrobble("2026-07-01T09:30:00Z", "Portishead"),
            ],
            { timeZone, today },
        );
        const scrobbles: LinesScale = {
            yAxis: "scrobbles",
            scrobblesY: scaleLinear().domain([0, 4]).range([100, 0]),
        };
        expect(lineAt(frameOf(tied, scrobbles), [50, 50])?.artist).toBe(
            idOf(tied, "Massive Attack"),
        );
    });
});

const line = (artist: number, day: number): HoveredLine => ({
    artist: artistId(artist),
    day: dayIndex(day),
    x: day * 10,
    y: 0,
});
const run = (state: HoverState, ...events: HoverEvent[]) => events.reduce(hoverTransition, state);
const pointed = (hovered: HoveredLine | undefined): HoverEvent => ({
    type: "pointed",
    line: hovered,
});

describe("hoverTransition", () => {
    test("pointing at a line opens its card, and another line or Day replaces it", () => {
        expect(run(NOT_HOVERING, pointed(line(1, 2)))).toEqual({
            kind: "onLine",
            line: line(1, 2),
        });
        expect(run(NOT_HOVERING, pointed(line(1, 2)), pointed(line(1, 3)))).toEqual({
            kind: "onLine",
            line: line(1, 3),
        });
    });

    test("leaving the line keeps the card through a grace period, then closes it", () => {
        const leaving = run(NOT_HOVERING, pointed(line(1, 2)), pointed(undefined));
        expect(leaving).toEqual({ kind: "leaving", line: line(1, 2) });
        expect(run(leaving, { type: "graceEnded" })).toEqual(NOT_HOVERING);
    });

    test("reaching the card in the grace period keeps it open until the pointer leaves it", () => {
        const onCard = run(
            NOT_HOVERING,
            pointed(line(1, 2)),
            pointed(undefined),
            { type: "cardEntered" },
            // The chart under the card may still report nothing hovered; the card stays.
            pointed(undefined),
            { type: "graceEnded" },
        );
        expect(onCard).toEqual({ kind: "onCard", line: line(1, 2) });
        expect(run(onCard, { type: "cardLeft" })).toEqual({ kind: "leaving", line: line(1, 2) });
        expect(run(onCard, { type: "cardLeft" }, { type: "graceEnded" })).toEqual(NOT_HOVERING);
    });

    test("coming back to the line in the grace period keeps the card open", () => {
        const back = run(
            NOT_HOVERING,
            pointed(line(1, 2)),
            pointed(undefined),
            pointed(line(1, 2)),
        );
        expect(run(back, { type: "graceEnded" })).toEqual({ kind: "onLine", line: line(1, 2) });
    });

    test("dismissing closes the card whatever the pointer is doing", () => {
        const onCard = run(NOT_HOVERING, pointed(line(1, 2)), { type: "cardEntered" });
        expect(run(onCard, { type: "dismissed" })).toEqual(NOT_HOVERING);
        expect(run(NOT_HOVERING, { type: "cardEntered" })).toEqual(NOT_HOVERING);
    });
});
