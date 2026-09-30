/**
 * The window's side of plugins.
 *
 * A plugin's pages run in frames sandboxed without allow-same-origin, so they
 * cannot reach this window, the Wails runtime, or each other. What they can do
 * is post messages here, which this module answers — after checking the call
 * against the permissions the user granted that plugin at install. Anything
 * that changes something is checked again in Go.
 *
 * The protocol (see internal/plugins/sdk/nugget.js, which wraps it):
 *
 *   plugin → app   { nugget: 1, id, method, params }     a call
 *                  { nugget: 1, subscribe: "vpn.state" } wants an event
 *                  { nugget: 1, hello: true }            has loaded
 *                  { nugget: 1, height }                 its page's height
 *   app → plugin   { nugget: 1, id, result } | { nugget: 1, id, error }
 *                  { nugget: 1, event, data }
 */
import toast from "react-hot-toast";

import { errorMessage, EVENTS, eventPayload, invoke, listen } from "@/lib/backend";
import type { ConnectionState, PluginInfo, PluginPermission, Profile } from "@/types";

/** What the host needs from the app to answer plugins. */
export interface HostActions {
    /** Connects, to a given server or to whatever is selected. */
    connect: (serverId?: string) => Promise<void>;
    disconnect: () => Promise<void>;
    addServer: (name: string, link: string) => Promise<void>;
    addSubscription: (url: string) => Promise<void>;
    profiles: () => Profile[];
    state: () => ConnectionState;
    language: () => string;
    platform: () => string;
}

interface Frame {
    pluginId: string;
    subscriptions: Set<string>;
    onHeight?: (height: number) => void;
}

const frames = new Map<Window, Frame>();
const plugins = new Map<string, PluginInfo>();
let actions: HostActions | null = null;
const lastToast = new Map<string, number>();
const lastNotify = new Map<string, number>();

/** Hands the host what it needs from the app; called on every render. */
export function setHostActions(next: HostActions) {
    actions = next;
}

/** Tells the host which plugins are installed, and what each may do. */
export function setHostPlugins(list: PluginInfo[]) {
    plugins.clear();
    for (const plugin of list) plugins.set(plugin.id, plugin);
}

/** Registers a plugin frame; returns a function that forgets it. */
export function registerFrame(target: Window, pluginId: string, onHeight?: (height: number) => void) {
    frames.set(target, { pluginId, subscriptions: new Set(), onHeight });
    return () => {
        frames.delete(target);
    };
}

function post(target: Window, message: Record<string, unknown>) {
    // "*": a sandboxed frame has no origin to name. The message goes to this
    // one window, so there is nobody else it could reach.
    target.postMessage({ nugget: 1, ...message }, "*");
}

function allowed(pluginId: string, permission?: PluginPermission): boolean {
    const plugin = plugins.get(pluginId);
    if (!plugin || !plugin.enabled) return false;
    return !permission || plugin.permissions.includes(permission);
}

/** Sends an event to every frame that asked for it and may see it. */
function broadcast(event: string, data: unknown, permission?: PluginPermission) {
    for (const [target, frame] of frames) {
        if (frame.subscriptions.has(event) && allowed(frame.pluginId, permission)) {
            post(target, { event, data });
        }
    }
}

// ---------------------------------------------------------------------------
// What plugins can see and do
// ---------------------------------------------------------------------------

/** The colours and shape of the app, for a plugin page to match it. */
export function currentTheme() {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const names = [
        "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
        "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
        "accent", "accent-foreground", "destructive", "border", "input", "ring",
        "status-connected", "status-connecting", "status-error", "status-idle",
    ];
    const colors: Record<string, string> = {};
    for (const name of names) {
        const value = style.getPropertyValue("--" + name).trim();
        if (value) colors[name] = value;
    }
    const dark = root.classList.contains("dark") || [...root.classList].some((name) => name.startsWith("theme-dark-"));
    return {
        mode: dark ? "dark" : "light",
        colors,
        radius: style.getPropertyValue("--radius").trim(),
        font: style.getPropertyValue("--app-font").trim(),
        language: root.lang || actions?.language() || "en",
        dir: root.dir || "ltr",
    };
}

function publicState(state: ConnectionState) {
    return {
        status: state.status,
        server: state.profile ?? null,
        server_id: state.profile_id ?? null,
        since: state.since ?? null,
        reconnecting: !!state.reconnecting,
        blocked: !!state.blocked,
        error: state.error ?? null,
    };
}

type Params = Record<string, unknown>;

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.slice(0, limit) : "");

function ready(): HostActions {
    if (!actions) throw new Error("the app is still starting");
    return actions;
}

function throttle(map: Map<string, number>, pluginId: string, gap: number) {
    const now = Date.now();
    if (now - (map.get(pluginId) ?? 0) < gap) throw new Error("too many at once; try again in a moment");
    map.set(pluginId, now);
}

interface Method {
    permission?: PluginPermission;
    run: (pluginId: string, params: Params) => Promise<unknown> | unknown;
}

