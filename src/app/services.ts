import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ListenerId } from "../db";
import type { AppSettings } from "../settings";
import type { ArtistId, DayIndex, StandingsTables, TrackPlays } from "../standings";
import type { Ingest, IngestState } from "../ingest";
import type { Connection, ConnectionState } from "./connection";
import type { Failures, FailuresState } from "./failures";
import type { Session, SessionState } from "./session";
import type { Settings } from "./settings";
import type { SoundtrackPlayer, SoundtrackPlayerState } from "./soundtrackPlayer";

/** Everything the composition root builds, handed to components through context. */
export interface Services {
    ingest: Ingest;
    settings: Settings;
    session: Session;
    failures: Failures;
    /** The Spotify connection, or none if the build has no Spotify Client ID. */
    spotify: Connection | undefined;
    /** What plays the Soundtrack on Spotify, or none if the build has no Spotify Client ID. */
    soundtrackPlayer: SoundtrackPlayer | undefined;
    /** The clock that labels counting from now, such as the sync age, read. */
    now: () => number;
    /** An Artist's Track plays on a Day, read from the Listener's stored Scrobbles. */
    readTrackPlays: ReadTrackPlays;
}

export type ReadTrackPlays = (
    listenerId: ListenerId,
    tables: StandingsTables,
    day: DayIndex,
    artist: ArtistId,
) => Promise<TrackPlays[]>;

export const ServicesContext = createContext<Services | undefined>(undefined);

export function useServices(): Services {
    const services = useContext(ServicesContext);
    if (!services) throw new Error("useServices needs a ServicesContext above it");
    return services;
}

export const useSettings = <T>(select: (settings: AppSettings) => T): T =>
    useStore(useServices().settings.store, select);

export const useSession = <T>(select: (state: SessionState) => T): T =>
    useStore(useServices().session.store, select);

export const useFailures = <T>(select: (state: FailuresState) => T): T =>
    useStore(useServices().failures.store, select);

export const useQueue = <T>(select: (state: IngestState) => T): T =>
    useStore(useServices().ingest.store, select);

export const useConnection = <T>(
    connection: Connection,
    select: (state: ConnectionState) => T,
): T => useStore(connection.store, select);

export const useSoundtrackPlayer = <T>(
    player: SoundtrackPlayer,
    select: (state: SoundtrackPlayerState) => T,
): T => useStore(player.store, select);
