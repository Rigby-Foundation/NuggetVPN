import { startTransition, useCallback, useEffect, useRef, useState } from "react";
// @ts-expect-error - React experimental ViewTransition type not in stable defs.
import { ViewTransition } from "react";
import toast, { Toaster } from "react-hot-toast";

import { appWindow, errorMessage, invoke, save, writeTextFile } from "@/lib/backend";

import AddModal from "@/components/AddModal";
import Onboarding from "@/components/Onboarding";
import AppSidebar from "@/components/layout/AppSidebar";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import TopBar from "@/components/layout/TopBar";
import { WindowControls } from "@/components/layout/WindowControls";
import ConnectionView from "@/components/views/ConnectionView";
import ConfigurationView from "@/components/views/ConfigurationView";
import LogsView from "@/components/views/LogsView";
import ProxiesView from "@/components/views/ProxiesView";
import SettingsView from "@/components/views/SettingsView";
import { useTheme } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useConnection } from "@/hooks/use-connection";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLogs } from "@/hooks/use-logs";
import { LOCAL, profileDomain, useProfiles } from "@/hooks/use-profiles";
import { useTraffic } from "@/hooks/use-traffic";
import { cn } from "@/lib/utils";
import { AppSettings, ConfigSource, IpInfo, ProfilePing } from "@/types";

import "./App.css";

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
    auth_server: null,
    auth_token: null,
    skip_auth: false,
    pending_sync_upload: false,
    routing_mode: "all",
    routing_apps: [],
    routing_domains: [],
    proxy_chain_enabled: false,
    proxy_chain: [],
    proxy_chain_exit: "",
};

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
    if (agent.includes("Windows")) return "windows";
    if (agent.includes("Mac OS")) return "macos";
    return "linux";
}

