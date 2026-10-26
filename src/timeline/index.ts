import * as Comlink from "comlink";
import { createStore, useStore } from "zustand";
import type { StandingsTables } from "../standings";
import type { StandingsWorker } from "./standings.worker";

interface TimelineState {
  tables: StandingsTables | undefined;
}

const store = createStore<TimelineState>(() => ({ tables: undefined }));

let worker: Comlink.Remote<StandingsWorker> | undefined;
let generation = 0;

function standingsWorker(): Comlink.Remote<StandingsWorker> {
  worker ??= Comlink.wrap<StandingsWorker>(
    new Worker(new URL("./standings.worker.ts", import.meta.url), { type: "module" }),
  );
  return worker;
}

/**
 * Builds the Listener's tables in the worker and swaps them in, unless a newer
 * rebuild has started meanwhile.
 */
export async function rebuild(listenerId: string, timeZone: string): Promise<void> {
  const current = ++generation;
  const tables = await standingsWorker().build(listenerId, timeZone, Math.floor(Date.now() / 1000));
  if (current === generation) store.setState({ tables });
}

export function useTables(): StandingsTables | undefined {
  return useStore(store, (state) => state.tables);
}
