import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
    ArrowDown,
    ArrowUp,
    Check,
    Clock,
    Copy,
    Cpu,
    Loader2,
    Lock,
    Power,
    Server,
    Shield,
    ShieldAlert,
    ShieldCheck,
    Signal,
    TriangleAlert,
} from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import { SpeedTest } from "@/components/speed-test";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConnectionState, IpInfo, Profile, ProxyMode, TrafficSample } from "@/types";

interface ConnectionViewProps {
    state: ConnectionState;
    traffic: TrafficSample;
    onToggle: () => void;
    onDismissError: () => void;
    ipInfo: IpInfo | null;
    isCheckingIp: boolean;
    ipCheckEnabled: boolean;

    // Cockpit extras
    profiles?: Profile[];
    profilePings?: Record<string, number | null>;
    selectedProxyMode?: ProxyMode;
    selectedProfileId?: string;
    onSelectProxy?: (id: string) => void;
    onSelectAuto?: () => void;
    onNavigateTab?: (tab: string) => void;
    core?: string;
    mtu?: number;
    killSwitch?: boolean;
}

/** Ticks once a second while connected, so the duration counts up. */
function useElapsed(since: number | undefined): string {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!since) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [since]);

    if (!since) {
        return "00:00:00";
    }
    return formatDuration(Math.max(0, now - since));
}

/** Animated wave / sparkline for live ping visualizer */
function PingWave({ active, ping }: { active: boolean; ping: number | null | undefined }) {
    return (
        <div className="hidden sm:flex items-end gap-1 h-5 w-12 py-0.5 shrink-0" aria-hidden="true">
            {[45, 80, 55, 90, 60].map((height, i) => {
                const animDelay = `${i * 0.15}s`;
                return (
                    <span
                        key={i}
                        className={cn(
                            "flex-1 rounded-full transition-all duration-300",
                            active
                                ? ping && ping < 150
                                    ? "bg-status-connected"
                                    : "bg-status-connecting"
                                : "bg-muted-foreground/20"
                        )}
                        style={{
                            height: active ? `${height}%` : "25%",
                            animation: active ? `pulse 1.8s ease-in-out infinite` : "none",
                            animationDelay: animDelay,
                        }}
                    />
                );
            })}
        </div>
    );
}

