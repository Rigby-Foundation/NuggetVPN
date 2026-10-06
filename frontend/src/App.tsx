import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";

import { appWindow, errorMessage, eventPayload, EVENTS, invoke, listen, save, writeTextFile } from "@/lib/backend";

import AddModal from "@/components/AddModal";
import { useAppearance } from "@/components/appearance-provider";
import Onboarding from "@/components/Onboarding";
import Welcome from "@/components/Welcome";
import AppSidebar from "@/components/layout/AppSidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { BottomDockNav } from "@/components/layout/BottomDockNav";
import { DesktopSidebarNav } from "@/components/layout/DesktopSidebarNav";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import TopBar from "@/components/layout/TopBar";
import { UnifiedHeader } from "@/components/layout/UnifiedHeader";
import { WindowControls } from "@/components/layout/WindowControls";
import { WindowDragHeader } from "@/components/layout/WindowDragHeader";
import ConnectionView from "@/components/views/ConnectionView";
import ConfigurationView from "@/components/views/ConfigurationView";
import LogsView from "@/components/views/LogsView";
import ProxiesView from "@/components/views/ProxiesView";
import RoutingView from "@/components/views/RoutingView";
import ConnectionsView from "@/components/views/ConnectionsView";
import StatisticsView from "@/components/views/StatisticsView";
import { subscriptionAlert } from "@/components/subscription-usage";
import SettingsView from "@/components/views/SettingsView";
import { useTheme } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PluginsProvider } from "@/components/plugins/plugins-provider";
import { useConnection } from "@/hooks/use-connection";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLogs } from "@/hooks/use-logs";
import { LOCAL, profileDomain, reconcileSelection, useProfiles } from "@/hooks/use-profiles";
import { useTraffic } from "@/hooks/use-traffic";
import { stripAnsi } from "@/lib/ansi";
import { useBack } from "@/lib/back";
import { useI18n, useT } from "@/lib/i18n";
import type { HostActions } from "@/lib/plugin-host";
import { cn } from "@/lib/utils";
import {
    AppSettings,
    ConfigSource,
    IpInfo,
    Profile,
    ProfilePing,
    UpdateInfo,
} from "@/types";

import "./App.css";
import { usePageVisible } from "@/hooks/use-page-visible";

/**
 * Settings are owned by Go, including their defaults and normalisation. This is
 * only the shape used before the first load resolves, so the settings screen has
 * something to render against.
 */
const PENDING_SETTINGS: AppSettings = {
    mtu: 9000,
    dns: "1.1.1.1",
    tls_fragment: false,
    tls_fragment_size: "100-200",
    tls_fragment_sleep: "10-20",
    tls_mixed_sni_case: false,
    tls_padding: false,
    sni_spoof_enabled: false,
    sni_spoof_value: "",
    ip_check_enabled: true,
    logging_enabled: null,
    auth_server: null,
    auth_token: null,
    skip_auth: false,
    pending_sync_upload: false,
    subscription_user_agent: "NuggetVPN/1.0",
    hwid_enabled: true,
    hwid: "",
    device_os: "",
    device_os_version: "",
    device_model: "",
    routing_rules: [],
    default_action: "proxy",
    routing_layout: {},
    routing_mode: "all",
    routing_apps: [],
    routing_domains: [],
    proxy_chain_enabled: false,
    proxy_chain: [],
    proxy_chain_exit: "",
    last_selection: null,
    launch_at_startup: false,
    auto_connect: false,
    auto_reconnect: null,
    kill_switch: false,
    fastest_server: false,
    notifications: null,
    clipboard_offer: null,
    update_check: null,
    global_shortcut: "",
    core: "builtin",
    routing_schedule: [],
    schedule_fallback: "",
    wifi_auto_connect: false,
    wifi_trusted_disconnect: false,
    trusted_networks: [],
    server_health: null,
    app_stats: null,
    subscription_auto_update: null,
    close_action: "tray",
    routing_comments: [],
    default_server: "",
    routing_servers: [],
    routing_setups: [],
    active_routing_setup: "",
    geo_files: {},
};

/** How often subscriptions refresh while the app runs, when that is on. */
const SUBSCRIPTION_REFRESH_MS = 6 * 60 * 60 * 1000;

const IP_RECHECK_MS = 5 * 60 * 1000;

/**
 * Best guess at the platform before the backend answers.
 *
 * The window chrome differs per platform — traffic lights on macOS, a wordmark
 * plus minimise/maximise/close everywhere else — and the window is frameless,
 * so getting this wrong means the user has no working controls. Defaulting to
 * "macos" put macOS traffic lights on Windows whenever the backend call did not
 * land. The user agent is available synchronously and is right often enough to
 * be a better starting point than a fixed guess.
 */
function guessPlatform(): string {
    const agent = navigator.userAgent;
    if (agent.includes("Android")) return "android";
    if (/iPhone|iPad|iPod/i.test(agent)) return "ios";
    if (agent.includes("Windows")) return "windows";
    if (agent.includes("Mac OS")) return "macos";
    return "linux";
}

