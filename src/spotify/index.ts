import type { Fetch } from "./core";
import { createSdkLoader, type CreatePlayer } from "./player";

export * from "./core";
export * from "./signIn";
export * from "./accounts";
export * from "./player";
export * from "./playback";

/** Everything the app does through Spotify and the browser around it, so tests can fake it. */
export interface SpotifyPort {
    fetch: Fetch;
    /** Sends the browser to `url`, leaving the app. */
    navigate: (url: string) => void;
    /** Shows `url` in the address bar without loading it. */
    replaceAddress: (url: string) => void;
    /** Loads the Web Playback SDK, once, and makes a player that registers this tab as a device. */
    createPlayer: CreatePlayer;
}

/** The real Spotify, reached from this browser tab. */
export function browserSpotify(): SpotifyPort {
    const sdk = createSdkLoader();
    return {
        fetch: (input, init) => fetch(input, init),
        navigate: (url) => location.assign(url),
        replaceAddress: (url) => history.replaceState(history.state, "", url),
        createPlayer: async (options) => new (await sdk()).Player(options),
    };
}
