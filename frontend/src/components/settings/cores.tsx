import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Check, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import { errorMessage, eventPayload, EVENTS, invoke, listen } from "@/lib/backend";
import { formatBytes } from "@/lib/format";
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
    { id: "sing-box", title: "core.singbox", summary: "core.singbox.summary", limits: ["core.singbox.limit.counts", "core.singbox.limit.xhttp"] },
    {
        id: "mihomo",
        title: "core.mihomo",
        summary: "core.mihomo.summary",
        limits: ["core.mihomo.limit.protocol", "core.mihomo.limit.srs", "core.mihomo.limit.geo", "core.mihomo.limit.tls"],
    },
    { id: "xray", title: "core.xray", summary: "core.xray.summary", limits: ["core.xray.limit.protocols", "core.xray.limit.plugins", "core.xray.limit.tls"] },
];

interface Progress {
    name: string;
    received: number;
    total: number;
    done: boolean;
    error?: string;
}

/**
 * Which program runs the tunnel. The built-in core is always there; the
 * others are downloaded on request, from their official releases, by the
 * privileged service — which is why installing one asks for administrator
 * rights.
 */
export function CorePanel({
    appSettings,
    onSettingsChange,
}: {
    appSettings: AppSettings;
    onSettingsChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}) {
    const t = useT();
    const [cores, setCores] = useState<CoreInfo[]>([]);
    const [progress, setProgress] = useState<Record<string, Progress>>({});
    const [busy, setBusy] = useState<string | null>(null);

    const load = () =>
        invoke<CoreInfo[]>("list_cores")
            .then((list) => setCores(list ?? []))
            .catch(() => undefined);

    useEffect(() => {
        void load();
        return listen(EVENTS.coreProgress, (data) => {
            const update = eventPayload<Progress>(data);
            setProgress((current) => ({ ...current, [update.name]: update }));
            if (update.done) {
                setBusy(null);
                void load();
                if (update.error) toast.error(update.error, { id: "core-install" });
                else toast.success(t("core.installed", { name: t(CORES.find((core) => core.id === update.name)?.title ?? "core.builtin") }), { id: "core-install" });
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const info = (id: CoreName) => cores.find((core) => core.name === id);
    const installed = (id: CoreName) => id === "builtin" || !!info(id)?.installed;

    const install = async (id: CoreName) => {
        setBusy(id);
        setProgress((current) => ({ ...current, [id]: { name: id, received: 0, total: 0, done: false } }));
        try {
            await invoke("install_core", { name: id });
        } catch (error) {
            setBusy(null);
            setProgress((current) => {
                const next = { ...current };
                delete next[id];
                return next;
            });
            toast.error(errorMessage(error), { id: "core-install" });
        }
    };

    const remove = async (id: CoreName) => {
        setBusy(id);
        try {
            setCores((await invoke<CoreInfo[]>("remove_core", { name: id })) ?? []);
            if (appSettings.core === id) onSettingsChange("core", "builtin");
        } catch (error) {
            toast.error(errorMessage(error), { id: "core-install" });
        } finally {
            setBusy(null);
        }
    };

    const choose = async (id: CoreName) => {
        if (id === appSettings.core || !installed(id)) return;
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
                {CORES.map((core) => {
                    const active = appSettings.core === core.id;
                    const available = installed(core.id);
                    const detail = info(core.id);
                    const current = progress[core.id];
                    const downloading = current && !current.done;
                    return (
                        <div
                            key={core.id}
                            className={cn(
                                "rounded-xl border-2 p-3.5 transition-colors",
                                active ? "border-primary bg-primary/5" : "border-transparent bg-muted/30"
                            )}
                        >
                            <div className="flex items-start gap-3">
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    disabled={!available || busy !== null}
                                    onClick={() => void choose(core.id)}
                                    className="flex min-w-0 flex-1 items-start gap-3 text-start disabled:cursor-not-allowed"
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border",
                                            active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                                            !available && "opacity-40"
                                        )}
                                    >
                                        {active ? <Check size={11} strokeWidth={3} /> : null}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                                            {t(core.title)}
                                            {core.id === "builtin" ? (
                                                <span className="text-[11px] font-normal text-muted-foreground">{t("core.default")}</span>
                                            ) : detail?.installed ? (
                                                <span className="font-mono text-[11px] font-normal text-muted-foreground">{detail.version}</span>
                                            ) : (
                                                <span className="text-[11px] font-normal text-muted-foreground">{t("core.notInstalled")}</span>
                                            )}
                                        </span>
                                        <span className="mt-0.5 block text-xs text-muted-foreground">{t(core.summary)}</span>
                                    </span>
                                </button>
                                {core.id !== "builtin" ? (
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 gap-1.5 text-xs"
                                            disabled={busy !== null}
                                            onClick={() => void install(core.id)}
                                        >
                                            {downloading ? (
                                                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                                            ) : detail?.installed ? (
                                                <RefreshCw size={12} aria-hidden="true" />
                                            ) : (
                                                <Download size={12} aria-hidden="true" />
                                            )}
                                            {t(detail?.installed ? "core.update" : "core.install")}
                                        </Button>
                                        {detail?.installed ? (
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7"
                                                disabled={busy !== null}
                                                onClick={() => void remove(core.id)}
                                                aria-label={t("core.remove", { name: t(core.title) })}
                                            >
                                                <Trash2 size={13} aria-hidden="true" />
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                            {downloading ? (
                                <div className="mt-2.5 ms-7.5 space-y-1">
                                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full rounded-full bg-primary transition-[width]"
                                            style={{ width: `${current.total > 0 ? Math.round((current.received / current.total) * 100) : 5}%` }}
                                        />
                                    </div>
                                    <p className="text-[11px] tabular-nums text-muted-foreground">
                                        {current.total > 0
                                            ? `${formatBytes(current.received)} / ${formatBytes(current.total)}`
                                            : t("core.preparing")}
                                    </p>
                                </div>
                            ) : null}
                            {core.limits.length > 0 ? (
                                <ul className="mt-2 ms-7.5 list-disc space-y-0.5 ps-4 text-[11px] leading-relaxed text-muted-foreground">
                                    {core.limits.map((limit) => (
                                        <li key={limit}>{t(limit)}</li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("core.safety")}</p>
        </SettingsGroup>
    );
}
