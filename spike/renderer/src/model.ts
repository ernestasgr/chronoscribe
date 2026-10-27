// SPIKE: the real Standings tables, built from the local history, and the line rules both renderers share.
import { buildStandings, dayDate, type StandingsTables, UNRANKED } from "../../../src/standings";

export const X = 10;
export const TIME_ZONE = "Europe/Vilnius";

export async function loadTables(): Promise<StandingsTables> {
  const { scrobbles } = (await (await fetch("/history.json")).json()) as {
    scrobbles: (number | string)[];
  };
  const rows = Array.from({ length: scrobbles.length / 2 }, (_, i) => ({
    uts: scrobbles[2 * i] as number,
    artist: scrobbles[2 * i + 1] as string,
  }));
  const today = Math.max(...rows.map((row) => row.uts));
  return buildStandings(rows, { timeZone: TIME_ZONE, today });
}

/** Every Artist in the Top X on any Day of the window: the density the chart really draws. */
export function drawnArtists(tables: StandingsTables, from: number, to: number): number[] {
  const artistCount = tables.artists.length;
  const drawn = new Set<number>();
  for (let day = Math.max(0, Math.floor(from)); day <= Math.min(tables.dayCount - 1, Math.ceil(to)); day++)
    for (let rank = 0; rank < X; rank++) {
      const id = tables.rankOrder[day * artistCount + rank]!;
      if (id === UNRANKED) break;
      drawn.add(id);
    }
  return [...drawn];
}

/** Where an Artist sits on the Standing axis: its Standing in the Top X, off the bottom below it, none while unranked. */
export const standingLevel =
  (tables: StandingsTables, artist: number) =>
  (day: number): number | undefined => {
    if (day >= tables.dayCount) return undefined;
    const standing = tables.standing[day * tables.artists.length + artist]!;
    if (standing === UNRANKED) return undefined;
    return Math.min(standing, X + 3);
  };

export const dateOf = (tables: StandingsTables, day: number): string =>
  dayDate(tables, Math.max(0, Math.min(tables.dayCount - 1, Math.round(day))));

const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
  "#9c755f", "#5fa2ce", "#d37295", "#8cd17d", "#b6992d", "#499894", "#86bcb6", "#e19d9a",
];
export const colorOf = (artist: number): string => PALETTE[(artist * 7919) % PALETTE.length]!;

export const MARGIN = { left: 44, right: 16, top: 16, bottom: 28 };

/** A renderer under test: moves its visible Day window through its own pan/zoom machinery and paints before returning. */
export interface Renderer {
  show(from: number, to: number): void;
  /** Lines drawn in the current window. */
  drawn(): number;
  /** The visible Day window. */
  view(): [from: number, to: number];
}
