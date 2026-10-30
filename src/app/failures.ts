import { createStore, type StoreApi } from "zustand";

/** Something the app tried and couldn't do, such as a write the browser's storage refused. */
export interface Failure {
    id: number;
    message: string;
}

export interface FailuresState {
    /** The latest failure not yet dismissed. */
    latest: Failure | undefined;
}

/** Collects the failures of work nobody awaits, so the user is told rather than nothing happening. */
export function createFailures() {
    const store: StoreApi<FailuresState> = createStore<FailuresState>(() => ({
        latest: undefined,
    }));
    const ids = { next: 1 };

    return {
        store,
        /** Records that `what` failed with `error`. */
        report: (what: string, error: unknown): void =>
            store.setState({ latest: { id: ids.next++, message: `${what}: ${String(error)}` } }),
        dismiss: (): void => store.setState({ latest: undefined }),
    };
}

export type Failures = ReturnType<typeof createFailures>;
