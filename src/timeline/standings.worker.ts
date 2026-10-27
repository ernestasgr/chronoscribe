import * as Comlink from "comlink";
import { openDb } from "../db";
import { buildStandings, transferables } from "../standings";

const api = {
    /** Reads the Listener's Scrobbles from Dexie and builds their tables, handed back zero-copy. */
    async build(listenerId: string, timeZone: string, today: number) {
        const db = openDb();
        try {
            const tables = buildStandings(await db.scrobblesOf(listenerId), { timeZone, today });
            return Comlink.transfer(tables, transferables(tables));
        } finally {
            db.close();
        }
    },
};

export type StandingsWorker = typeof api;

Comlink.expose(api);
