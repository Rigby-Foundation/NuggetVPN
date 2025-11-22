<script lang="ts">
    import { X, Clipboard, Link, type Icon } from "lucide-svelte";
    import { invoke } from "@tauri-apps/api/core";

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
        class="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        onclick={onClose}
    >
        <div
            class="w-full max-w-sm bg-[#120a05] border border-orange-500/20 rounded-2xl shadow-2xl overflow-hidden"
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="bg-white/5 p-4 flex justify-between items-center border-b border-white/5"
            >
                <h3 class="text-zinc-100 font-bold tracking-wide">
                    ADD CONNECTION
                </h3>
                <button onclick={onClose}
                    ><X
                        size={18}
                        class="text-zinc-500 hover:text-white"
                    /></button
                >
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
                        class="w-full bg-zinc-900/50 border border-zinc-700 focus:border-orange-500 text-zinc-100 p-3 rounded-xl outline-none text-xs font-mono resize-none"
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
                            class="w-full bg-zinc-900/50 border border-zinc-700 text-zinc-100 p-3 rounded-xl outline-none"
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
