// SPIKE: Standing-mode line geometry shared by both renderers.

export type Point = [x: number, y: number];

/** The narrowest S-curve a change of Standing is drawn with: adjacent Days are often < 1 px apart. */
export const MIN_CURVE_PX = 14;

/**
 * One Artist's line over Days `from`..`to` as runs of points: consecutive points at the same level
 * are a flat run, at different levels an S-curve (draw with a bump-x curve). Changes are kept as
 * change points only, each at least `MIN_CURVE_PX` wide around the midpoint between its two Days.
 * The line breaks wherever `level` is undefined.
 */
export function sCurveSegments(
  level: (day: number) => number | undefined,
  x: (day: number) => number,
  from: number,
  to: number,
): Point[][] {
  const segments: Point[][] = [];
  let run: Point[] = [];
  let held: { day: number; level: number } | undefined;

  const close = () => {
    if (held && x(held.day) > run.at(-1)![0]) run.push([x(held.day), held.level]);
    if (run.length > 0) segments.push(run);
    run = [];
    held = undefined;
  };

  for (let day = Math.max(0, Math.floor(from)); day <= Math.ceil(to); day++) {
    const current = level(day);
    if (current === undefined) {
      close();
      continue;
    }
    if (!held) run.push([x(day), current]);
    else if (current !== held.level) {
      const before = x(day - 1);
      const after = x(day);
      const mid = (before + after) / 2;
      const half = Math.max((after - before) / 2, MIN_CURVE_PX / 2);
      const last = run.at(-1)!;
      // Overlapping transitions: curve straight on from the previous one.
      if (mid - half > last[0]) run.push([mid - half, held.level]);
      else if (run.length > 1) run.pop();
      run.push([mid + half, current]);
    }
    held = { day, level: current };
  }
  close();
  return segments;
}
