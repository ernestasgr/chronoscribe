import type { ListenerId } from "../db";
import type { LastfmFailure } from "../lastfm";

/** How many recent page times the ETA averages. */
const ETA_WINDOW = 5;

/** How far a job has got: nothing counted before its first page, then a count with the time left. */
export type JobProgress =
    | { kind: "uncounted" }
    | {
          kind: "counted";
          fetched: number;
          total: number;
          /** Milliseconds left, from a moving average of recent page times. */
          etaMs: number;
      };

/**
 * How a job settled: `paused` keeps what an import fetched and waits to be resumed; `failed` is a
 * Sync that changed nothing, or a bug.
 */
export type Outcome =
    | { status: "paused"; error: LastfmFailure }
    | { status: "done" }
    | { status: "failed"; error: LastfmFailure }
    | { status: "cancelled" };

/** Where a job is in its lifecycle, each status carrying only what it can have. */
export type JobState =
    | { status: "queued" }
    | { status: "running" }
    | { status: "retrying"; retry: Retry }
    | Outcome;

export type JobStatus = JobState["status"];

/** An Import fetches a whole history; a Sync fetches its recent window again. */
export const JOB_KINDS = ["import", "sync"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Who a job is for and how far it has got, whatever its state. */
interface JobBase {
    id: number;
    kind: JobKind;
    listenerId: ListenerId;
    username: string;
    progress: JobProgress;
}

export type Job = JobBase & JobState;

/** Everything that moves a job along, from its own run. */
export type JobEvent =
    | { type: "started" }
    | { type: "counted"; fetched: number; total: number; etaMs: number }
    | { type: "retrying"; retry: Retry }
    | { type: "settled"; outcome: Outcome };

/** A job without what its state carries, ready for its next state. */
const baseOf = (job: Job): JobBase => ({
    id: job.id,
    kind: job.kind,
    listenerId: job.listenerId,
    username: job.username,
    progress: job.progress,
});

/** The job after `event`; an event the current state doesn't accept leaves it unchanged. */
export function transition(job: Job, event: JobEvent): Job {
    switch (job.status) {
        case "queued":
            if (event.type === "started") return { ...baseOf(job), status: "running" };
            return event.type === "settled" && event.outcome.status === "cancelled"
                ? { ...baseOf(job), ...event.outcome }
                : job;
        case "running":
        case "retrying":
            switch (event.type) {
                case "started":
                    return job;
                case "counted": {
                    const { type: _type, ...counted } = event;
                    return {
                        ...baseOf(job),
                        progress: { kind: "counted", ...counted },
                        status: "running",
                    };
                }
                case "retrying":
                    return { ...baseOf(job), status: "retrying", retry: event.retry };
                case "settled":
                    return { ...baseOf(job), ...event.outcome };
            }
        default:
            return job;
    }
}

/** Transient failures being waited out: `failures` in a row, pausing at `pausesAt`, retrying in `inMs`. */
export interface Retry {
    failures: number;
    pausesAt: number;
    inMs: number;
    error: LastfmFailure;
}

export interface IngestEvents {
    /** Ingest has committed a change to a Listener's Scrobbles. */
    scrobblesChanged: { listenerId: ListenerId };
    /** A job has finished, paused, failed or been cancelled. */
    jobSettled: { job: Job };
}

const SETTLED: ReadonlySet<JobStatus> = new Set<Outcome["status"]>([
    "paused",
    "done",
    "failed",
    "cancelled",
]);

/** Whether a job has stopped running; a paused import resumes as a new job. */
export const isSettled = ({ status }: Job): boolean => SETTLED.has(status);

const average = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

/** The ETA after a page: the mean of the last few page times, once per page still to fetch. */
export const etaMs = (pageTimes: readonly number[], pagesLeft: number): number =>
    Math.round(average(pageTimes.slice(-ETA_WINDOW)) * Math.max(pagesLeft, 0));

/** How a job ends on a failed page: cancelled if its signal stopped it, else as `outcome` says. */
export const stoppedBy = (
    error: LastfmFailure,
    outcome: (error: LastfmFailure) => Outcome,
): Outcome => (error.kind === "Aborted" ? { status: "cancelled" } : outcome(error));
