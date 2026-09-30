import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Gauge, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage, eventPayload, EVENTS, invoke, listen } from "@/lib/backend";
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SpeedProgress, SpeedResult } from "@/types";

const PHASES: Record<SpeedProgress["phase"], MessageKey> = {
    latency: "speed.phase.latency",
    download: "speed.phase.download",
    upload: "speed.phase.upload",
};

function mbps(value: number): string {
    if (value >= 100) return value.toFixed(0);
    if (value >= 10) return value.toFixed(1);
    return value.toFixed(2);
}

function Figure({ label, value, unit, live }: { label: string; value: string; unit: string; live?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className={cn("tnum text-lg font-semibold leading-tight", live && "text-primary")}>
                {value}
                <span className="ms-1 text-xs font-normal text-muted-foreground">{unit}</span>
            </div>
        </div>
    );
}

/**
 * Measures the connection through the current server: latency, then
 * download and upload, live as it runs, with the last result kept.
 */
export function SpeedTest() {
    const t = useT();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<SpeedProgress | null>(null);
    const [result, setResult] = useState<SpeedResult | null>(null);
    const [live, setLive] = useState<{ download?: number; upload?: number }>({});

    useEffect(() => {
        invoke<SpeedResult[]>("get_speed_tests")
            .then((list) => setResult(list?.length ? list[list.length - 1] : null))
            .catch(() => undefined);
        return listen(EVENTS.speedProgress, (data) => {
            const next = eventPayload<SpeedProgress>(data);
            setProgress(next);
            setLive((current) =>
                next.phase === "download" ? { ...current, download: next.mbps } : next.phase === "upload" ? { ...current, upload: next.mbps } : current
            );
        });
    }, []);

    const run = async () => {
        setRunning(true);
        setLive({});
        setProgress({ phase: "latency", fraction: 0, mbps: 0, latency_ms: 0 });
        try {
            setResult(await invoke<SpeedResult>("run_speed_test"));
        } catch (error) {
            const message = errorMessage(error);
            if (message !== "stopped") toast.error(message, { id: "speed" });
        } finally {
            setRunning(false);
            setProgress(null);
        }
    };

    const download = running ? live.download : result?.download_mbps;
    const upload = running ? live.upload : result?.upload_mbps;
    const latency = running ? progress?.latency_ms : result?.latency_ms;

    return (
        <div className="w-full max-w-2xl rounded-lg border bg-card/50 px-4 py-3">
            <div className="flex items-center gap-3">
                <Gauge size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t("speed.title")}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                        {running && progress
                            ? t(PHASES[progress.phase])
                            : result
                              ? t("speed.last", { server: result.server, when: new Date(result.at * 1000).toLocaleString() })
                              : t("speed.hint")}
                    </div>
                </div>
                {running ? (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void invoke("stop_speed_test")}>
                        <Square size={12} aria-hidden="true" />
                        {t("speed.stop")}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void run()}>
                        {t(result ? "speed.again" : "speed.start")}
                    </Button>
                )}
            </div>
            {running || result ? (
                <div className="mt-3 grid grid-cols-4 gap-3">
                    <Figure label={t("speed.download")} value={download !== undefined ? mbps(download) : "—"} unit="Mbps" live={running && progress?.phase === "download"} />
                    <Figure label={t("speed.upload")} value={upload !== undefined ? mbps(upload) : "—"} unit="Mbps" live={running && progress?.phase === "upload"} />
                    <Figure label={t("speed.ping")} value={latency ? latency.toFixed(0) : "—"} unit="ms" live={running && progress?.phase === "latency"} />
                    <Figure label={t("speed.jitter")} value={!running && result ? result.jitter_ms.toFixed(1) : "—"} unit="ms" />
                </div>
            ) : null}
            {running ? (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
                </div>
            ) : null}
        </div>
    );
}
