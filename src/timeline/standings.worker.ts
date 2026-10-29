import * as Comlink from "comlink";
import { listenerId, openDb } from "../db";
import { buildStandings, transferables } from "../standings";

const api = {
    /** Reads the Listener's Scrobbles from Dexie and builds their tables, handed back zero-copy. */
    async build(id: string, timeZone: string, today: number) {
        const db = openDb();
        try {
            // The id crossed from the main thread as a plain string, so it is branded again here.
            const tables = buildStandings(await db.scrobblesOf(listenerId(id)), {
                timeZone,
                today,
            });
            return Comlink.transfer(tables, transferables(tables));
        } finally {
            db.close();
        }
    },
};

export type StandingsWorker = typeof api;

Comlink.expose(api);
