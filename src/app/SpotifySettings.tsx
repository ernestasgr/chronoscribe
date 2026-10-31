import { Button } from "../ui";
import type { Connection, ConnectionState } from "./connection";
import { useConnection, useServices } from "./services";

/** Where the connection stands, in a line. */
const statusText = (state: ConnectionState): string => {
    switch (state.kind) {
        case "disconnected":
            return "Not connected. Turning the Soundtrack on signs you in.";
        case "signingIn":
            return "Signing in…";
        case "connected":
            switch (state.device.kind) {
                case "connecting":
                    return "Connected. Getting this tab ready to play…";
                case "ready":
                    return "Connected. This tab is ready to play.";
                case "unavailable":
                    return "Connected, but this tab can't play.";
            }
    }
};

const isConnected = (state: ConnectionState): boolean => state.kind === "connected";

const isUnavailable = (state: ConnectionState): boolean =>
    state.kind === "connected" && state.device.kind === "unavailable";

/** The Spotify connection's status and Disconnect, if the build has Spotify at all. */
export function SpotifySettings() {
    const { spotify } = useServices();
    return spotify ? <SpotifyConnection connection={spotify} /> : null;
}

function SpotifyConnection({ connection }: { connection: Connection }) {
    const status = useConnection(connection, statusText);
    const connected = useConnection(connection, isConnected);
    const unavailable = useConnection(connection, isUnavailable);
    return (
        <section aria-label="Spotify" className="grid gap-2">
            <h2 className="text-sm font-medium">Spotify</h2>
            <p role="status" className="text-sm text-muted-foreground">
                {status}
            </p>
            {connected && (
                <div className="flex flex-wrap gap-2">
                    {unavailable && (
                        <Button size="sm" variant="outline" onClick={connection.retryDevice}>
                            Retry
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void connection.disconnect()}
                    >
                        Disconnect Spotify
                    </Button>
                </div>
            )}
        </section>
    );
}
