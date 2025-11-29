<script lang="ts">
    import { X, Clipboard, Link, type Icon } from "lucide-svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { fade, scale } from "svelte/transition";

    let { isOpen, onClose, onSave } = $props();

    let name = $state("");
    let inputLink = $state("");
    let isLoading = $state(false);
    let errorMsg = $state("");

    async function handleProcess() {
        if (!inputLink) return;
        isLoading = true;
        errorMsg = "";

        try {
            if (
                inputLink.startsWith("http://") ||
                inputLink.startsWith("https://")
            ) {
                const updatedProfiles = await invoke("import_subscription", {
                    url: inputLink,
                });
                onSave(null, null, true);
                onClose();
            } else {
                let finalName = name || "New Profile";
                onSave(finalName, inputLink, false);
                onClose();
            }
        } catch (e) {
            errorMsg = "Error: " + e;
        } finally {
            isLoading = false;
            name = "";
            inputLink = "";
        }
    }
</script>

{#if isOpen}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        transition:fade={{ duration: 200 }}
    >
        <div
            class="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            transition:scale={{ duration: 200, start: 0.95 }}
        >
            <div
                class="p-6 border-b border-white/5 flex items-center justify-between"
            >
                <h2 class="text-xl font-bold text-white">Add Profile</h2>
                <button
                    onclick={onClose}
                    class="text-zinc-500 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>
            </div>

            <div class="p-6 space-y-4">
                <div class="space-y-1">
                    <label
                        class="text-[10px] uppercase font-bold text-zinc-500 ml-1"
                        >Config Link OR Subscription URL</label
                    >
                    <textarea
                        bind:value={inputLink}
                        rows="3"
                        placeholder="Paste vless://... OR http://mysite.com/sub"
                        class="w-full bg-zinc-950 border border-zinc-700 focus:border-orange-500 text-zinc-100 p-3 rounded-xl outline-none text-xs font-mono resize-none"
                    ></textarea>
                </div>

                {#if !inputLink.startsWith("http")}
                    <div class="space-y-1">
                        <label
                            class="text-[10px] uppercase font-bold text-zinc-500 ml-1"
                            >Profile Name (Optional)</label
                        >
                        <input
                            bind:value={name}
                            type="text"
                            placeholder="My Server"
                            class="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 p-3 rounded-xl outline-none"
                        />
                    </div>
                {/if}

                {#if errorMsg}
                    <div
                        class="text-red-500 text-xs p-2 bg-red-500/10 rounded border border-red-500/20"
                    >
                        {errorMsg}
                    </div>
                {/if}
            </div>

            <div class="p-4 pt-0 flex gap-3">
                <button
                    onclick={onClose}
                    class="flex-1 py-3 rounded-xl text-zinc-400 hover:bg-white/5 text-sm"
                    >Cancel</button
                >
                <button
                    onclick={handleProcess}
                    disabled={isLoading}
                    class="flex-1 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm shadow-[0_0_15px_-5px_rgba(234,88,12,0.5)] disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {#if isLoading}
                        <span
                            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                        ></span>
                        Processing...
                    {:else if inputLink.startsWith("http")}
                        Import Sub
                    {:else}
                        Add Profile
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}
