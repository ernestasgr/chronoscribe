import { describe, expect, test } from "vitest";
import { buildStandings, dayDate, topX } from ".";

const uts = (iso: string) => Date.parse(iso) / 1000;
const scrobble = (iso: string, artist: string) => ({ uts: uts(iso), artist });

describe("buildStandings", () => {
  const timeZone = "Europe/Vilnius"; // UTC+3 in summer
  const tables = buildStandings(
    [
      scrobble("2026-07-01T10:00:00Z", "Massive Attack"),
      scrobble("2026-07-01T11:00:00Z", "Portishead"),
      scrobble("2026-07-01T12:00:00Z", "Portishead"),
      // 22:30 UTC is already 2 July in Vilnius
      scrobble("2026-07-01T22:30:00Z", "Massive Attack"),
      scrobble("2026-07-02T09:00:00Z", "Tricky"),
    ],
    { timeZone, today: uts("2026-07-04T12:00:00Z") },
  );

  test("Days run from the first Scrobble's Day through today in the Listener's timezone", () => {
    expect(tables.dayCount).toBe(4);
    expect(tables.firstDay).toEqual({ date: "2026-07-01", timeZone });
    expect(dayDate(tables, 0)).toBe("2026-07-01");
    expect(dayDate(tables, 3)).toBe("2026-07-04");
  });

  test("Top X lists Artists by cumulative Scrobbles through the end of the Day", () => {
    expect(topX(tables, 0, 10)).toEqual([
      { artist: "Portishead", standing: 1, cumulative: 2 },
      { artist: "Massive Attack", standing: 2, cumulative: 1 },
    ]);
  });

  test("equal counts go to the Artist who reached that count first", () => {
    expect(topX(tables, 1, 10)).toEqual([
      { artist: "Portishead", standing: 1, cumulative: 2 },
      { artist: "Massive Attack", standing: 2, cumulative: 2 },
      { artist: "Tricky", standing: 3, cumulative: 1 },
    ]);
  });

  test("Top X is cut at X", () => {
    expect(topX(tables, 1, 1)).toEqual([{ artist: "Portishead", standing: 1, cumulative: 2 }]);
  });

  test("empty Days carry Standings forward", () => {
    expect(topX(tables, 3, 10)).toEqual(topX(tables, 1, 10));
  });

  test("an Artist is unranked before their first Scrobble", () => {
    expect(topX(tables, 0, 10).map((row) => row.artist)).not.toContain("Tricky");
  });
});
