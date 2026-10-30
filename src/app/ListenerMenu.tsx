import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ListenerId, ListenerRow } from "../db";
import { isSettled, type Job } from "../ingest";
import type { UnixSeconds } from "../lastfm";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../ui";
import { count, MINUTE_MS, syncAge, useNow } from "./labels";
import { useQueue, useServices, useSession } from "./services";

/** One Listener as the menu lists them: finished, with how long since their Sync, or still importing. */
type ListenerEntry = { id: ListenerId; username: string } & (
    | { kind: "finished"; syncedAt: UnixSeconds; syncing: boolean }
    | { kind: "importing"; job: Job | undefined }
);

/** The Listener in view, on a dashboard or an import's screen. */
export interface CurrentListener {
    id: ListenerId;
    username: string;
}

const latestJob = (queue: readonly Job[], id: ListenerId, kind: Job["kind"]) =>
    queue.findLast((job) => job.listenerId === id && job.kind === kind);

/** Every stored Listener, and every new one whose import is queued before their row is stored, by name. */
function listenerEntries(
    listeners: readonly ListenerRow[],
    queue: readonly Job[],
): ListenerEntry[] {
    const stored = listeners.map((listener): ListenerEntry => {
        const { id, username } = listener;
        if (!listener.importComplete)
            return { id, username, kind: "importing", job: latestJob(queue, id, "import") };
        const sync = latestJob(queue, id, "sync");
        return {
            id,
            username,
            kind: "finished",
            syncedAt: listener.syncedAt,
            syncing: sync !== undefined && !isSettled(sync),
        };
    });
    const queuedOnly = queue
        .filter((job) => job.kind === "import" && !isSettled(job))
        .filter((job) => !listeners.some((listener) => listener.id === job.listenerId))
        .map((job): ListenerEntry => ({
            id: job.listenerId,
            username: job.username,
            kind: "importing",
            job,
        }));
    return [...stored, ...queuedOnly].toSorted((a, b) => a.username.localeCompare(b.username));
}

/** Where an unfinished import is: "Import queued", "Importing 1,000 / 1,500", "Import paused". */
function importText(job: Job | undefined): string {
    switch (job?.status) {
        case "queued":
            return "Import queued";
        case "running":
        case "retrying":
            return job.progress.kind === "counted"
                ? `Importing ${job.progress.fetched.toLocaleString("en")} / ${job.progress.total.toLocaleString("en")}`
                : "Importing…";
        case "paused":
            return "Import paused";
        default:
            return "Import unfinished";
    }
}

const entryText = (entry: ListenerEntry, now: number): string => {
    if (entry.kind === "importing") return importText(entry.job);
    return entry.syncing ? "Syncing…" : `Synced ${syncAge(now, entry.syncedAt)}`;
};

/** The Listener menu, labelled `children`: every Listener's sync age or import, to switch, add or remove. */
export function ListenerMenu({
    current,
    children,
}: {
    current: CurrentListener;
    children: ReactNode;
}) {
    const { session } = useServices();
    const listeners = useSession((state) => state.listeners);
    const queue = useQueue((state) => state.queue);
    const entries = useMemo(() => listenerEntries(listeners, queue), [listeners, queue]);
    const now = useNow(MINUTE_MS);
    const [removing, setRemoving] = useState(false);

    const openEntry = (value: string) => {
        const entry = entries.find(({ id }) => id === value);
        if (entry && entry.id !== current.id) void session.open(entry.id);
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-auto px-2 py-1 text-[length:inherit]">
                        {children}
                        <ChevronDownIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel>Listeners</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={current.id} onValueChange={openEntry}>
                        {entries.map((entry) => (
                            <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                                <span className="grid">
                                    <span className="font-medium">{entry.username}</span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                        {entryText(entry, now)}
                                    </span>
                                </span>
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={session.startAdding}>
                        <PlusIcon />
                        Add Listener…
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
                        <Trash2Icon />
                        Remove…
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <RemoveDialog listener={current} open={removing} onOpenChange={setRemoving} />
        </>
    );
}

/** "Delete N Scrobbles for X?", counted from what is stored when it opens. */
function RemoveDialog({
    listener,
    open,
    onOpenChange,
}: {
    listener: CurrentListener;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { session } = useServices();
    const [scrobbles, setScrobbles] = useState<{ id: ListenerId; count: number }>();

    useEffect(() => {
        if (!open) return;
        let current = true;
        void session.scrobbleCount(listener.id).then((n) => {
            if (current && n !== undefined) setScrobbles({ id: listener.id, count: n });
        });
        return () => {
            current = false;
        };
    }, [open, listener.id, session]);

    const counted = scrobbles?.id === listener.id ? scrobbles.count : undefined;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {counted === undefined
                            ? `Delete the Scrobbles for ${listener.username}?`
                            : `Delete ${count(counted, "Scrobble")} for ${listener.username}?`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {listener.username} and everything imported for them will be removed from
                        this browser. Their last.fm account isn't touched.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={counted === undefined}
                        onClick={() => void session.removeListener(listener.id)}
                    >
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
