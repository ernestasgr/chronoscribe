import * as Comlink from "comlink";
import { listenerId, openDb } from "../db";
import { buildSoundtracks, buildStandings, transferables } from "../standings";

/** Reads a Listener's Scrobbles from Dexie, closing the connection after. */
async function scrobblesOf(id: string) {
    const db = openDb();
    try {
        // The id crossed from the main thread as a plain string, so it is branded again here.
        return await db.scrobblesOf(listenerId(id));
    } finally {
        db.close();
    }
}

const api = {
    /** Builds the Listener's tables, handed back zero-copy, and their Soundtracks in `windowDays` Windows. */
    async build(id: string, timeZone: string, today: number, windowDays: number) {
        const scrobbles = await scrobblesOf(id);
        const tables = buildStandings(scrobbles, { timeZone, today });
        const soundtracks = buildSoundtracks(scrobbles, { timeZone, today, windowDays });
        return Comlink.transfer({ tables, soundtracks }, transferables(tables));
    },

    /** Picks the Listener's Soundtracks alone, for a new Window size. */
    async soundtracks(id: string, timeZone: string, today: number, windowDays: number) {
        return buildSoundtracks(await scrobblesOf(id), { timeZone, today, windowDays });
    },
};

export type StandingsWorker = typeof api;

Comlink.expose(api);
