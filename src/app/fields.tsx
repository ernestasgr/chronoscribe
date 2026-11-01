import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
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
    ListenerTaken: {
        field: "username",
        message: (_, username) => `${username} is already a Listener`,
    },
};

/** The form field `problem` belongs under. */
export const fieldOf = (problem: SetupProblem): ProblemField => PROBLEMS[problem.kind].field;

const messageOf = <Kind extends SetupProblem["kind"]>(
    problem: ProblemOf<Kind>,
    username: string,
): ReactNode => {
    // cast: TypeScript can't tie `problem.kind` to the entry it indexes, so it widens `message`'s parameter.
    const entry = PROBLEMS[problem.kind] as (typeof PROBLEMS)[Kind];
    return entry.message(problem, username);
};

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

/** Each choice of a setting, as its stored value and its label. */
export type Choices<T extends string> = readonly (readonly [value: T, label: string])[];

/** A labelled select over a setting's choices, handing back only a value it offered. */
export function OptionSelect<T extends string>({
    id,
    label,
    value,
    choices,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    value: T;
    choices: Choices<T>;
    disabled?: boolean;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Label htmlFor={id}>{label}</Label>
            <NativeSelect
                id={id}
                value={value}
                disabled={disabled}
                onChange={(e) => {
                    const chosen = choices.find(([choice]) => choice === e.target.value);
                    if (chosen) onChange(chosen[0]);
                }}
            >
                {choices.map(([choice, text]) => (
                    <NativeSelectOption key={choice} value={choice}>
                        {text}
                    </NativeSelectOption>
                ))}
            </NativeSelect>
        </div>
    );
}

/** A preset number of Days, by its label. */
export type DayPreset = readonly [label: string, days: number];

/** A row of preset Day counts, the one matching `value` pressed; `name` names each, if its label can't alone. */
export function DayPresets({
    presets,
    value,
    onChoose,
    name,
}: {
    presets: readonly DayPreset[];
    value: number;
    onChoose: (days: number) => void;
    name?: (label: string) => string;
}) {
    return presets.map(([label, days]) => (
        <Button
            key={label}
            variant={value === days ? "secondary" : "ghost"}
            size="xs"
            aria-label={name?.(label)}
            aria-pressed={value === days}
            onClick={() => onChoose(days)}
        >
            {label}
        </Button>
    ));
}

/**
 * A number input for a setting that keeps what is being typed, saving it only once it is valid,
 * so passing through an invalid value such as "0." on the way to "0.05" doesn't reset it.
 */
export function NumberSetting({
    id,
    label,
    value,
    min,
    max,
    step,
    schema,
    onChange,
    disabled,
    className,
}: {
    id?: string;
    label?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** The rule a typed value must pass before it is saved. */
    schema: z.ZodType<number>;
    onChange: (value: number) => void;
    disabled?: boolean;
    className?: string;
}) {
    const [draft, setDraft] = useState<string>();
    return (
        <Input
            id={id}
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            disabled={disabled}
            className={className}
            onChange={(e) => {
                setDraft(e.target.value);
                const typed = schema.safeParse(
                    e.target.value === "" ? Number.NaN : Number(e.target.value),
                );
                if (typed.success) onChange(typed.data);
            }}
            onBlur={() => setDraft(undefined)}
        />
    );
}
