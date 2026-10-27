# Coding standards

The principles and patterns every change in this codebase follows. A ticket's acceptance criteria add to these; they never replace them. When a ticket seems to need an exception, say so in the PR body so the human decides.

## Stack

- A Vite single-page app with React 19 and strict TypeScript. It runs entirely in the browser, with no server or proxy; the browser calls last.fm directly.
- Dexie (IndexedDB) for storage. Nothing goes in `localStorage`.
- Zustand for app state, TanStack Virtual for long lists. TanStack Query is not used, because there is no server state to cache.
- Heavy computation runs in a Web Worker over Comlink, passing typed arrays back zero-copy.
- The chart draws on Canvas 2D using D3 modules (`d3-scale`, `d3-shape`, `d3-zoom`, `d3-array`). React renders its axes, labels and markers.
- Tailwind and shadcn/ui for the interface.
- Vitest and Playwright for tests, oxlint and oxfmt for linting and formatting, pnpm as the package manager (pinned in `packageManager`).

## Modules

- Each module is a directory `src/<module>/` with one public surface, `index.ts`. Other modules import only through it.
- Dependencies point downward, lowest first: `events`, `ui`, `lastfm`, `db`, `ingest`, `standings`, `timeline`, `chart`, `app`. Adding a module means placing it in this order.
- Each module owns its concern: `db` is the only code that touches IndexedDB (apart from the worker's read), and `standings` (plus the chart's line loop) is the only code that reads the raw table arrays.
- `src/architecture.test.ts` enforces all of the above. Extend it whenever a new rule of this kind appears.

## Functional core, imperative shell

- Domain logic is pure functions over plain, immutable data: same input, same output, no I/O. Keep it in its own module (`standings`) or file (`chart/geometry`).
- Side effects (storage, network, timers, the DOM, workers) live in a thin shell around that core.
- Prefer `const`, expressions, and `map`/`filter`/`reduce` over loops that mutate. Hot paths are the exception: a benchmarked loop may mutate locals and typed arrays it owns, as long as it returns a fresh value and touches nothing outside itself.
- Write functions and plain objects. Classes are used only where a library requires one.

## Services and composition

- A stateful module exports a `create*` factory that takes all of its dependencies (database, event bus, transport, clock, worker) and returns a service object.
- Module scope holds only constants, types and pure functions. Mutable state lives inside a factory's closure or store, and a module does nothing when it is imported.
- `src/app/index.tsx` is the composition root: it builds every service once and wires them together.
- Components reach services through React context (`ServicesContext`, `TimelineContext`), never through imported singletons.
- Inject time and I/O (`now`, `sleep`, `fetch`) so tests can control them.

## State

- Each service keeps its state in a vanilla Zustand store created inside its factory. State is data; actions are functions on the service.
- State changes are pure reducers, `(state, input) => Partial<State>`, which the service applies with `setState`.
- Keep the store minimal and derive everything else. For example, the Focus Day is derived from the playhead rather than stored.
- Components subscribe through narrow selector hooks and change state only by calling service actions.
- Persistent state hydrates from Dexie at boot and writes back on every change.

## Events

- Services communicate through the typed bus from `src/events`. A service publishes facts named in the past tense (`scrobblesChanged`, `jobSettled`) after the change has been committed.
- Subscribers react inside their own factory. A service depends on the half of the bus it needs: `Emitter` to publish, `Subscriber` to react.
- Ongoing progress is published as store state (such as the ingest `queue`), not as a stream of events.

## Errors and async

- Expected failures are values: discriminated unions such as `{ ok: true, value } | { ok: false, error }`, so callers must handle them and the types show them.
- `throw` is reserved for programmer errors and broken invariants.
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

## Testing

- Test only through public interfaces, checking what a user or a calling module can observe: what is shown, what is stored, what is emitted. A test should survive a rewrite of the internals.
- There are three seams:
  1. **The app at its network boundary (Playwright):** the real app and real IndexedDB, with only last.fm faked, by route.
  2. **Services at their interface (Vitest):** fake transport, `fake-indexeddb`, and a fake clock and sleep.
  3. **The pure core (Vitest):** plain function tests, plus benchmarks that guard the performance budgets.
- Tests never call the real last.fm API.
- Write tests first (red, green, refactor) where the behaviour is new.

## Code style

- Make comments a single line explaining why, on exports and on anything non-obvious. Name things for what they are in the domain.
- Prefer small named helpers over long inline expressions.

## Dependencies

- Prefer the platform and the libraries already in the stack over adding a new package.
- Use releases that are at least two weeks old, and commit `pnpm-lock.yaml`.

## Git

- Write commit subjects as Conventional Commits: `type(scope): subject`.
- Rebase rather than merge.
