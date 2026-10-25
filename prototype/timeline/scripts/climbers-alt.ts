// PROTOTYPE: candidate Climber presentations: scope cut-offs and relative gain.
import { readFileSync } from "node:fs";
import { build, climbers } from "../src/tables.ts";
const t = build(JSON.parse(readFileSync("public/data.json", "utf8")));
let active = 0;
const within: Record<number, number> = { 10: 0, 25: 0, 50: 0, 100: 0 };
let relTopInside50 = 0, relTop1Play = 0, n = 0, c25 = 0;
for (let d = 1; d < t.D; d++) {
  if (!t.total[d]) continue;
  active++;
  const c = climbers(t, d);
  for (const k of [10, 25, 50, 100]) if (c.some((x) => x.to <= k)) within[k]++;
  c25 += c.filter((x) => x.to <= 25).length;
  const rel = [...c].sort((x, y) => y.gain / x.from - x.gain / y.from);
  if (rel.length) { n++; if (rel[0].to <= 50) relTopInside50++; if (rel[0].plays === 1) relTop1Play++; }
}
const p = (x: number, of = active) => `${((100 * x) / of).toFixed(0)}%`;
console.log("Days with >=1 Climber ending within Top k:", Object.entries(within).map(([k, v]) => `${k}: ${p(v)}`).join(", "));
console.log(`mean Climbers ending within Top 25 per active Day: ${(c25 / active).toFixed(1)}`);
console.log(`rank by relative gain (gain/from): #1 ends within Top 50 on ${p(relTopInside50, n)}, #1 had 1 Daily play on ${p(relTop1Play, n)}`);
