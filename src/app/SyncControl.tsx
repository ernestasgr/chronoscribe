import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { ListenerRow } from "../db";
import { isSettled } from "../ingest";
import { Alert, AlertDescription, AlertTitle, Button } from "../ui";
import { MINUTE_MS, syncAge, useNow } from "./labels";
import { useQueue, useServices } from "./services";

/** The Sync button and the Listener's sync age, a spinner while a Sync runs, and a Retry toast if one fails. */
export function SyncControl({ listener }: { listener: ListenerRow }) {
    const { session } = useServices();
    const sync = useQueue(({ queue }) =>
        queue.findLast((job) => job.kind === "sync" && job.listenerId === listener.id),
    );
    const syncing = sync !== undefined && !isSettled(sync);
    const now = useNow(MINUTE_MS);
    const [dismissed, setDismissed] = useState<number>();

    return (
        <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={syncing} onClick={session.sync}>
                <RefreshCwIcon className={syncing ? "animate-spin" : undefined} />
                Sync
            </Button>
            {syncing ? (
                <span role="status" aria-label="Syncing" className="text-sm text-muted-foreground">
                    Syncing…
                </span>
            ) : (
                <span className="text-sm text-muted-foreground">
                    Synced {syncAge(now, listener.syncedAt)}
                </span>
            )}
            {sync?.status === "failed" && dismissed !== sync.id && (
                <Alert
                    variant="destructive"
                    className="fixed right-4 bottom-4 left-4 z-50 shadow-lg sm:left-auto sm:max-w-sm"
                >
                    <AlertTitle>Sync failed</AlertTitle>
                    <AlertDescription>
                        <p>{sync.error.message}</p>
                        <p>Nothing was changed.</p>
                        <div className="flex gap-2 pt-1">
                            <Button size="sm" onClick={session.sync}>
                                Retry
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDismissed(sync.id)}>
                                Dismiss
                            </Button>
                        </div>
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}
