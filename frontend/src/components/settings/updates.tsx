import { useEffect, useState } from "react";
import { Browser } from "@wailsio/runtime";
import { Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { SettingsField, SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { errorMessage, eventPayload, EVENTS, invoke, listen } from "@/lib/backend";
import { formatBytes } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { AppSettings, UpdateInfo } from "@/types";

/**
 * The running version, and a newer release when there is one: its notes, and
 * installing it — the installer on Windows, the disk image on macOS, the
 * release page elsewhere.
 */
export function UpdatesPanel({
    appSettings,
    onSettingsChange,
}: {
    appSettings: AppSettings;
    onSettingsChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}) {
    const { t, language } = useI18n();
    const [version, setVersion] = useState("");
    const [info, setInfo] = useState<UpdateInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
    const [installing, setInstalling] = useState(false);

    const check = async () => {
        setChecking(true);
        setError("");
        try {
            setInfo(await invoke<UpdateInfo>("check_for_update"));
        } catch (reason) {
            setError(errorMessage(reason));
        } finally {
            setChecking(false);
        }
    };

    useEffect(() => {
        invoke<string>("get_version").then(setVersion).catch(() => undefined);
        void check();
        return listen(EVENTS.updateProgress, (data) =>
            setProgress(eventPayload<{ received: number; total: number }>(data))
        );
        // Once, on opening the section.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const install = async () => {
        setInstalling(true);
        setError("");
        setProgress(null);
        try {
            await invoke("install_update");
        } catch (reason) {
            setError(errorMessage(reason));
        } finally {
            setInstalling(false);
        }
    };

    const open = (url: string) => void Browser.OpenURL(url).catch(() => window.open(url, "_blank", "noopener"));
    const percent = progress && progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;

    return (
        <>
            <SettingsGroup>
                <SettingsField
                    label={t("updates.version")}
                    description={
                        checking
                            ? t("updates.checking")
                            : error
                              ? error
                              : info?.available
                                ? t("updates.available", { version: info.latest })
                                : info
                                  ? t("updates.upToDate", {
                                        time: new Date(info.checked_at * 1000).toLocaleTimeString(language, {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        }),
                                    })
                                  : ""
                    }
                    control={
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm tabular-nums">{version}</span>
                            <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking || installing}>
                                <RefreshCw size={14} className={checking ? "me-2 animate-spin" : "me-2"} aria-hidden="true" />
                                {t("updates.check")}
                            </Button>
                        </div>
                    }
                />
                <SettingsField
                    label={t("updates.auto")}
                    description={t("updates.auto.description")}
                    control={
                        <Switch
                            checked={appSettings.update_check !== false}
                            onCheckedChange={(checked) => onSettingsChange("update_check", checked)}
                            aria-label={t("updates.auto")}
                        />
                    }
                />
            </SettingsGroup>

            {info?.available ? (
                <SettingsGroup title={t("updates.newTitle", { version: info.latest })}>
                    {info.notes ? (
                        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                            {info.notes}
                        </div>
                    ) : null}
                    {installing && progress ? (
                        <div className="space-y-1">
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                            </div>
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                                {formatBytes(progress.received)} / {formatBytes(progress.total)}
                            </p>
                        </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                        {info.installable ? (
                            <Button onClick={() => void install()} disabled={installing}>
                                {installing ? (
                                    <Loader2 size={14} className="me-2 animate-spin" aria-hidden="true" />
                                ) : (
                                    <Download size={14} className="me-2" aria-hidden="true" />
                                )}
                                {installing
                                    ? t("updates.downloading")
                                    : t("updates.install", { size: formatBytes(info.asset_size ?? 0) })}
                            </Button>
                        ) : null}
                        <Button variant="outline" onClick={() => open(info.page_url)}>
                            <ExternalLink size={14} className="me-2" aria-hidden="true" />
                            {t("updates.page")}
                        </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        {info.installable ? t("updates.installHint") : t("updates.manualHint")}
                    </p>
                </SettingsGroup>
            ) : null}
        </>
    );
}
