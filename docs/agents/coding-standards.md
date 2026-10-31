# Coding standards

The principles and patterns every change in this codebase follows. A ticket's acceptance criteria add to these; they never replace them. When a ticket seems to need an exception, say so in the PR body so the human decides.

## Stack

- A Vite single-page app with React 19 and strict TypeScript. It runs entirely in the browser, with no server or proxy; the browser calls last.fm directly.
- Dexie (IndexedDB) for storage. Nothing goes in `localStorage`.
- Zustand for app state, TanStack Virtual for long lists. TanStack Query is not used, because there is no server state to cache.
- Zod for parsing data that crosses a boundary.
- Heavy computation runs in a Web Worker over Comlink, passing typed arrays back zero-copy.
- The chart draws on Canvas 2D using D3 modules (`d3-scale`, `d3-shape`, `d3-zoom`, `d3-selection`). React renders its axes, labels and markers.
- Tailwind and shadcn/ui for the interface.
- Vitest and Playwright for tests, oxlint and oxfmt for linting and formatting, pnpm as the package manager (pinned in `packageManager`).

## Modules

- Each module is a directory `src/<module>/` with one public surface, `index.ts`. Other modules import only through it.
- Dependencies point downward, lowest first: `events`, `ui`, `lastfm`, `settings`, `spotify`, `db`, `ingest`, `standings`, `timeline`, `chart`, `app`. Adding a module means placing it in this order.
- Each module owns its concern: `db` is the only code that touches IndexedDB (apart from the worker's read), and `standings` (plus the chart's line loop) is the only code that reads the raw table arrays.
- A concept's vocabulary (its types, options, limits and defaults) lives in the module that owns the concept, not the one that stores or draws it. `db` persists settings; `settings` defines them.
- `src/architecture.test.ts` enforces all of the above. Extend it whenever a new rule of this kind appears.

## Source of truth and projections

- Scrobbles are an append-only event log and the only source of truth for listening history.
- Everything computed from them (the Standings tables, Climbers, anything the chart draws) is a projection: rebuilt from the log on demand, never stored or edited by hand.
- Store only what cannot be derived: Scrobbles, Listener settings, Pinned Artists and app settings.

## Functional core, imperative shell

- Domain logic is pure functions over plain, immutable data: same input, same output, no I/O. Keep it in its own module (`standings`) or file (`chart/geometry`).
- Side effects (storage, network, timers, the DOM, workers) live in a thin shell around that core.
- Prefer `const`, expressions, and `map`/`filter`/`reduce` over loops that mutate. Hot paths are the exception: a benchmarked loop may mutate locals and typed arrays it owns, as long as it returns a fresh value and touches nothing outside itself.
- Write functions and plain objects. Classes are used only where a library requires one.

## Services and composition

- A stateful module exports a `create*` factory that takes all of its dependencies (database, event bus, transport, clock, worker) and returns a service object.
- Module scope holds only constants, types and pure functions. Mutable state lives inside a factory's closure or store, and a module does nothing when it is imported. The one exception is a `WeakMap` memo keyed on immutable tables, which changes no result.
- `src/app/index.tsx` is the composition root: it builds every service once and wires them together.
- Components reach services through React context (`ServicesContext`, `TimelineContext`), never through imported singletons.
- Inject time and I/O (`now`, `sleep`, `fetch`) so tests can control them.
- Two flows that follow the same protocol (throttle, fetch, retry with backoff) share one function and differ only in what they pass it, as Import and Sync share `fetchPage`.

## State

- Each service keeps its state in a vanilla Zustand store created inside its factory. State is data; actions are functions on the service.
- State changes are pure reducers, `(state, input) => Partial<State>`, which the service applies with `setState`.
- A lifecycle (a Job, the screen flow, the player) is an explicit state machine: a discriminated union of states and a pure `transition(state, event) => state` that lists every legal move; an event a state does not accept leaves it unchanged. Test the transition function directly. Plain reducers are enough; reach for XState v5 only if a chart of states gets deeply nested.
- Keep the store minimal and derive everything else. For example, the Focus Day is derived from the playhead rather than stored.
- Refer to a stored row by its id and look it up with a selector (such as `viewedListener`); never keep a copy of it in other state, which then has to be kept in step by hand.
- An optimistic update may show a change before it is stored, but never one a reload would undo: a list of stored rows loses a row only once its deletion is read back.
- Components subscribe through narrow selector hooks and change state only by calling service actions.
- Persistent state hydrates from Dexie at boot and writes back on every change.

## Events

- Services communicate through the typed bus from `src/events`. A service publishes facts named in the past tense (`scrobblesChanged`, `jobSettled`) after the change has been committed.
- Subscribers react inside their own factory. A service depends on the half of the bus it needs: `Emitter` to publish, `Subscriber` to react.
- Ongoing progress is published as store state (such as the ingest `queue`), not as a stream of events.

## Errors and async