function App() {
    const { theme, setTheme } = useTheme();
    const isMobile = useIsMobile();

    const {
        profiles,
        sources,
        selection,
        setSelection,
        load: loadProfiles,
        addProfile,
        importSubscription,
        deleteIds,
        refreshDomain,
        refreshAll,
    } = useProfiles();
    const connection = useConnection();
    const traffic = useTraffic(connection.isConnected);
    const { logs, limit: logLimit, changeLimit, append: appendLog, clear: clearLogs } = useLogs();

    const [settings, setSettings] = useState<AppSettings>(PENDING_SETTINGS);
    const [activeTab, setActiveTab] = useState("connection");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [platform, setPlatform] = useState(guessPlatform);
    const [profilePings, setProfilePings] = useState<Record<string, number | null>>({});
    const [refreshingDomain, setRefreshingDomain] = useState("");
    const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
    const [isCheckingIp, setIsCheckingIp] = useState(false);

    const saveSettings = useCallback(async (next: AppSettings) => {
        // Go normalises and returns the canonical value, so the UI holds
        // exactly what was persisted rather than its own idea of it.
        const stored = await invoke<AppSettings>("save_settings", { settings: next });
        setSettings(stored);
        return stored;
    }, []);

    // settingsRef mirrors the latest settings so updateSetting can build the
    // next value without depending on `settings` and being rebuilt on every
    // keystroke in the settings form.
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const updateSetting = useCallback(
        <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
            // The save happens here, not inside a setSettings updater. React may
            // invoke an updater more than once for a single change, so a request
            // fired from inside one produces duplicate saves — and, when they
            // fail, a stack of identical error toasts.
            const next = { ...settingsRef.current, [key]: value };
            setSettings(next);
            void saveSettings(next).catch((error) =>
                toast.error(`Could not save settings: ${errorMessage(error)}`, {
                    id: "save-settings",
                })
            );
        },
        [saveSettings]
    );

    // ---- startup ----------------------------------------------------------
    // Runs exactly once. It used to list every piece of state it touched as a
    // dependency, so changing the log-line limit re-ran the whole sequence,
    // subscriptions and all.
    const startedRef = useRef(false);
    useEffect(() => {
        if (startedRef.current) {
            return;
        }
        startedRef.current = true;

        const start = async () => {
            appendLog(["NuggetVPN started."]);

            try {
                setPlatform(await invoke<string>("get_current_platform"));
            } catch {
                // Keep the default chrome; not worth bothering the user.
            }

            try {
                const stored = await invoke<AppSettings>("get_settings");
                setSettings(stored);

                if (!stored.auth_server && !stored.skip_auth) {
                    setShowOnboarding(true);
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
                await loadProfiles();
            } catch (error) {
                appendLog([`Could not load profiles: ${errorMessage(error)}`]);
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

    useEffect(() => {
        if (activeTab !== "proxies") {
            return;
        }
        void refreshPings();
        const interval = setInterval(() => void refreshPings(), 30_000);
        return () => clearInterval(interval);
    }, [activeTab, refreshPings]);

    // ---- actions ----------------------------------------------------------
    const toggleConnection = useCallback(async () => {
        try {
            if (connection.isConnected) {
                await connection.disconnect();
                return;
            }
            if (profiles.length === 0) {
                toast.error("Add a profile or import a subscription first.", {
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
    }, [connection, profiles.length, selection]);

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

    const handleDeleteSource = useCallback(
        async (source: ConfigSource) => {
            const domain =
                source.kind === "subscription" ? source.domain.trim() || LOCAL : LOCAL;
            const ids =
                source.kind === "profile"
                    ? [source.profileId]
                    : profiles
                          .filter((profile) => profileDomain(profile) === domain)
                          .map((profile) => profile.id);
            if (ids.length === 0) {
                return;
            }

            try {
                const remaining = await deleteIds(ids);
                appendLog([
                    source.kind === "profile"
                        ? `Profile "${source.label}" deleted.`
                        : `Configuration "${domain}" deleted.`,
                ]);

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
                toast.error(`Delete failed: ${errorMessage(error)}`);
            }
        },
        [appendLog, deleteIds, profiles, saveSettings, settings]
    );

    const handleRefreshSource = useCallback(
        async (source: ConfigSource) => {
            if (source.kind !== "subscription") {
                return;
            }
            const domain = source.domain.trim();
            if (!domain || domain === LOCAL) {
                return;
            }

            setRefreshingDomain(domain);
            try {
                const summary = await refreshDomain(domain);
                appendLog([
                    `${domain}: ${summary.refreshed} updated, ${summary.failed} failed, ` +
                        `${summary.skipped} skipped.`,
                ]);
                toast.success(`Refreshed ${domain}`, { id: `refresh-${domain}` });
            } catch (error) {
                const message = errorMessage(error);
                appendLog([`Refresh failed for ${domain}: ${message}`]);
                toast.error(`Could not refresh ${domain}: ${message.slice(0, 200)}`, {
                    id: `refresh-${domain}`,
                });
            } finally {
                setRefreshingDomain("");
            }
        },
        [appendLog, refreshDomain]
    );

    const handleDumpLogs = useCallback(async () => {
        try {
            const path = await save({ defaultPath: "nuggetvpn-logs.txt" });
            if (!path) {
                return;
            }
            await writeTextFile(path, logs.join("\n"));
            toast.success("Logs exported.");
        } catch (error) {
            toast.error(`Export failed: ${errorMessage(error)}`);
        }
    }, [logs]);

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

    const changeTab = (tab: string) => startTransition(() => setActiveTab(tab));
    const isMac = platform === "macos";

    return (
        <main className="h-full overflow-hidden">
            <Toaster
                position="top-center"
                toastOptions={{
                    className: "shadow-lg",
                    style: {
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        border: "1px solid var(--border)",
                    },
                }}
            />
            <AddModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSaveProfile={handleAddProfile}
                onImportSubscription={handleImportSubscription}
            />

            {showOnboarding ? (
                <Onboarding
                    settings={settings}
                    onComplete={() => startTransition(() => setShowOnboarding(false))}
                    onSettingsChange={setSettings}
                />
            ) : null}

            <SidebarProvider>
                <AppSidebar
                    activeTab={activeTab}
                    onTabChange={changeTab}
                    onClose={appWindow.close}
                    onMinimize={appWindow.minimize}
                    onMaximize={appWindow.toggleMaximize}
                    platform={platform}
                    status={connection.state.status}
                />
                <SidebarInset
                    className={cn(
                        "overflow-hidden flex flex-col",
                        !isMac && "bg-transparent! m-0! p-0! shadow-none! rounded-none!"
                    )}
                >
                    {!isMac ? (
                        <div className="bg-inset z-50">
                            <WindowControls
                                onClose={appWindow.close}
                                onMinimize={appWindow.minimize}
                                onMaximize={appWindow.toggleMaximize}
                            />
                        </div>
                    ) : null}
                    <div
                        className={cn(
                            "flex-1 flex flex-col overflow-hidden",
                            isMac
                                ? "px-2 pb-4 pt-2"
                                : "bg-background m-2 mt-0 border rounded-[var(--window-radius)] shadow-sm"
                        )}
                    >
                        {isMac && isMobile ? (
                            <div className="drag-region h-8 px-4 flex items-center shrink-0">
                                <MacWindowControls
                                    onClose={appWindow.close}
                                    onMinimize={appWindow.minimize}
                                    onMaximize={appWindow.toggleMaximize}
                                />
                            </div>
                        ) : null}

                        <TopBar
                            sources={sources}
                            selectedSourceDomain={selection.domain}
                            selectedProfileId={selection.profileId}
                            locked={connection.isConnected || connection.isBusy}
                            onSourceSelect={(source) => selectSource(source, false)}
                            onAddProfile={() => setIsModalOpen(true)}
                        />

                        <ViewTransition name="app-content">
                            <div className="flex-1 relative overflow-hidden">
                                {activeTab === "connection" && (
                                    <ConnectionView
                                        state={connection.state}
                                        traffic={traffic}
                                        onToggle={toggleConnection}
                                        onDismissError={connection.dismissError}
                                        ipInfo={ipInfo}
                                        isCheckingIp={isCheckingIp}
                                        ipCheckEnabled={settings.ip_check_enabled !== false}
                                    />
                                )}

                                {activeTab === "settings" && (
                                    <SettingsView
                                        theme={theme}
                                        setTheme={setTheme}
                                        appSettings={settings}
                                        profiles={profiles}
                                        selectedProfileId={selection.profileId}
                                        onSettingsChange={updateSetting}
                                        onConnectSync={() =>
                                            startTransition(() => setShowOnboarding(true))
                                        }
                                        onDisconnectSync={() => {
                                            void saveSettings({
                                                ...settings,
                                                auth_server: null,
                                                auth_token: null,
                                                skip_auth: false,
                                            });
                                        }}
                                    />
                                )}

                                {activeTab === "logs" && (
                                    <LogsView
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
                                        onSelectProxy={(id) => {
                                            const profile = profiles.find(
                                                (item) => item.id === id
                                            );
                                            if (!profile) {
                                                return;
                                            }
                                            if (
                                                settings.proxy_chain_enabled &&
                                                settings.proxy_chain.includes(id)
                                            ) {
                                                // A hop cannot also be the exit.
                                                void saveSettings({
                                                    ...settings,
                                                    proxy_chain: settings.proxy_chain.filter(
                                                        (entry) => entry !== id
                                                    ),
                                                });
                                            }
                                            setSelection({
                                                domain: profileDomain(profile),
                                                mode: "manual",
                                                profileId: id,
                                            });
                                        }}
                                        onSelectAuto={() =>
                                            setSelection((current) => ({
                                                ...current,
                                                mode: "auto",
                                                profileId: "",
                                            }))
                                        }
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
                                    />
                                )}

                                {activeTab === "configuration" && (
                                    <ConfigurationView
                                        sources={sources}
                                        selectedSource={selection.domain}
                                        selectedProfileId={selection.profileId}
                                        refreshingSourceDomain={refreshingDomain}
                                        onSelectSource={(source) => selectSource(source, true)}
                                        onDeleteSource={handleDeleteSource}
                                        onRefreshSource={handleRefreshSource}
                                        onAdd={() => setIsModalOpen(true)}
                                    />
                                )}
                            </div>
                        </ViewTransition>
                    </div>
                </SidebarInset>
            </SidebarProvider>
        </main>
    );
}

export default App;
