// PROTOTYPE: how much of each Day's Climbers list is debuts / long-tail tie jumps?
import { readFileSync } from "node:fs";
import { build, climbers } from "../src/tables.ts";
const t0 = performance.now();
const t = build(JSON.parse(readFileSync("public/data.json", "utf8")));
console.log(`build ${Math.round(performance.now() - t0)} ms, D=${t.D} A=${t.A}`);
const X = 10, K = 5;
let days = 0, slots = 0, debut = 0, onePlay = 0, outsideTop = 0, outside50 = 0, top1Debut = 0, top1Tail = 0, honestTop1 = 0, any = 0;
const gains: number[] = [];
for (let d = 1; d < t.D; d++) {
  if (!t.total[d]) continue;
  const c = climbers(t, d);
  days++;
  if (!c.length) continue;
  any++;
  const top = c.slice(0, K);
  for (const x of top) { slots++; if (x.debut) debut++; if (x.plays === 1) onePlay++; if (x.to > X) outsideTop++; if (x.to > 50) outside50++; gains.push(x.gain); }
  if (top[0].debut) top1Debut++;
  if (!top[0].debut && top[0].to > 50) top1Tail++;
  if (c.some((x) => !x.debut && x.to <= X)) honestTop1++;
}
gains.sort((a, b) => a - b);
const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(0)}%`;
console.log(`active Days ${days}, with any Climber ${any}`);
console.log(`top-${K} slots ${slots}: debut ${pct(debut, slots)}, 1 Daily play ${pct(onePlay, slots)}, end outside Top ${X} ${pct(outsideTop, slots)}, end beyond #50 ${pct(outside50, slots)}`);
console.log(`#1 Climber is a debut on ${pct(top1Debut, any)} of Days; a non-debut ending beyond #50 on ${pct(top1Tail, any)}`);
console.log(`Days with at least one non-debut Climber inside Top ${X}: ${pct(honestTop1, days)}`);
console.log(`gain p50 ${gains[gains.length >> 1]}, p90 ${gains[Math.floor(gains.length * 0.9)]}, max ${gains.at(-1)}`);
