import { useState, type FormEvent, type ReactNode } from "react";
import { MAX_FAILURES, problemOf, type Job, type Retry } from "../ingest";
import type { LastfmFailure } from "../lastfm";
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
import {
    ApiKeyForm,
    describedBy,
    ProblemMessage,
    FieldProblem,
    fieldOf,
    TimeZoneSelect,
    type FieldProblemOf,
    type ProblemField,
} from "./fields";
import { useQueue, useServices, useSession, useSettings } from "./services";
import type { SetupStatus } from "./session";

export function App() {
    const screen = useSession((state) => state.screen);

    switch (screen.kind) {
        case "setup":
            return <Setup status={screen.status} />;
        case "importing":
            return <Importing listenerId={screen.listenerId} username={screen.username} />;
        case "dashboard":
            return <Dashboard listener={screen.listener} />;
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

function Setup({ status }: { status: SetupStatus }) {
    const { session } = useServices();
    const storedKey = useSettings((settings) => settings.apiKey);
    const [username, setUsername] = useState("");
    const [apiKey, setApiKey] = useState(storedKey);
    const [timeZone, setTimeZone] = useState(session.defaultTimeZone);

    function submit(event: FormEvent) {
        event.preventDefault();
        void session.addListener({ username: username.trim(), apiKey: apiKey.trim(), timeZone });
    }

    /** The problem to show under `field`, if the last attempt was turned down there. */
    const problemUnder = (field: ProblemField): FieldProblemOf | undefined =>
        status.kind === "rejected" && fieldOf(status.problem) === field
            ? { id: `${field}-problem`, problem: status.problem, username: status.username }
            : undefined;

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
                            {...describedBy(problemUnder("username"))}
                        />
                        <FieldProblem shown={problemUnder("username")} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="api-key">API key</Label>
                        <Input
                            id="api-key"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            autoComplete="off"
                            required
                            {...describedBy(problemUnder("apiKey"))}
                        />
                        <FieldProblem shown={problemUnder("apiKey")} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="time-zone">Timezone</Label>
                        <TimeZoneSelect id="time-zone" value={timeZone} onChange={setTimeZone} />
                    </div>
                    <FieldProblem shown={problemUnder("form")} />
                    <Button type="submit" disabled={status.kind === "checking"}>
                        {status.kind === "checking" ? "Checking…" : "Import"}
                    </Button>
                </form>
            </CardContent>
        </Centered>
    );
}

const seconds = (ms: number) => Math.max(Math.ceil(ms / 1000), 1);

/** "about 12 s left", or in minutes past one. */
const formatEta = (ms: number) =>
    seconds(ms) < 60
        ? `about ${seconds(ms)} s left`
        : `about ${Math.ceil(seconds(ms) / 60)} min left`;

/** What the status line says while a request is waited out before retrying. */
const retryText = ({ failures, pausesAt, inMs, error }: Retry) =>
    `${error.message} · retrying in ${seconds(inMs)} s (${failures} of ${pausesAt} failed)`;

/** The status line: "48,000 / 96,451 Scrobbles · about 12 s left", or why it is waiting. */
const progressText = ({ progress, etaMs, retry }: Job) => {
    const counted = progress
        ? `${progress.fetched.toLocaleString("en")} / ${progress.total.toLocaleString("en")} Scrobbles`
        : "Starting…";
    if (retry) return `${counted} · ${retryText(retry)}`;
    return progress && etaMs ? `${counted} · ${formatEta(etaMs)}` : counted;
};

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
                {job?.status === "paused" && job.error && (
                    <Paused error={job.error} username={username} />
                )}
            </CardContent>
        </Centered>
    );
}

/** Why the import paused, with what fixes it: waiting it out, or Settings. */
function Paused({ error, username }: { error: LastfmFailure; username: string }) {
    const { session } = useServices();
    const resume = <Button onClick={() => void session.resumeImport()}>Resume</Button>;

    if (error.kind !== "Hard")
        return (
            <div className="grid gap-3">
                <p role="alert" className="text-sm text-destructive">
                    The import paused after last.fm failed {MAX_FAILURES} times in a row:{" "}
                    {error.message}. Everything fetched so far is kept.
                </p>
                {resume}
            </div>
        );

    const problem = problemOf(error);
    return (
        <div className="grid gap-3">
            <div role="alert" className="grid gap-1 text-sm">
                <p className="text-destructive">
                    The import paused:{" "}
                    {problem.kind === "Unavailable" ? (
                        `last.fm refused it (${error.message}).`
                    ) : (
                        <ProblemMessage problem={problem} username={username} />
                    )}
                </p>
                <p className="text-muted-foreground">Fix it in Settings, then resume.</p>
            </div>
            <section aria-label="Settings" className="grid gap-3 rounded-lg border p-3">
                <h2 className="text-sm font-medium">Settings</h2>
                <ApiKeyForm id="import-api-key" username={username} />
            </section>
            {resume}
        </div>
    );
}
