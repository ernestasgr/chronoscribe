import { useEffect, useState } from "react";
import type { UnixSeconds } from "../lastfm";
import type { Standing } from "../standings";
import { useServices } from "./services";

/** "1 Scrobble", "1,500 Scrobbles". */
export const count = (n: number, noun: string) =>
    `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;

/** A Standing as a chip or row shows it: "#3", or "unranked". */
export const standingLabel = (standing: Standing | undefined) =>
    standing === undefined ? "unranked" : `#${standing}`;

/** How often labels that count minutes refresh. */
export const MINUTE_MS = 60_000;

/** How long ago a Listener was synced, as the toolbar puts it: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function syncAge(nowMs: number, syncedAt: UnixSeconds): string {
    const minutes = Math.floor((nowMs - syncedAt * 1000) / MINUTE_MS);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** The time now from the app's clock, refreshed every `everyMs`, for labels that count from it. */
export function useNow(everyMs: number): number {
    const { now: clock } = useServices();
    const [now, setNow] = useState(clock);
    useEffect(() => {
        const timer = setInterval(() => setNow(clock()), everyMs);
        return () => clearInterval(timer);
    }, [clock, everyMs]);
    return now;
}
