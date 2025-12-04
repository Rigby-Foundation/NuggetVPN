export interface Profile {
    id: string;
    name: string;
    server: string;
    protocol: string;
    config_link: string;
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
    auth_server: string | null;
    auth_token: string | null;
    skip_auth: boolean;
    pending_sync_upload: boolean;
}

export interface IpInfo {
    ip: string;
    region: string;
}
