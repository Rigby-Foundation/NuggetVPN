<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { Server, LogIn, UserPlus, ArrowRight, X } from "lucide-svelte";

    let { settings, oncomplete } = $props();

    let step = $state(0); // 0: Server URL, 1: Auth (Login/Register)
    let serverUrl = $state("http://127.0.0.1:3001");
    let username = $state("");
    let password = $state("");
    let isRegistering = $state(false);
    let error = $state("");
    let isLoading = $state(false);

    async function handleSkip() {
        settings.skip_auth = true;
        await invoke("save_settings", { settings });
        oncomplete();
    }

    async function checkServer() {
        isLoading = true;
        error = "";
        try {
            // Simple health check or just assume it's valid if we can reach it
            // For now, we'll just proceed to the next step
            // In a real app, you might want to ping the server here
            if (!serverUrl.startsWith("http")) {
                serverUrl = "http://" + serverUrl;
            }
            step = 1;
        } catch (e) {
            error = "Could not reach server";
        } finally {
            isLoading = false;
        }
    }

    async function handleAuth() {
        isLoading = true;
        error = "";
        try {
            if (isRegistering) {
                await invoke("register_user", {
                    server: serverUrl,
                    username,
                    password,
                });

                isRegistering = false;
                error = "Registration successful! Please log in.";
                isLoading = false;
                return;
            }

            // Login
            const token = await invoke("login_user", {
                server: serverUrl,
                username,
                password,
            });

            if (token) {
                settings.auth_server = serverUrl;
                settings.auth_token = token;
                settings.skip_auth = false;

                // Check for local profiles
                const profiles = (await invoke("get_profiles")) as any[];

                if (profiles.length > 0) {
                    // Existing user adding sync -> Push on next restart
                    settings.pending_sync_upload = true;
                    await invoke("save_settings", { settings });
                    // We can't easily force a restart here, so we just complete and let the main app handle notifications or the user restarts manually as instructed
                    // Maybe show a message?
                    alert(
                        "Sync configured! Please restart the application to upload your profiles.",
                    );
                } else {
                    // New user -> Pull profiles immediately
                    try {
                        await invoke("pull_profiles_from_server", { settings });
                    } catch (e) {
                        console.error("Failed to pull profiles:", e);
                        // Non-fatal, maybe just empty server
                    }
                    await invoke("save_settings", { settings });
                }

                oncomplete();
            }
        } catch (e: any) {
            error = e || "An error occurred";
        } finally {
            isLoading = false;
        }
    }
</script>

<div
    class="fixed inset-0 z-50 bg-[#0f0805] flex items-center justify-center p-6"
>
    <div class="w-full max-w-md">
        <!-- Header -->
        <div class="text-center mb-10">
            <div
                class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500/10 text-orange-500 mb-6"
            >
                <Server size={32} />
            </div>
            <h1 class="text-3xl font-black text-white tracking-tight mb-2">
                Welcome to NuggetVPN
            </h1>
            <p class="text-zinc-500">
                {#if step === 0}
                    Connect to your sync server to get started
                {:else}
                    {isRegistering
                        ? "Create your account"
                        : "Sign in to your account"}
                {/if}
            </p>
        </div>

        <div
            class="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-xl"
        >
            {#if error}
                <div
                    class="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center"
                >
                    {error}
                </div>
            {/if}

            {#if step === 0}
                <div class="space-y-4">
                    <div>
                        <label
                            class="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider"
                            >Server URL</label
                        >
                        <input
                            type="text"
                            bind:value={serverUrl}
                            placeholder="http://your-server.com:3001"
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 focus:outline-none focus:border-orange-500/50 transition-colors"
                        />
                    </div>

                    <button
                        onclick={checkServer}
                        disabled={isLoading}
                        class="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {#if isLoading}
                            Checking...
                        {:else}
                            Continue <ArrowRight size={18} />
                        {/if}
                    </button>
                </div>
            {:else}
                <div class="space-y-4">
                    <div>
                        <label
                            class="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider"
                            >Username</label
                        >
                        <input
                            type="text"
                            bind:value={username}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 focus:outline-none focus:border-orange-500/50 transition-colors"
                        />
                    </div>
                    <div>
                        <label
                            class="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider"
                            >Password</label
                        >
                        <input
                            type="password"
                            bind:value={password}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 focus:outline-none focus:border-orange-500/50 transition-colors"
                        />
                    </div>

                    <button
                        onclick={handleAuth}
                        disabled={isLoading}
                        class="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {#if isLoading}
                            Processing...
                        {:else}
                            {isRegistering ? "Create Account" : "Sign In"}
                        {/if}
                    </button>

                    <div class="flex items-center justify-between pt-2">
                        <button
                            onclick={() => (step = 0)}
                            class="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            Back
                        </button>
                        <button
                            onclick={() => {
                                isRegistering = !isRegistering;
                                error = "";
                            }}
                            class="text-sm text-orange-500 hover:text-orange-400 transition-colors font-medium"
                        >
                            {isRegistering
                                ? "Already have an account?"
                                : "Need an account?"}
                        </button>
                    </div>
                </div>
            {/if}
        </div>

        <div class="mt-6 text-center">
            <button
                onclick={handleSkip}
                class="w-full py-3 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-all font-medium text-sm"
            >
                Skip Synchronization
            </button>
        </div>
    </div>
</div>
