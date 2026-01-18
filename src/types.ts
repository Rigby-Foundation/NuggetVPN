export interface Profile {
    id: string;
    name: string;
    server: string;
    protocol: string;
    config_link: string;
    source_domain?: string;
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
    auth_server: string | null;
    auth_token: string | null;
    skip_auth: boolean;
    pending_sync_upload: boolean;
    routing_mode: "all" | "apps" | "domains" | "apps_domains" | "selected";
    routing_apps: string[];
    routing_domains: string[];
    proxy_chain_enabled: boolean;
    proxy_chain: string[];
    proxy_chain_exit: string;
}

export interface IpInfo {
    ip: string;
    region: string;
}

export interface ProfilePing {
    id: string;
    ping_ms: number | null;
}

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
