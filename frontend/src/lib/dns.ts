/** Resolver transports that this client routes through native Xray. */
export function validDnsAddress(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    let parsed: URL;
    try {
        parsed = new URL(text.includes("://") ? text : `udp://${text}`);
    } catch {
        return false;
    }
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    if (!["udp", "tcp", "https"].includes(scheme)) return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (!host) return false;
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
    if (!ip && !/^([a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$/i.test(host)) return false;
    const path = parsed.pathname;
    const web = scheme === "https";
    return web || path === "" || path === "/";
}
