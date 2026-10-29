import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Input, Label, NativeSelect, NativeSelectOption } from "../ui";
import { useServices, useSession, useSettings } from "./services";
import type { SetupProblem } from "./session";

const CREATE_API_KEY_URL = "https://www.last.fm/api/account/create";

/** Which form field a problem belongs under; `form` is for problems no field can fix. */
export type ProblemField = "username" | "apiKey" | "form";

type ProblemOf<Kind extends SetupProblem["kind"]> = Extract<SetupProblem, { kind: Kind }>;

/** Where each problem shows and what it tells the user, naming the Listener it was found for. */
const PROBLEMS: {
    [Kind in SetupProblem["kind"]]: {
        field: ProblemField;
        message: (problem: ProblemOf<Kind>, username: string) => ReactNode;
    };
} = {
    UnknownUser: {
        field: "username",
        message: (_, username) => `No last.fm user named ${username}`,
    },
    InvalidKey: {
        field: "apiKey",
        message: () => (
            <>
                This API key isn't valid.{" "}
                <a
                    href={CREATE_API_KEY_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                >
                    Create an API key
                </a>
            </>
        ),
    },
    PrivateHistory: {
        field: "username",
        message: (_, username) =>
            `${username}'s listening history is private. To unhide it, untick “Hide recent ` +
            `listening information” under Privacy in their last.fm settings.`,
    },
    Unavailable: {
        field: "form",
        message: ({ message }) => `last.fm couldn't check these details: ${message}`,
    },
    ImportFailed: { field: "form", message: ({ message }) => message },
    ImportCancelled: { field: "form", message: () => "Import cancelled" },
};

/** The form field `problem` belongs under. */
export const fieldOf = (problem: SetupProblem): ProblemField => PROBLEMS[problem.kind].field;

const messageOf = <Kind extends SetupProblem["kind"]>(
    problem: ProblemOf<Kind>,
    username: string,
): ReactNode => (PROBLEMS[problem.kind] as (typeof PROBLEMS)[Kind]).message(problem, username);

/** What `problem` tells the user, inline. */
export function ProblemMessage({ problem, username }: { problem: SetupProblem; username: string }) {
    return <>{messageOf(problem, username)}</>;
}

/** A field's problem, for when a field shows one: the message, and the id that describes it. */
export interface FieldProblemOf {
    id: string;
    problem: SetupProblem;
    username: string;
}

/** The ARIA attributes that tie an input to its problem, if it has one. */
export const describedBy = (shown: FieldProblemOf | undefined) =>
    shown ? { "aria-invalid": true, "aria-describedby": shown.id } : { "aria-invalid": false };

/** The message under a field; a problem with no field to sit under is announced as an alert. */
export function FieldProblem({ shown }: { shown: FieldProblemOf | undefined }) {
    if (!shown) return null;
    return (
        <p
            id={shown.id}
            role={fieldOf(shown.problem) === "form" ? "alert" : undefined}
            className="text-sm text-destructive"
        >
            {messageOf(shown.problem, shown.username)}
        </p>
    );
}

/** Every IANA timezone the browser knows, with `current` first in case it isn't listed. */
const timeZonesWith = (current: string): string[] => [
    ...new Set([current, ...Intl.supportedValuesOf("timeZone")]),
];

/** A labelled choice of IANA timezone, handing back only a timezone it offered. */
export function TimeZoneSelect({
    id,
    value,
    onChange,
}: {
    id: string;
    value: string;
    onChange: (timeZone: string) => void;
}) {
    const choices = useMemo(() => timeZonesWith(value), [value]);
    return (
        <NativeSelect
            id={id}
            value={value}
            onChange={(e) => {
                const chosen = choices.find((timeZone) => timeZone === e.target.value);
                if (chosen) onChange(chosen);
            }}
        >
            {choices.map((timeZone) => (
                <NativeSelectOption key={timeZone} value={timeZone}>
                    {timeZone}
                </NativeSelectOption>
            ))}
        </NativeSelect>
    );
}

/** The API key, probed against `username` before it is saved. */
export function ApiKeyForm({ id, username }: { id: string; username: string }) {
    const { session } = useServices();
    const storedKey = useSettings((settings) => settings.apiKey);
    const check = useSession((state) => state.apiKeyCheck);
    const [apiKey, setApiKey] = useState(storedKey);
    // A check speaks only for the key it checked, so editing the key clears its message.
    const checked = check.kind !== "idle" && check.apiKey === apiKey.trim() ? check : undefined;
    const problem: FieldProblemOf | undefined =
        checked?.kind === "rejected"
            ? { id: `${id}-problem`, problem: checked.problem, username }
            : undefined;

    function saveKey(event: FormEvent) {
        event.preventDefault();
        void session.changeApiKey(apiKey.trim());
    }

    return (
        <form onSubmit={saveKey} className="grid min-w-64 flex-1 gap-2">
            <Label htmlFor={id}>API key</Label>
            <div className="flex gap-2">
                <Input
                    id={id}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                    required
                    {...describedBy(problem)}
                />
                <Button type="submit" variant="secondary" disabled={check.kind === "checking"}>
                    {check.kind === "checking" ? "Checking…" : "Save key"}
                </Button>
            </div>
            <FieldProblem shown={problem} />
            {checked?.kind === "saved" && (
                <p role="status" className="text-sm text-muted-foreground">
                    API key saved
                </p>
            )}
        </form>
    );
}
