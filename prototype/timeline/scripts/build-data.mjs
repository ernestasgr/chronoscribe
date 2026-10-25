// PROTOTYPE: flattens the local history dump (from "Pull my history locally and measure its shape")
// into public/data.json: { tz, artists: string[], s: [uts, artistIdx, uts, artistIdx, ...] } sorted by time.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const gitCommon = resolve(execSync("git rev-parse --git-common-dir").toString().trim());
const dir = process.env.HISTORY_DIR ?? join(dirname(gitCommon), ".scratch", "history", "pages");
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  for (const t of JSON.parse(readFileSync(join(dir, f), "utf8"))) rows.push([t.uts, t.artist]);
}
rows.sort((a, b) => a[0] - b[0]);
const idx = new Map();
const artists = [];
const s = [];
for (const [uts, name] of rows) {
  if (!idx.has(name)) idx.set(name, artists.push(name) - 1);
  s.push(uts, idx.get(name));
}
writeFileSync("public/data.json", JSON.stringify({ tz: "Europe/Vilnius", artists, s }));
console.log(`${rows.length} scrobbles, ${artists.length} artists -> public/data.json`);
