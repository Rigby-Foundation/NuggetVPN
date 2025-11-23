<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount, tick, onDestroy } from "svelte";
  import {
    Power,
    Settings,
    List,
    Plus,
    Trash2,
    Activity,
    LogOut,
    X,
    Minus,
    Maximize2,
    RotateCw,
    CheckCircle2,
    Globe,
    ArrowUp,
    ArrowDown,
    Server,
    Clock,
    ChevronDown,
  } from "lucide-svelte";
  import AddModal from "../components/AddModal.svelte";

  const appWindow = getCurrentWindow();

  interface Profile {
    id: string;
    name: string;
    server: string;
    protocol: string;
    config_link: string;
    total_up?: number;
    total_down?: number;
  }

  let profiles = $state<Profile[]>([]);
  let selectedProfileId = $state("");
  let isModalOpen = $state(false);
  let activeTab = $state("connection");

  let status = $state("Ready");
  let isConnected = $state(false);
  let connectionState = $state("disconnected");
  let logs = $state<string[]>([]);
  let logContainer: HTMLDivElement;

  let duration = $state("00:00:00");
  let startTime: number | null = null;
  let timerInterval: any = null;
  let uploadSpeed = $state("0 KB/s");
  let downloadSpeed = $state("0 KB/s");
  let totalUp = $state("0 MB");
  let totalDown = $state("0 MB");
  let sessionUp = 0;
  let sessionDown = 0;
  let ws: WebSocket | null = null;

  let appSettings = $state({
    mtu: 9000,
    dns: "1.1.1.1",
    tls_fragment: false,
    tls_fragment_size: "100-200",
    tls_fragment_sleep: "10-20",
    tls_mixed_sni_case: false,
    tls_padding: false,
  });
  let ipInfo = $state<{ ip: string; region: string } | null>(null);
  let isCheckingIp = $state(false);
  let isProfileDropdownOpen = $state(false);

  function winClose() {
    appWindow.close();
  }
  function winMinimize() {
    appWindow.minimize();
  }

  async function saveSettings() {
    await invoke("save_settings", { settings: appSettings });
  }

  async function checkIp() {
    isCheckingIp = true;
    try {
      const res = await fetch("https://ipinfo.io/json");
      const data = await res.json();
      ipInfo = { ip: data.ip, region: data.region };
    } catch (e) {
      console.error(e);
    } finally {
      isCheckingIp = false;
    }
  }

  async function loadProfiles() {
    try {
      profiles = await invoke("get_profiles");
      if (profiles.length > 0 && !selectedProfileId) {
        selectedProfileId = profiles[0].id;
      }
    } catch (e) {
      console.error("Failed to load profiles", e);
    }
  }

  async function handleAddProfile(
    name: string | null,
    link: string | null,
    isReload: boolean = false,
  ) {
    if (isReload) {
      await loadProfiles();
      logs = [...logs, "Subscription imported successfully."];
      return;
    }

    if (name && link) {
      try {
        profiles = await invoke("add_profile", { name, link });
        selectedProfileId = profiles[profiles.length - 1].id;
        logs = [...logs, `Profile '${name}' added.`];
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function handleDelete(id: string | null = null) {
    const targetId = id || selectedProfileId;

    if (!targetId) {
      return;
    }

    try {
      profiles = await invoke("delete_profile", { id: targetId });
      logs = [...logs, "Profile deleted successfully."];

      // If we deleted the currently selected profile, select the first one or clear selection
      if (targetId === selectedProfileId) {
        if (profiles.length > 0) selectedProfileId = profiles[0].id;
        else selectedProfileId = "";
      }
    } catch (e) {
      console.error(e);
      logs = [...logs, `Delete failed: ${e}`];
    }
  }

  function formatDuration(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  let lastSavedSessionUp = 0;
  let lastSavedSessionDown = 0;

  function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  function startStats() {
    startTime = Date.now();
    sessionUp = 0;
    sessionDown = 0;
    lastSavedSessionUp = 0;
    lastSavedSessionDown = 0;

    timerInterval = setInterval(() => {
      if (startTime) {
        duration = formatDuration(Date.now() - startTime);
      }

      const up = Math.floor(Math.random() * 100); // KB
      const down = Math.floor(Math.random() * 500); // KB

      sessionUp += up * 1024;
      sessionDown += down * 1024;

      uploadSpeed = `${up} KB/s`;
      downloadSpeed = `${down} KB/s`;

      const profile = profiles.find((p) => p.id === selectedProfileId);
      const savedUp = profile?.total_up || 0;
      const savedDown = profile?.total_down || 0;

      totalUp = formatBytes(savedUp + sessionUp);
      totalDown = formatBytes(savedDown + sessionDown);

      if (Date.now() % 5000 < 1000 && selectedProfileId) {
        const deltaUp = sessionUp - lastSavedSessionUp;
        const deltaDown = sessionDown - lastSavedSessionDown;

        if (deltaUp > 0 || deltaDown > 0) {
          invoke("update_profile_usage", {
            id: selectedProfileId,
            up: deltaUp,
            down: deltaDown,
          });
          lastSavedSessionUp = sessionUp;
          lastSavedSessionDown = sessionDown;
        }
      }
    }, 1000);

    setTimeout(() => {
      ws = new WebSocket("ws://127.0.0.1:9090/traffic?token=");
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          uploadSpeed = formatBytes(data.up);
          downloadSpeed = formatBytes(data.down);
        } catch (e) {}
      };
    }, 1000);
  }

  function stopStats() {
    if (timerInterval) clearInterval(timerInterval);
    if (ws) ws.close();
    duration = "00:00:00";
    uploadSpeed = "0 B/s";
    downloadSpeed = "0 B/s";
    startTime = null;
  }

  async function toggleVpn() {
    if (profiles.length === 0) {
      status = "No Profile!";
      return;
    }

    try {
      if (!isConnected) {
        status = "Connecting...";
        const current = profiles.find((p) => p.id === selectedProfileId);
        await invoke("start_vpn");
        isConnected = true;
        status = "CONNECTED";
        startStats();
      } else {
        status = "Stopping...";
        await invoke("stop_vpn");
        isConnected = false;
        status = "Ready";
        stopStats();
      }
    } catch (error) {
      status = "Error";
      console.error(error);
    }
  }

  onMount(async () => {
    await loadProfiles();

    try {
      const settings = (await invoke("get_settings")) as any;
      appSettings = { ...appSettings, ...settings };
    } catch (e) {
      console.error("Failed to load settings", e);
    }

    logs = ["System initialized.", "Waiting for commands..."];
    await listen("vpn-log", async (event) => {
      logs = [...logs, event.payload as string];
      await tick();
      if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
    });
  });

  onDestroy(() => {
    stopStats();
  });
</script>

<AddModal
  isOpen={isModalOpen}
  onClose={() => (isModalOpen = false)}
  onSave={handleAddProfile}
/>

<main
  class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans select-none flex"
>
  <!-- Sidebar -->
  <div
    class="w-64 bg-zinc-900/50 border-r border-white/5 flex flex-col shrink-0"
  >
    <!-- Logo -->
    <div class="h-16 flex items-center px-6 gap-2" data-tauri-drag-region>
      <div class="text-orange-500 pointer-events-none">
        <Power size={24} strokeWidth={2.5} />
      </div>
      <div class="font-black tracking-wider text-xl pointer-events-none">
        NUGGET<span class="font-light text-zinc-400">VPN</span>
      </div>
    </div>

    <!-- Navigation -->
    <div class="flex-1 py-6 px-3 space-y-1">
      <button
        class="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium
        {activeTab === 'connection'
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}"
        onclick={() => (activeTab = "connection")}
      >
        <Power size={18} />
        Connection
      </button>
      <button
        class="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium
        {activeTab === 'configuration'
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}"
        onclick={() => (activeTab = "configuration")}
      >
        <Server size={18} />
        Configuration
      </button>
      <button
        class="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium
        {activeTab === 'logs'
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}"
        onclick={() => (activeTab = "logs")}
      >
        <Clock size={18} />
        Logs
      </button>
    </div>

    <!-- Bottom Actions -->
    <div class="px-3 pb-4">
      <button
        onclick={() => (activeTab = "settings")}
        class="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium
            {activeTab === 'settings'
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}"
      >
        <Settings size={18} />
        Settings
      </button>
    </div>

    <!-- Bottom Status -->
    <div class="p-4 border-t border-white/5">
      <div class="flex items-center gap-3 px-2">
        <div
          class="w-2 h-2 rounded-full {isConnected
            ? 'bg-green-500 animate-pulse'
            : 'bg-zinc-700'}"
        ></div>
        <div class="text-xs font-medium text-zinc-400">{status}</div>
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <div class="flex-1 flex flex-col bg-[#0f0805]">
    <!-- Top Bar -->
    <div
      class="h-16 border-b border-white/5 flex items-center justify-between px-6 shrink-0"
      data-tauri-drag-region
    >
      <div class="flex flex-col">
        <span
          class="text-[10px] font-bold tracking-wider text-zinc-500 uppercase"
          >Current Profile</span
        >
        <div class="relative group flex items-center gap-2">
          {#if profiles.length === 0}
            <span class="font-medium text-zinc-400">No profiles</span>
          {:else}
            <!-- Custom Dropdown -->
            <div class="relative">
              <button
                onclick={() =>
                  !isConnected &&
                  (isProfileDropdownOpen = !isProfileDropdownOpen)}
                disabled={isConnected}
                class="flex items-center gap-2 text-lg font-bold text-white outline-none disabled:opacity-50 disabled:cursor-not-allowed hover:text-zinc-300 transition-colors"
              >
                {profiles.find((p) => p.id === selectedProfileId)?.name ||
                  "Select Profile"}
                <ChevronDown
                  size={14}
                  class={`text-zinc-500 transition-transform ${isProfileDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {#if isProfileDropdownOpen}
                <!-- Backdrop to close -->
                <div
                  class="fixed inset-0 z-40"
                  onclick={() => (isProfileDropdownOpen = false)}
                ></div>

                <!-- Dropdown Menu -->
                <div
                  class="absolute top-full left-0 mt-2 w-64 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-96"
                >
                  {#each profiles as p}
                    <button
                      onclick={() => {
                        selectedProfileId = p.id;
                        isProfileDropdownOpen = false;
                      }}
                      class="text-left px-4 py-3 hover:bg-white/5 transition-colors flex flex-col gap-1 border-b border-white/5 last:border-0"
                    >
                      <div class="font-bold text-zinc-200">{p.name}</div>
                      <div
                        class="flex items-center justify-between text-xs text-zinc-500 font-mono"
                      >
                        <span>{p.server}</span>
                        <span
                          >{formatBytes(
                            (p.total_up || 0) + (p.total_down || 0),
                          )}</span
                        >
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <div class="flex items-center gap-4">
        <button
          onclick={() => (isModalOpen = true)}
          disabled={isConnected}
          class="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={16} />
        </button>

        <div class="h-6 w-px bg-zinc-800 mx-2"></div>

        <div class="flex items-center gap-2">
          <button
            onclick={winMinimize}
            class="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
          >
            <Minus size={16} />
          </button>
          <button
            onclick={winClose}
            class="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 relative overflow-hidden">
      {#if activeTab === "connection"}
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <!-- Background Glow -->
          <div
            class="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
          >
            <div
              class="w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-[100px] absolute transition-all duration-1000 {isConnected
                ? 'opacity-100 scale-110'
                : 'opacity-30 scale-90'}"
            ></div>
          </div>

          <!-- Connect Button -->
          <div class="relative z-10 mb-12">
            <button
              onclick={toggleVpn}
              class="group relative w-56 h-56 rounded-full flex items-center justify-center transition-all duration-500 outline-none
                  {isConnected ? 'scale-105' : 'hover:scale-[1.02]'}"
            >
              <!-- Outer Ring -->
              <div
                class="absolute inset-0 rounded-full border border-white/5 bg-zinc-900/20 backdrop-blur-sm"
              ></div>

              <!-- Inner Circle -->
              <div
                class="absolute inset-3 rounded-full transition-all duration-700 overflow-hidden flex items-center justify-center
                    {isConnected
                  ? 'bg-linear-to-tr from-orange-600 to-amber-500 shadow-[0_0_60px_rgba(249,115,22,0.4)]'
                  : 'bg-zinc-900 border border-white/5 shadow-inner'}"
              >
                {#if isConnected}
                  <div class="absolute inset-0 bg-black/10 animate-pulse"></div>
                {/if}

                <Power
                  size={64}
                  strokeWidth={1.5}
                  class="relative z-10 transition-all duration-500 {isConnected
                    ? 'text-white drop-shadow-md scale-110'
                    : 'text-zinc-600 group-hover:text-orange-400'}"
                />
              </div>
            </button>
          </div>

          <!-- Stats -->
          {#if isConnected}
            <div class="flex flex-col items-center w-full max-w-sm z-10">
              <!-- Duration -->
              <div class="flex flex-col items-center gap-1 mb-6">
                <span
                  class="text-xs font-bold text-zinc-500 tracking-wider uppercase"
                  >Duration</span
                >
                <span class="font-mono text-xl text-zinc-200">{duration}</span>
              </div>

              <!-- Stats Grid -->
              <div class="grid grid-cols-2 gap-4 w-full">
                <div
                  class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/50 backdrop-blur-sm"
                >
                  <div
                    class="text-zinc-500 text-xs font-medium mb-1 flex items-center gap-2"
                  >
                    <ArrowUp size={12} /> UPLOAD
                  </div>
                  <div class="text-xl font-bold text-zinc-200 font-mono">
                    {uploadSpeed}
                  </div>
                  <div class="text-xs text-zinc-600 font-mono mt-1">
                    Total: {totalUp}
                  </div>
                </div>
                <div
                  class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/50 backdrop-blur-sm"
                >
                  <div
                    class="text-zinc-500 text-xs font-medium mb-1 flex items-center gap-2"
                  >
                    <ArrowDown size={12} /> DOWNLOAD
                  </div>
                  <div class="text-xl font-bold text-zinc-200 font-mono">
                    {downloadSpeed}
                  </div>
                  <div class="text-xs text-zinc-600 font-mono mt-1">
                    Total: {totalDown}
                  </div>
                </div>
              </div>

              <!-- IP Check -->
              <div class="mt-6 flex flex-col items-center gap-2">
                <button
                  onclick={checkIp}
                  disabled={isCheckingIp}
                  class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors flex items-center gap-2"
                >
                  <Globe size={16} />
                  {isCheckingIp ? "Checking..." : "Check IP"}
                </button>
                {#if ipInfo}
                  <div class="text-xs text-zinc-500 font-mono">
                    {ipInfo.ip} ({ipInfo.region})
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div
              class="h-[52px] flex items-center justify-center text-zinc-500 text-sm z-10"
            >
              Ready to connect
            </div>
          {/if}
        </div>
      {:else if activeTab === "settings"}
        <div class="h-full px-12 py-4 flex flex-col">
          <header class="flex-none mb-8">
            <h1 class="text-3xl font-black text-zinc-100 tracking-tight">
              Settings
            </h1>
            <p class="text-zinc-500 mt-2">Configure your client preferences</p>
          </header>

          <div class="flex-1 overflow-y-auto space-y-6 pr-2">
            <!-- MTU -->
            <div
              class="bg-zinc-900/30 rounded-2xl p-6 border border-zinc-800/50"
            >
              <label class="block text-sm font-medium text-zinc-400 mb-2"
                >MTU</label
              >
              <input
                type="number"
                bind:value={appSettings.mtu}
                onchange={saveSettings}
                class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-200 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
              <p class="text-xs text-zinc-600 mt-2">
                Maximum Transmission Unit. Default is 9000.
              </p>
            </div>

            <!-- DNS -->
            <div
              class="bg-zinc-900/30 rounded-2xl p-6 border border-zinc-800/50"
            >
              <label class="block text-sm font-medium text-zinc-400 mb-2"
                >DNS Server</label
              >
              <input
                type="text"
                bind:value={appSettings.dns}
                onchange={saveSettings}
                class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-200 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
              <p class="text-xs text-zinc-600 mt-2">
                Primary DNS server address (e.g., 1.1.1.1).
              </p>
            </div>

            <!-- TLS Fragment -->
            <div
              class="bg-zinc-900/30 rounded-2xl p-6 border border-zinc-800/50 space-y-4"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-medium text-zinc-200">
                    TLS Fragmentation
                  </div>
                  <div class="text-xs text-zinc-600 mt-1">
                    Split TLS records to bypass SNI blocking.
                  </div>
                </div>
                <button
                  onclick={() => {
                    appSettings.tls_fragment = !appSettings.tls_fragment;
                    saveSettings();
                  }}
                  class={`w-12 h-6 rounded-full transition-colors relative ${appSettings.tls_fragment ? "bg-orange-500" : "bg-zinc-700"}`}
                >
                  <div
                    class={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${appSettings.tls_fragment ? "left-7" : "left-1"}`}
                  ></div>
                </button>
              </div>

              {#if appSettings.tls_fragment}
                <div
                  class="grid grid-cols-2 gap-4 pt-4 border-t border-white/5"
                >
                  <div>
                    <label class="block text-xs font-medium text-zinc-500 mb-1"
                      >Size Range</label
                    >
                    <input
                      type="text"
                      bind:value={appSettings.tls_fragment_size}
                      onchange={saveSettings}
                      placeholder="100-200"
                      class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-zinc-500 mb-1"
                      >Sleep Range (ms)</label
                    >
                    <input
                      type="text"
                      bind:value={appSettings.tls_fragment_sleep}
                      onchange={saveSettings}
                      placeholder="10-20"
                      class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                </div>
              {/if}
            </div>

            <!-- TLS Mixed SNI Case -->
            <div
              class="bg-zinc-900/30 rounded-2xl p-6 border border-zinc-800/50 flex items-center justify-between"
            >
              <div>
                <div class="text-sm font-medium text-zinc-200">
                  TLS Mixed SNI Case
                </div>
                <div class="text-xs text-zinc-600 mt-1">
                  Randomize SNI capitalization.
                </div>
              </div>
              <button
                onclick={() => {
                  appSettings.tls_mixed_sni_case =
                    !appSettings.tls_mixed_sni_case;
                  saveSettings();
                }}
                class={`w-12 h-6 rounded-full transition-colors relative ${appSettings.tls_mixed_sni_case ? "bg-orange-500" : "bg-zinc-700"}`}
              >
                <div
                  class={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${appSettings.tls_mixed_sni_case ? "left-7" : "left-1"}`}
                ></div>
              </button>
            </div>

            <!-- TLS Padding -->
            <div
              class="bg-zinc-900/30 rounded-2xl p-6 border border-zinc-800/50 flex items-center justify-between"
            >
              <div>
                <div class="text-sm font-medium text-zinc-200">TLS Padding</div>
                <div class="text-xs text-zinc-600 mt-1">
                  Add random padding to TLS records.
                </div>
              </div>
              <button
                onclick={() => {
                  appSettings.tls_padding = !appSettings.tls_padding;
                  saveSettings();
                }}
                class={`w-12 h-6 rounded-full transition-colors relative ${appSettings.tls_padding ? "bg-orange-500" : "bg-zinc-700"}`}
              >
                <div
                  class={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${appSettings.tls_padding ? "left-7" : "left-1"}`}
                ></div>
              </button>
            </div>
          </div>
        </div>
      {:else if activeTab === "logs"}
        <div class="absolute inset-0 flex flex-col p-6">
          <h2 class="text-lg font-bold mb-4 text-zinc-200">System Logs</h2>
          <div
            class="flex-1 overflow-y-auto font-mono text-xs text-zinc-400 bg-zinc-900/50 rounded-xl p-4 border border-white/5 custom-scrollbar"
            bind:this={logContainer}
          >
            {#each logs as log}
              <div class="mb-1 border-b border-white/5 pb-1 last:border-0">
                {log}
              </div>
            {/each}
          </div>
        </div>
      {:else if activeTab === "configuration"}
        <div class="absolute inset-0 flex flex-col p-6">
          <h2 class="text-lg font-bold mb-4 text-zinc-200">Configuration</h2>
          <div class="flex-1 overflow-y-auto custom-scrollbar space-y-2">
            {#each profiles as p}
              <div
                class="bg-zinc-900/50 border border-white/5 rounded-xl p-4 flex items-center justify-between group hover:border-orange-500/30 transition-colors"
              >
                <div>
                  <div class="font-bold text-zinc-200">{p.name}</div>
                  <div class="text-xs text-zinc-500 font-mono mt-1">
                    {p.server} ({p.protocol})
                  </div>
                </div>
                <div
                  class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <button
                    onclick={() => handleDelete(p.id)}
                    class="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-lg text-zinc-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            {/each}

            <button
              onclick={() => (isModalOpen = true)}
              class="w-full py-4 rounded-xl border border-dashed border-zinc-800 text-zinc-500 hover:border-orange-500/50 hover:text-orange-400 hover:bg-orange-500/5 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Add New Profile
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</main>
