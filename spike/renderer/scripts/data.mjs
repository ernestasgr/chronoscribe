// SPIKE: flattens the local history dump (.scratch/history/pages in the main checkout, or HISTORY_DIR)
// into public/history.json: { scrobbles: [uts, artist, uts, artist, ...] }.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const gitCommon = resolve(execSync("git rev-parse --git-common-dir").toString().trim());
const dir = process.env.HISTORY_DIR ?? join(dirname(gitCommon), ".scratch", "history", "pages");
const scrobbles = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => JSON.parse(readFileSync(join(dir, file), "utf8")))
  .flatMap(({ uts, artist }) => [uts, artist]);
writeFileSync("public/history.json", JSON.stringify({ scrobbles }));
console.log(`${scrobbles.length / 2} Scrobbles -> public/history.json`);
