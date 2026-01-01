import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import AddModal from "@/components/AddModal";
import Onboarding from "@/components/Onboarding";
import AppSidebar from "@/components/layout/AppSidebar";
import TopBar from "@/components/layout/TopBar";
import ConnectionView from "@/components/views/ConnectionView";
import ConfigurationView from "@/components/views/ConfigurationView";
import LogsView from "@/components/views/LogsView";
import SettingsView from "@/components/views/SettingsView";
import { useTheme } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { formatBytes, formatDuration } from "@/lib/format";
import { AppSettings, IpInfo, Profile } from "@/types";

import "./App.css";

const appWindow = getCurrentWindow();

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
};

function App() {
  const { theme, setTheme } = useTheme();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("connection");

  const [status, setStatus] = useState("Ready");
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logLimit, setLogLimit] = useState("1000");
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState("00:00:00");
  const [uploadSpeed, setUploadSpeed] = useState("0 KB/s");
  const [downloadSpeed, setDownloadSpeed] = useState("0 KB/s");
  const [totalUp, setTotalUp] = useState("0 MB");
  const [totalDown, setTotalDown] = useState("0 MB");

  const startTimeRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionUpRef = useRef(0);
  const sessionDownRef = useRef(0);
  const lastSavedSessionUpRef = useRef(0);
  const lastSavedSessionDownRef = useRef(0);

  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
  const [isCheckingIp, setIsCheckingIp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const winClose = () => appWindow.close();
  const winMinimize = () => appWindow.minimize();

  const saveSettings = useCallback(async (settings: AppSettings) => {
    await invoke("save_settings", { settings });
  }, []);

  const checkIp = async () => {
    setIsCheckingIp(true);
    try {
      const res = await fetch("https://ipinfo.io/json");
      const data = await res.json();
      setIpInfo({ ip: data.ip, region: data.region });
    } catch (e) {
      console.error(e);
    } finally {
      setIsCheckingIp(false);
    }
  };

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await invoke<Profile[]>("get_profiles");
      setProfiles(loaded);
      if (loaded.length > 0 && !selectedProfileId) {
        setSelectedProfileId(loaded[0].id);
      }
    } catch (e) {
      console.error("Failed to load profiles", e);
    }
  }, [selectedProfileId]);

  const handleAddProfile = async (
    name: string | null,
    link: string | null,
    isReload: boolean = false
  ) => {
    if (isReload) {
      await loadProfiles();
      setLogs((prev) => [...prev, "Subscription imported successfully."]);
      return;
    }

    if (name && link) {
      try {
        const updated = await invoke<Profile[]>("add_profile", { name, link });
        setProfiles(updated);
        setSelectedProfileId(updated[updated.length - 1].id);
        setLogs((prev) => [...prev, `Profile '${name}' added.`]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleDelete = async (id: string | null = null) => {
    const targetId = id || selectedProfileId;
    if (!targetId) return;

    try {
      const updated = await invoke<Profile[]>("delete_profile", { id: targetId });
      setProfiles(updated);
      setLogs((prev) => [...prev, "Profile deleted successfully."]);

      if (targetId === selectedProfileId) {
        setSelectedProfileId(updated.length > 0 ? updated[0].id : "");
      }
    } catch (e) {
      console.error(e);
      setLogs((prev) => [...prev, `Delete failed: ${e}`]);
    }
  };

  const startStats = useCallback(() => {
    startTimeRef.current = Date.now();
    sessionUpRef.current = 0;
    sessionDownRef.current = 0;
    lastSavedSessionUpRef.current = 0;
    lastSavedSessionDownRef.current = 0;

    timerIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setDuration(formatDuration(Date.now() - startTimeRef.current));
      }

      const up = Math.floor(Math.random() * 100);
      const down = Math.floor(Math.random() * 500);

      sessionUpRef.current += up * 1024;
      sessionDownRef.current += down * 1024;

      setUploadSpeed(`${up} KB/s`);
      setDownloadSpeed(`${down} KB/s`);

      setProfiles((currentProfiles) => {
        const profile = currentProfiles.find((p) => p.id === selectedProfileId);
        const savedUp = profile?.total_up || 0;
        const savedDown = profile?.total_down || 0;

        setTotalUp(formatBytes(savedUp + sessionUpRef.current));
        setTotalDown(formatBytes(savedDown + sessionDownRef.current));

        return currentProfiles;
      });

      if (Date.now() % 5000 < 1000 && selectedProfileId) {
        const deltaUp = sessionUpRef.current - lastSavedSessionUpRef.current;
        const deltaDown = sessionDownRef.current - lastSavedSessionDownRef.current;

        if (deltaUp > 0 || deltaDown > 0) {
          invoke("update_profile_usage", {
            id: selectedProfileId,
            up: deltaUp,
            down: deltaDown,
          });
          lastSavedSessionUpRef.current = sessionUpRef.current;
          lastSavedSessionDownRef.current = sessionDownRef.current;
        }
      }
    }, 1000);

    setTimeout(() => {
      wsRef.current = new WebSocket("ws://127.0.0.1:9090/traffic?token=");
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setUploadSpeed(formatBytes(data.up));
          setDownloadSpeed(formatBytes(data.down));
        } catch (_e) {
          // ignore parse errors
        }
      };
    }, 1000);
  }, [selectedProfileId]);

  const stopStats = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (wsRef.current) wsRef.current.close();
    setDuration("00:00:00");
    setUploadSpeed("0 B/s");
    setDownloadSpeed("0 B/s");
    startTimeRef.current = null;
  }, []);

  const toggleVpn = async () => {
    if (profiles.length === 0) {
      setStatus("No Profile!");
      return;
    }

    try {
      if (!isConnected) {
        setStatus("Connecting...");
        await invoke("start_vpn");
        setIsConnected(true);
        setStatus("CONNECTED");
        await checkIp();
        startStats();
      } else {
        setStatus("Stopping...");
        await invoke("stop_vpn");
        setIsConnected(false);
        setStatus("Ready");
        stopStats();
      }
    } catch (error) {
      setStatus("Error");
      console.error(error);
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadProfiles();

      try {
        const settings = (await invoke("get_settings")) as AppSettings;
        setAppSettings({ ...defaultSettings, ...settings });

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

      setLogs(["System initialized.", "Waiting for commands..."]);
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
  }, [loadProfiles, saveSettings, stopStats, logLimit]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

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

  const changeTab = (tab: string) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  };

  return (
      <main className="h-full overflow-hidden">
      <AddModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleAddProfile}
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
          status={status}
          isConnected={isConnected}
          onClose={winClose}
          onMinimize={winMinimize}
        />
        <SidebarInset>
          <div className="flex-1 flex flex-col py-4 px-2">
            <TopBar
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              isConnected={isConnected}
              onProfileSelect={setSelectedProfileId}
              onAddProfile={() => setIsModalOpen(true)}
            />

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
                  logEndRef={logContainerRef}
                />
              )}

              {activeTab === "configuration" && (
                <ConfigurationView
                  profiles={profiles}
                  onDelete={(id) => handleDelete(id)}
                  onAdd={() => setIsModalOpen(true)}
                />
              )}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </main>
  );
}

export default App;
