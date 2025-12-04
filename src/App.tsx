import { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Power,
  Settings,
  Plus,
  Trash2,
  X,
  Minus,
  RotateCw,
  CheckCircle2,
  Globe,
  ArrowUp,
  ArrowDown,
  Server,
  Clock,
  ChevronDown,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";

import AddModal from "@/components/AddModal";
import Onboarding from "@/components/Onboarding";
import { Profile, AppSettings, IpInfo } from "./types";
import { useTheme } from "@/components/theme-provider";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

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
  auth_server: null,
  auth_token: null,
  skip_auth: false,
  pending_sync_upload: false,
};

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

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

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  const changeTab = (tab: string) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  };

  return (
    <>
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
        <Sidebar variant="floating">
          <SidebarHeader className="h-16 flex-row items-center justify-between px-4" data-tauri-drag-region>
            <div className="flex items-center gap-2">
              <div className="text-primary pointer-events-none">
                <Power size={24} strokeWidth={2.5} />
              </div>
              <div className="font-black tracking-wider text-xl pointer-events-none">
                NUGGET
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={winClose}
                className="w-3 h-3 rounded-full bg-[#FF5F57] hover:bg-[#FF5F57]/80 transition-colors"
                aria-label="Close"
              />
              <button
                onClick={winMinimize}
                className="w-3 h-3 rounded-full bg-[#FEBC2E] hover:bg-[#FEBC2E]/80 transition-colors"
                aria-label="Minimize"
              />
              <button
                className="w-3 h-3 rounded-full bg-[#28C840] hover:bg-[#28C840]/80 transition-colors"
                aria-label="Maximize"
              />
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeTab === "connection"}
                      onClick={() => changeTab("connection")}
                    >
                      <Power size={18} />
                      <span>Connection</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeTab === "configuration"}
                      onClick={() => changeTab("configuration")}
                    >
                      <Server size={18} />
                      <span>Configuration</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeTab === "logs"}
                      onClick={() => changeTab("logs")}
                    >
                      <Clock size={18} />
                      <span>Logs</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "settings"}
                  onClick={() => changeTab("settings")}
                >
                  <Settings size={18} />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div className="p-2 border-t border-sidebar-border">
              <div className="flex items-center gap-3 px-2">
                <div
                  className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`}
                />
                <div className="text-xs font-medium text-muted-foreground">{status}</div>
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>
        {/* Main Content */}
        <div className="flex-1 flex flex-col py-4 px-2">
          {/* Top Bar */}
          <div
            className="h-16 border-b flex items-center justify-between px-6 shrink-0"
            data-tauri-drag-region
          >
            <div className="flex flex-col">
              <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                Current Profile
              </span>
              <div className="relative group flex items-center gap-2">
                {profiles.length === 0 ? (
                  <span className="font-medium text-muted-foreground">No profiles</span>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        disabled={isConnected}
                        className="p-0 h-auto font-bold text-lg hover:bg-transparent"
                      >
                        {selectedProfile?.name || "Select Profile"}
                        <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64 max-h-96 overflow-y-auto">
                      {profiles.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => setSelectedProfileId(p.id)}
                          className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                        >
                          <div className="font-bold">{p.name}</div>
                          <div className="flex w-full items-center justify-between text-xs text-muted-foreground font-mono">
                            <span>{p.server}</span>
                            <span>
                              {formatBytes((p.total_up || 0) + (p.total_down || 0))}
                            </span>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button
                size="icon"
                variant="secondary"
                onClick={() => setIsModalOpen(true)}
                disabled={isConnected}
                className="rounded-full"
              >
                <Plus size={16} />
              </Button>

            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 relative overflow-hidden">
            {activeTab === "connection" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden" />

                {/* Connect Button */}
                <div className="relative z-10 mb-12">
                  <button
                    onClick={toggleVpn}
                    className={`group relative w-56 h-56 rounded-full flex items-center justify-center transition-all duration-500 outline-none ${isConnected ? "scale-105" : "hover:scale-[1.02]"
                      }`}
                  >
                    <div className="absolute inset-0 rounded-full border border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-xl" />
                    <div
                      className={`absolute inset-3 rounded-full transition-all duration-700 overflow-hidden flex items-center justify-center ${isConnected
                        ? "bg-gradient-to-tr from-primary to-orange-500 shadow-[0_0_60px_rgba(249,115,22,0.4)]"
                        : "bg-white/5 dark:bg-black/10 backdrop-blur-md border border-white/10 shadow-inner"
                        }`}
                    >
                      {isConnected && (
                        <div className="absolute inset-0 bg-black/10 animate-pulse" />
                      )}
                      <Power
                        size={64}
                        strokeWidth={1.5}
                        className={`relative z-10 transition-all duration-500 ${isConnected
                          ? "drop-shadow-md scale-110"
                          : "text-muted-foreground group-hover:text-primary"
                          }`}
                      />
                    </div>
                  </button>
                </div>

                {/* Stats */}
                {isConnected ? (
                  <div className="flex flex-col items-center w-full max-w-sm z-10">
                    <div className="flex flex-col items-center gap-1 mb-6">
                      <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
                        Duration
                      </span>
                      <span className="font-mono text-xl">{duration}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 w-full">
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-muted-foreground text-xs font-medium mb-1 flex items-center gap-2">
                            <ArrowUp size={12} /> UPLOAD
                          </div>
                          <div className="text-xl font-bold font-mono">
                            {uploadSpeed}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-1">
                            Total: {totalUp}
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-muted-foreground text-xs font-medium mb-1 flex items-center gap-2">
                            <ArrowDown size={12} /> DOWNLOAD
                          </div>
                          <div className="text-xl font-bold font-mono">
                            {downloadSpeed}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-1">
                            Total: {totalDown}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="mt-6 flex flex-col items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={checkIp}
                        disabled={isCheckingIp}
                        className="gap-2"
                      >
                        <Globe size={16} />
                        {isCheckingIp ? "Checking..." : "Check IP"}
                      </Button>
                      {ipInfo && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {ipInfo.ip} ({ipInfo.region})
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-[52px] flex items-center justify-center text-muted-foreground text-sm z-10">
                    Ready to connect
                  </div>
                )}
              </div>
            )}

            {activeTab === "settings" && (
              <ScrollArea className="h-full">
                <div className="px-12 py-4 flex flex-col">
                  <header className="flex-none mb-8">
                    <h1 className="text-3xl font-black tracking-tight">Settings</h1>
                    <p className="text-muted-foreground mt-2">
                      Configure your client preferences
                    </p>
                  </header>

                  <div className="space-y-6 pr-2">
                    {/* Appearance */}
                    <Card>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Appearance</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Customize the application theme.
                            </div>
                          </div>
                          <Select
                            value={theme}
                            onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue placeholder="Select theme" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="light">
                                <div className="flex items-center gap-2">
                                  <Sun size={14} /> Light
                                </div>
                              </SelectItem>
                              <SelectItem value="dark">
                                <div className="flex items-center gap-2">
                                  <Moon size={14} /> Dark
                                </div>
                              </SelectItem>
                              <SelectItem value="system">
                                <div className="flex items-center gap-2">
                                  <Laptop size={14} /> System
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Sync Settings */}
                    <Card>
                      <CardContent>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <div className="text-sm font-medium">Synchronization</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Sync your profiles across devices.
                            </div>
                          </div>
                          {appSettings.auth_server && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-green-500 font-mono flex items-center gap-1">
                                <CheckCircle2 size={12} /> Connected
                              </span>
                            </div>
                          )}
                        </div>

                        {appSettings.auth_server ? (
                          <>
                            <div className="bg-muted rounded-xl p-4 mb-4">
                              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                                Server
                              </div>
                              <div className="text-sm font-mono truncate">
                                {appSettings.auth_server}
                              </div>
                            </div>
                            <Button
                              variant="destructive"
                              className="w-full"
                              onClick={() => {
                                const newSettings = {
                                  ...appSettings,
                                  auth_server: null,
                                  auth_token: null,
                                  skip_auth: false,
                                };
                                setAppSettings(newSettings);
                                saveSettings(newSettings);
                              }}
                            >
                              Disconnect
                            </Button>
                          </>
                        ) : (
                          <Button
                            className="w-full gap-2"
                            onClick={() => startTransition(() => setShowOnboarding(true))}
                          >
                            <RotateCw size={16} /> Connect Sync Server
                          </Button>
                        )}
                      </CardContent>
                    </Card>

                    {/* MTU */}
                    <Card>
                      <CardContent>
                        <Label htmlFor="mtu" className="mb-2 block">
                          MTU
                        </Label>
                        <Input
                          id="mtu"
                          type="number"
                          value={appSettings.mtu}
                          onChange={(e) =>
                            handleSettingsChange(
                              "mtu",
                              parseInt(e.target.value) || 9000
                            )
                          }
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Maximum Transmission Unit. Default is 9000.
                        </p>
                      </CardContent>
                    </Card>

                    {/* DNS */}
                    <Card>
                      <CardContent>
                        <Label htmlFor="dns" className="mb-2 block">
                          DNS Server
                        </Label>
                        <Input
                          id="dns"
                          type="text"
                          value={appSettings.dns}
                          onChange={(e) => handleSettingsChange("dns", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Primary DNS server address (e.g., 1.1.1.1).
                        </p>
                      </CardContent>
                    </Card>

                    {/* TLS Fragment */}
                    <Card>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">
                              TLS Fragmentation
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Split TLS records to bypass SNI blocking.
                            </div>
                          </div>
                          <Switch
                            checked={appSettings.tls_fragment}
                            onCheckedChange={(checked) =>
                              handleSettingsChange("tls_fragment", checked)
                            }
                          />
                        </div>

                        {appSettings.tls_fragment && (
                          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                            <div>
                              <Label className="mb-1 block text-xs">Size Range</Label>
                              <Input
                                type="text"
                                value={appSettings.tls_fragment_size}
                                onChange={(e) =>
                                  handleSettingsChange(
                                    "tls_fragment_size",
                                    e.target.value
                                  )
                                }
                                placeholder="100-200"
                              />
                            </div>
                            <div>
                              <Label className="mb-1 block text-xs">
                                Sleep Range (ms)
                              </Label>
                              <Input
                                type="text"
                                value={appSettings.tls_fragment_sleep}
                                onChange={(e) =>
                                  handleSettingsChange(
                                    "tls_fragment_sleep",
                                    e.target.value
                                  )
                                }
                                placeholder="10-20"
                              />
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* TLS Mixed SNI Case */}
                    <Card>
                      <CardContent className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">
                            TLS Mixed SNI Case
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Randomize SNI capitalization.
                          </div>
                        </div>
                        <Switch
                          checked={appSettings.tls_mixed_sni_case}
                          onCheckedChange={(checked) =>
                            handleSettingsChange("tls_mixed_sni_case", checked)
                          }
                        />
                      </CardContent>
                    </Card>

                    {/* TLS Padding */}
                    <Card>
                      <CardContent className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">TLS Padding</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Add random padding to TLS records.
                          </div>
                        </div>
                        <Switch
                          checked={appSettings.tls_padding}
                          onCheckedChange={(checked) =>
                            handleSettingsChange("tls_padding", checked)
                          }
                        />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </ScrollArea>
            )}

            {activeTab === "logs" && (
              <div className="absolute inset-0 flex flex-col p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">System Logs</h2>
                  <Select
                    value={logLimit}
                    onValueChange={(value) => {
                      setLogLimit(value);
                      const limit = parseInt(value);
                      if (logs.length > limit) {
                        setLogs(logs.slice(-limit));
                      }
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select limit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100">100 lines</SelectItem>
                      <SelectItem value="500">500 lines</SelectItem>
                      <SelectItem value="1000">1000 lines</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <ScrollArea className="flex-1 rounded-lg border p-4">
                  <div className="font-mono text-xs text-muted-foreground">
                    {logs.map((log, index) => (
                      <div
                        key={index}
                        className="mb-1 border-b border-border/50 pb-1 last:border-0"
                      >
                        {log}
                      </div>
                    ))}
                    <div ref={logContainerRef} />
                  </div>
                </ScrollArea>
              </div>
            )}

            {activeTab === "configuration" && (
              <div className="absolute inset-0 flex flex-col p-6">
                <h2 className="text-lg font-bold mb-4">Configuration</h2>
                <ScrollArea className="flex-1">
                  <div className="space-y-2 pr-4">
                    {profiles.map((p) => (
                      <Card
                        key={p.id}
                        className="flex flex-row justify-between p-4 group hover:border-primary/50 transition-colors"
                      >
                        <div className="flex justify-between w-full items-center">
                          <div>
                            <div className="font-bold">{p.name}</div>
                            <div className="text-xs text-muted-foreground font-mono mt-1">
                              {p.server} ({p.protocol})
                            </div>
                          </div>
                          <div className="flex">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(p.id)}
                              className="hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}

                    <Button
                      variant="outline"
                      className="w-full py-8 border-dashed"
                      onClick={() => setIsModalOpen(true)}
                    >
                      <Plus size={16} className="mr-2" /> Add New Profile
                    </Button>
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </SidebarProvider>
    </>
  );
}

export default App;
