export interface Profile {
    id: string;
    name: string;
    server: string;
    protocol: string;
    config_link: string;
    source_domain?: string;
    subscription_url?: string;
    total_up?: number;
    total_down?: number;
    /** Pinned to the top of its list. */
    favorite?: boolean;
    subscription_info?: SubscriptionInfo | null;
}

/** A subscription's account details; see models.SubscriptionInfo. */
export interface SubscriptionInfo {
    upload: number;
    download: number;
    /** Bytes; 0 means no data limit. */
    total: number;
    /** Unix seconds; 0 means no expiry. */
    expire: number;
    title?: string;
    support_url?: string;
    web_page_url?: string;
    updated_at: number;
}

export interface AppSettings {
    mtu: number;
    dns: string;
    tls_fragment: boolean;
    tls_fragment_size: string;
    tls_fragment_sleep: string;
    tls_mixed_sni_case: boolean;
    tls_padding: boolean;
    sni_spoof_enabled: boolean;
    sni_spoof_value: string;
    /** Null means the user has never chosen; the backend treats that as on. */
    ip_check_enabled: boolean | null;
    /** Keep logs: the Logs screen, session.log and the core's log. Go fills it in. */
    logging_enabled: boolean | null;
    auth_server: string | null;
    auth_token: string | null;
    skip_auth: boolean;
    pending_sync_upload: boolean;
    /**
     * How this client presents itself when fetching a subscription. Some
     * panels only serve known clients, and some count devices by the x-hwid
     * header and refuse the request without one.
     */
    subscription_user_agent: string;
    /** Null means never chosen; the backend treats that as on. */
    hwid_enabled: boolean | null;
    hwid: string;
    device_os: string;
    device_os_version: string;
    device_model: string;
    /** The routing graph. Go owns migration from the legacy fields below. */
    routing_rules: RoutingRule[];
    default_action: RoutingAction;
    /** Canvas positions, keyed by node id, so the graph survives a restart. */
    routing_layout: Record<string, CanvasPoint>;
    /** Notes on the canvas; their positions are in routing_layout. */
    routing_comments: RoutingComment[];
    /** Profile id unmatched proxied traffic goes through; "" is the connected server. */
    default_server: string;
    /** Server destinations placed on the canvas, by profile id. */
    routing_servers: string[] | null;
    /**
     * Saved routing setups. The active one is edited in the fields above;
     * its entry here is refreshed by Go on every save.
     */
    routing_setups: RoutingSetup[] | null;
    active_routing_setup: string;
    /** The user's own geoip.dat / geosite.dat, by kind. */
    geo_files: Partial<Record<GeoKind, GeoFile>>;
    /** Superseded by routing_rules; read only by the one-time migration. */
    routing_mode: "all" | "apps" | "domains" | "apps_domains";
    routing_apps: string[];
    routing_domains: string[];
    proxy_chain_enabled: boolean;
    proxy_chain: string[];
    proxy_chain_exit: string;
    /** The server last picked, restored on the next start. */
    last_selection: SavedSelection | null;
    /** Read from the system on every load; see internal/autostart. */
    launch_at_startup: boolean;
    auto_connect: boolean;
    /** Null means never chosen; the backend treats that as on. */
    auto_reconnect: boolean | null;
    kill_switch: boolean;
    fastest_server: boolean;
    /** Null means never chosen; the backend treats that as on. */
    notifications: boolean | null;
    /** Null means never chosen; the backend treats that as on. */
    clipboard_offer: boolean | null;
    /** Null means never chosen; the backend treats that as on. */
    update_check: boolean | null;
    /** "Ctrl+Alt+V"-style; "" for none. */
    global_shortcut: string;
    /** Which program runs the tunnel. */
    core: CoreName;
    /** Switches routing setups by the time of the week. */
    routing_schedule: ScheduleEntry[];
    /** The setup outside every schedule entry; "" leaves whichever is on. */
    schedule_fallback: string;
    /** Connect on joining a Wi-Fi network that is not trusted. */
    wifi_auto_connect: boolean;
    /** Disconnect on joining a trusted Wi-Fi network. */
    wifi_trusted_disconnect: boolean;
    trusted_networks: string[];
    /** Check servers in the background and try failing ones last. */
    server_health: boolean | null;
    /** Count traffic by program. */
    app_stats: boolean | null;
    /** Null means never chosen; the backend treats that as on. */
    subscription_auto_update: boolean | null;
    close_action: CloseAction;
}

