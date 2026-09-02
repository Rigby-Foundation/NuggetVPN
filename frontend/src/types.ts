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
    auth_server: string | null;
    auth_token: string | null;
    skip_auth: boolean;
    pending_sync_upload: boolean;
    routing_mode: "all" | "apps" | "domains" | "apps_domains";
    routing_apps: string[];
    routing_domains: string[];
    proxy_chain_enabled: boolean;
    proxy_chain: string[];
    proxy_chain_exit: string;
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
    }
    | {
        kind: "profile";
        key: string;
        domain: "local";
        label: string;
        detail: string;
        profileId: string;
    };
