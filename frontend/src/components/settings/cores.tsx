import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

import { SettingsGroup } from "@/components/settings/shell";
import { errorMessage, invoke } from "@/lib/backend";
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isAndroid } from "@/lib/platform";
import { AppSettings, CoreInfo, CoreName } from "@/types";

interface CoreEntry {
    id: CoreName;
    title: MessageKey;
    summary: MessageKey;
    /** What works differently with this core; empty for none. */
    limits: MessageKey[];
}

const CORES: CoreEntry[] = [
    { id: "builtin", title: "core.builtin", summary: "core.builtin.summary", limits: [] },
    { id: "sing-box", title: "core.singbox", summary: "core.singbox.summary", limits: ["core.singbox.limit.xhttp"] },
    {
        id: "mihomo",
        title: "core.mihomo",
        summary: "core.mihomo.summary",
        limits: ["core.mihomo.limit.protocol", "core.mihomo.limit.srs", "core.mihomo.limit.geo", "core.mihomo.limit.tls"],
    },
    { id: "xray", title: "core.xray", summary: "core.xray.summary", limits: ["core.xray.limit.protocols", "core.xray.limit.plugins", "core.xray.limit.tls"] },
];

/**
 * Which core runs the tunnel. All of them are linked into the app, so
 * choosing one is all there is to it.
 */
export function CorePanel({
    appSettings,
    onSettingsChange,
}: {
    appSettings: AppSettings;
    onSettingsChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}) {
    const t = useT();
    const [versions, setVersions] = useState<Partial<Record<CoreName, string>>>({});
    const [busy, setBusy] = useState<CoreName | null>(null);

    useEffect(() => {
        invoke<CoreInfo[]>("list_cores")
            .then((list) => setVersions(Object.fromEntries((list ?? []).map((core) => [core.name, core.version]))))
            .catch(() => undefined);
    }, []);

    const choose = async (id: CoreName) => {
        if (id === appSettings.core) return;
        setBusy(id);
        try {
            const saved = await invoke<AppSettings>("set_core", { name: id });
            onSettingsChange("core", saved.core);
            toast.success(t("core.chosen", { name: t(CORES.find((core) => core.id === id)!.title) }), { id: "core-set" });
        } catch (error) {
            toast.error(errorMessage(error), { id: "core-set" });
        } finally {
            setBusy(null);
        }
    };

    return (
        <SettingsGroup>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("core.description")}</p>
            <div className="space-y-2" role="radiogroup" aria-label={t("settings.core")}>
                {/* Android gives the tunnel to one core through VpnService; the
                    built-in core has that wiring, and Xray works behind it. */}
                {CORES.filter((core) => !isAndroid || core.id === "builtin" || core.id === "xray").map((core) => {
                    const active = appSettings.core === core.id;
                    const version = versions[core.id];
                    return (
                        <button
                            key={core.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={busy !== null}
                            onClick={() => void choose(core.id)}
                            className={cn(
                                "block w-full rounded-xl border-2 p-3.5 text-start transition-colors disabled:cursor-wait",
                                active ? "border-primary bg-primary/5" : "border-transparent bg-muted/30 hover:bg-muted/50"
                            )}
                        >
                            <span className="flex items-start gap-3">
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border",
                                        active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                                    )}
                                >
                                    {active ? <Check size={11} strokeWidth={3} /> : null}
                                </span>
                                <span className="min-w-0">
                                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                                        {t(core.title)}
                                        {version ? <span className="font-mono text-[11px] font-normal text-muted-foreground">{version}</span> : null}
                                        {core.id === "builtin" ? (
                                            <span className="text-[11px] font-normal text-muted-foreground">{t("core.default")}</span>
                                        ) : null}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">{t(core.summary)}</span>
                                    {core.limits.length > 0 ? (
                                        <span className="mt-2 block space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                            {core.limits.map((limit) => (
                                                <span key={limit} className="block before:me-1.5 before:content-['•']">
                                                    {t(limit)}
                                                </span>
                                            ))}
                                        </span>
                                    ) : null}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </SettingsGroup>
    );
}
