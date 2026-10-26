import * as Comlink from "comlink";
import { createStore, useStore } from "zustand";
import { onScrobblesChanged } from "../ingest";
import type { StandingsTables } from "../standings";
import type { StandingsWorker } from "./standings.worker";

interface TimelineState {
  tables: StandingsTables | undefined;
}

const store = createStore<TimelineState>(() => ({ tables: undefined }));

let worker: Comlink.Remote<StandingsWorker> | undefined;
let generation = 0;
let current: { id: string; timeZone: string } | undefined;

function standingsWorker(): Comlink.Remote<StandingsWorker> {
  worker ??= Comlink.wrap<StandingsWorker>(
    new Worker(new URL("./standings.worker.ts", import.meta.url), { type: "module" }),
  );
  return worker;
}

/**
 * Builds the current Listener's tables in the worker and swaps them in, unless a newer
 * rebuild has started meanwhile.
 */
async function rebuild(listener: { id: string; timeZone: string }): Promise<void> {
  const started = ++generation;
  const now = Math.floor(Date.now() / 1000);
  const tables = await standingsWorker().build(listener.id, listener.timeZone, now);
  if (started === generation) store.setState({ tables });
}

/** Makes `listener` the one whose tables the timeline holds, rebuilding them. */
export function showListener(listener: { id: string; timeZone: string }): void {
  if (current?.id !== listener.id) store.setState({ tables: undefined });
  current = { id: listener.id, timeZone: listener.timeZone };
  void rebuild(current);
}

onScrobblesChanged((listenerId) => {
  if (current?.id === listenerId) void rebuild(current);
});

export function useTables(): StandingsTables | undefined {
  return useStore(store, (state) => state.tables);
}
