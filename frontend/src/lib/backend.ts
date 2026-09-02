/**
 * Bridge between the React app and the Wails v3 runtime.
 *
 * Calls go through `Call.ByName` rather than the generated bindings in
 * `frontend/bindings/`, which keeps `bun run build` working on its own without
 * a binding-generation step. `TestBridgeCommandTableMatchesApp` in the Go test
 * suite fails if a name here stops matching a method on App, and
 * `TestBoundMethodsAreReachable` fails if a Go method is left unwired.
 */
import { Call, Events } from "@wailsio/runtime";

/**
 * Fully qualified name of the bound service: `<package path>.<type>`.
 * It must match the Go module path in go.mod.
 */
const SERVICE = "github.com/Rigby-Foundation/NuggetVPN.App";

/**
 * Maps the command names the UI uses onto Go methods. Wails passes arguments
 * positionally, so each entry records the order to read them out of the object
 * the caller passes.
 */
const COMMANDS: Record<string, { method: string; args: string[] }> = {
    get_profiles: { method: "GetProfiles", args: [] },
    add_profile: { method: "AddProfile", args: ["name", "link"] },
    delete_profile: { method: "DeleteProfile", args: ["id"] },
    delete_profiles_by_source: { method: "DeleteProfilesBySource", args: ["sourceDomain"] },
    delete_profiles_by_ids: { method: "DeleteProfilesByIds", args: ["ids"] },

    get_settings: { method: "GetSettings", args: [] },
    save_settings: { method: "SaveSettings", args: ["settings"] },

    connect: { method: "Connect", args: ["sourceDomain", "mode", "profileId"] },
    disconnect: { method: "Disconnect", args: [] },
    get_connection_state: { method: "GetConnectionState", args: [] },
    get_traffic: { method: "GetTraffic", args: [] },
    check_ip: { method: "CheckIP", args: [] },

    ping_profiles: { method: "PingProfiles", args: ["sourceDomain"] },
    probe_profiles_connectivity: {
        method: "ProbeProfilesConnectivity",
        args: ["sourceDomain", "profileIds", "timeoutMs"],
    },

    import_subscription: { method: "ImportSubscription", args: ["url"] },
    refresh_subscriptions_on_startup: { method: "RefreshSubscriptionsOnStartup", args: [] },
    refresh_subscription_by_domain: { method: "RefreshSubscriptionByDomain", args: ["sourceDomain"] },

    login_user: { method: "LoginUser", args: ["server", "username", "password"] },
    register_user: { method: "RegisterUser", args: ["server", "username", "password"] },
    push_profiles_to_server: { method: "PushProfilesToServer", args: ["settings"] },
    pull_profiles_from_server: { method: "PullProfilesFromServer", args: ["settings"] },

    get_current_platform: { method: "GetCurrentPlatform", args: [] },
    open_logs_folder: { method: "OpenLogsFolder", args: [] },
    select_applications: { method: "SelectApplications", args: [] },
    show_save_dialog: { method: "ShowSaveDialog", args: ["defaultFilename"] },
    write_text_file: { method: "WriteTextFile", args: ["path", "contents"] },

    request_close: { method: "RequestClose", args: [] },
    quit_app: { method: "QuitApp", args: [] },
    minimise_window: { method: "MinimiseWindow", args: [] },
    toggle_maximise_window: { method: "ToggleMaximiseWindow", args: [] },
    show_window: { method: "ShowWindow", args: [] },
};

/** Calls a Go method by its command name. */
export async function invoke<T = unknown>(
    command: string,
    args: Record<string, unknown> = {}
): Promise<T> {
    const entry = COMMANDS[command];
    if (!entry) {
        throw new Error(`Unknown backend command: ${command}`);
    }
    const positional = entry.args.map((name) => args[name]);
    return (await Call.ByName(`${SERVICE}.${entry.method}`, ...positional)) as T;
}

export type UnlistenFn = () => void;

/** Subscribes to a backend event. */
export function listen<T = unknown>(
    event: string,
    handler: (payload: T) => void
): UnlistenFn {
    return Events.On(event, (wailsEvent: { data: unknown }) => {
        handler(wailsEvent.data as T);
    });
}

/**
 * Wails delivers an event's arguments as an array when the Go side emitted more
 * than one, and as the bare value when it emitted one. Every emit in app.go
 * sends a single payload, so unwrap the one-element case.
 */
export function eventPayload<T>(data: unknown): T {
    if (Array.isArray(data) && data.length === 1) {
        return data[0] as T;
    }
    return data as T;
}

/** Names of the events the backend pushes. */
export const EVENTS = {
    log: "vpn-log",
    state: "vpn-state",
    traffic: "vpn-traffic",
} as const;

/** Window chrome controls used by the custom title bar. */
export const appWindow = {
    /** Hides the window; the tray icon is how the user brings it back. */
    close: () => invoke("request_close"),
    minimize: () => invoke("minimise_window"),
    toggleMaximize: () => invoke("toggle_maximise_window"),
    show: () => invoke("show_window"),
};

/** Quits the application entirely, stopping the tunnel. */
export function quitApp(): Promise<unknown> {
    return invoke("quit_app");
}

interface SaveDialogOptions {
    defaultPath?: string;
}

/** Native save dialog; resolves to null when the user cancels. */
export async function save(options: SaveDialogOptions = {}): Promise<string | null> {
    const path = await invoke<string>("show_save_dialog", {
        defaultFilename: options.defaultPath ?? "",
    });
    return path ? path : null;
}

/** Writes text to a path returned by {@link save}. */
export async function writeTextFile(path: string, contents: string): Promise<void> {
    await invoke("write_text_file", { path, contents });
}

/** Native picker for the split-tunnelling application list. */
export async function openApplications(): Promise<string[]> {
    const selected = await invoke<string[] | null>("select_applications");
    return selected ?? [];
}

/** Turns a rejected backend call into something worth showing a user. */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    const text = String(error ?? "").trim();
    return text || "Something went wrong.";
}

/** The command table, exported so the Go test suite can check it for drift. */
export const BACKEND_COMMANDS = COMMANDS;
