import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
// @ts-expect-error - React experimental ViewTransition type not in stable defs.
import { ViewTransition } from "react";
import toast, { Toaster } from "react-hot-toast";

import { appWindow, invoke, listen, save, writeTextFile } from "@/lib/backend";

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
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AppSettings, ConfigSource, IpInfo, Profile, ProfilePing } from "@/types";
import { useIsMobile } from "@/hooks/use-mobile";

import "./App.css";

const defaultSettings: AppSettings = {
  mtu: 9000,
  dns: "1.1.1.1",
  tls_fragment: false,
  tls_fragment_size: "100-200",
  tls_fragment_sleep: "10-20",
  tls_mixed_sni_case: false,
  tls_padding: false,
  sni_spoof_enabled: false,
  sni_spoof_value: "",
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

const resolveProfileDomain = (profile: Profile) =>
  (profile.source_domain || "").trim() || "local";

function App() {
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("connection");
  const [selectedConfigDomain, setSelectedConfigDomain] = useState("local");
  const [selectedProxyMode, setSelectedProxyMode] = useState<"manual" | "auto">(
    "manual"
  );
  const [profilePings, setProfilePings] = useState<Record<string, number | null>>(
    {}
  );

  const [, setStatus] = useState("Ready");
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logLimit, setLogLimit] = useState("999999");
  const logContainerRef = useRef<HTMLDivElement>(null);
  const selectedConfigDomainRef = useRef(selectedConfigDomain);
  const selectedProfileIdRef = useRef(selectedProfileId);
  const selectedProxyModeRef = useRef(selectedProxyMode);

  const [duration, setDuration] = useState("00:00:00");
  const [uploadSpeed, setUploadSpeed] = useState("0 KB/s");
  const [downloadSpeed, setDownloadSpeed] = useState("0 KB/s");
  const [totalUp, setTotalUp] = useState("0 MB");
  const [totalDown, setTotalDown] = useState("0 MB");

  const startTimeRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ipCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionUpRef = useRef(0);
  const sessionDownRef = useRef(0);
  const lastSavedSessionUpRef = useRef(0);
  const lastSavedSessionDownRef = useRef(0);

  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
  const [isCheckingIp, setIsCheckingIp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [platform, setPlatform] = useState("macos");
  const [refreshingSourceDomain, setRefreshingSourceDomain] = useState("");

  const winClose = () => appWindow.close();
  const winMinimize = () => appWindow.minimize();
  const winMaximize = () => appWindow.toggleMaximize();

  const sources = useMemo<ConfigSource[]>(() => {
    const subscriptionCounts = new Map<string, number>();
    const localProfiles: Profile[] = [];

    profiles.forEach((profile) => {
      const domain = resolveProfileDomain(profile);
      if (domain === "local") {
        localProfiles.push(profile);
        return;
      }
      subscriptionCounts.set(domain, (subscriptionCounts.get(domain) ?? 0) + 1);
    });

    const localEntries: ConfigSource[] = localProfiles
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((profile) => ({
        kind: "profile" as const,
        key: `profile:${profile.id}`,
        domain: "local" as const,
        label: profile.name,
        detail: profile.protocol,
        profileId: profile.id,
      }));

    const subscriptionEntries: ConfigSource[] = Array.from(
      subscriptionCounts.entries()
    )
      .map(([domain, count]) => ({
        kind: "subscription" as const,
        key: `subscription:${domain}`,
        domain,
        label: domain,
        detail: `${count} ${count === 1 ? "proxy" : "proxies"}`,
        count,
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return [...localEntries, ...subscriptionEntries];
  }, [profiles]);

  const saveSettings = useCallback(async (settings: AppSettings) => {
    await invoke("save_settings", { settings });
  }, []);

  const fetchIpInfo = useCallback(async (timeoutMs = 8000): Promise<IpInfo | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://ipinfo.io/json", { signal: controller.signal });
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      const ip = typeof data?.ip === "string" ? data.ip : "";
      if (!ip) {
        return null;
      }
      return {
        ip,
        region: typeof data?.region === "string" ? data.region : "",
      };
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const checkIp = useCallback(async () => {
    setIsCheckingIp(true);
    try {
      const info = await fetchIpInfo();
      if (info) {
        setIpInfo(info);
      }
    } finally {
      setIsCheckingIp(false);
    }
  }, [fetchIpInfo]);

  const startIpCheck = useCallback(() => {
    if (ipCheckIntervalRef.current) {
      clearInterval(ipCheckIntervalRef.current);
    }
    // Check IP every 5 minutes
    ipCheckIntervalRef.current = setInterval(() => {
      checkIp();
    }, 5 * 60 * 1000);
  }, [checkIp]);

  const stopIpCheck = useCallback(() => {
    if (ipCheckIntervalRef.current) {
      clearInterval(ipCheckIntervalRef.current);
      ipCheckIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    selectedConfigDomainRef.current = selectedConfigDomain;
  }, [selectedConfigDomain]);

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
  }, [selectedProfileId]);

  useEffect(() => {
    selectedProxyModeRef.current = selectedProxyMode;
  }, [selectedProxyMode]);

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await invoke<Profile[]>("get_profiles");
      setProfiles(loaded);
      if (loaded.length === 0) {
        setSelectedProfileId("");
        setSelectedConfigDomain("local");
        return;
      }

      const domains = Array.from(
        new Set(loaded.map((profile) => resolveProfileDomain(profile)))
      ).sort((a, b) => {
        if (a === "local") return -1;
        if (b === "local") return 1;
        return a.localeCompare(b);
      });

      const currentDomain = selectedConfigDomainRef.current;
      const nextDomain = domains.includes(currentDomain) ? currentDomain : domains[0];
      if (currentDomain !== nextDomain) {
        setSelectedConfigDomain(nextDomain);
      }

      const currentProfileId = selectedProfileIdRef.current;
      const currentProfile = loaded.find(
        (profile) => profile.id === currentProfileId
      );
      const currentMatchesDomain =
        currentProfile &&
        resolveProfileDomain(currentProfile) === nextDomain;

      if (nextDomain === "local") {
        const localProfiles = loaded.filter(
          (profile) => resolveProfileDomain(profile) === "local"
        );
        if (localProfiles.length > 0) {
          if (!localProfiles.some((profile) => profile.id === currentProfileId)) {
            setSelectedProfileId(localProfiles[0].id);
          }
          if (selectedProxyModeRef.current !== "manual") {
            setSelectedProxyMode("manual");
          }
        } else {
          setSelectedProfileId("");
        }
      } else if (!currentMatchesDomain) {
        setSelectedProfileId("");
        setSelectedProxyMode("auto");
      }
    } catch (e) {
      console.error("Failed to load profiles", e);
    }
  }, []);

  const refreshSubscriptionsOnStartup = useCallback(async () => {
    try {
      const summary = await invoke<{
        refreshed: number;
        failed: number;
        skipped: number;
      }>(
        "refresh_subscriptions_on_startup"
      );
      await loadProfiles();
      if (summary.refreshed > 0 || summary.failed > 0 || summary.skipped > 0) {
        setLogs((prev) => [
          ...prev,
          `Subscriptions startup refresh: refreshed=${summary.refreshed}, failed=${summary.failed}, skipped=${summary.skipped}`,
        ]);
      }
    } catch (e) {
      console.error("Failed to refresh subscriptions on startup", e);
      setLogs((prev) => [...prev, `Subscription refresh failed: ${e}`]);
    }
  }, [loadProfiles]);

  const refreshSubscriptionDomain = useCallback(
    async (domain: string) => {
      const normalized = domain.trim();
      if (!normalized || normalized === "local") {
        return;
      }

      setRefreshingSourceDomain(normalized);
      try {
        const summary = await invoke<{
          refreshed: number;
          failed: number;
          skipped: number;
        }>("refresh_subscription_by_domain", {
          sourceDomain: normalized,
        });
        await loadProfiles();
        setLogs((prev) => [
          ...prev,
          `Subscription refreshed (${normalized}): refreshed=${summary.refreshed}, failed=${summary.failed}, skipped=${summary.skipped}`,
        ]);
        toast.success(`Subscription refreshed: ${normalized}`, {
          id: `refresh-${normalized}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLogs((prev) => [
          ...prev,
          `Subscription refresh failed (${normalized}): ${message}`,
        ]);
        const details =
          message.length > 220 ? `${message.slice(0, 220)}...` : message;
        toast.error(`Failed to refresh ${normalized}: ${details}`, {
          id: `refresh-${normalized}`,
        });
      } finally {
        setRefreshingSourceDomain("");
      }
    },
    [loadProfiles]
  );

  const refreshPings = useCallback(
    async (domain?: string) => {
      const targetDomain = (domain || selectedConfigDomain).trim() || "local";
      const domainProfiles = profiles.filter(
        (profile) => resolveProfileDomain(profile) === targetDomain
      );
      if (domainProfiles.length === 0) {
        setProfilePings({});
        return {};
      }

      try {
        const results = await invoke<ProfilePing[]>("ping_profiles", {
          sourceDomain: targetDomain,
        });
        const next: Record<string, number | null> = {};
        domainProfiles.forEach((profile) => {
          next[profile.id] = null;
        });
        results.forEach((result) => {
          next[result.id] = result.ping_ms ?? null;
        });
        setProfilePings(next);
        return next;
      } catch (e) {
        console.error("Failed to ping profiles", e);
        const fallback: Record<string, number | null> = {};
        domainProfiles.forEach((profile) => {
          fallback[profile.id] = null;
        });
        setProfilePings(fallback);
        return fallback;
      }
    },
    [profiles, selectedConfigDomain]
  );

  const handleAddProfile = async (name: string, link: string) => {
    try {
      const updated = await invoke<Profile[]>("add_profile", { name, link });
      setProfiles(updated);
      setSelectedProfileId(updated[updated.length - 1].id);
      setSelectedProxyMode("manual");
      setSelectedConfigDomain("local");
      setLogs((prev) => [...prev, `Profile '${name}' added.`]);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const handleImportSubscription = useCallback(
    async (url: string) => {
      try {
        await invoke("import_subscription", { url });
        await loadProfiles();
        try {
          const parsed = new URL(url);
          const domain = parsed.host || "local";
          setSelectedConfigDomain(domain);
          setSelectedProxyMode("auto");
          setSelectedProfileId("");
          setActiveTab("proxies");
        } catch (_e) {
          // ignore invalid URL parsing, backend already validates
        }
        setLogs((prev) => [...prev, "Subscription imported successfully."]);
      } catch (e) {
        console.error(e);
        throw e;
      }
    },
    [loadProfiles]
  );

  const handleDeleteSource = async (source: ConfigSource) => {
    const normalizedDomain =
      source.kind === "subscription"
        ? source.domain.trim() || "local"
        : "local";
    const targetIds =
      source.kind === "profile"
        ? [source.profileId]
        : profiles
            .filter((profile) => resolveProfileDomain(profile) === normalizedDomain)
            .map((profile) => profile.id);
    if (targetIds.length === 0) {
      return;
    }
    try {
      const updated = await invoke<Profile[]>("delete_profiles_by_ids", {
        ids: targetIds,
      });
      setProfiles(updated);
      setLogs((prev) => [
        ...prev,
        source.kind === "profile"
          ? `Profile '${source.label}' deleted.`
          : `Configuration '${normalizedDomain}' deleted.`,
      ]);

      const remainingIds = new Set(updated.map((profile) => profile.id));
      if (appSettings.proxy_chain.length > 0) {
        const nextChain = appSettings.proxy_chain.filter((id) =>
          remainingIds.has(id)
        );
        if (nextChain.length !== appSettings.proxy_chain.length) {
          const nextSettings = { ...appSettings, proxy_chain: nextChain };
          setAppSettings(nextSettings);
          try {
            await saveSettings(nextSettings);
          } catch (e) {
            console.error("Failed to save settings after delete", e);
          }
        }
      }

      const remainingDomains = Array.from(
        new Set(updated.map((profile) => resolveProfileDomain(profile)))
      ).sort((a, b) => {
        if (a === "local") return -1;
        if (b === "local") return 1;
        return a.localeCompare(b);
      });
      const currentDomain = selectedConfigDomain;
      const nextDomain = remainingDomains.includes(currentDomain)
        ? currentDomain
        : remainingDomains[0] || "local";
      if (currentDomain !== nextDomain) {
        setSelectedConfigDomain(nextDomain);
      }

      const currentProfile = updated.find(
        (profile) => profile.id === selectedProfileId
      );
      const currentMatchesDomain =
        currentProfile && resolveProfileDomain(currentProfile) === nextDomain;

      if (nextDomain === "local") {
        const localProfiles = updated.filter(
          (profile) => resolveProfileDomain(profile) === "local"
        );
        if (localProfiles.length > 0) {
          if (
            !localProfiles.some((profile) => profile.id === selectedProfileId)
          ) {
            setSelectedProfileId(localProfiles[0].id);
          }
          setSelectedProxyMode("manual");
        } else {
          setSelectedProfileId("");
          setSelectedProxyMode("auto");
        }
      } else if (!currentMatchesDomain) {
        setSelectedProfileId("");
        setSelectedProxyMode("auto");
      }
    } catch (e) {
      console.error(e);
      setLogs((prev) => [...prev, `Delete failed: ${e}`]);
    }
  };

  const handleRefreshSource = useCallback(
    async (source: ConfigSource) => {
      if (source.kind !== "subscription") {
        return;
      }
      await refreshSubscriptionDomain(source.domain);
    },
    [refreshSubscriptionDomain]
  );

  const startStats = useCallback((profileId: string) => {
    startTimeRef.current = Date.now();
    sessionUpRef.current = 0;
    sessionDownRef.current = 0;
    lastSavedSessionUpRef.current = 0;
    lastSavedSessionDownRef.current = 0;

    // The core reports counters that are cumulative for its own lifetime, so
    // the first sample of this session becomes the baseline.
    let baselineUp: number | null = null;
    let baselineDown: number | null = null;
    let previousUp = 0;
    let previousDown = 0;
    let ticksSinceSave = 0;

    timerIntervalRef.current = setInterval(async () => {
      if (startTimeRef.current) {
        setDuration(formatDuration(Date.now() - startTimeRef.current));
      }

      let traffic: { up: number; down: number };
      try {
        traffic = await invoke<{ up: number; down: number }>("get_traffic");
      } catch {
        return;
      }

      // A restarted core resets its counters below the baseline; re-anchor.
      if (
        baselineUp === null ||
        baselineDown === null ||
        traffic.up < baselineUp ||
        traffic.down < baselineDown
      ) {
        baselineUp = traffic.up;
        baselineDown = traffic.down;
        previousUp = 0;
        previousDown = 0;
        return;
      }

      const sessionUp = traffic.up - baselineUp;
      const sessionDown = traffic.down - baselineDown;

      setUploadSpeed(`${formatBytes(Math.max(0, sessionUp - previousUp))}/s`);
      setDownloadSpeed(`${formatBytes(Math.max(0, sessionDown - previousDown))}/s`);
      previousUp = sessionUp;
      previousDown = sessionDown;

      sessionUpRef.current = sessionUp;
      sessionDownRef.current = sessionDown;

      setProfiles((currentProfiles) => {
        const profile = currentProfiles.find((p) => p.id === profileId);
        setTotalUp(formatBytes((profile?.total_up || 0) + sessionUp));
        setTotalDown(formatBytes((profile?.total_down || 0) + sessionDown));
        return currentProfiles;
      });

      ticksSinceSave += 1;
      if (ticksSinceSave >= 5 && profileId) {
        ticksSinceSave = 0;
        const deltaUp = sessionUp - lastSavedSessionUpRef.current;
        const deltaDown = sessionDown - lastSavedSessionDownRef.current;

        if (deltaUp > 0 || deltaDown > 0) {
          void invoke("update_profile_usage", {
            id: profileId,
            up: deltaUp,
            down: deltaDown,
          });
          lastSavedSessionUpRef.current = sessionUp;
          lastSavedSessionDownRef.current = sessionDown;
        }
      }
    }, 1000);
  }, []);

  const stopStats = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setDuration("00:00:00");
    setUploadSpeed("0 B/s");
    setDownloadSpeed("0 B/s");
    startTimeRef.current = null;
  }, []);

  const toggleVpn = async () => {
    if (profiles.length === 0) {
      setStatus("No Profile!");
      toast.error("No profiles found. Add a profile or import a subscription.", {
        id: "no-profiles",
      });
      return;
    }

    try {
      if (!isConnected) {
        setStatus("Connecting...");
        let profileIdToUse = selectedProfileId;
        let candidateOrder: string[] = [];
        const domain = selectedConfigDomain.trim() || "local";
        const chainActive =
          appSettings.proxy_chain_enabled && appSettings.proxy_chain.length > 0;
        const chainExclusions = chainActive
          ? new Set(appSettings.proxy_chain)
          : null;
        const domainProfiles = profiles.filter(
          (profile) => resolveProfileDomain(profile) === domain
        );
        const eligibleDomainProfiles = chainExclusions
          ? domainProfiles.filter((profile) => !chainExclusions.has(profile.id))
          : domainProfiles;
        if (chainExclusions?.has(profileIdToUse)) {
          profileIdToUse = "";
        }
        const hasForcedExit = chainActive && profileIdToUse !== "";

        if (selectedProxyMode === "auto" && !hasForcedExit) {
          const pings = await refreshPings(selectedConfigDomain);
          const effectiveCandidates =
            eligibleDomainProfiles.length > 0
              ? eligibleDomainProfiles
              : domainProfiles;
          candidateOrder = effectiveCandidates
            .map((profile) => ({
              id: profile.id,
              ping: pings[profile.id],
            }))
            .sort((a, b) => {
              const left =
                a.ping === null || a.ping === undefined
                  ? Number.POSITIVE_INFINITY
                  : a.ping;
              const right =
                b.ping === null || b.ping === undefined
                  ? Number.POSITIVE_INFINITY
                  : b.ping;
              return left - right;
            })
            .map((candidate) => candidate.id);
          profileIdToUse = candidateOrder[0] || "";

          if (candidateOrder.length > 1) {
            try {
              const probeLimit = Math.min(candidateOrder.length, 8);
              const probeResults = await invoke<ProfilePing[]>(
                "probe_profiles_connectivity",
                {
                  sourceDomain: domain,
                  profileIds: candidateOrder.slice(0, probeLimit),
                  timeoutMs: 1200,
                }
              );
              const reachable = probeResults
                .filter((item) => item.ping_ms !== null)
                .sort((a, b) => (a.ping_ms ?? Infinity) - (b.ping_ms ?? Infinity))
                .map((item) => item.id);
              const fallback = candidateOrder.filter(
                (id) => !reachable.includes(id)
              );
              candidateOrder = [...reachable, ...fallback];
              profileIdToUse = candidateOrder[0] || "";
            } catch (error) {
              console.error("Connectivity pre-check failed", error);
            }
          }
        } else if (!profileIdToUse) {
          const fallbackProfile = eligibleDomainProfiles[0] || domainProfiles[0];
          profileIdToUse = fallbackProfile?.id || "";
        }

        if (!profileIdToUse) {
          setStatus("No Proxy!");
          toast.error("No proxy available for this configuration.", {
            id: "no-proxy",
          });
          return;
        }

        const autoMode = selectedProxyMode === "auto" && !hasForcedExit;
        const subscriptionFallbackMode =
          selectedProxyMode === "manual" && domain !== "local" && !hasForcedExit;
        if (subscriptionFallbackMode && candidateOrder.length === 0) {
          const tailCandidates = (
            eligibleDomainProfiles.length > 0 ? eligibleDomainProfiles : domainProfiles
          )
            .map((profile) => profile.id)
            .filter((id) => id !== profileIdToUse);
          candidateOrder = [profileIdToUse, ...tailCandidates];
        }

        const resilientMode = autoMode || subscriptionFallbackMode;
        const attemptOrder = resilientMode
          ? candidateOrder.length > 0
            ? candidateOrder
            : [profileIdToUse]
          : [profileIdToUse];

        let connectedProfileId = "";
        let lastAutoError = "";

        for (const candidateId of attemptOrder) {
          try {
            await invoke("start_vpn", {
              profileId: candidateId,
            });
          } catch (error) {
            if (!resilientMode) {
              throw error;
            }
            lastAutoError = String(error);
            continue;
          }

          connectedProfileId = candidateId;
          break;
        }

        if (!connectedProfileId) {
          throw new Error(
            `No working profile found${lastAutoError ? ` (${lastAutoError})` : ""}.`
          );
        }

        setIsConnected(true);
        setStatus("CONNECTED");
        setTimeout(async () => {
          await checkIp();
          startIpCheck();
        }, 3000);
        startStats(connectedProfileId);
      } else {
        setStatus("Stopping...");
        await invoke("stop_vpn");
        setIsConnected(false);
        setStatus("Ready");
        stopStats();
        stopIpCheck();
        setIpInfo(null);
      }
    } catch (error) {
      setStatus("Error");
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message ? `Connection failed: ${message}` : "Connection failed.", {
        id: "connect-error",
      });
      console.error(error);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLogs(["System initialized.", "Waiting for commands..."]);
      await loadProfiles();
      await refreshSubscriptionsOnStartup();

      try {
        const platformName = await invoke<string>("get_current_platform");
        setPlatform(platformName);

        const settings = (await invoke("get_settings")) as AppSettings;
        const storedMode = settings.routing_mode as string;
        const normalizedMode =
          storedMode === "selected"
            ? "apps_domains"
            : storedMode === "all" ||
              storedMode === "apps" ||
              storedMode === "domains" ||
              storedMode === "apps_domains"
            ? storedMode
            : "all";
        const mergedSettings = {
          ...defaultSettings,
          ...settings,
          routing_mode: normalizedMode as AppSettings["routing_mode"],
        };
        setAppSettings(mergedSettings);
        if (normalizedMode !== storedMode) {
          await saveSettings(mergedSettings);
        }

        if (!settings.auth_server && !settings.skip_auth) {
          setShowOnboarding(true);
        }

        if (
          settings.pending_sync_upload &&
          settings.auth_server &&
          settings.auth_token
        ) {
          try {
            setLogs((prev) => [...prev, "Syncing profiles to server..."]);
            await invoke("push_profiles_to_server", { settings });
            const updatedSettings = { ...settings, pending_sync_upload: false };
            await saveSettings(updatedSettings);
            setAppSettings(updatedSettings);
            setLogs((prev) => [...prev, "Profiles synced successfully."]);
          } catch (e) {
            console.error("Sync failed:", e);
            setLogs((prev) => [...prev, `Sync failed: ${e}`]);
          }
        }
      } catch (e) {
        console.error("Failed to load settings", e);
      }

    };

    init();

    const unlisten = listen<string[]>("vpn-log", async (event) => {
      const newLogs = event.payload;
      setLogs((prev) => {
        const limit = parseInt(logLimit);
        const updated = [...prev, ...newLogs];
        return updated.length > limit ? updated.slice(-limit) : updated;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
      stopStats();
    };
  }, [loadProfiles, refreshSubscriptionsOnStartup, saveSettings, stopStats, logLimit]);

  useEffect(() => {
    if (activeTab !== "proxies") {
      return;
    }
    refreshPings();
    const interval = setInterval(() => refreshPings(), 30000);
    return () => clearInterval(interval);
  }, [activeTab, refreshPings]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const handleDumpLogs = async () => {
    try {
      const path = await save({
        defaultPath: "nuggetvpn-logs.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (path) {
        const content = logs.join("\n");
        await writeTextFile(path, content);
        setLogs((prev) => [...prev, `Logs exported to ${path}`]);
      }
    } catch (e) {
      setLogs((prev) => [...prev, `Export failed: ${e}`]);
    }
  };

  const handleSettingsChange = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    const newSettings = { ...appSettings, [key]: value };
    setAppSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleLogLimitChange = (value: string) => {
    setLogLimit(value);
    const limit = parseInt(value);
    setLogs((prev) => (prev.length > limit ? prev.slice(-limit) : prev));
  };

  const handleDisconnectSync = () => {
    const newSettings = {
      ...appSettings,
      auth_server: null,
      auth_token: null,
      skip_auth: false,
    };
    setAppSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleConnectSync = () => {
    startTransition(() => setShowOnboarding(true));
  };

  const handleSelectProxy = (id: string) => {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    if (appSettings.proxy_chain_enabled && appSettings.proxy_chain.includes(id)) {
      const newSettings = {
        ...appSettings,
        proxy_chain: appSettings.proxy_chain.filter((entry) => entry !== id),
      };
      setAppSettings(newSettings);
      saveSettings(newSettings);
    }
    setSelectedProfileId(id);
    setSelectedProxyMode("manual");
    setSelectedConfigDomain(resolveProfileDomain(profile));
  };

  const handleSelectAuto = (domain: string) => {
    setSelectedProxyMode("auto");
    setSelectedProfileId("");
    setSelectedConfigDomain(domain || "local");
  };

  const applyConfigSelection = (source: ConfigSource, focusProxies: boolean) => {
    if (source.kind === "profile") {
      const profile = profiles.find((item) => item.id === source.profileId);
      if (!profile) {
        return;
      }
      setSelectedConfigDomain(resolveProfileDomain(profile));
      setSelectedProxyMode("manual");
      setSelectedProfileId(profile.id);
      if (focusProxies) {
        setActiveTab("proxies");
      }
      return;
    }

    const normalized = source.domain.trim() || "local";
    setSelectedConfigDomain(normalized);
    const currentProfile = profiles.find(
      (profile) => profile.id === selectedProfileId
    );
    if (!currentProfile || resolveProfileDomain(currentProfile) !== normalized) {
      setSelectedProxyMode("auto");
      setSelectedProfileId("");
    }
    if (focusProxies) {
      setActiveTab("proxies");
    }
  };

  const handleSelectConfig = (source: ConfigSource) => {
    applyConfigSelection(source, true);
  };

  const handleSelectConfigFromTopBar = (source: ConfigSource) => {
    applyConfigSelection(source, false);
  };

  const changeTab = (tab: string) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  };

  return (
    <main className="h-full overflow-hidden">
      <Toaster
        position="top-center"
        toastOptions={{
          className: "shadow-lg",
          style: {
            background: "var(--background)",
            color: "var(--foreground)",
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

      {showOnboarding && (
        <Onboarding
          settings={appSettings}
          onComplete={() => startTransition(() => setShowOnboarding(false))}
          onSettingsChange={setAppSettings}
        />
      )}
      <SidebarProvider>
        <AppSidebar
          activeTab={activeTab}
          onTabChange={changeTab}
          onClose={winClose}
          onMinimize={winMinimize}
          onMaximize={winMaximize}
          platform={platform}
        />
        <SidebarInset
          className={cn(
            "overflow-hidden flex flex-col",
            platform !== "macos" && "bg-transparent! m-0! p-0! shadow-none! rounded-none!"
          )}
        >
          {platform !== "macos" && (
            <div className="bg-inset z-50">
              <WindowControls
                onClose={winClose}
                onMinimize={winMinimize}
                onMaximize={winMaximize}
              />
            </div>
          )}
          <div
            className={cn(
              "flex-1 flex flex-col overflow-hidden",
              platform !== "macos"
                ? "bg-background m-2 mt-0 border rounded-[var(--window-radius)] shadow-sm"
                : cn("px-2 pb-4 pt-2")
            )}
          >
            {platform === "macos" && isMobile && (
              <div
                className="h-8 px-4 flex items-center shrink-0"
                data-tauri-drag-region
              >
                <MacWindowControls
                  onClose={winClose}
                  onMinimize={winMinimize}
                  onMaximize={winMaximize}
                />
              </div>
            )}
            <TopBar
              sources={sources}
              selectedSourceDomain={selectedConfigDomain}
              selectedProfileId={selectedProfileId}
              isConnected={isConnected}
              onSourceSelect={handleSelectConfigFromTopBar}
              onAddProfile={() => setIsModalOpen(true)}
            />

            <ViewTransition name="app-content">
              <div className="flex-1 relative overflow-hidden">
                {activeTab === "connection" && (
                  <ConnectionView
                    isConnected={isConnected}
                    toggleVpn={toggleVpn}
                    duration={duration}
                    uploadSpeed={uploadSpeed}
                    downloadSpeed={downloadSpeed}
                    totalUp={totalUp}
                    totalDown={totalDown}
                    checkIp={checkIp}
                    isCheckingIp={isCheckingIp}
                    ipInfo={ipInfo}
                  />
                )}

                {activeTab === "settings" && (
                  <SettingsView
                    theme={theme}
                    setTheme={setTheme}
                    appSettings={appSettings}
                    profiles={profiles}
                    selectedProfileId={selectedProfileId}
                    onSettingsChange={handleSettingsChange}
                    onConnectSync={handleConnectSync}
                    onDisconnectSync={handleDisconnectSync}
                  />
                )}

                {activeTab === "logs" && (
                  <LogsView
                    logs={logs}
                    logLimit={logLimit}
                    onLogLimitChange={handleLogLimitChange}
                    onDumpLogs={handleDumpLogs}
                    logEndRef={logContainerRef}
                  />
                )}

                {activeTab === "proxies" && (
                  <ProxiesView
                    profiles={profiles}
                    profilePings={profilePings}
                    selectedSourceDomain={selectedConfigDomain}
                    selectedProxyMode={selectedProxyMode}
                    selectedProfileId={selectedProfileId}
                    isRefreshingSource={
                      refreshingSourceDomain ===
                      ((selectedConfigDomain || "").trim() || "local")
                    }
                    onSelectProxy={handleSelectProxy}
                    onSelectAuto={() => handleSelectAuto(selectedConfigDomain)}
                    onRefreshSource={() =>
                      refreshSubscriptionDomain(selectedConfigDomain)
                    }
                  />
                )}

                {activeTab === "configuration" && (
                  <ConfigurationView
                    sources={sources}
                    selectedSource={selectedConfigDomain}
                    selectedProfileId={selectedProfileId}
                    refreshingSourceDomain={refreshingSourceDomain}
                    onSelectSource={handleSelectConfig}
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
