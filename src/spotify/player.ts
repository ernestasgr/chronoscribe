import { z } from "zod";
import { deviceId, SDK_URL, type DeviceId, type SpotifyFailure } from "./core";

/** The Web Playback SDK events the app listens to. */
export const PLAYER_EVENTS = [
    "ready",
    "not_ready",
    "initialization_error",
    "authentication_error",
    "account_error",
    "autoplay_failed",
] as const;
export type PlayerEvent = (typeof PLAYER_EVENTS)[number];

export interface PlayerOptions {
    name: string;
    /** Called by the SDK whenever it needs an access token. */
    getOAuthToken: (callback: (token: string) => void) => void;
}

/** The SDK's `Spotify.Player`, as much of it as the app uses. */
export interface WebPlayer {
    connect(): Promise<boolean>;
    disconnect(): void;
    /** Unlocks audio for the tab; called on a click, so browsers allow it to play. */
    activateElement(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    addListener(event: PlayerEvent, handler: (payload: unknown) => void): boolean;
}

export type CreatePlayer = (options: PlayerOptions) => Promise<WebPlayer>;

/** What happened to this tab's device, read from an SDK event. */
export type DeviceEvent =
    | { type: "ready"; deviceId: DeviceId }
    | { type: "notReady" }
    /** The device can't be used: the browser, the token or the account was refused. */
    | { type: "unusable"; failure: SpotifyFailure }
    /** The device works, but the browser wouldn't let it start playing. */
    | { type: "blocked"; failure: SpotifyFailure };

const DeviceReady = z.object({ device_id: z.string().min(1) });
const SdkError = z.object({ message: z.string() });

const messageOf = (payload: unknown): string => {
    const parsed = SdkError.safeParse(payload);
    return parsed.success ? parsed.data.message : "No message";
};

/** Reads an SDK event; a `ready` without a device id reads as not ready. */
export function deviceEventOf(event: PlayerEvent, payload: unknown): DeviceEvent {
    switch (event) {
        case "ready": {
            const ready = DeviceReady.safeParse(payload);
            return ready.success
                ? { type: "ready", deviceId: deviceId(ready.data.device_id) }
                : { type: "notReady" };
        }
        case "not_ready":
            return { type: "notReady" };
        case "initialization_error":
            return {
                type: "unusable",
                failure: { kind: "Unsupported", message: messageOf(payload) },
            };
        case "authentication_error":
            return {
                type: "unusable",
                failure: { kind: "SignInRefused", message: messageOf(payload) },
            };
        case "account_error":
            return { type: "unusable", failure: { kind: "PremiumRequired" } };
        case "autoplay_failed":
            return { type: "blocked", failure: { kind: "AutoplayBlocked" } };
    }
}

declare global {
    interface Window {
        Spotify?: { Player: new (options: PlayerOptions) => WebPlayer };
        onSpotifyWebPlaybackSDKReady?: () => void;
    }
}

type Sdk = NonNullable<Window["Spotify"]>;

/** Adds the SDK's script to the page; it calls `onSpotifyWebPlaybackSDKReady` once it has loaded. */
const loadSdk = (): Promise<Sdk> =>
    new Promise((resolve, reject) => {
        window.onSpotifyWebPlaybackSDKReady = () =>
            window.Spotify ? resolve(window.Spotify) : reject(new Error("No Spotify SDK"));
        const script = document.createElement("script");
        script.src = SDK_URL;
        script.async = true;
        script.addEventListener("error", () => reject(new Error("Couldn't load the Spotify SDK")));
        document.head.append(script);
    });

/** The SDK's `Spotify.Player`, loading its script the first time it is asked for. */
export function createSdkLoader(): () => Promise<Sdk> {
    const loading: { sdk?: Promise<Sdk> } = {};
    return () => {
        loading.sdk ??= loadSdk().catch((error: unknown) => {
            loading.sdk = undefined;
            throw error;
        });
        return loading.sdk;
    };
}
