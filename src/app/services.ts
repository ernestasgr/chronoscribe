import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { AppSettings } from "../settings";
import type { Ingest, IngestState } from "../ingest";
import type { Failures, FailuresState } from "./failures";
import type { Session, SessionState } from "./session";
import type { Settings } from "./settings";

/** Everything the composition root builds, handed to components through context. */
export interface Services {
    ingest: Ingest;
    settings: Settings;
    session: Session;
    failures: Failures;
    /** The clock that labels counting from now, such as the sync age, read. */
    now: () => number;
}

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
