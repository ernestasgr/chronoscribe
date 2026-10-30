# Standings are dense day-major typed arrays

The Standings projection is three flat typed arrays indexed `day * artists + artist` (cumulative Scrobbles in 32 bits, Standing and rank order in 16 bits), plus a per-Day Daily volume. They are built in a worker and transferred to the main thread without copying. We chose this because every Focus Day query and every chart frame becomes an O(1) array read, which keeps playback at frame rate. The cost is memory proportional to Days × Artists, about 8 bytes per cell.

## Consequences

- The measured history (2,400 Days × 1,300 Artists) needs about 25 MB. A heavy, long history (5,000 Days × 20,000 Artists) would need about 800 MB, enough to crash a tab.
- 16-bit Standings cap a history at 65,534 Artists; `buildStandings` throws a `RangeError` beyond that, which the Dashboard shows as a failed build.
- Raising either ceiling means a different layout (for example sparse per-Artist runs, or tracking only Artists that ever reach a cutoff Standing). That is a rewrite of `standings` and the chart's line loop, not a tweak.
