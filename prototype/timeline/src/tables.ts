// PROTOTYPE: dense Day × Artist tables per "How are Standings computed and stored for every Day?".
// Runs on the main thread here (the real thing runs in a worker). No imports so node can run it too.

export type Raw = { tz: string; artists: string[]; s: number[] };

export type Tables = {
  artists: string[];
  days: string[]; // "YYYY-MM-DD"
  dayStart: number[]; // ms at local midnight-ish (noon UTC of the date; good enough for an x scale)
  A: number;
  D: number;
  cum: Int32Array; // [d*A + a]
  standing: Int32Array; // [d*A + a], 0 = unranked
  order: Int32Array; // [d*A + i] = artist at Standing i+1
  ranked: Int32Array; // [d] number of ranked Artists
  total: Int32Array; // [d] Scrobbles that Day
};

export function build(raw: Raw): Tables {
  const { artists, s, tz } = raw;
  const A = artists.length;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const n = s.length / 2;
  const dayOf = new Array<string>(n);
  for (let i = 0; i < n; i++) dayOf[i] = fmt.format(new Date(s[2 * i] * 1000));

  const days: string[] = [];
  const first = new Date(dayOf[0] + "T12:00:00Z");
  const last = new Date(fmt.format(new Date()) + "T12:00:00Z");
  for (let t = first.getTime(); t <= last.getTime(); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const D = days.length;
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const cum = new Int32Array(D * A);
  const standing = new Int32Array(D * A);
  const order = new Int32Array(D * A);
  const ranked = new Int32Array(D);
  const total = new Int32Array(D);

  const count = new Int32Array(A);
  const reached = new Float64Array(A); // uts of the Scrobble that brought the Artist to its count
  const lower = artists.map((a) => a.toLowerCase());
  let live: number[] = [];
  let i = 0;
  for (let d = 0; d < D; d++) {
    while (i < n && dayIndex.get(dayOf[i]) === d) {
      const a = s[2 * i + 1];
      if (count[a] === 0) live.push(a);
      count[a]++;
      reached[a] = s[2 * i];
      total[d]++;
      i++;
    }
    live.sort(
      (x, y) =>
        count[y] - count[x] ||
        reached[x] - reached[y] ||
        (lower[x] < lower[y] ? -1 : lower[x] > lower[y] ? 1 : 0) ||
        (artists[x] < artists[y] ? -1 : 1),
    );
    const base = d * A;
    cum.set(count, base);
    for (let r = 0; r < live.length; r++) {
      order[base + r] = live[r];
      standing[base + live[r]] = r + 1;
    }
    ranked[d] = live.length;
  }
  return { artists, days, dayStart: days.map((d) => Date.parse(d + "T00:00:00Z")), A, D, cum, standing, order, ranked, total };
}

export type Climber = {
  a: number;
  from: number; // previous Standing, or ranked(prev)+1 for a debut
  to: number;
  gain: number;
  debut: boolean;
  plays: number; // Daily plays on this Day
};

export function climbers(t: Tables, d: number): Climber[] {
  if (d === 0) return [];
  const out: Climber[] = [];
  const b = d * t.A;
  const p = (d - 1) * t.A;
  for (let r = 0; r < t.ranked[d]; r++) {
    const a = t.order[b + r];
    const prev = t.standing[p + a];
    const from = prev || t.ranked[d - 1] + 1;
    const gain = from - (r + 1);
    if (gain > 0) out.push({ a, from, to: r + 1, gain, debut: prev === 0, plays: t.cum[b + a] - t.cum[p + a] });
  }
  return out.sort((x, y) => y.gain - x.gain || x.to - y.to);
}

export const dailyPlays = (t: Tables, d: number, a: number) => t.cum[d * t.A + a] - (d ? t.cum[(d - 1) * t.A + a] : 0);
export const topX = (t: Tables, d: number, x: number) =>
  Array.from(t.order.subarray(d * t.A, d * t.A + Math.min(x, t.ranked[d])));
