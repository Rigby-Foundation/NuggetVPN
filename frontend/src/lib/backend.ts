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
 *
 * Wails builds this from `reflect.Type.PkgPath()`. `TestServiceFQNMatchesGo`
 * derives the same value by reflection and fails if this constant drifts, so
 * it is checked rather than assumed.
 *
 * That check only became possible once App moved out of package main. A type
 * declared there reports its path as the literal `"main"` in the shipped
 * binary but as the full import path inside a Go test binary — so no test
 * could observe the name the app actually uses, and a wrong constant shipped
 * with every call failing on "unknown bound method name" while the suite
 * stayed green.
 */
const SERVICE = "github.com/Rigby-Foundation/NuggetVPN/internal/app.App";

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
    set_favorites: { method: "SetFavorites", args: ["ids", "favorite"] },
    share_links: { method: "ShareLinks", args: ["ids"] },
    update_profile: { method: "UpdateProfile", args: ["id", "name", "configLink"] },
    update_subscription_url: { method: "UpdateSubscriptionURL", args: ["domain", "newURL"] },
    export_configs: { method: "ExportConfigs", args: ["ids", "format", "full"] },

    get_settings: { method: "GetSettings", args: [] },
    save_settings: { method: "SaveSettings", args: ["settings"] },
    regenerate_hwid: { method: "RegenerateHWID", args: [] },

    import_geo_file: { method: "ImportGeoFile", args: [] },
    download_geo_file: { method: "DownloadGeoFile", args: ["url"] },
    remove_geo_file: { method: "RemoveGeoFile", args: ["kind"] },
    get_geo_codes: { method: "GetGeoCodes", args: ["kind"] },
    export_routing: { method: "ExportRouting", args: [] },
    import_routing: { method: "ImportRouting", args: [] },
    switch_routing_setup: { method: "SwitchRoutingSetup", args: ["id"] },
    get_rule_hits: { method: "GetRuleHits", args: [] },
    get_rule_lists: { method: "GetRuleLists", args: [] },
    update_rule_lists: { method: "UpdateRuleLists", args: [] },
    get_connections: { method: "GetConnections", args: [] },
    close_connection: { method: "CloseConnection", args: ["id"] },
    close_all_connections: { method: "CloseAllConnections", args: [] },

    set_ui_language: { method: "SetUILanguage", args: ["language"] },
    take_pending_link: { method: "TakePendingLink", args: [] },
    get_version: { method: "GetVersion", args: [] },
    list_cores: { method: "ListCores", args: [] },
    set_core: { method: "SetCore", args: ["name"] },
    unsupported_profiles: { method: "UnsupportedProfiles", args: [] },
    export_backup: { method: "ExportBackup", args: ["ui"] },
    import_backup: { method: "ImportBackup", args: [] },
    list_user_files: { method: "ListUserFiles", args: ["kind"] },
    import_user_file: { method: "ImportUserFile", args: ["kind"] },
    remove_user_file: { method: "RemoveUserFile", args: ["kind", "id"] },
    get_app_usage: { method: "GetAppUsage", args: ["days"] },
    clear_statistics: { method: "ClearStatistics", args: [] },
    get_server_health: { method: "GetServerHealth", args: [] },
    run_speed_test: { method: "RunSpeedTest", args: [] },
    stop_speed_test: { method: "StopSpeedTest", args: [] },
    get_speed_tests: { method: "GetSpeedTests", args: [] },
    get_wifi_state: { method: "GetWifiState", args: [] },
    get_system_palette: { method: "GetSystemPalette", args: [] },
    set_system_bars: { method: "SetSystemBars", args: ["color", "light"] },
    list_installed_apps: { method: "ListInstalledApps", args: [] },
    get_app_icon: { method: "GetAppIcon", args: ["packageName"] },
    list_plugins: { method: "ListPlugins", args: [] },
    pick_plugin: { method: "PickPlugin", args: [] },
    install_plugin: { method: "InstallPlugin", args: ["token"] },
    remove_plugin: { method: "RemovePlugin", args: ["id"] },
    set_plugin_enabled: { method: "SetPluginEnabled", args: ["id", "enabled"] },
    plugin_storage_get: { method: "PluginStorageGet", args: ["id", "key"] },
    plugin_storage_set: { method: "PluginStorageSet", args: ["id", "key", "value"] },
    apply_plugin_routing: { method: "ApplyPluginRouting", args: ["id", "file"] },
    add_plugin_rule: { method: "AddPluginRule", args: ["id", "rule"] },
    plugin_notify: { method: "PluginNotify", args: ["id", "title", "body"] },
    set_global_shortcut: { method: "SetGlobalShortcut", args: ["spec"] },
    global_shortcut_supported: { method: "GlobalShortcutSupported", args: [] },
    check_for_update: { method: "CheckForUpdate", args: [] },
    install_update: { method: "InstallUpdate", args: [] },
    read_clipboard_link: { method: "ReadClipboardLink", args: [] },

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
    /** Settings changed outside the window, such as from the tray. */
    settings: "settings-changed",
    /** A nuggetvpn:// link to offer in the Add dialog. */
    importLink: "import-link",
    updateProgress: "update-progress",
    speedProgress: "speed-progress",
    wifi: "wifi-changed",
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
