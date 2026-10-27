import { useState, type FormEvent, type ReactNode } from "react";
import type { Job } from "../ingest";
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Input,
    Label,
    Progress,
} from "../ui";
import { Dashboard } from "./Dashboard";
import { useQueue, useServices, useSession, useSettings } from "./services";

export function App() {
    const screen = useSession((state) => state.screen);

    switch (screen.kind) {
        case "setup":
            return <Setup error={screen.error} />;
        case "importing":
            return <Importing listenerId={screen.listenerId} username={screen.username} />;
        case "dashboard":
            return <Dashboard username={screen.listener.username} />;
    }
}

/** A full-height page with one card in the middle. */
function Centered({ children }: { children: ReactNode }) {
    return (
        <main className="grid min-h-svh place-items-center bg-muted/40 p-4">
            <Card className="w-full max-w-sm">{children}</Card>
        </main>
    );
}

function Setup({ error }: { error?: string }) {
    const { session } = useServices();
    const storedKey = useSettings((settings) => settings.apiKey);
    const [username, setUsername] = useState("");
    const [apiKey, setApiKey] = useState(storedKey);

    function submit(event: FormEvent) {
        event.preventDefault();
        session.addListener(username.trim(), apiKey.trim());
    }

    return (
        <Centered>
            <CardHeader>
                <CardTitle>
                    <h1 className="text-xl">Add a Listener</h1>
                </CardTitle>
                <CardDescription>
                    Chronoscribe imports the whole history into this browser. Nothing leaves it
                    except requests to last.fm.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="username">last.fm username</Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="off"
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="api-key">API key</Label>
                        <Input
                            id="api-key"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            autoComplete="off"
                            required
                        />
                    </div>
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <Button type="submit">Import</Button>
                </form>
            </CardContent>
        </Centered>
    );
}

const formatEta = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    return seconds < 60 ? `${seconds}s left` : `${Math.ceil(seconds / 60)} min left`;
};

const progressText = ({ progress, etaMs }: Job) =>
    progress
        ? `${progress.fetched.toLocaleString("en")} / ${progress.total.toLocaleString("en")} Scrobbles` +
          (etaMs ? ` · ${formatEta(etaMs)}` : "")
        : "Starting…";

function Importing({ listenerId, username }: { listenerId: string; username: string }) {
    const job = useQueue(({ queue }) =>
        queue.findLast((queued) => queued.listenerId === listenerId),
    );
    const percent = job?.progress
        ? (100 * job.progress.fetched) / Math.max(job.progress.total, 1)
        : 0;

    return (
        <Centered>
            <CardHeader>
                <CardTitle>
                    <h1 className="text-xl">Importing {username}</h1>
                </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
                <Progress value={percent} aria-label="Import progress" />
                <p role="status" className="text-sm text-muted-foreground tabular-nums">
                    {job ? progressText(job) : "Starting…"}
                </p>
            </CardContent>
        </Centered>
    );
}