const METHODS: Record<string, Method> = {
    "app.info": {
        run: async (pluginId) => ({
            version: await invoke<string>("get_version").catch(() => ""),
            language: ready().language(),
            platform: ready().platform(),
            plugin: { id: pluginId, version: plugins.get(pluginId)?.version, permissions: plugins.get(pluginId)?.permissions ?? [] },
        }),
    },
    "app.theme": { run: () => currentTheme() },
    "ui.toast": {
        run: (pluginId, params) => {
            throttle(lastToast, pluginId, 1500);
            const message = `${plugins.get(pluginId)?.name ?? pluginId}: ${text(params.text, 200)}`;
            const id = "plugin-" + pluginId;
            if (params.kind === "error") toast.error(message, { id });
            else if (params.kind === "success") toast.success(message, { id });
            else toast(message, { id });
            return null;
        },
    },
    "storage.get": {
        run: (pluginId, params) => invoke("plugin_storage_get", { id: pluginId, key: text(params.key, 200) }),
    },
    "storage.set": {
        run: (pluginId, params) =>
            invoke("plugin_storage_set", { id: pluginId, key: text(params.key, 200), value: params.value ?? null }).then(() => null),
    },

    "vpn.status": { permission: "state", run: () => publicState(ready().state()) },
    "vpn.traffic": { permission: "state", run: () => invoke("get_traffic") },
    "vpn.connect": {
        permission: "control",
        run: async (_, params) => {
            const server = text(params.server, 100);
            if (server && !ready().profiles().some((profile) => profile.id === server)) {
                throw new Error("there is no server with that id");
            }
            await ready().connect(server || undefined);
            return publicState(ready().state());
        },
    },
    "vpn.disconnect": {
        permission: "control",
        run: async () => {
            await ready().disconnect();
            return null;
        },
    },

    "connections.list": { permission: "connections", run: () => invoke("get_connections") },

    "servers.list": {
        permission: "profiles",
        // Never the links: they carry the credentials.
        run: () =>
            ready()
                .profiles()
                .map((profile) => ({
                    id: profile.id,
                    name: profile.name,
                    protocol: profile.protocol,
                    host: profile.server,
                    favorite: !!profile.favorite,
                    subscription: profile.source_domain ?? null,
                })),
    },
    "servers.add": {
        permission: "import",
        run: async (_, params) => {
            const link = text(params.link, 20000).trim();
            if (!link) throw new Error("give a link");
            await ready().addServer(text(params.name, 100), link);
            return null;
        },
    },
    "subscriptions.add": {
        permission: "import",
        run: async (_, params) => {
            const url = text(params.url, 4000).trim();
            if (!/^https?:\/\//i.test(url)) throw new Error("give an http or https link");
            await ready().addSubscription(url);
            return null;
        },
    },

    "routing.addRule": {
        permission: "routing",
        run: async (pluginId, params) => {
            const values = Array.isArray(params.values) ? params.values.map((value) => text(value, 500)).filter(Boolean) : [];
            await invoke("add_plugin_rule", {
                id: pluginId,
                rule: { kind: text(params.kind, 40), values, action: text(params.action, 20), invert: params.invert === true },
            });
            return null;
        },
    },

    notify: {
        permission: "notifications",
        run: async (pluginId, params) => {
            throttle(lastNotify, pluginId, 10_000);
            await invoke("plugin_notify", { id: pluginId, title: text(params.title, 100), body: text(params.body, 400) });
            return null;
        },
    },
};

/** Which permission each event needs. */
const EVENT_PERMISSIONS: Record<string, PluginPermission | undefined> = {
    "vpn.state": "state",
    "vpn.traffic": "state",
    "app.theme": undefined,
};

async function answer(target: Window, frame: Frame, id: number, method: string, params: Params) {
    const entry = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : undefined;
    try {
        if (!entry) throw new Error(`unknown method ${method}`);
        if (!allowed(frame.pluginId, entry.permission)) {
            throw new Error(
                entry.permission
                    ? `this plugin has not been allowed "${entry.permission}"`
                    : "this plugin is turned off"
            );
        }
        const result = await entry.run(frame.pluginId, params);
        post(target, { id, result: result ?? null });
    } catch (error) {
        post(target, { id, error: errorMessage(error) });
    }
}

function onMessage(event: MessageEvent) {
    const target = event.source as Window | null;
    const frame = target ? frames.get(target) : undefined;
    const data = event.data;
    if (!target || !frame || !data || typeof data !== "object" || data.nugget !== 1) return;

    if (data.hello === true) {
        frame.subscriptions.add("app.theme");
        post(target, { event: "app.theme", data: currentTheme() });
        return;
    }
    if (typeof data.subscribe === "string") {
        const name = data.subscribe;
        if (!(name in EVENT_PERMISSIONS)) return;
        frame.subscriptions.add(name);
        if (name === "vpn.state" && allowed(frame.pluginId, "state") && actions) {
            post(target, { event: name, data: publicState(actions.state()) });
        }
        return;
    }
    if (typeof data.height === "number" && Number.isFinite(data.height)) {
        frame.onHeight?.(Math.max(60, Math.min(4000, data.height)));
        return;
    }
    if (typeof data.method === "string" && typeof data.id === "number") {
        const params = data.params && typeof data.params === "object" ? (data.params as Params) : {};
        void answer(target, frame, data.id, data.method, params);
    }
}

/** Starts listening for plugins; returns a function that stops. */
export function startPluginHost(): () => void {
    window.addEventListener("message", onMessage);
    const stopState = listen(EVENTS.state, (data) => {
        broadcast("vpn.state", publicState(eventPayload<ConnectionState>(data)), "state");
    });
    const stopTraffic = listen(EVENTS.traffic, (data) => {
        broadcast("vpn.traffic", eventPayload(data), "state");
    });
    // The theme lives on <html>: its class and inline knobs.
    let pending = 0;
    const observer = new MutationObserver(() => {
        window.clearTimeout(pending);
        pending = window.setTimeout(() => broadcast("app.theme", currentTheme()), 50);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "lang", "dir"] });
    return () => {
        window.removeEventListener("message", onMessage);
        stopState();
        stopTraffic();
        observer.disconnect();
        window.clearTimeout(pending);
    };
}
