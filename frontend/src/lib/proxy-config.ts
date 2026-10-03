/**
 * Utilities for parsing and reconstructing proxy configuration links
 * (VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC, WireGuard, SOCKS, HTTP, sing-box JSON).
 */

export interface ProxyFormState {
    protocol: string; // vless, vmess, trojan, ss, hysteria2, tuic, wireguard, socks5, http, json
    name: string;
    server: string;
    port: number;
    // Auth & Identity
    uuid: string;
    password: string;
    username: string;
    cipher: string; // SS method or VMess cipher
    alterId: number; // VMess
    flow: string; // xtls-rprx-vision
    // Security & TLS
    security: "none" | "tls" | "reality";
    sni: string;
    alpn: string;
    fingerprint: string;
    insecure: boolean;
    // Reality specific
    publicKey: string;
    shortId: string;
    spiderX: string;
    // Transport & Network
    network: "tcp" | "ws" | "grpc" | "http" | "httpupgrade";
    path: string;
    host: string;
    serviceName: string;
    // Hysteria 2 specific
    obfs: string;
    obfsPassword: string;
    ports: string;
    upMbps: string;
    downMbps: string;
    // WireGuard
    privateKey: string;
    peerPublicKey: string;
    localAddress: string;
    mtu: number;
    reserved: string;
    // Original raw link for fallback or JSON preserve
    rawLink: string;
    isJson: boolean;
}

export function defaultProxyFormState(name = "", server = "127.0.0.1", port = 443): ProxyFormState {
    return {
        protocol: "vless",
        name,
        server,
        port,
        uuid: "",
        password: "",
        username: "",
        cipher: "auto",
        alterId: 0,
        flow: "",
        security: "tls",
        sni: "",
        alpn: "",
        fingerprint: "chrome",
        insecure: false,
        publicKey: "",
        shortId: "",
        spiderX: "",
        network: "tcp",
        path: "",
        host: "",
        serviceName: "",
        obfs: "",
        obfsPassword: "",
        ports: "",
        upMbps: "",
        downMbps: "",
        privateKey: "",
        peerPublicKey: "",
        localAddress: "10.0.0.2/32",
        mtu: 1420,
        reserved: "",
        rawLink: "",
        isJson: false,
    };
}

/** Decode base64 URL or standard safely */
function safeBase64Decode(str: string): string {
    try {
        let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4 !== 0) {
            b64 += "=";
        }
        return decodeURIComponent(
            atob(b64)
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );
    } catch {
        try {
            return atob(str);
        } catch {
            return "";
        }
    }
}

/** Encode base64 safely */
function safeBase64Encode(str: string): string {
    try {
        return btoa(
            encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
                String.fromCharCode(parseInt(p1, 16))
            )
        );
    } catch {
        return btoa(str);
    }
}

