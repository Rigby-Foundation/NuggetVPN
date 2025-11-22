<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount, tick } from "svelte";
  import {
    Power,
    X,
    Minus,
    Plus,
    ChevronDown,
    Trash2,
    ShieldCheck,
    Server,
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

  let status = $state("Ready");
  let isConnected = $state(false);
  let logs: string[] = $state([]);
  let logContainer: HTMLDivElement;

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

  async function handleDelete() {
    if (!selectedProfileId) return;
    if (confirm("Delete this profile?")) {
      profiles = await invoke("delete_profile", { id: selectedProfileId });
      if (profiles.length > 0) selectedProfileId = profiles[0].id;
      else selectedProfileId = "";
    }
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
      } else {
        status = "Stopping...";
        await invoke("stop_vpn");
        isConnected = false;
        status = "Ready";
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
</script>

<AddModal
  isOpen={isModalOpen}
  onClose={() => (isModalOpen = false)}
  onSave={handleAddProfile}
/>

<main
  class="h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-[#0f0805] to-black text-zinc-100 font-sans select-none flex flex-col"
>
  <div
    data-tauri-drag-region
    class="h-12 flex items-center justify-between px-4 shrink-0 relative bg-white/0"
  >
    <div class="flex items-center gap-2 z-10 pt-2">
      <button
        onclick={winClose}
        class="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-75 transition-all group relative"
      >
        <X
          class="w-2 h-2 text-black/50 absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-100"
        />
      </button>
      <button
        onclick={winMinimize}
        class="w-3 h-3 rounded-full bg-[#FFBD2E] hover:brightness-75 transition-all group relative"
      >
        <Minus
          class="w-2 h-2 text-black/50 absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-100"
        />
      </button>
    </div>

    <div
      class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30 text-xs tracking-widest font-bold"
    >
      NUGGETVPN
    </div>
  </div>

  <div
    class="flex-1 flex flex-col items-center justify-center p-6 relative z-0"
  >
    <div
      class="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        class="w-[450px] h-[450px] bg-orange-600/5 rounded-full blur-3xl absolute transition-all duration-1000 {isConnected
          ? 'opacity-100 scale-110'
          : 'opacity-20 scale-90'}"
      ></div>
    </div>

    <div class="relative w-full max-w-[320px] z-10 flex flex-col gap-6">
      <div class="text-center space-y-1 mb-2">
        <div
          class="text-xs font-bold tracking-[0.2em] text-zinc-500 uppercase flex items-center justify-center gap-2"
        >
          {#if isConnected}<span
              class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"
            ></span>{/if}
          Status
        </div>
        <div
          class="text-2xl font-black tracking-tight flex items-center justify-center gap-2 {isConnected
            ? 'text-orange-400 drop-shadow-glow'
            : 'text-zinc-300'}"
        >
          {status}
        </div>
      </div>

      <div class="flex justify-center mb-2">
        <button
          onclick={toggleVpn}
          class="group relative w-44 h-44 rounded-full flex items-center justify-center transition-all duration-500 outline-none
          {isConnected ? 'scale-105' : 'hover:scale-[1.02]'}"
        >
          <div
            class="absolute inset-0 rounded-full bg-zinc-900/40 border border-white/5 shadow-2xl backdrop-blur-sm"
          ></div>

          <div
            class="absolute inset-2 rounded-full transition-all duration-700 overflow-hidden
            {isConnected
              ? 'bg-gradient-to-t from-orange-600 to-amber-500 shadow-[0_0_50px_rgba(249,115,22,0.6)]'
              : 'bg-[#0a0a0a] border border-white/5 shadow-inner'}"
          >
            {#if isConnected}
              <div
                class="absolute bottom-0 left-0 right-0 h-full bg-black/10 mix-blend-overlay animate-pulse"
              ></div>
            {/if}
          </div>

          <Power
            size={56}
            strokeWidth={1.5}
            class="relative z-10 transition-all duration-500 {isConnected
              ? 'text-white drop-shadow-md scale-110'
              : 'text-zinc-600 group-hover:text-orange-400'}"
          />
        </button>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <div class="relative flex-1 group">
            <div class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              <Server size={14} />
            </div>
            <select
              bind:value={selectedProfileId}
              disabled={isConnected || profiles.length === 0}
              class="w-full appearance-none bg-zinc-900/50 hover:bg-zinc-800 border border-white/5 hover:border-orange-500/20 text-sm text-zinc-200 pl-10 pr-8 py-3 rounded-xl transition-all outline-none disabled:opacity-50 cursor-pointer"
            >
              {#if profiles.length === 0}
                <option>No profiles</option>
              {:else}
                {#each profiles as p}
                  <option value={p.id}>{p.name} ({p.protocol})</option>
                {/each}
              {/if}
            </select>
            <div
              class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
            >
              <ChevronDown size={14} />
            </div>
          </div>

          {#if profiles.length > 0 && !isConnected}
            <button
              onclick={handleDelete}
              class="p-3 rounded-xl bg-zinc-900/30 border border-white/5 hover:bg-red-900/20 hover:text-red-400 text-zinc-600 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          {/if}
        </div>

        <button
          onclick={() => (isModalOpen = true)}
          disabled={isConnected}
          class="w-full py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-500 text-xs hover:border-orange-500/50 hover:text-orange-400 hover:bg-orange-500/5 transition-all flex items-center justify-center gap-2 disabled:opacity-0"
        >
          <Plus size={14} /> Add Connection Profile
        </button>
      </div>

      <div class="h-16 overflow-hidden relative group/logs mt-2">
        <div
          class="h-full overflow-y-auto font-mono text-[9px] text-zinc-600 px-2 custom-scrollbar"
          bind:this={logContainer}
        >
          {#each logs as log}
            <div class="mb-1">{log}</div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</main>
