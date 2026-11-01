import type { LastfmFailure } from "../lastfm";

/** Why the probe turned a username and API key down: no such user, a bad key, a private history, or no answer. */
export type ProbeProblem =
    | { kind: "UnknownUser" }
    | { kind: "InvalidKey" }
    | { kind: "PrivateHistory" }
    | { kind: "Unavailable"; message: string };

/** What the probe found: the username and key work together, or the problem with them. */
export type ProbeResult = { ok: true } | { ok: false; problem: ProbeProblem };

/** The last.fm error codes the probe can name: 6 no such user, 10 bad key, 17 private, 26 suspended key. */
const PROBE_PROBLEMS: Readonly<Record<number, ProbeProblem>> = {
    6: { kind: "UnknownUser" },
    10: { kind: "InvalidKey" },
    17: { kind: "PrivateHistory" },
    26: { kind: "InvalidKey" },
};

/** What a last.fm failure means for the Listener and key it was asked with. */
export const problemOf = ({ code, message }: LastfmFailure): ProbeProblem =>
    (code === undefined ? undefined : PROBE_PROBLEMS[code]) ?? { kind: "Unavailable", message };