/** Parse any raw proxy link or JSON into structured form state */
export function parseProxyLink(raw: string, fallbackName = ""): ProxyFormState {
    const trimmed = raw.trim();
    const state = defaultProxyFormState(fallbackName);
    state.rawLink = trimmed;

    if (!trimmed) {
        return state;
    }

    // JSON outbound
    if (trimmed.startsWith("{")) {
        try {
            const obj = JSON.parse(trimmed);
            state.isJson = true;
            state.protocol = obj.type || "json";
            state.name = obj.tag || fallbackName;
            state.server = obj.server || "";
            state.port = typeof obj.server_port === "number" ? obj.server_port : 443;
            state.uuid = obj.uuid || "";
            state.password = obj.password || "";
            state.username = obj.username || "";
            state.flow = obj.flow || "";

            if (obj.tls) {
                if (obj.tls.reality?.enabled) {
                    state.security = "reality";
                    state.publicKey = obj.tls.reality.public_key || "";
                    state.shortId = obj.tls.reality.short_id || "";
                } else if (obj.tls.enabled) {
                    state.security = "tls";
                } else {
                    state.security = "none";
                }
                state.sni = obj.tls.server_name || "";
                state.fingerprint = obj.tls.utls?.fingerprint || "chrome";
                state.insecure = Boolean(obj.tls.insecure);
                if (Array.isArray(obj.tls.alpn)) {
                    state.alpn = obj.tls.alpn.join(",");
                }
            } else {
                state.security = "none";
            }

            if (obj.transport) {
                state.network = obj.transport.type || "tcp";
                state.path = obj.transport.path || "";
                state.host = obj.transport.headers?.Host || "";
                state.serviceName = obj.transport.service_name || "";
            }
            return state;
        } catch {
            // Not valid JSON, fall through
        }
    }

    // VMess Base64 JSON: vmess://ey...
    if (trimmed.toLowerCase().startsWith("vmess://")) {
        const payload = trimmed.slice(8);
        const decoded = safeBase64Decode(payload);
        if (decoded.trim().startsWith("{")) {
            try {
                const v = JSON.parse(decoded);
                state.protocol = "vmess";
                state.name = v.ps || fallbackName;
                state.server = v.add || "";
                state.port = parseInt(v.port, 10) || 443;
                state.uuid = v.id || "";
                state.alterId = typeof v.aid === "number" ? v.aid : parseInt(v.aid, 10) || 0;
                state.cipher = v.scy || "auto";
                state.network = (v.net || "tcp").toLowerCase();
                state.path = v.path || "";
                state.host = v.host || "";
                state.security = v.tls === "tls" ? "tls" : "none";
                state.sni = v.sni || "";
                state.fingerprint = v.fp || "chrome";
                return state;
            } catch {
                // Try URI format below
            }
        }
    }

    try {
        const url = new URL(trimmed);
        const scheme = url.protocol.replace(":", "").toLowerCase();
        state.protocol = scheme === "hy2" ? "hysteria2" : scheme;
        state.server = url.hostname || "";
        state.port = parseInt(url.port, 10) || 443;

        // Name from fragment (e.g. #US%20Server)
        if (url.hash) {
            try {
                state.name = decodeURIComponent(url.hash.slice(1));
            } catch {
                state.name = url.hash.slice(1);
            }
        }
        if (!state.name) {
            state.name = fallbackName;
        }

        const params = url.searchParams;

        // Common credentials
        if (scheme === "vless" || scheme === "vmess") {
            state.uuid = decodeURIComponent(url.username || "");
            state.flow = params.get("flow") || "";
        } else if (scheme === "trojan" || scheme === "hysteria2" || scheme === "hy2") {
            state.password = decodeURIComponent(url.username || url.password || "");
        } else if (scheme === "ss") {
            let userPart = url.username;
            if (url.password) {
                state.cipher = decodeURIComponent(url.username);
                state.password = decodeURIComponent(url.password);
            } else if (userPart) {
                const decodedUser = safeBase64Decode(userPart);
                if (decodedUser.includes(":")) {
                    const [method, pass] = decodedUser.split(":", 2);
                    state.cipher = method;
                    state.password = pass;
                } else {
                    state.password = userPart;
                }
            }
        } else if (scheme === "tuic") {
            state.uuid = decodeURIComponent(url.username || "");
            state.password = decodeURIComponent(url.password || "");
        } else if (scheme === "socks" || scheme === "socks5" || scheme === "http" || scheme === "https") {
            state.username = decodeURIComponent(url.username || "");
            state.password = decodeURIComponent(url.password || "");
        }

        // Security / TLS
        const sec = (params.get("security") || "").toLowerCase();
        if (sec === "reality") {
            state.security = "reality";
        } else if (sec === "tls" || scheme === "trojan" || scheme === "hysteria2" || scheme === "tuic") {
            state.security = "tls";
        } else {
            state.security = "none";
        }

        state.sni = params.get("sni") || params.get("peer") || "";
        state.fingerprint = params.get("fp") || "chrome";
        state.alpn = params.get("alpn") || "";
        state.insecure = params.get("insecure") === "1" || params.get("allowInsecure") === "1";

        // Reality params
        state.publicKey = params.get("pbk") || "";
        state.shortId = params.get("sid") || "";
        state.spiderX = params.get("spx") || "";

        // Transport
        const netType = (params.get("type") || params.get("net") || "tcp").toLowerCase();
        if (netType === "ws" || netType === "websocket") {
            state.network = "ws";
        } else if (netType === "grpc") {
            state.network = "grpc";
        } else if (netType === "httpupgrade") {
            state.network = "httpupgrade";
        } else if (netType === "http" || netType === "h2") {
            state.network = "http";
        } else {
            state.network = "tcp";
        }

        state.path = params.get("path") || "";
        state.host = params.get("host") || "";
        state.serviceName = params.get("serviceName") || "";

        // Hysteria 2 params
        state.obfs = params.get("obfs") || "";
        state.obfsPassword = params.get("obfs-password") || "";
        state.ports = params.get("mport") || params.get("ports") || "";
        state.upMbps = params.get("upmbps") || "";
        state.downMbps = params.get("downmbps") || "";

        return state;
    } catch {
        // Return defaults with raw link
        return state;
    }
}