function ConnectionView({
    state,
    traffic,
    onToggle,
    onDismissError,
    ipInfo,
    isCheckingIp,
    ipCheckEnabled,
    profiles = [],
    profilePings = {},
    selectedProxyMode = "auto",
    selectedProfileId = "",
    onSelectProxy,
    onSelectAuto,
    onNavigateTab,
    core = "builtin",
    mtu = 9000,
    killSwitch = false,
}: ConnectionViewProps) {
    const t = useT();
    const isConnected = state.status === "connected";
    const isConnecting = state.status === "connecting";
    const isError = state.status === "error";
    const isIdle = state.status === "idle";
    const busy = isConnecting && !state.reconnecting;
    const elapsed = useElapsed(isConnected ? state.since : undefined);

    const { prefs } = useAppearance();
    const layout = prefs.layout;

    const [copiedIp, setCopiedIp] = useState(false);

    // Active server lookup
    const activeProfile = profiles.find((p) => p.id === selectedProfileId);
    const activePing = activeProfile ? profilePings[activeProfile.id] : null;

    const handleCopyIp = () => {
        if (!ipInfo?.ip) return;
        void navigator.clipboard.writeText(ipInfo.ip);
        setCopiedIp(true);
        toast.success("IP copied", { id: "copy-ip", duration: 1800 });
        setTimeout(() => setCopiedIp(false), 2000);
    };

    const widthClass = layout.dashboardWidth === "compact"
        ? "max-w-2xl"
        : layout.dashboardWidth === "wide"
          ? "max-w-5xl"
          : "max-w-3xl";

    const alignClass = layout.cockpitAlign === "top" ? "mt-4 mb-auto" : "my-auto";

    const activeMetrics = (layout.telemetryOrder || ["download", "upload", "latency"])
        .filter((metric) => layout.telemetryVisible?.[metric] !== false);

    const renderTelemetryCard = (metric: string) => {
        if (metric === "download") {
            return (
                <div key="download" className="rounded-xl border border-border/50 bg-muted/20 p-2.5 sm:p-4 backdrop-blur-xs flex flex-col justify-between gap-1.5 sm:gap-2 shadow-2xs">
                    <div className="flex items-center text-[11px] sm:text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 sm:gap-1.5 font-medium shrink-0">
                            <ArrowDown size={13} className={isConnected && traffic.down_rate > 0 ? "text-status-connected animate-bounce shrink-0" : "shrink-0"} />
                            <span>{t("connection.download")}</span>
                        </span>
                    </div>
                    <div>
                        <span className="text-sm sm:text-2xl font-bold font-mono tracking-tight tnum block truncate">
                            {formatRate(traffic.down_rate)}
                        </span>
                        <span className="text-[10px] sm:text-[11px] text-muted-foreground truncate block" title={formatBytes(traffic.down)}>
                            {t("connection.thisSession", { amount: formatBytes(traffic.down) })}
                        </span>
                    </div>
                </div>
            );
        }
        if (metric === "upload") {
            return (
                <div key="upload" className="rounded-xl border border-border/50 bg-muted/20 p-2.5 sm:p-4 backdrop-blur-xs flex flex-col justify-between gap-1.5 sm:gap-2 shadow-2xs">
                    <div className="flex items-center text-[11px] sm:text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 sm:gap-1.5 font-medium shrink-0">
                            <ArrowUp size={13} className={isConnected && traffic.up_rate > 0 ? "text-primary animate-bounce shrink-0" : "shrink-0"} />
                            <span>{t("connection.upload")}</span>
                        </span>
                    </div>
                    <div>
                        <span className="text-sm sm:text-2xl font-bold font-mono tracking-tight tnum block truncate">
                            {formatRate(traffic.up_rate)}
                        </span>
                        <span className="text-[10px] sm:text-[11px] text-muted-foreground truncate block" title={formatBytes(traffic.up)}>
                            {t("connection.thisSession", { amount: formatBytes(traffic.up) })}
                        </span>
                    </div>
                </div>
            );
        }
        if (metric === "latency") {
            return (
                <div key="latency" className="rounded-xl border border-border/50 bg-muted/20 p-2.5 sm:p-4 backdrop-blur-xs flex flex-col justify-between gap-1.5 sm:gap-2 shadow-2xs">
                    <div className="flex items-center justify-between text-[11px] sm:text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 sm:gap-1.5 font-medium shrink-0">
                            <Signal size={13} className={activePing ? "text-status-connected shrink-0" : "shrink-0"} />
                            <span>Latency</span>
                        </span>
                        <PingWave active={isConnected} ping={activePing} />
                    </div>
                    <div>
                        <span className="text-sm sm:text-2xl font-bold font-mono tracking-tight tnum block truncate">
                            {activePing !== null && activePing !== undefined ? `${activePing} ms` : isConnected ? "—" : "Offline"}
                        </span>
                        <span className="text-[10px] sm:text-[11px] text-muted-foreground block truncate">
                            {activePing && activePing < 100
                                ? "Optimal signal"
                                : activePing && activePing < 250
                                  ? "Moderate latency"
                                  : isConnected
                                    ? "Measuring route…"
                                    : "Standby"}
                        </span>
                    </div>
                </div>
            );
        }
        return null;
    };

    const renderTelemetryGrid = () => {
        if (activeMetrics.length === 0) return null;
        const colsClass = activeMetrics.length === 3 ? "grid-cols-3" : activeMetrics.length === 2 ? "grid-cols-2" : "grid-cols-1";
        return (
            <div className={cn("grid gap-2 sm:gap-3", colsClass, layout.telemetryPlacement === "inside" && "mb-3")}>
                {activeMetrics.map(renderTelemetryCard)}
            </div>
        );
    };

    return (
        <div className="absolute inset-0 overflow-y-auto">
            <div className="min-h-full flex flex-col px-4 py-8 sm:px-6">
                <div className={cn("enter-stagger w-full flex flex-col gap-5 mx-auto transition-all duration-300", widthClass, alignClass)}>

                    {/* 1. HERO COCKPIT COMMAND CARD */}
                <div
                    className={cn(
                        "relative overflow-hidden rounded-2xl border p-6 sm:p-8 backdrop-blur-md transition-all duration-300",
                        isConnected
                            ? "border-status-connected/40 bg-card/75"
                            : isConnecting
                              ? "border-status-connecting/40 bg-card/75"
                              : isError
                                ? "border-status-error/40 bg-card/75"
                                : "border-border/60 bg-card/50 shadow-xs"
                    )}
                >
                    {/* Top Row: Tunnel Status Headline + Elapsed Timer + Engine Badge */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-5">
                        <div>
                            <h2 className="text-sm font-medium flex items-center gap-2">
                                <span>
                                    {isConnected
                                        ? t("status.connected")
                                        : isConnecting
                                          ? t("status.connecting")
                                          : isError
                                            ? t("status.error")
                                            : t("status.idle")}
                                </span>
                                {activeProfile && (
                                    <span className="text-muted-foreground font-normal text-xs truncate max-w-[200px] sm:max-w-xs">
                                        · {activeProfile.name}
                                    </span>
                                )}
                            </h2>
                            {isError ? (
                                <p className="text-[11px] text-status-error mt-0.5">
                                    {state.error || t("connection.hint.error")}
                                </p>
                            ) : state.reconnecting ? (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {t("connection.reconnecting", { attempt: state.attempt ?? 1 })}
                                </p>
                            ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                            {isConnected ? (
                                <Badge variant="outline" className="font-mono text-xs gap-1.5 py-1 px-2.5 border-status-connected/40 bg-status-connected/10 text-foreground">
                                    <Clock size={12} className="text-status-connected" />
                                    <span>{elapsed}</span>
                                </Badge>
                            ) : null}

                            <Badge variant="secondary" className="text-[11px] gap-1 px-2 py-0.5 font-normal">
                                <Cpu size={12} className="text-muted-foreground" />
                                <span className="capitalize">{core}</span>
                            </Badge>
                        </div>
                    </div>

                    {/* Center Area: Tactile Cockpit Power Controller */}
                    <div className="my-8 flex flex-col items-center justify-center gap-4">
                        <button
                            type="button"
                            onClick={onToggle}
                            disabled={busy}
                            aria-label={t(isConnected ? "connection.disconnect" : "connection.connect")}
                            aria-busy={busy}
                            className={cn(
                                "group relative flex h-44 w-44 sm:h-48 sm:w-48 items-center justify-center rounded-full transition-transform duration-300 select-none",
                                "focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-ring/50",
                                !busy && "hover:scale-[1.03] active:scale-[0.98]",
                                busy && "cursor-progress"
                            )}
                        >
                            {/* Outer orbital track */}
                            <span
                                className={cn(
                                    "absolute inset-0 rounded-full border-2 transition-all duration-300",
                                    isConnected
                                        ? "border-status-connected/40"
                                        : isConnecting
                                          ? "border-status-connecting/30"
                                          : isError
                                            ? "border-status-error/40"
                                            : "border-border/60 group-hover:border-primary/40"
                                )}
                                aria-hidden="true"
                            />

                            {/* Sweeping radar ring while connecting */}
                            {busy ? (
                                <span
                                    className="absolute inset-0 rounded-full border-2 border-transparent border-t-status-connecting animate-sweep"
                                    aria-hidden="true"
                                />
                            ) : null}

                            {/* Connected breathing aura */}
                            {isConnected ? (
                                <span
                                    className="absolute inset-1 rounded-full border border-status-connected/30 animate-breathe"
                                    aria-hidden="true"
                                />
                            ) : null}

                            {/* Inner Tactile Push Core */}
                            <span
                                className={cn(
                                    "absolute inset-3 rounded-full flex items-center justify-center border transition-all duration-300",
                                    isConnected
                                        ? "bg-linear-to-tr from-status-connected to-status-connecting border-status-connected/50 text-primary-foreground"
                                        : isConnecting
                                          ? "bg-card border-status-connecting/40 text-status-connecting"
                                          : isError
                                            ? "bg-card border-status-error/40 text-status-error"
                                            : "bg-linear-to-b from-card to-muted/80 border-border text-foreground group-hover:border-primary/50 group-hover:shadow-xs"
                                )}
                            >
                                {busy ? (
                                    <Loader2 size={52} strokeWidth={1.75} className="animate-spin text-status-connecting" />
                                ) : isError ? (
                                    <TriangleAlert size={48} strokeWidth={1.75} className="text-status-error" />
                                ) : (
                                    <Power
                                        size={52}
                                        strokeWidth={1.75}
                                        className={cn(
                                            "transition-transform duration-300 group-hover:scale-105",
                                            isConnected ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary"
                                        )}
                                    />
                                )}
                            </span>
                        </button>

                        {/* Error / Alert feedback */}
                        {isError && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-status-error font-medium">
                                    {state.error || t("connection.hint.error")}
                                </span>
                                {!state.blocked && (
                                    <Button size="sm" variant="ghost" onClick={onDismissError} className="h-7 text-xs">
                                        {t("connection.dismiss")}
                                    </Button>
                                )}
                            </div>
                        )}

                        {state.blocked ? (
                            <div className="flex items-center gap-1.5 rounded-full bg-status-error/15 px-3 py-1 text-xs text-status-error font-medium">
                                <ShieldAlert size={14} />
                                {t("connection.blocked")}
                            </div>
                        ) : null}
                    </div>

                    {/* Real-time Telemetry & Speedometers Grid (Inside Mode) */}
                    {layout.telemetryPlacement === "inside" ? renderTelemetryGrid() : null}

                    {/* Bottom Row: Virtual IP & Privacy Pill Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-2.5 text-xs">
                        <div className="flex items-center gap-3">
                            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                                <ShieldCheck size={14} className={isConnected ? "text-status-connected" : "text-muted-foreground"} />
                                {t("connection.publicIp")}:
                            </span>
                            <span className="font-mono font-medium tracking-tight">
                                {!ipCheckEnabled
                                    ? t("connection.ipOff")
                                    : isCheckingIp
                                      ? t("connection.checking")
                                      : ipInfo?.ip || "—"}
                            </span>
                            {ipInfo?.ip ? (
                                <button
                                    type="button"
                                    onClick={handleCopyIp}
                                    title="Copy IP"
                                    className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                                >
                                    {copiedIp ? <Check size={12} className="text-status-connected" /> : <Copy size={12} />}
                                </button>
                            ) : null}
                            {ipInfo?.region ? (
                                <Badge variant="secondary" className="text-[10px] font-normal py-0 px-1.5">
                                    {ipInfo.region}
                                </Badge>
                            ) : null}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {killSwitch ? (
                                <span className="flex items-center gap-1 text-primary">
                                    <Lock size={11} /> Kill Switch On
                                </span>
                            ) : null}
                            <span>MTU: {mtu}</span>
                            <span className="opacity-40">·</span>
                            <span>DNS Secure</span>
                        </div>
                    </div>
                </div>

                {/* Real-time Telemetry & Speedometers (Below Mode) */}
                {layout.telemetryPlacement === "below" && activeMetrics.length > 0 ? (
                    <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md p-4 sm:p-5 shadow-xs">
                        {renderTelemetryGrid()}
                    </div>
                ) : null}

                {/* Optional Quick Switcher Card on Dashboard */}
                {layout.showQuickSwitch ? (
                    <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md p-5 shadow-xs flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                <Server size={18} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] text-muted-foreground font-normal">Active Node</div>
                                <div className="text-sm font-semibold truncate flex items-center gap-2">
                                    <span className="truncate">{selectedProxyMode === "auto" ? t("proxies.auto") : (activeProfile?.name || t("topbar.none"))}</span>
                                    {activePing !== null && activePing !== undefined ? (
                                        <Badge variant="outline" className="text-[10px] font-mono py-0 px-1.5 text-muted-foreground shrink-0">
                                            {activePing}ms
                                        </Badge>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onNavigateTab?.("proxies")}
                            className="h-8 text-xs shrink-0"
                        >
                            Change →
                        </Button>
                    </div>
                ) : null}

                {/* 2. SPEED TEST (Embedded when connected) */}
                {isConnected && layout.showSpeedTest ? (
                    <SpeedTest />
                ) : null}
                </div>
            </div>
        </div>
    );
}

export default ConnectionView;