- Expected failures are values: discriminated unions such as `{ ok: true, value } | { ok: false, error }`, so callers must handle them and the types show them.
- `throw` is reserved for programmer errors and broken invariants.
- Parse, don't validate: data crossing a boundary (last.fm responses, Dexie rows, worker messages, user input) goes through a Zod schema with `safeParse`, which yields a typed value or a failure value. Never cast it with `as`. A malformed last.fm page is a `Hard` failure, never a stored `NaN`.
- Work nobody awaits (UI handlers, event subscribers, store subscriptions) reports its failure to the app's `failures` store rather than rejecting unhandled. Write `void promise` only for a promise that cannot reject; wrap a session action that can in `guarded`.
- Async work the UI waits on keeps its status in state as a union with a failure case, such as the timeline's `build: idle | running | failed`, and the UI renders every case, failure included, with a way to retry. A spinner with no failure state is a bug.
- Long-running work accepts an `AbortSignal` and passes it down to `fetch`; cancelling is an outcome (`cancelled`), not a failure.
- A job's promise resolves to its outcome and never rejects.

## Domain language

- Name things with the terms in `GLOSSARY.md`, capitalised as they are there (Listener, Scrobble, Day, Standing, Focus Day, Climber), in code, comments, tests and UI copy alike.
- Record decisions that are hard to reverse as ADRs in `docs/adr/`.

## UI

- Style with Tailwind utility classes and compose shadcn/ui components, imported from the `ui` module (`src/ui/index.ts`). Inline `style` is only for values computed at runtime, such as chart geometry or a bar's width.
- Use a shadcn component before hand-rolling a control: run `pnpm dlx shadcn@4.22.1 add <name> -y < /dev/null`, then export it from `src/ui/index.ts`. The CLI rewrites the `cn` import to `from "cn"`: change it to `from "./utils"`, and remove any `cn` package it added.
- Colours come from the theme tokens in `src/index.css` (`bg-card`, `text-muted-foreground`, and so on), so dark mode, which follows the OS, works with no extra classes.
- Make every control accessible by role and name; the e2e tests find elements that way. Layouts work from phone width up.
- The timeline prototype's variant A sets the bar for the chart, player and Focus Day look and feel: open it (`timeline-prototype` in `.claude/launch.json`, source in `.scratch/prototype-timeline/prototype/timeline/src`) and match it unless the ticket says otherwise. `.scratch` is git-ignored, so it exists only in the main checkout.

## Testing

- Test only through public interfaces, checking what a user or a calling module can observe: what is shown, what is stored, what is emitted. A test should survive a rewrite of the internals.
- There are three seams:
  1. **The app at its network boundary (Playwright):** the real app and real IndexedDB, with only last.fm and Spotify faked, by route.
  2. **Services at their interface (Vitest):** fake transport, `fake-indexeddb`, and a fake clock and sleep.
  3. **The pure core (Vitest):** plain function tests, plus benchmarks that guard the performance budgets.
- Tests never call the real last.fm or Spotify APIs.
- Write tests first (red, green, refactor) where the behaviour is new. A bug fix starts with a test that fails without it.
- A change is done only when `pnpm check` and `pnpm e2e` pass. The pre-commit hook runs `pnpm check`; CI runs both. When a refactor breaks an e2e test, find the commit that broke it rather than changing the test to fit.
- A UI change is done only once you have used it in the running app (`app` in `.claude/launch.json`), starting from the default view a fresh import lands on, not only the state an e2e test sets up.

## Types

- Give identifiers and units that share a primitive their own branded type, for example `type DayIndex = number & { readonly brand: "DayIndex" }`. This covers Day index versus epoch day, Artist id, Standing, Unix seconds versus milliseconds, and Listener id. Values get their brand in one constructor per type, at the point they are created or parsed.
- Query functions take branded parameters: a function over Days or Artists accepts `DayIndex` and `ArtistId`, not `number`, so swapped arguments don't compile.
- Prefer discriminated unions over optional fields and boolean flags, so impossible states cannot be written down.
- Every `as` assertion is `as const`, a brand constructor, or carries a `// cast:` comment on the line above saying why the types can't express it (a library's loose typing, for example). `src/architecture.test.ts` enforces this; `any` is a lint error.
- No non-null `!` except on array and typed-array reads inside benchmarked loops. Elsewhere, handle the missing case or `throw` an error naming the broken invariant. oxlint enforces this; the files with such loops are exempted in `.oxlintrc.json`.
- Each limit or set of options is defined once, as a schema or `as const` array, and everything else reads it: the stored row's parser, the input's `min` and `max`, the select's options.

## Performance

- Work done per frame, per render or per resize costs in proportion to what is shown, never to the whole history (Days × Artists). A whole-history aggregate, such as Daily volume, is computed once when the projection is built.
- Size limits of the projection are recorded in `docs/adr/0001-dense-standings-tables.md`; a change that raises memory per Day or per Artist says so in its PR.

## Code style

- Make comments a single line explaining why, on exports and on anything non-obvious. Name things for what they are in the domain.
- Prefer small named helpers over long inline expressions.
- A file holds one feature, with the small components only it uses. One that grows past about 300 lines, or picks up a second feature, is split by feature (as `Dashboard`, `Player`, `SyncControl`, `ChartSettings` and `FocusDayPanel` are). oxlint's `max-lines` enforces the size; the files still awaiting a split are listed in `.oxlintrc.json`, and a split removes its file from that list.

## Dependencies

- Prefer the platform and the libraries already in the stack over adding a new package.
- Use releases that are at least two weeks old, and commit `pnpm-lock.yaml`.
