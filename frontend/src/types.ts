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
    /** "" until the first-start Beam offer is answered, then "done" or "dismissed". */
    beam_migration: "" | "done" | "dismissed";
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

/** One line of what a Beam migration carries across, or leaves behind. */
export interface BeamItem {
    /** Which message; see ITEM_COPY in BeamMigration.tsx. */
    key: string;
    value?: string;
    count?: number;
}

/** A Beam profile, described without its subscription URL. */
export interface BeamSubscription {
    name: string;
    provider: string;
    /** Empty for servers added to Beam by hand. */
    host: string;
    cached_nodes: number;
    expires_at: number;
    data_used: number;
    data_limit: number;
}

export interface BeamPreview {
    subscriptions: BeamSubscription[];
    carried: BeamItem[];
    skipped: BeamItem[];
    /** The matching preset id, or empty. */
    theme: string;
    appearance: BeamAppearance;
}

/** Beam's font, corners and transition in this app's ids; empty = no match. */
export interface BeamAppearance {
    font: string;
    radius: string;
    motion: string;
}

export interface BeamOffer {
    found: boolean;
    /** Show the first-start dialog. */
    prompt: boolean;
    preview: BeamPreview | null;
}

export interface BeamOutcome {
    name: string;
    host: string;
    profiles: number;
    source: "fetched" | "cached" | "failed" | "local";
    /** The fetch failure as the network reported it. */
    error?: string;
    no_servers?: boolean;
    shared_host?: boolean;
}

export interface BeamMigrationReport {
    profiles: Profile[];
    settings: AppSettings;
    outcomes: BeamOutcome[];
    selection: { domain: string; profile_id: string } | null;
    theme: string;
    appearance: BeamAppearance;
}
