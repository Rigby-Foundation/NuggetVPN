import { useCallback, useEffect, useState } from "react";

import { EVENTS, errorMessage, eventPayload, invoke, listen } from "@/lib/backend";
import { ConnectionState, ProxyMode } from "@/types";

const IDLE: ConnectionState = { status: "idle" };

/**
 * Owns the connection state.
 *
 * The state lives in Go and arrives on the `vpn-state` event; nothing here
 * guesses. That matters more than it sounds: the previous version set a local
 * `isConnected` boolean when the user clicked connect and never listened for
 * anything, so a tunnel that died — a crashed core, a dropped socket, a network
 * change — left the UI reporting a connection the user did not have.
 */
export function useConnection() {
    const [state, setState] = useState<ConnectionState>(IDLE);

    useEffect(() => {
        const unlisten = listen(EVENTS.state, (data) => {
            setState(eventPayload<ConnectionState>(data));
        });

        // Reconcile once on mount. The window can be reopened from the tray
        // long after the tunnel came up, and a dev-mode reload starts a fresh
        // renderer against a core that is already running.
        invoke<ConnectionState>("get_connection_state")
            .then(setState)
            .catch(() => setState(IDLE));

        return unlisten;
    }, []);

    const connect = useCallback(
        async (sourceDomain: string, mode: ProxyMode, profileId: string) => {
            // Show the attempt immediately: the backend may probe and try
            // several servers, which takes long enough that an unchanged button
            // reads as a dead click.
            setState({ status: "connecting" });
            try {
                setState(
                    await invoke<ConnectionState>("connect", {
                        sourceDomain,
                        mode,
                        profileId,
                    })
                );
            } catch (error) {
                setState({ status: "error", error: errorMessage(error) });
                throw error;
            }
        },
        []
    );

    const disconnect = useCallback(async () => {
        try {
            setState(await invoke<ConnectionState>("disconnect"));
        } catch (error) {
            setState({ status: "error", error: errorMessage(error) });
            throw error;
        }
    }, []);

    /** Clears a failed attempt so the button returns to its resting state. */
    const dismissError = useCallback(() => {
        setState((current) => (current.status === "error" ? IDLE : current));
    }, []);

    return {
        state,
        isConnected: state.status === "connected",
        isBusy: state.status === "connecting",
        connect,
        disconnect,
        dismissError,
    };
}