/** Serialize structured form state back into a valid standard link or JSON */
export function serializeProxyConfig(state: ProxyFormState): string {
    const proto = state.protocol.toLowerCase();

    // If it was originally JSON and remains JSON, reconstruct clean sing-box outbound
    if (state.isJson) {
        const outbound: Record<string, unknown> = {
            type: proto === "json" ? "vless" : proto,
            tag: state.name || "proxy",
            server: state.server,
            server_port: state.port,
        };
        if (state.uuid) outbound.uuid = state.uuid;
        if (state.password) outbound.password = state.password;
        if (state.username) outbound.username = state.username;
        if (state.flow && (proto === "vless" || proto === "json")) outbound.flow = state.flow;

        if (state.security !== "none") {
            const tls: Record<string, unknown> = {
                enabled: true,
                server_name: state.sni || state.server,
                insecure: state.insecure,
            };
            if (state.alpn) {
                tls.alpn = state.alpn.split(",").map((s) => s.trim()).filter(Boolean);
            }
            if (state.fingerprint) {
                tls.utls = { enabled: true, fingerprint: state.fingerprint };
            }
            if (state.security === "reality") {
                tls.reality = {
                    enabled: true,
                    public_key: state.publicKey,
                    short_id: state.shortId,
                };
            }
            outbound.tls = tls;
        }

        if (state.network !== "tcp") {
            const transport: Record<string, unknown> = { type: state.network };
            if (state.path) transport.path = state.path;
            if (state.host) transport.headers = { Host: state.host };
            if (state.serviceName) transport.service_name = state.serviceName;
            outbound.transport = transport;
        }

        return JSON.stringify(outbound, null, 2);
    }

    const host = state.server.trim();
    const port = state.port || 443;
    const nameFragment = state.name ? `#${encodeURIComponent(state.name)}` : "";

    // VLESS
    if (proto === "vless") {
        const params = new URLSearchParams();
        params.set("type", state.network || "tcp");
        params.set("security", state.security);

        if (state.security === "reality") {
            if (state.publicKey) params.set("pbk", state.publicKey);
            if (state.shortId) params.set("sid", state.shortId);
            if (state.spiderX) params.set("spx", state.spiderX);
        }
        if (state.security !== "none") {
            if (state.sni) params.set("sni", state.sni);
            if (state.fingerprint) params.set("fp", state.fingerprint);
            if (state.alpn) params.set("alpn", state.alpn);
        }
        if (state.flow) {
            params.set("flow", state.flow);
        }
        if (state.path) {
            params.set("path", state.path);
        }
        if (state.host) {
            params.set("host", state.host);
        }
        if (state.serviceName) {
            params.set("serviceName", state.serviceName);
        }
        if (state.insecure) {
            params.set("insecure", "1");
        }

        return `vless://${encodeURIComponent(state.uuid)}@${host}:${port}?${params.toString()}${nameFragment}`;
    }

    // VMess
    if (proto === "vmess") {
        const vmessObj = {
            v: "2",
            ps: state.name,
            add: host,
            port: port,
            id: state.uuid,
            aid: state.alterId || 0,
            scy: state.cipher || "auto",
            net: state.network || "tcp",
            type: "none",
            host: state.host || "",
            path: state.path || "",
            tls: state.security === "tls" ? "tls" : "",
            sni: state.sni || "",
            fp: state.fingerprint || "chrome",
        };
        return `vmess://${safeBase64Encode(JSON.stringify(vmessObj))}`;
    }

    // Trojan
    if (proto === "trojan") {
        const params = new URLSearchParams();
        params.set("security", state.security === "none" ? "none" : "tls");
        if (state.sni) params.set("sni", state.sni);
        if (state.alpn) params.set("alpn", state.alpn);
        if (state.fingerprint) params.set("fp", state.fingerprint);
        if (state.network !== "tcp") params.set("type", state.network);
        if (state.path) params.set("path", state.path);
        if (state.host) params.set("host", state.host);
        if (state.serviceName) params.set("serviceName", state.serviceName);

        const q = params.toString() ? `?${params.toString()}` : "";
        return `trojan://${encodeURIComponent(state.password)}@${host}:${port}${q}${nameFragment}`;
    }

    // Shadowsocks
    if (proto === "ss") {
        const method = state.cipher || "aes-256-gcm";
        const pass = state.password || "";
        const encodedCreds = safeBase64Encode(`${method}:${pass}`);
        return `ss://${encodedCreds}@${host}:${port}${nameFragment}`;
    }

    // Hysteria 2
    if (proto === "hysteria2" || proto === "hy2") {
        const params = new URLSearchParams();
        if (state.sni) params.set("sni", state.sni);
        if (state.insecure) params.set("insecure", "1");
        if (state.obfs) params.set("obfs", state.obfs);
        if (state.obfsPassword) params.set("obfs-password", state.obfsPassword);
        if (state.ports) params.set("mport", state.ports);
        if (state.upMbps) params.set("upmbps", state.upMbps);
        if (state.downMbps) params.set("downmbps", state.downMbps);

        const q = params.toString() ? `?${params.toString()}` : "";
        return `hysteria2://${encodeURIComponent(state.password)}@${host}:${port}${q}${nameFragment}`;
    }

    // TUIC
    if (proto === "tuic") {
        const params = new URLSearchParams();
        if (state.sni) params.set("sni", state.sni);
        if (state.alpn) params.set("alpn", state.alpn || "h3");
        const q = params.toString() ? `?${params.toString()}` : "";
        return `tuic://${encodeURIComponent(state.uuid)}:${encodeURIComponent(state.password)}@${host}:${port}${q}${nameFragment}`;
    }

    // SOCKS / HTTP
    if (proto === "socks" || proto === "socks5" || proto === "http" || proto === "https") {
        let auth = "";
        if (state.username || state.password) {
            auth = `${encodeURIComponent(state.username)}:${encodeURIComponent(state.password)}@`;
        }
        return `${proto}://${auth}${host}:${port}${nameFragment}`;
    }

    // Fallback: if we don't recognize the protocol, return rawLink if unmodified or build URL
    return state.rawLink || `vless://${encodeURIComponent(state.uuid)}@${host}:${port}${nameFragment}`;
}
