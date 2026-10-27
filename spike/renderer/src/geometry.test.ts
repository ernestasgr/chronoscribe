import { describe, expect, it } from "vitest";
import { sCurveSegments } from "./geometry";

// Standing levels by Day; undefined while unranked. Day d sits at x = 100 + spacing * d.
const scale = (spacing: number) => (day: number) => 100 + spacing * day;

describe("sCurveSegments", () => {
  it("draws a Standing that never changes as one flat run across the window", () => {
    const levels = [3, 3, 3, 3, 3];
    expect(sCurveSegments((d) => levels[d], scale(10), 0, 4)).toEqual([
      [
        [100, 3],
        [140, 3],
      ],
    ]);
  });

  it("widens a change between Days less than 14 px apart to a 14 px S-curve around their midpoint", () => {
    const levels = [3, 3, 3, 3, 1, 1, 1, 1];
    expect(sCurveSegments((d) => levels[d], scale(4), 0, 7)).toEqual([
      [
        [100, 3],
        [107, 3],
        [121, 1],
        [128, 1],
      ],
    ]);
  });

  it("spans a change between Days more than 14 px apart from one Day to the next", () => {
    const levels = [3, 3, 1, 1];
    expect(sCurveSegments((d) => levels[d], scale(40), 0, 3)).toEqual([
      [
        [100, 3],
        [140, 3],
        [180, 1],
        [220, 1],
      ],
    ]);
  });

  it("breaks the line while the Artist is unranked", () => {
    const levels = [undefined, 2, 2, undefined, 4, 4];
    expect(sCurveSegments((d) => levels[d], scale(40), 0, 5)).toEqual([
      [
        [140, 2],
        [180, 2],
      ],
      [
        [260, 4],
        [300, 4],
      ],
    ]);
  });
});