function App() {
    const { theme, setTheme } = useTheme();
    const t = useT();
    const appearance = useAppearance();
    const isMobile = useIsMobile();

    const {
        profiles,
        setProfiles,
        sources,
        selection,
        setSelection,
        load: loadProfiles,
        addProfile,
        updateProfile,
        updateSubscriptionUrl,
        importSubscription,
        deleteIds,
        refreshDomain,
        refreshAll,
    } = useProfiles();
    const connection = useConnection();
    // Startup runs once, before connection settles into a stable identity.
    const connectRef = useRef(connection.connect);
    connectRef.current = connection.connect;
    const traffic = useTraffic(connection.isConnected);

    const [settings, setSettings] = useState<AppSettings>(PENDING_SETTINGS);
    const { logs, limit: logLimit, changeLimit, append: appendLog, clear: clearLogs } = useLogs(settings.logging_enabled !== false);
    const [activeTab, setActiveTab] = useState("connection");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState<false | "welcome" | "sync">(false);
    const [platform, setPlatform] = useState(guessPlatform);
    const [profilePings, setProfilePings] = useState<Record<string, number | null>>({});
    const [refreshingDomain, setRefreshingDomain] = useState("");
    const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
    const [isCheckingIp, setIsCheckingIp] = useState(false);

    useEffect(() => {
        const radius = (platform === "android" || platform === "ios" || isMobile) ? "0px" : platform === "windows" ? "8px" : "10px";
        document.documentElement.style.setProperty("--window-radius", radius);
    }, [platform, isMobile]);

    const saveSettings = useCallback(async (next: AppSettings) => {
        // Go normalises and returns the canonical value, so the UI holds
        // exactly what was persisted rather than its own idea of it.
        const stored = await invoke<AppSettings>("save_settings", { settings: next });
        setSettings(stored);
        return stored;
    }, []);

    // Settings changed from outside the window — a routing setup picked in
    // the tray — arrive already saved.
    useEffect(
        () =>
            listen(EVENTS.settings, (data) => {
                setSettings(eventPayload<AppSettings>(data));
            }),
        []
    );

    // Opening a settings section from elsewhere, such as the update toast.
    const [settingsOpen, setSettingsOpen] = useState<{ id: string; n: number }>();
    const openSettingsSection = useCallback((id: string) => {
        setActiveTab("settings");
        setSettingsOpen((current) => ({ id, n: (current?.n ?? 0) + 1 }));
    }, []);

    // A new release, checked at start and then once a day, announced once per
    // version.
    const updateCheck = settings !== PENDING_SETTINGS && settings.update_check !== false;
    const announcedRef = useRef("");
    useEffect(() => {
        if (!updateCheck) return;
        const check = async () => {
            try {
                const info = await invoke<UpdateInfo>("check_for_update");
                if (!info.available || announcedRef.current === info.latest) return;
                announcedRef.current = info.latest;
                toast(
                    (shown) => (
                        <span className="flex items-center gap-3 text-sm">
                            {t("updates.toast", { version: info.latest })}
                            <button
                                type="button"
                                className="font-medium text-primary"
                                onClick={() => {
                                    toast.dismiss(shown.id);
                                    openSettingsSection("updates");
                                }}
                            >
                                {t("updates.view")}
                            </button>
                        </span>
                    ),
                    { id: "update", duration: 15000 }
                );
            } catch {
                // Offline, or GitHub unreachable: try again tomorrow.
            }
        };
        const first = window.setTimeout(check, 5000);
        const daily = window.setInterval(check, 24 * 60 * 60 * 1000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(daily);
        };
    }, [updateCheck, openSettingsSection, t]);

    // Links offered for import: a nuggetvpn:// link the app was opened with,
    // or one found on the clipboard. Both open the Add dialog filled in;
    // nothing is imported without the user confirming it there.
    const [offeredLink, setOfferedLink] = useState("");
    const openWithLink = useCallback((link: string) => {
        setOfferedLink(link);
        setIsModalOpen(true);
    }, []);
    useEffect(() => {
        const unlisten = listen(EVENTS.importLink, (data) => openWithLink(eventPayload<string>(data)));
        invoke<string>("take_pending_link")
            .then((link) => {
                if (link) openWithLink(link);
            })
            .catch(() => undefined);
        return unlisten;
    }, [openWithLink]);

    const profilesRef = useRef(profiles);
    profilesRef.current = profiles;
    const offeredRef = useRef(new Set<string>());
    useEffect(() => {
        if (settings.clipboard_offer === false) return;
        const check = async () => {
            let link = "";
            try {
                link = await invoke<string>("read_clipboard_link");
            } catch {
                return;
            }
            // Once per link, and not for what is already added.
            if (!link || offeredRef.current.has(link)) return;
            offeredRef.current.add(link);
            const known = profilesRef.current.some(
                (profile) => profile.config_link === link || profile.subscription_url === link
            );
            if (known) return;
            toast(
                (shown) => (
                    <span className="flex items-center gap-3 text-sm">
                        <span className="min-w-0">
                            <span className="block">{t("clipboard.found")}</span>
                            <span className="block max-w-56 truncate font-mono text-[11px] text-muted-foreground">{link}</span>
                        </span>
                        <button
                            type="button"
                            className="shrink-0 font-medium text-primary"
                            onClick={() => {
                                toast.dismiss(shown.id);
                                openWithLink(link);
                            }}
                        >
                            {t("clipboard.add")}
                        </button>
                    </span>
                ),
                { id: "clipboard-link", duration: 10000 }
            );
        };
        window.addEventListener("focus", check);
        return () => window.removeEventListener("focus", check);
    }, [settings.clipboard_offer, openWithLink, t]);

    // A subscription about to run out — of days or of data — is worth one
    // warning per session, not one per refresh.
    const warnedRef = useRef(new Set<string>());
    useEffect(() => {
        sources.forEach((source) => {
            if (source.kind !== "subscription") return;
            const alert = subscriptionAlert(source.info);
            if (!alert) return;
            const key = `${source.domain}:${alert}`;
            if (warnedRef.current.has(key)) return;
            warnedRef.current.add(key);
            toast(t(`usage.alert.${alert}` as const, { name: source.label }), { id: key, icon: "⚠️", duration: 8000 });
        });
    }, [sources, t]);

    // settingsRef mirrors the latest settings so updateSetting can build the
    // next value without depending on `settings` and being rebuilt on every
    // keystroke in the settings form.
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    // The save happens here, not inside a setSettings updater. React may invoke
    // an updater more than once for a single change, so a request fired from
    // inside one produces duplicate saves — and, when they fail, a stack of
    // identical error toasts.
    const patchSettings = useCallback(
        (patch: Partial<AppSettings>) => {
            const next = { ...settingsRef.current, ...patch };
            setSettings(next);
            void saveSettings(next).catch((error) =>
                toast.error(t("toast.saveFailed", { error: errorMessage(error) }), {
                    id: "save-settings",
                })
            );
        },
        [saveSettings, t]
    );

    const updateSetting = useCallback(
        <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
            patchSettings({ [key]: value } as Partial<AppSettings>);
        },
        [patchSettings]
    );

    // ---- startup ----------------------------------------------------------
    // Runs exactly once. It used to list every piece of state it touched as a
    // dependency, so changing the log-line limit re-ran the whole sequence,
    // subscriptions and all.
    const startedRef = useRef(false);
    // Until the saved selection is restored, the empty initial one must not be
    // saved over it.
    const selectionRestoredRef = useRef(false);
    useEffect(() => {
        if (startedRef.current) {
            return;
        }
        startedRef.current = true;

        const start = async () => {
            appendLog(["NuggetVPN started."]);
            let saved: AppSettings["last_selection"] = null;
            let autoConnect = false;
            let autoUpdate = true;

            try {
                setPlatform(await invoke<string>("get_current_platform"));
            } catch {
                // Keep the default chrome; not worth bothering the user.
            }

            try {
                const stored = await invoke<AppSettings>("get_settings");
                setSettings(stored);
                saved = stored.last_selection;
                autoConnect = stored.auto_connect;
                autoUpdate = stored.subscription_auto_update !== false;

                if (!stored.auth_server && !stored.skip_auth) {
                    setShowOnboarding("welcome");
                }
                if (stored.pending_sync_upload && stored.auth_server && stored.auth_token) {
                    try {
                        await invoke("push_profiles_to_server", { settings: stored });
                        await saveSettings({ ...stored, pending_sync_upload: false });
                        appendLog(["Profiles synced to the server."]);
                    } catch (error) {
                        appendLog([`Profile sync failed: ${errorMessage(error)}`]);
                    }
                }
            } catch (error) {
                appendLog([`Could not load settings: ${errorMessage(error)}`]);
            }

            try {
                const loaded = await loadProfiles();
                // Back to the server picked last time. By id, or by name when
                // the provider has since changed that server's link.
                if (saved) {
                    const byId = loaded.find((profile) => profile.id === saved!.profile_id);
                    const byName = loaded.find(
                        (profile) =>
                            profileDomain(profile) === saved!.domain &&
                            profile.name === saved!.profile_name
                    );
                    const match = byId ?? byName;
                    setSelection(
                        reconcileSelection(loaded, {
                            domain: saved.domain,
                            mode: saved.mode,
                            profileId: match?.id ?? "",
                        })
                    );
                }

                // Before the subscription refresh, not after it: that can
                // take as long as a provider takes to time out, and the point
                // of connecting automatically is not waiting.
                if (autoConnect && loaded.length > 0) {
                    const target = reconcileSelection(loaded, {
                        domain: saved?.domain ?? "",
                        mode: saved?.mode ?? "auto",
                        profileId:
                            loaded.find((profile) => profile.id === saved?.profile_id)?.id ?? "",
                    });
                    appendLog(["Connecting automatically."]);
                    void connectRef
                        .current(target.domain, target.mode, target.profileId)
                        .catch((error) =>
                            appendLog([`Automatic connection failed: ${errorMessage(error)}`])
                        );
                }
            } catch (error) {
                appendLog([`Could not load profiles: ${errorMessage(error)}`]);
            }
            selectionRestoredRef.current = true;

            // Off means off: no refresh at start, none on a timer, for any
            // subscription. Refreshing by hand still works.
            if (!autoUpdate) {
                return;
            }
            try {
                const summary = await refreshAll();
                if (summary.refreshed || summary.failed || summary.skipped) {
                    appendLog([
                        `Subscriptions refreshed: ${summary.refreshed} updated, ` +
                            `${summary.failed} failed, ${summary.skipped} skipped.`,
                    ]);
                }
            } catch (error) {
                appendLog([`Subscription refresh failed: ${errorMessage(error)}`]);
            }
        };

        void start();
    }, [appendLog, loadProfiles, refreshAll, saveSettings]);

    // ---- periodic subscription refresh ---------------------------------------
    useEffect(() => {
        if (settings.subscription_auto_update === false) {
            return;
        }
        const timer = setInterval(() => {
            void refreshAll()
                .then((summary) => {
                    if (summary.refreshed || summary.failed) {
                        appendLog([
                            `Subscriptions refreshed: ${summary.refreshed} updated, ${summary.failed} failed.`,
                        ]);
                    }
                })
                .catch((error) => appendLog([`Subscription refresh failed: ${errorMessage(error)}`]));
        }, SUBSCRIPTION_REFRESH_MS);
        return () => clearInterval(timer);
    }, [settings.subscription_auto_update, refreshAll, appendLog]);

    // ---- remembering the selection -----------------------------------------
    useEffect(() => {
        if (!selectionRestoredRef.current || !selection.domain) {
            return;
        }
        const profile = profiles.find((item) => item.id === selection.profileId);
        const next = {
            domain: selection.domain,
            mode: selection.mode,
            profile_id: selection.profileId,
            profile_name: profile?.name ?? "",
        };
        const current = settingsRef.current.last_selection;
        if (
            current &&
            current.domain === next.domain &&
            current.mode === next.mode &&
            current.profile_id === next.profile_id &&
            current.profile_name === next.profile_name
        ) {
            return;
        }
        patchSettings({ last_selection: next });
    }, [selection, profiles, patchSettings]);

    // ---- public address ---------------------------------------------------
    const checkIp = useCallback(async () => {
        if (!settings.ip_check_enabled) {
            setIpInfo(null);
            return;
        }
        setIsCheckingIp(true);
        try {
            setIpInfo(await invoke<IpInfo>("check_ip"));
        } catch {
            setIpInfo(null);
        } finally {
            setIsCheckingIp(false);
        }
    }, [settings.ip_check_enabled]);

    useEffect(() => {
        if (!connection.isConnected || !settings.ip_check_enabled) {
            setIpInfo(null);
            return;
        }
        // Give routing a moment to settle before asking who we look like.
        const initial = setTimeout(() => void checkIp(), 2500);
        const interval = setInterval(() => void checkIp(), IP_RECHECK_MS);
        return () => {
            clearTimeout(initial);
            clearInterval(interval);
        };
    }, [connection.isConnected, settings.ip_check_enabled, checkIp]);

    // ---- latency ----------------------------------------------------------
    const refreshPings = useCallback(async () => {
        const domain = selection.domain.trim() || LOCAL;
        const inDomain = profiles.filter((profile) => profileDomain(profile) === domain);
        if (inDomain.length === 0) {
            setProfilePings({});
            return;
        }

        const next: Record<string, number | null> = {};
        inDomain.forEach((profile) => {
            next[profile.id] = null;
        });
        try {
            const results = await invoke<ProfilePing[]>("ping_profiles", {
                sourceDomain: domain,
            });
            results.forEach((result) => {
                next[result.id] = result.ping_ms ?? null;
            });
        } catch {
            // Leave every entry null; the view renders that as "n/a".
        }
        setProfilePings(next);
    }, [profiles, selection.domain]);

    // Re-measured while the server list or the home screen is showing, and
    // not while the window is hidden: each sweep is a process per server on
    // macOS and Linux, and the home screen is where the app sits.
    const pageVisible = usePageVisible();
    useEffect(() => {
        if (!pageVisible || (activeTab !== "proxies" && activeTab !== "connection")) {
            return;
        }
        void refreshPings();
        const interval = setInterval(() => void refreshPings(), activeTab === "proxies" ? 30_000 : 120_000);
        return () => clearInterval(interval);
    }, [activeTab, refreshPings, pageVisible]);

    useEffect(() => {
        if (connection.isConnected) {
            void refreshPings();
        }
    }, [connection.isConnected, refreshPings]);

    // ---- actions ----------------------------------------------------------
    const toggleConnection = useCallback(async () => {
        try {
            // Connected, reconnecting or held by the kill switch: the button
            // stops it.
            if (connection.isConnected || connection.state.reconnecting || connection.state.blocked) {
                await connection.disconnect();
                return;
            }
            if (profiles.length === 0) {
                toast.error(t("toast.noProfiles"), {
                    id: "no-profiles",
                });
                return;
            }
            await connection.connect(selection.domain, selection.mode, selection.profileId);
        } catch (error) {
            // The connection state already carries the message and the view
            // renders it; the toast is for when the user is on another tab.
            toast.error(errorMessage(error), { id: "connect" });
        }
    }, [connection, profiles.length, selection, t]);

    const handleAddProfile = useCallback(
        async (name: string, link: string) => {
            await addProfile(name, link);
            appendLog([`Profile "${name || link.slice(0, 40)}" added.`]);
            setActiveTab("configuration");
        },
        [addProfile, appendLog]
    );

    const handleImportSubscription = useCallback(
        async (url: string) => {
            await importSubscription(url);
            appendLog(["Subscription imported."]);
            setActiveTab("proxies");
        },
        [appendLog, importSubscription]
    );

    // What plugins reach the app through; see lib/plugin-host. Read through a
    // ref, so the host always sees the current state without re-rendering.
    const { language } = useI18n();
    const pluginState = useRef({ profiles, connection, selection, language, platform, addProfile, importSubscription, appendLog });
    pluginState.current = { profiles, connection, selection, language, platform, addProfile, importSubscription, appendLog };
    const pluginActions = useRef<HostActions>({
        connect: async (serverId) => {
            const { profiles: list, connection: current, selection: selected } = pluginState.current;
            const target = serverId ? list.find((profile) => profile.id === serverId) : undefined;
            if (target) {
                await current.connect(profileDomain(target), "manual", target.id);
            } else {
                await current.connect(selected.domain, selected.mode, selected.profileId);
            }
        },
        disconnect: () => pluginState.current.connection.disconnect(),
        addServer: async (name, link) => {
            await pluginState.current.addProfile(name, link);
            pluginState.current.appendLog([`A plugin added "${name || link.slice(0, 40)}".`]);
        },
        addSubscription: async (url) => {
            await pluginState.current.importSubscription(url);
            pluginState.current.appendLog(["A plugin added a subscription."]);
        },
        profiles: () => pluginState.current.profiles,
        state: () => pluginState.current.connection.state,
        language: () => pluginState.current.language,
        platform: () => pluginState.current.platform,
    }).current;

    /** The profiles a configuration source stands for. */
    const profilesOf = useCallback(
        (source: ConfigSource) => {
            if (source.kind === "profile") {
                return profiles.filter((profile) => profile.id === source.profileId);
            }
            const domain = source.domain.trim() || LOCAL;
            return profiles.filter((profile) => profileDomain(profile) === domain);
        },
        [profiles]
    );

    // One call for any number of sources: deleting them one by one would
    // save the profile list once per source.
    const handleDeleteSources = useCallback(
        async (list: ConfigSource[]) => {
            const ids = list.flatMap((source) => profilesOf(source).map((profile) => profile.id));
            if (ids.length === 0) {
                return;
            }

            try {
                const remaining = await deleteIds(ids);
                appendLog(
                    list.map((source) =>
                        source.kind === "profile"
                            ? `Profile "${source.label}" deleted.`
                            : `Configuration "${source.domain.trim() || LOCAL}" deleted.`
                    )
                );

                // A chain hop that no longer exists would fail the next connect
                // with a confusing error, so prune it here.
                if (settings.proxy_chain.length > 0) {
                    const alive = new Set(remaining.map((profile) => profile.id));
                    const chain = settings.proxy_chain.filter((id) => alive.has(id));
                    if (chain.length !== settings.proxy_chain.length) {
                        await saveSettings({ ...settings, proxy_chain: chain });
                    }
                }
            } catch (error) {
                toast.error(t("toast.deleteFailed", { error: errorMessage(error) }));
            }
        },
        [appendLog, deleteIds, profilesOf, saveSettings, settings, t]
    );
    const handleDeleteSource = useCallback(
        (source: ConfigSource) => handleDeleteSources([source]),
        [handleDeleteSources]
    );

    /** Refreshes one subscription; reports whether it worked. */
    const refreshOne = useCallback(
        async (domain: string, quiet: boolean) => {
            setRefreshingDomain(domain);
            try {
                const summary = await refreshDomain(domain);
                appendLog([
                    `${domain}: ${summary.refreshed} updated, ${summary.failed} failed, ` +
                        `${summary.skipped} skipped.`,
                ]);
                if (!quiet) toast.success(t("toast.refreshed", { name: domain }), { id: `refresh-${domain}` });
                return true;
            } catch (error) {
                const message = errorMessage(error);
                appendLog([`Refresh failed for ${domain}: ${message}`]);
                toast.error(t("toast.refreshFailed", { name: domain, error: message.slice(0, 200) }), {
                    id: `refresh-${domain}`,
                });
                return false;
            } finally {
                setRefreshingDomain("");
            }
        },
        [appendLog, refreshDomain, t]
    );

    // One after another: they write the same profile list, and the card
    // being refreshed shows its spinner in turn.
    const handleRefreshSources = useCallback(
        async (list: ConfigSource[]) => {
            const domains = list
                .filter((source) => source.kind === "subscription")
                .map((source) => source.domain.trim())
                .filter((domain) => domain && domain !== LOCAL);
            if (domains.length === 1) {
                await refreshOne(domains[0], false);
                return;
            }
            let refreshed = 0;
            for (const domain of domains) {
                if (await refreshOne(domain, true)) refreshed++;
            }
            if (refreshed > 0) {
                toast.success(t("configuration.bulk.refreshed", { count: refreshed }), { id: "refresh-bulk" });
            }
        },
        [refreshOne, t]
    );
    const handleRefreshSource = useCallback(
        (source: ConfigSource) => handleRefreshSources([source]),
        [handleRefreshSources]
    );

    // A subscription's address, or a single profile's share link: what it
    // takes to add the same thing on another device.
    const linkOf = useCallback(
        (source: ConfigSource) => {
            const members = profilesOf(source);
            return source.kind === "subscription"
                ? members.find((profile) => profile.subscription_url)?.subscription_url ?? ""
                : members[0]?.config_link ?? "";
        },
        [profilesOf]
    );
    const profileIdsOf = useCallback((source: ConfigSource) => profilesOf(source).map((profile) => profile.id), [profilesOf]);
    const handleCopySources = useCallback(
        async (list: ConfigSource[]) => {
            const links = list.map(linkOf).filter(Boolean);
            if (links.length === 0) {
                toast.error(t("configuration.bulk.nothingToCopy"), { id: "copy-links" });
                return;
            }
            try {
                await navigator.clipboard.writeText(links.join("\n"));
                toast.success(t("configuration.bulk.copied", { count: links.length }), { id: "copy-links" });
            } catch (error) {
                toast.error(errorMessage(error), { id: "copy-links" });
            }
        },
        [linkOf, t]
    );

    // Proxies screen actions.
    const testProfiles = useCallback(
        async (ids?: string[]) => {
            if (!ids) {
                await refreshPings();
                return;
            }
            const domain = selection.domain.trim() || LOCAL;
            setProfilePings((current) => {
                const next = { ...current };
                ids.forEach((id) => delete next[id]);
                return next;
            });
            try {
                const results = await invoke<ProfilePing[]>("probe_profiles_connectivity", {
                    sourceDomain: domain,
                    profileIds: ids,
                    timeoutMs: 2500,
                });
                setProfilePings((current) => {
                    const next = { ...current };
                    ids.forEach((id) => (next[id] = null));
                    results.forEach((result) => (next[result.id] = result.ping_ms ?? null));
                    return next;
                });
            } catch (error) {
                toast.error(errorMessage(error), { id: "test-profiles" });
            }
        },
        [refreshPings, selection.domain]
    );

    const setFavorites = useCallback(
        async (ids: string[], favorite: boolean) => {
            try {
                setProfiles(await invoke<Profile[]>("set_favorites", { ids, favorite }));
            } catch (error) {
                toast.error(errorMessage(error), { id: "favorites" });
            }
        },
        [setProfiles]
    );

    // Added hops go after the existing ones, in list order; the connected
    // exit cannot also be a hop.
    const addToChain = useCallback(
        async (ids: string[]) => {
            const chain = [...settings.proxy_chain];
            ids.forEach((id) => {
                if (!chain.includes(id) && !(selection.mode === "manual" && selection.profileId === id)) chain.push(id);
            });
            await saveSettings({ ...settings, proxy_chain: chain, proxy_chain_enabled: true });
            toast.success(t("proxies.bulk.chained", { count: chain.length }), { id: "chain" });
        },
        [saveSettings, selection.mode, selection.profileId, settings, t]
    );

    const deleteProfiles = useCallback(
        async (ids: string[]) => {
            try {
                const remaining = await deleteIds(ids);
                const alive = new Set(remaining.map((profile) => profile.id));
                const chain = settings.proxy_chain.filter((id) => alive.has(id));
                if (chain.length !== settings.proxy_chain.length) {
                    await saveSettings({ ...settings, proxy_chain: chain });
                }
            } catch (error) {
                toast.error(t("toast.deleteFailed", { error: errorMessage(error) }));
            }
        },
        [deleteIds, saveSettings, settings, t]
    );

    const handleDumpLogs = useCallback(async () => {
        try {
            const path = await save({ defaultPath: "nuggetvpn-logs.txt" });
            if (!path) {
                return;
            }
            // Colour codes are for the live view; a text file gets plain text.
            await writeTextFile(path, logs.map(stripAnsi).join("\n"));
            toast.success(t("toast.logsExported"));
        } catch (error) {
            toast.error(t("toast.exportFailed", { error: errorMessage(error) }));
        }
    }, [logs, t]);

    const selectSource = useCallback(
        (source: ConfigSource, focusProxies: boolean) => {
            if (source.kind === "profile") {
                setSelection({
                    domain: LOCAL,
                    mode: "manual",
                    profileId: source.profileId,
                });
            } else {
                setSelection((current) => {
                    const domain = source.domain.trim() || LOCAL;
                    const stillValid = profiles.some(
                        (profile) =>
                            profile.id === current.profileId &&
                            profileDomain(profile) === domain
                    );
                    return stillValid
                        ? { ...current, domain }
                        : { domain, mode: "auto", profileId: "" };
                });
            }
            if (focusProxies) {
                setActiveTab("proxies");
            }
        },
        [profiles, setSelection]
    );

    const handleSelectProxy = useCallback(
        (id: string) => {
            const profile = profiles.find((item) => item.id === id);
            if (!profile) {
                return;
            }
            if (settings.proxy_chain_enabled && settings.proxy_chain.includes(id)) {
                // A hop cannot also be the exit.
                void saveSettings({
                    ...settings,
                    proxy_chain: settings.proxy_chain.filter((entry) => entry !== id),
                });
            }
            setSelection({
                domain: profileDomain(profile),
                mode: "manual",
                profileId: id,
            });
        },
        [profiles, settings, saveSettings, setSelection]
    );

    const handleSelectAuto = useCallback(() => {
        setSelection((current) => ({
            ...current,
            mode: "auto",
            profileId: "",
        }));
    }, [setSelection]);

    // Clicking Settings while already in it goes back to its category list,
    // the way a second tap on a tab returns to its top level.
    const [settingsHome, setSettingsHome] = useState(0);
    const changeTab = (tab: string) => {
        if (tab === "settings" && activeTab === "settings") {
            setSettingsHome((count) => count + 1);
            return;
        }
        startTransition(() => setActiveTab(tab));
    };
    // On a phone, Back from any other tab returns to Connection before it
    // leaves the app.
    useBack(activeTab !== "connection", () => startTransition(() => setActiveTab("connection")));
    const isMac = platform === "macos";
    // A phone: no window to control, and the page is the whole screen.
    const isPhone = platform === "android" || platform === "ios";
    const navPosition = isMobile ? "top" : (appearance.prefs.layout?.navPosition || "top");

    const unifiedHeaderElement = (
        <UnifiedHeader
            activeTab={activeTab}
            onTabChange={changeTab}
            onClose={appWindow.close}
            onMinimize={appWindow.minimize}
            onMaximize={appWindow.toggleMaximize}
            platform={platform}
            sources={sources}
            selectedSourceDomain={selection.domain}
            selectedProfileId={selection.profileId}
            locked={connection.isConnected || connection.isBusy}
            onSourceSelect={(source) => selectSource(source, false)}
            onAddProfile={() => setIsModalOpen(true)}
            profiles={profiles}
            profilePings={profilePings}
            selectedProxyMode={selection.mode}
            onSelectProxy={handleSelectProxy}
            onSelectAuto={handleSelectAuto}
            connectionState={connection.state}
            traffic={traffic}
            onToggleConnection={toggleConnection}
        />
    );

    return (
        <PluginsProvider actions={pluginActions}>
        <main className="h-full overflow-hidden">
            <Toaster
                position="top-center"
                containerStyle={{
                    top: "calc(env(safe-area-inset-top, 0px) + 64px)",
                    zIndex: 99999,
                }}
                toastOptions={{
                    className: "shadow-lg",
                    style: {
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        border: "1px solid var(--border)",
                        // Errors can quote a long unbroken string (a link, a
                        // response body); wrap it rather than run off screen.
                        overflowWrap: "anywhere",
                    },
                }}
            />
            <AddModal
                isOpen={isModalOpen}
                initialLink={offeredLink}
                onClose={() => {
                    setIsModalOpen(false);
                    setOfferedLink("");
                }}
                onSaveProfile={handleAddProfile}
                onImportSubscription={handleImportSubscription}
            />

            {showOnboarding === "welcome" ? (
                <Welcome
                    platform={platform}
                    settings={settings}
                    theme={theme}
                    setTheme={setTheme}
                    onSettingChange={updateSetting}
                    profileCount={profiles.length}
                    onImportSubscription={handleImportSubscription}
                    onSaveProfile={handleAddProfile}
                    onOpenAddDialog={() => setIsModalOpen(true)}
                    onFinish={() => {
                        // Marks the first start as done, so it is not shown again.
                        updateSetting("skip_auth", true);
                        // Adding a subscription moves to its server list; the
                        // first thing after setup should be the connect button.
                        startTransition(() => {
                            setShowOnboarding(false);
                            setActiveTab("connection");
                        });
                    }}
                />
            ) : showOnboarding === "sync" ? (
                <Onboarding
                    settings={settings}
                    onComplete={() => startTransition(() => setShowOnboarding(false))}
                    onSettingsChange={setSettings}
                />
            ) : null}

            <div className={cn(
                "h-full overflow-hidden bg-background",
                navPosition === "sidebar-left" || navPosition === "sidebar-right" ? "flex flex-row" : "flex flex-col"
            )}>
                {/* 1. Left Sidebar Mode */}
                {navPosition === "sidebar-left" ? (
                    <DesktopSidebarNav
                        position="left"
                        activeTab={activeTab}
                        onTabChange={changeTab}
                        onClose={appWindow.close}
                        onMinimize={appWindow.minimize}
                        onMaximize={appWindow.toggleMaximize}
                        platform={platform}
                        sources={sources}
                        selectedSourceDomain={selection.domain}
                        selectedProfileId={selection.profileId}
                        locked={connection.isConnected || connection.isBusy}
                        onSourceSelect={(source) => selectSource(source, false)}
                        onAddProfile={() => setIsModalOpen(true)}
                        profiles={profiles}
                        profilePings={profilePings}
                        selectedProxyMode={selection.mode}
                        onSelectProxy={handleSelectProxy}
                        onSelectAuto={handleSelectAuto}
                        connectionState={connection.state}
                        traffic={traffic}
                    />
                ) : null}

                {/* 2. Top Header (TopBar or WindowDragHeader for Bottom mode) */}
                {navPosition === "top" ? (
                    unifiedHeaderElement
                ) : navPosition === "bottom" ? (
                    <WindowDragHeader
                        platform={platform}
                        onClose={appWindow.close}
                        onMinimize={appWindow.minimize}
                        onMaximize={appWindow.toggleMaximize}
                        showControls={true}
                        showBrand={true}
                        showServerSelector={true}
                        sources={sources}
                        selectedSourceDomain={selection.domain}
                        selectedProfileId={selection.profileId}
                        locked={connection.isConnected || connection.isBusy}
                        onSourceSelect={(source) => selectSource(source, false)}
                        onAddProfile={() => setIsModalOpen(true)}
                        profiles={profiles}
                        profilePings={profilePings}
                        selectedProxyMode={selection.mode}
                        onSelectProxy={handleSelectProxy}
                        onSelectAuto={handleSelectAuto}
                        connectionState={connection.state}
                        onTabChange={changeTab}
                    />
                ) : null}

                {/* Main Content Viewport */}
                <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
                    {/* Top drag bar if in sidebar mode */}
                    {navPosition === "sidebar-left" ? (
                        <WindowDragHeader
                            platform={platform}
                            onClose={appWindow.close}
                            onMinimize={appWindow.minimize}
                            onMaximize={appWindow.toggleMaximize}
                            showControls={!isMac}
                            showBrand={false}
                            showServerSelector={false}
                            onTabChange={changeTab}
                        />
                    ) : navPosition === "sidebar-right" ? (
                        <WindowDragHeader
                            platform={platform}
                            onClose={appWindow.close}
                            onMinimize={appWindow.minimize}
                            onMaximize={appWindow.toggleMaximize}
                            showControls={isMac}
                            showBrand={true}
                            showServerSelector={false}
                            onTabChange={changeTab}
                        />
                    ) : null}

                    <div className="flex-1 relative overflow-hidden">
                    {activeTab === "connection" && (
                        <ConnectionView
                            key="connection"
                            state={connection.state}
                            traffic={traffic}
                            onToggle={toggleConnection}
                            onDismissError={connection.dismissError}
                            ipInfo={ipInfo}
                            isCheckingIp={isCheckingIp}
                            ipCheckEnabled={settings.ip_check_enabled !== false}
                            profiles={profiles}
                            profilePings={profilePings}
                            selectedProxyMode={selection.mode}
                            selectedProfileId={selection.profileId}
                            onSelectProxy={handleSelectProxy}
                            onSelectAuto={handleSelectAuto}
                            onNavigateTab={changeTab}
                            core={settings.core}
                            mtu={settings.mtu}
                            killSwitch={settings.kill_switch}
                        />
                    )}

                                {activeTab === "settings" && (
                                    <SettingsView
                                        platform={platform}
                                        homeSignal={settingsHome}
                                        openSignal={settingsOpen}
                                        theme={theme}
                                        setTheme={setTheme}
                                        appSettings={settings}
                                        profiles={profiles}
                                        selectedProfileId={selection.profileId}
                                        onSettingsChange={updateSetting}
                                        onConnectSync={() =>
                                            startTransition(() => setShowOnboarding("sync"))
                                        }
                                        onRestartWelcome={() =>
                                            startTransition(() => setShowOnboarding("welcome"))
                                        }
                                        onDisconnectSync={() => {
                                            void saveSettings({
                                                ...settings,
                                                auth_server: null,
                                                auth_token: null,
                                                skip_auth: false,
                                            });
                                        }}
                                        onRegenerateHWID={() => {
                                            // Go owns the format, so it mints
                                            // the value and returns the saved
                                            // settings.
                                            void invoke<AppSettings>("regenerate_hwid")
                                                .then(setSettings)
                                                .catch((error) =>
                                                    toast.error(
                                                        t("toast.hwidFailed", { error: errorMessage(error) })
                                                    )
                                                );
                                        }}
                                    />
                                )}

                                {activeTab === "routing" && (
                                    <RoutingView
                                        settings={settings}
                                        onChange={patchSettings}
                                        onReplace={setSettings}
                                        profiles={profiles}
                                        connected={connection.isConnected}
                                    />
                                )}

                                {activeTab === "connections" && (
                                    <ConnectionsView
                                        connected={connection.isConnected}
                                        rules={settings.routing_rules ?? []}
                                        profiles={profiles}
                                    />
                                )}

                                {activeTab === "statistics" && (
                                    <StatisticsView key="statistics" profiles={profiles} settings={settings} onSettingsChange={updateSetting} />
                                )}

                                {activeTab === "logs" && (
                                    <LogsView
                                        enabled={settings.logging_enabled !== false}
                                        onEnable={() => updateSetting("logging_enabled", true)}
                                        logs={logs}
                                        logLimit={logLimit}
                                        onLogLimitChange={changeLimit}
                                        onDumpLogs={handleDumpLogs}
                                        onClear={clearLogs}
                                    />
                                )}

                                {activeTab === "proxies" && (
                                    <ProxiesView
                                        profiles={profiles}
                                        profilePings={profilePings}
                                        selectedSourceDomain={selection.domain}
                                        selectedProxyMode={selection.mode}
                                        selectedProfileId={selection.profileId}
                                        isRefreshingSource={
                                            refreshingDomain === (selection.domain.trim() || LOCAL)
                                        }
                                        onSelectProxy={handleSelectProxy}
                                        onSelectAuto={handleSelectAuto}
                                        onRefreshSource={() => {
                                            const source = sources.find(
                                                (item) =>
                                                    item.kind === "subscription" &&
                                                    item.domain === selection.domain
                                            );
                                            if (source) {
                                                void handleRefreshSource(source);
                                            }
                                        }}
                                        onTest={testProfiles}
                                        onSetFavorite={setFavorites}
                                        onAddToChain={addToChain}
                                        onDelete={deleteProfiles}
                                        onUpdateProfile={updateProfile}
                                    />
                                )}

                                {activeTab === "configuration" && (
                                    <ConfigurationView
                                        sources={sources}
                                        profiles={profiles}
                                        selectedSource={selection.domain}
                                        selectedProfileId={selection.profileId}
                                        refreshingSourceDomain={refreshingDomain}
                                        onSelectSource={(source) => selectSource(source, true)}
                                        onDeleteSource={handleDeleteSource}
                                        onRefreshSource={handleRefreshSource}
                                        onDeleteSources={handleDeleteSources}
                                        onRefreshSources={handleRefreshSources}
                                        onCopySources={handleCopySources}
                                        onUpdateSubscriptionUrl={updateSubscriptionUrl}
                                        onUpdateProfile={updateProfile}
                                        linkOf={linkOf}
                                        profileIdsOf={profileIdsOf}
                                        onAdd={() => setIsModalOpen(true)}
                                    />
                                )}
                    </div>
                </div>

                {/* 3. Right Sidebar Mode */}
                {navPosition === "sidebar-right" ? (
                    <DesktopSidebarNav
                        position="right"
                        activeTab={activeTab}
                        onTabChange={changeTab}
                        onClose={appWindow.close}
                        onMinimize={appWindow.minimize}
                        onMaximize={appWindow.toggleMaximize}
                        platform={platform}
                        sources={sources}
                        selectedSourceDomain={selection.domain}
                        selectedProfileId={selection.profileId}
                        locked={connection.isConnected || connection.isBusy}
                        onSourceSelect={(source) => selectSource(source, false)}
                        onAddProfile={() => setIsModalOpen(true)}
                        profiles={profiles}
                        profilePings={profilePings}
                        selectedProxyMode={selection.mode}
                        onSelectProxy={handleSelectProxy}
                        onSelectAuto={handleSelectAuto}
                        connectionState={connection.state}
                        traffic={traffic}
                    />
                ) : null}

                {/* 4. Bottom Dock Mode */}
                {navPosition === "bottom" ? (
                    <BottomDockNav activeTab={activeTab} onTabChange={changeTab} />
                ) : null}

                {/* Mobile Responsive Bottom Nav */}
                {isMobile ? (
                    <div className="md:hidden shrink-0">
                        <BottomNav activeTab={activeTab} onTabChange={changeTab} />
                    </div>
                ) : null}
            </div>
        </main>
        </PluginsProvider>
    );
}

export default App;
