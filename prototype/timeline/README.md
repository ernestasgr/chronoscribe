# PROTOTYPE: timeline look and feel (throwaway)

Answers "What should the timeline look and feel like?" (ernestasgr/chronoscribe#6). Never merged.

```bash
npm install && npm run dev   # http://localhost:5199/?variant=A|B|C, ←/→ cycles variants
npm run climbers             # Climber dominance stats over the local history
```

Needs the local history dump from "Pull my history locally and measure its shape" in the main checkout's `.scratch/history/pages` (or `HISTORY_DIR`). The generated `public/data.json` is personal data and is git-ignored.

- **A Dashboard**: toolbar, chart and Focus Day sidebar, minimap pans. Artists below the Top X slide off the chart.
- **B Player**: full-bleed dark chart, video-style transport and scrubber, floating Top X card, Climbers ticker. Artists below the Top X go in a compressed gutter.
- **C Leaderboard**: Focus Day leaderboard first, chart as context with direct labels. Artists below the Top X use a log axis.

Keys: `,` `.` step a Day, space plays.