/**
 * Connection status, mirroring the Go constants.
 *
 * "connecting" is a real state rather than a spinner the UI invents: bringing
 * a tunnel up can mean probing and trying several servers in turn.
 */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface ConnectionState {
    status: ConnectionStatus;
    profile_id?: string;
    profile?: string;
    error?: string;
    /** Unix milliseconds the tunnel came up; absent unless connected. */
    since?: number;
    /** Bringing a dropped tunnel back; attempt counts the tries. */
    reconnecting?: boolean;
    attempt?: number;
    /** The kill switch is holding all traffic. */
    blocked?: boolean;
}

export interface TrafficSample {
    up: number;
    down: number;
    up_rate: number;
    down_rate: number;
    total_up: number;
    total_down: number;
}

export interface IpInfo {
    ip: string;
    region: string;
}

export interface ProfilePing {
    id: string;
    ping_ms: number | null;
}

export interface RefreshSummary {
    refreshed: number;
    failed: number;
    skipped: number;
}

export type ProxyMode = "manual" | "auto";

export type ConfigSource =
    | {
        kind: "subscription";
        key: string;
        domain: string;
        label: string;
        detail: string;
        count: number;
        info?: SubscriptionInfo;
    }
    | {
        kind: "profile";
        key: string;
        domain: "local";
        label: string;
        detail: string;
        profileId: string;
    };

/** A source kind a routing rule can match on. */
export type RoutingSource =
    | "apps"
    | "domains"
    | "ip"
    | "domain_regex"
    | "port"
    | "protocol"
    | "geosite"
    | "geoip"
    | "network"
    | "ruleset";

/** A rule's kind: a single matcher, or a combination of them. */
export type RoutingKind = RoutingSource | "logical";

/** Where a routing rule sends what it matches. */
export type RoutingAction = "proxy" | "direct" | "block" | "drop";

export interface RoutingCondition {
    kind: RoutingSource;
    values: string[];
    invert?: boolean;
}

export interface RoutingRule {
    id: string;
    kind: RoutingKind;
    values: string[];
    action: RoutingAction;
    /** Match everything the entries do not. */
    invert?: boolean;
    /** Profile id for a proxied rule; "" or absent is the connected server. */
    server?: string;
    /** A resolver for the rule's domains; see models.ParseDNSServer. */
    dns?: string;
    /** For "logical": all conditions ("and") or any ("or"). */
    mode?: "and" | "or";
    conditions?: RoutingCondition[];
}

export interface RoutingGraph {
    rules: RoutingRule[];
    default_action: RoutingAction;
    default_server?: string;
    layout: Record<string, CanvasPoint>;
    comments: RoutingComment[];
    servers?: string[] | null;
}

export interface RoutingSetup {
    id: string;
    /** "" for the first setup, shown under a translated default name. */
    name: string;
    graph: RoutingGraph;
}

/** The cores the tunnel can run on. */
export type CoreName = "builtin" | "sing-box" | "mihomo" | "xray";

/** A core built into the app; see core.CoreInfo. */
export interface CoreInfo {
    name: CoreName;
    version?: string;
}

/** An open connection; see app.LiveConnection. */
export interface LiveConnection {
    id: string;
    network: string;
    protocol?: string;
    host?: string;
    destination: string;
    app?: string;
    app_path?: string;
    /** Routing rule id; "__default" for everything else, "" for built-in routes. */
    rule: string;
    /** mihomo's own name for the rule, when it maps to none. */
    rule_text?: string;
    route: "proxy" | "direct";
    server?: string;
    upload: number;
    download: number;
    started: number;
}

/** The newest release against the running version; see app.UpdateInfo. */
export interface UpdateInfo {
    current: string;
    latest: string;
    available: boolean;
    notes: string;
    page_url: string;
    asset?: string;
    asset_size?: number;
    installable: boolean;
    checked_at: number;
}

