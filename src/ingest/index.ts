import { listenerId, type Db } from "../db";
import { getRecentTracks, type Fetch } from "../lastfm";

const PAGE_LIMIT = 1000;
/** At most 4 last.fm requests per second, app-wide. */
const MIN_REQUEST_GAP_MS = 250;

export interface IngestDeps {
  fetch: Fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface ImportProgress {
  fetched: number;
  total: number;
}

const browserDeps: IngestDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface RateLimit {
  lastRequestAt: number;
  /** Settles once the latest caller may send; each caller queues behind the one before. */
  turn: Promise<void>;
}

// Keyed by transport, so every job sharing one (the browser's) shares one rate limit.
const rateLimits = new WeakMap<IngestDeps, RateLimit>();

function throttle(deps: IngestDeps): Promise<void> {
  let limit = rateLimits.get(deps);
  if (!limit) rateLimits.set(deps, (limit = { lastRequestAt: -Infinity, turn: Promise.resolve() }));
  const state = limit;
  state.turn = state.turn.then(async () => {
    const wait = state.lastRequestAt + MIN_REQUEST_GAP_MS - deps.now();
    if (wait > 0) await deps.sleep(wait);
    state.lastRequestAt = deps.now();
  });
  return state.turn;
}

type ScrobblesChangedListener = (listenerId: string) => void;

const scrobblesChangedListeners = new Set<ScrobblesChangedListener>();

/** Calls `listener` with a Listener's id whenever ingest has committed a change to their Scrobbles. */
export function onScrobblesChanged(listener: ScrobblesChangedListener): () => void {
  scrobblesChangedListeners.add(listener);
  return () => scrobblesChangedListeners.delete(listener);
}

function emitScrobblesChanged(id: string): void {
  for (const listener of scrobblesChangedListeners) listener(id);
}

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}

/**
 * Adds a Listener and imports their whole Scrobble history, newest first, up to a `to`
 * fixed when the import starts.
 */
export async function importListener(
  db: Db,
  { username, apiKey, timeZone }: { username: string; apiKey: string; timeZone: string },
  deps: IngestDeps = browserDeps,
  { signal, onProgress }: ImportOptions = {},
): Promise<void> {
  const id = listenerId(username);
  const importTo = Math.floor(deps.now() / 1000);
  // Until imports can resume, a restarted import begins again from nothing.
  await db.deleteScrobblesOf(id);
  await db.putListener({
    id,
    username,
    timeZone,
    pinnedArtists: [],
    importTo,
    importComplete: false,
    lastViewedAt: deps.now(),
  });

  let fetched = 0;
  for (let page = 1; ; page++) {
    await throttle(deps);
    signal?.throwIfAborted();
    const result = await getRecentTracks(
      { user: username, apiKey, page, limit: PAGE_LIMIT, to: importTo, signal },
      deps.fetch,
    );
    await db.addScrobbles(result.scrobbles.map((scrobble) => ({ listenerId: id, ...scrobble })));
    fetched += result.scrobbles.length;
    onProgress?.({ fetched, total: result.total });
    if (result.scrobbles.length === 0 || page >= result.totalPages) break;
  }
  await db.updateListener(id, { importComplete: true });
  // One event for the whole import: its history is only shown once it is complete.
  emitScrobblesChanged(id);
}
