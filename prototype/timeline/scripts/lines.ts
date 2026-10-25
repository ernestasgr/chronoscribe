// PROTOTYPE: how many lines the "Top X on any visible Day" rule draws, by window and warm-up.
import { readFileSync } from "node:fs";
import { build } from "../src/tables.ts";
const t = build(JSON.parse(readFileSync("public/data.json", "utf8")));
const X = 10;
const count = (d0: number, d1: number, minDays = 1) => {
  const n = new Map<number, number>();
  for (let d = d0; d <= d1; d++) for (let i = 0; i < Math.min(X, t.ranked[d]); i++) { const a = t.order[d * t.A + i]; n.set(a, (n.get(a) ?? 0) + 1); }
  return [...n.values()].filter((v) => v >= minDays).length;
};
console.log("full history:", count(0, t.D - 1), "| skipping first 30 Days:", count(30, t.D - 1), "| skipping first 90:", count(90, t.D - 1));
console.log("full history, in Top X >= 7 Days:", count(0, t.D - 1, 7));
for (const span of [90, 180, 365]) {
  const xs: number[] = [];
  for (let a = 0; a + span < t.D; a += 30) xs.push(count(a, a + span));
  xs.sort((p, q) => p - q);
  console.log(`${span}-Day windows: median ${xs[xs.length >> 1]}, max ${xs.at(-1)}`);
}