/** A font or background the user added; see app.UserFile. */
export interface UserFile {
    id: string;
    name: string;
    url: string;
    kind: "fonts" | "backgrounds";
}

/** A rule list from a URL, as the backend knows it. */
export interface RuleListStatus {
    url: string;
    /** Downloaded by the core itself; its size is not known here. */
    native: boolean;
    entries: number;
    updated_at: number;
    error?: string;
}

export interface CanvasPoint {
    x: number;
    y: number;
    /** Set once the node has been resized; absent means its natural size. */
    width?: number;
    height?: number;
}

export interface RoutingComment {
    id: string;
    text: string;
}

export type GeoKind = "geoip" | "geosite";

export interface GeoFile {
    /** "url" files can be downloaded again to update them. */
    source: "file" | "url";
    name: string;
    url?: string;
    codes: number;
    updated_at: number;
}

/** The result of opening a .vflow. */
export interface FlowImport {
    /** False when the dialog was cancelled. */
    imported: boolean;
    settings: AppSettings;
    /** Geo files the flow refers to that are not in use here, by URL. */
    missing_geo: Partial<Record<GeoKind, string>> | null;
}

/** What closing the window does. */
export type CloseAction = "tray" | "hide" | "quit";

export interface SavedSelection {
    domain: string;
    mode: ProxyMode;
    profile_id: string;
    /** Fallback when the id is gone, e.g. the provider changed the link. */
    profile_name: string;
}

/** A permission a plugin can hold; see internal/plugins. */
export type PluginPermission =
    | "state"
    | "connections"
    | "profiles"
    | "control"
    | "import"
    | "routing"
    | "notifications";

/** An installed plugin; see app.PluginInfo. */
export interface PluginInfo {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    homepage?: string;
    icon?: string;
    enabled: boolean;
    permissions: PluginPermission[];
    network: string[];
    themes: PluginTheme[];
    fonts: { id: string; name: string; url: string }[];
    routing: { name: string; description?: string; file: string }[];
    panel?: string;
    panel_title?: string;
    background?: string;
}

/** A theme a plugin brings, in the theme editor's shape. */
export interface PluginTheme {
    id: string;
    name: string;
    mode: "light" | "dark";
    background: unknown;
    accent: unknown;
    image?: { url: string; blur: number; brightness: number; saturate: number; dim: number; panel: number };
}

/** A plugin file read but not installed; see app.PluginPreview. */
export interface PluginPreview {
    token: string;
    plugin: PluginInfo;
    installed?: string;
    new_permissions: PluginPermission[];
    has_script: boolean;
}

/** One entry of the routing schedule; see models.ScheduleEntry. */
export interface ScheduleEntry {
    id: string;
    setup: string;
    /** 0 = Sunday … 6 = Saturday. */
    days: number[];
    /** "HH:MM", local time; an end before the start runs past midnight. */
    start: string;
    end: string;
}

/** Traffic by program; see app.AppUsage. */
export interface AppUsage {
    programs: { program: string; up: number; down: number }[];
    days: { day: string; up: number; down: number }[];
}

/** One observation of a server; see stats.Sample. */
export interface HealthSample {
    at: number;
    kind: "ping" | "connect" | "drop";
    /** Latency for a ping that answered; -1 for a failure. */
    ms: number;
}

/** A server's record, summed up; see stats.Health. */
export interface ServerHealth {
    /** 0–1, or -1 when there were no checks. */
    uptime_24h: number;
    uptime_7d: number;
    latency_ms: number;
    checks: number;
    failing: boolean;
    recent: HealthSample[];
}

/** A finished speed test; see stats.SpeedResult. */
export interface SpeedResult {
    at: number;
    server: string;
    download_mbps: number;
    upload_mbps: number;
    latency_ms: number;
    jitter_ms: number;
}

/** A speed test in progress; see speedtest.Progress. */
export interface SpeedProgress {
    phase: "latency" | "download" | "upload";
    fraction: number;
    mbps: number;
    latency_ms: number;
}

/** The Wi-Fi network; see app.WifiState. */
export interface WifiState {
    on_wifi: boolean;
    ssid: string;
    hidden: boolean;
    unsupported: boolean;
}
