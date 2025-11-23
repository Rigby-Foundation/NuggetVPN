<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount, tick } from "svelte";
  import { onDestroy } from "svelte";
  import {
    Power,
    X,
    Minus,
    Plus,
    ChevronDown,
    Trash2,
    Server,
    ArrowUp,
    ArrowDown,
    Clock,
  } from "lucide-svelte";
  import AddModal from "../components/AddModal.svelte";

  const appWindow = getCurrentWindow();

  interface Profile {
    id: string;
    name: string;
    server: string;
    protocol: string;
    config_link: string;
  }

  let profiles: Profile[] = $state([]);
  let selectedProfileId = $state("");
  let isModalOpen = $state(false);
  let activeTab = $state("connection");

  let status = $state("Ready");
  let isConnected = $state(false);
  let logs: string[] = $state([]);
  let logContainer: HTMLDivElement;

  // Stats
  let duration = $state("00:00:00");
  let startTime: number | null = null;
  let timerInterval: any = null;
  let uploadSpeed = $state("0 B/s");
  let downloadSpeed = $state("0 B/s");
  let ws: WebSocket | null = null;

  function winClose() {
    appWindow.close();
  }
  function winMinimize() {
    appWindow.minimize();
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

    // confirm() seems to be failing/returning false immediately in this environment
    // Removing it for now to allow deletion.
    // if (confirm("Delete this profile?")) {
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
    // }
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

  function formatBytes(bytes: number) {
    if (bytes === 0) return "0 B/s";
    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function startStats() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
      if (startTime) {
        duration = formatDuration(Date.now() - startTime);
      }
    }, 1000);

    // Connect to sing-box API
    // Wait a bit for sing-box to start
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
            <select
              bind:value={selectedProfileId}
              disabled={isConnected}
              class="appearance-none bg-transparent border-none text-lg font-bold text-white outline-none cursor-pointer disabled:opacity-50 pr-6"
            >
              {#each profiles as p}
                <option value={p.id} class="bg-zinc-900 text-zinc-300"
                  >{p.name}</option
                >
              {/each}
            </select>
            <div
              class="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500"
            >
              <ChevronDown size={14} />
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
            <div class="flex items-center gap-8 z-10">
              <div class="flex flex-col items-center gap-1">
                <span
                  class="text-xs font-bold text-zinc-500 tracking-wider uppercase"
                  >Duration</span
                >
                <span class="font-mono text-xl text-zinc-200">{duration}</span>
              </div>
              <div class="w-px h-8 bg-zinc-800"></div>
              <div class="flex flex-col items-center gap-1">
                <span
                  class="text-xs font-bold text-zinc-500 tracking-wider uppercase"
                  >Upload</span
                >
                <span
                  class="font-mono text-sm text-zinc-300 flex items-center gap-1"
                >
                  <ArrowUp size={12} class="text-orange-500" />
                  {uploadSpeed}
                </span>
              </div>
              <div class="w-px h-8 bg-zinc-800"></div>
              <div class="flex flex-col items-center gap-1">
                <span
                  class="text-xs font-bold text-zinc-500 tracking-wider uppercase"
                  >Download</span
                >
                <span
                  class="font-mono text-sm text-zinc-300 flex items-center gap-1"
                >
                  <ArrowDown size={12} class="text-green-500" />
                  {downloadSpeed}
                </span>
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
