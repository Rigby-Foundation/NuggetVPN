import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
    ArrowDown,
    ArrowUp,
    Check,
    ChevronDown,
    Copy,
    Infinity as InfinityIcon,
    Layers,
    Loader2,
    Lock,
    Plus,
    Power,
    Server,
    ShieldAlert,
    ShieldCheck,
    Signal,
    TriangleAlert,
    Zap,
} from "lucide-react";

import { AnnounceBanner } from "@/components/announce-banner";
import { useAppearance } from "@/components/appearance-provider";
import { SpeedTest } from "@/components/speed-test";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCAL, profileDomain } from "@/hooks/use-profiles";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConfigSource, ConnectionState, IpInfo, Profile, ProxyMode, TrafficSample } from "@/types";
import { Flag } from "@/components/ui/flag";
import { useUnsupported } from "@/lib/core-support";
import { withoutFlagEmoji } from "@/lib/flags";

interface ConnectionViewProps {
    state: ConnectionState;
    traffic: TrafficSample;
    onToggle: () => void;
    onDismissError: () => void;
    ipInfo: IpInfo | null;
    isCheckingIp: boolean;
    ipCheckEnabled: boolean;

    /** The configuration the button connects with; none before one is added. */
    source?: ConfigSource;
    /** Switching is refused while connected or connecting. */
    locked?: boolean;
    onAddProfile?: () => void;

    profiles?: Profile[];
    profilePings?: Record<string, number | null>;
    selectedProxyMode?: ProxyMode;
    selectedProfileId?: string;
    onSelectProxy?: (id: string) => void;
    onSelectAuto?: () => void;
    onNavigateTab?: (tab: string) => void;
    killSwitch?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

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
                            // A couple of pulses when the signal appears, then still; see
                            // .animate-breathe in App.css.
                            animation: active ? `pulse 1.8s ease-in-out 2` : "none",
                            animationDelay: animDelay,
                        }}
                    />
                );
            })}
        </div>
    );
}

/**
 * The left half of the route strip: which configuration the button connects
 * with, and what is left of it — data, then days. Opens the configurations
 * page, where it is chosen.
 */
function SourceSummary({ source, onOpen }: { source: ConfigSource; onOpen?: () => void }) {
    const t = useT();
    const info = source.kind === "subscription" ? source.info : undefined;

    const meta: React.ReactNode[] = [];
    let expired = false;
    if (source.kind === "subscription") {
        if (info && info.total > 0) {
            meta.push(t("usage.of", {
                used: formatBytes(info.upload + info.download),
                total: formatBytes(info.total),
            }));
        } else if (info) {
            meta.push(
                <span key="unlimited" className="inline-flex items-center gap-1">
                    <InfinityIcon size={13} aria-hidden="true" />
                    {t("connection.unlimited")}
                </span>
            );
        } else {
            meta.push(source.detail);
        }
        if (info && info.expire > 0) {
            const days = Math.ceil((info.expire * 1000 - Date.now()) / DAY);
            expired = days <= 0;
            meta.push(
                <span key="days" className={cn("tabular-nums", expired && "text-status-error")}>
                    {expired
                        ? t("usage.expired", { date: new Date(info.expire * 1000).toLocaleDateString() })
                        : t("connection.daysLeft", { count: days })}
                </span>
            );
        }
    } else {
        meta.push(<span key="protocol" className="uppercase">{source.detail}</span>);
    }

    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-foreground/5"
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Layers size={17} />
            </span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{source.label}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {meta.map((part, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                            {i > 0 ? <span className="opacity-40">·</span> : null}
                            {part}
                        </span>
                    ))}
                </span>
            </span>
        </button>
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
    source,
    locked = false,
    onAddProfile,
    profiles = [],
    profilePings = {},
    selectedProxyMode = "auto",
    selectedProfileId = "",
    onSelectProxy,
    onSelectAuto,
    onNavigateTab,
    killSwitch = false,
}: ConnectionViewProps) {
    const t = useT();
    const unsupported = useUnsupported();
    const isConnected = state.status === "connected";
    const isConnecting = state.status === "connecting";
    const isError = state.status === "error";
    const busy = isConnecting && !state.reconnecting;
    const elapsed = useElapsed(isConnected ? state.since : undefined);

    const { prefs } = useAppearance();
    const layout = prefs.layout;

    const [copiedIp, setCopiedIp] = useState(false);

    const isAuto = selectedProxyMode === "auto";
    const activeProfile = profiles.find((p) => p.id === selectedProfileId);
    const activePing = activeProfile ? profilePings[activeProfile.id] : null;
    const activeServerLabel = isAuto ? t("proxies.auto") : (activeProfile?.name || t("topbar.none"));

    const domain = source?.domain || LOCAL;
    const quickPickProfiles = source
        ? profiles.filter((p) => profileDomain(p) === domain).slice(0, 6)
        : [];

    const handleCopyIp = () => {
        if (!ipInfo?.ip) return;
        void navigator.clipboard.writeText(ipInfo.ip);
        setCopiedIp(true);
        toast.success(t("connection.ipCopied"), { id: "copy-ip", duration: 1800 });
        setTimeout(() => setCopiedIp(false), 2000);
    };

    const widthClass = layout.dashboardWidth === "compact"
        ? "max-w-2xl"
        : layout.dashboardWidth === "wide"
          ? "max-w-5xl"
          : "max-w-3xl";

    const activeMetrics = (layout.telemetryOrder || ["download", "upload", "latency"])
        .filter((metric) => layout.telemetryVisible?.[metric] !== false);

    const renderTelemetryCard = (metric: string) => {
        const cardClass = "rounded-xl bg-muted/30 p-2.5 sm:p-4 flex flex-col justify-between gap-1.5 sm:gap-2";
        if (metric === "download") {
            return (
                <div key="download" className={cardClass}>
                    <span className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
                        <ArrowDown size={13} className={traffic.down_rate > 0 ? "text-status-connected shrink-0" : "shrink-0"} />
                        {t("connection.download")}
                    </span>
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
                <div key="upload" className={cardClass}>
                    <span className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
                        <ArrowUp size={13} className={traffic.up_rate > 0 ? "text-primary shrink-0" : "shrink-0"} />
                        {t("connection.upload")}
                    </span>
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
                <div key="latency" className={cardClass}>
                    <div className="flex items-center justify-between text-[11px] sm:text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 sm:gap-1.5 font-medium shrink-0">
                            <Signal size={13} className={activePing ? "text-status-connected shrink-0" : "shrink-0"} />
                            {t("connection.latency")}
                        </span>
                        <PingWave active ping={activePing} />
                    </div>
                    <div>
                        <span className="text-sm sm:text-2xl font-bold font-mono tracking-tight tnum block truncate">
                            {activePing !== null && activePing !== undefined ? `${activePing} ms` : "—"}
                        </span>
                        <span className="text-[10px] sm:text-[11px] text-muted-foreground block truncate">
                            {activePing && activePing < 100
                                ? t("connection.latency.good")
                                : activePing && activePing < 250
                                  ? t("connection.latency.fair")
                                  : t("connection.latency.measuring")}
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
            <div className={cn("grid gap-2 sm:gap-3", colsClass)}>
                {activeMetrics.map(renderTelemetryCard)}
            </div>
        );
    };

    // The big line under the button says what pressing it will do, or what
    // is happening now; the small line under it adds the detail.
    const headline = isConnected
        ? t("status.connected")
        : isConnecting
          ? t("status.connecting")
          : isError
            ? t("status.error")
            : source
              ? t("connection.hint.idle")
              : t("connection.empty.title");

    const subline = isConnected ? (
        <span className="font-mono tnum">{elapsed}</span>
    ) : state.reconnecting ? (
        t("connection.reconnecting", { attempt: state.attempt ?? 1 })
    ) : isConnecting ? (
        t("connection.hint.connecting")
    ) : isError ? (
        <span className="text-status-error">{state.error || t("connection.hint.error")}</span>
    ) : !source ? (
        t("connection.empty.body")
    ) : null;

    return (
        <div className="absolute inset-0 overflow-y-auto">
            <div className="min-h-full flex flex-col px-4 py-5 sm:px-6">
                <div
                    className={cn(
                        "enter-stagger w-full flex flex-1 flex-col gap-4 mx-auto",
                        layout.cockpitAlign === "top" ? "justify-start" : "justify-center",
                        widthClass
                    )}
                >
                    {source?.kind === "subscription" ? <AnnounceBanner info={source.info} /> : null}

                    {/* The button and what it will do. */}
                    <div
                        className="flex flex-col items-center justify-center gap-6 pt-4 pb-2"
                    >
                        <button
                            type="button"
                            onClick={onToggle}
                            disabled={busy}
                            aria-label={t(isConnected ? "connection.disconnect" : "connection.connect")}
                            aria-busy={busy}
                            className={cn(
                                "group relative flex h-48 w-48 sm:h-56 sm:w-56 items-center justify-center rounded-full transition-transform duration-300 select-none",
                                "focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-ring/50",
                                !busy && "hover:scale-[1.03] active:scale-[0.98]",
                                busy && "cursor-progress"
                            )}
                        >
                            {/* Soft glow behind the button, in the state's colour. */}
                            <span
                                className={cn(
                                    "absolute -inset-6 rounded-full blur-3xl transition-opacity duration-500",
                                    isConnected
                                        ? "bg-status-connected/35 opacity-100"
                                        : isError
                                          ? "bg-status-error/20 opacity-100"
                                          : "bg-primary/20 opacity-60 group-hover:opacity-100"
                                )}
                                aria-hidden="true"
                            />

                            {busy ? (
                                <span
                                    className="absolute inset-0 rounded-full border-2 border-transparent border-t-status-connecting animate-sweep"
                                    aria-hidden="true"
                                />
                            ) : null}

                            {isConnected ? (
                                <span
                                    className="absolute -inset-2 rounded-full border border-status-connected/40 animate-breathe"
                                    aria-hidden="true"
                                />
                            ) : null}

                            {/* Off is an outlined disc, on is a filled one. */}
                            <span
                                className={cn(
                                    "absolute inset-2 rounded-full flex items-center justify-center border-2 shadow-lg transition-all duration-300",
                                    isConnected
                                        ? "bg-linear-to-br from-status-connected to-status-connecting border-transparent text-primary-foreground"
                                        : isConnecting
                                          ? "bg-card border-status-connecting/40 text-status-connecting"
                                          : isError
                                            ? "bg-card border-status-error/50 text-status-error"
                                            : "bg-card border-primary/50 text-primary group-hover:border-primary"
                                )}
                            >
                                {busy ? (
                                    <Loader2 size={64} strokeWidth={1.75} className="animate-spin" />
                                ) : isError ? (
                                    <TriangleAlert size={60} strokeWidth={1.75} />
                                ) : (
                                    <Power size={64} strokeWidth={2} className="transition-transform duration-300 group-hover:scale-105" />
                                )}
                            </span>
                        </button>

                        <div className="flex flex-col items-center gap-1.5 text-center">
                            <div className="text-2xl sm:text-3xl font-semibold tracking-tight">{headline}</div>
                            {subline ? <div className="text-sm text-muted-foreground">{subline}</div> : null}
                            {isError && !state.blocked ? (
                                <Button size="sm" variant="ghost" onClick={onDismissError} className="h-7 text-xs">
                                    {t("connection.dismiss")}
                                </Button>
                            ) : null}
                            {state.blocked ? (
                                <div className="mt-1 flex items-center gap-1.5 rounded-full bg-status-error/15 px-3 py-1 text-xs text-status-error font-medium">
                                    <ShieldAlert size={14} />
                                    {t("connection.blocked")}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Route: what the button connects with, and through which server. */}
                    {source ? (
                        <div className="flex items-stretch overflow-hidden rounded-2xl border border-border/60 bg-muted/30">
                            <SourceSummary source={source} onOpen={() => onNavigateTab?.("configuration")} />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        disabled={locked}
                                        className={cn(
                                            "flex max-w-[45%] shrink-0 items-center gap-2 border-s border-border/60 px-4 py-3 text-sm font-medium transition-colors",
                                            "hover:bg-foreground/5 disabled:opacity-60 disabled:pointer-events-none"
                                        )}
                                    >
                                        <Flag auto={isAuto} name={activeProfile?.name} size={20} />
                                        <span className="truncate">{withoutFlagEmoji(activeServerLabel)}</span>
                                        {activePing !== null && activePing !== undefined ? (
                                            <span className="shrink-0 font-mono text-xs text-muted-foreground">{activePing}ms</span>
                                        ) : null}
                                        <ChevronDown size={14} className="shrink-0 opacity-60" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                                        {t("proxies.title")}
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem onClick={onSelectAuto} className="flex items-center justify-between text-xs">
                                        <span className="flex items-center gap-2">
                                            <Zap size={14} className="text-primary" />
                                            {t("proxies.auto")}
                                        </span>
                                        {isAuto ? <Check size={14} className="text-primary" /> : null}
                                    </DropdownMenuItem>
                                    {quickPickProfiles.length > 0 ? <DropdownMenuSeparator /> : null}
                                    {quickPickProfiles.map((p) => {
                                        const ping = profilePings[p.id];
                                        return (
                                            <DropdownMenuItem
                                                key={p.id}
                                                disabled={Boolean(unsupported[p.id])}
                                                title={unsupported[p.id]}
                                                onClick={() => onSelectProxy?.(p.id)}
                                                className="flex items-center justify-between text-xs gap-2"
                                            >
                                                <Flag name={p.name} size={18} />
                                                <span className="truncate flex-1">{withoutFlagEmoji(p.name)}</span>
                                                {ping ? (
                                                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{ping}ms</span>
                                                ) : null}
                                                {!isAuto && selectedProfileId === p.id ? (
                                                    <Check size={14} className="text-primary shrink-0" />
                                                ) : null}
                                            </DropdownMenuItem>
                                        );
                                    })}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => onNavigateTab?.("proxies")}
                                        className="text-xs text-primary font-medium"
                                    >
                                        {t("proxies.sort.list")} →
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ) : (
                        <div className="flex justify-center">
                            <Button onClick={onAddProfile} disabled={locked} className="h-11 gap-2 rounded-full px-6 text-sm font-semibold">
                                <Plus size={17} />
                                {t("connection.empty.action")}
                            </Button>
                        </div>
                    )}

                    {/* Live numbers only mean something while connected. */}
                    {isConnected && activeMetrics.length > 0 ? (
                        layout.telemetryPlacement === "below" ? (
                            <div className="rounded-2xl bg-muted/30 p-4 sm:p-5">{renderTelemetryGrid()}</div>
                        ) : (
                            renderTelemetryGrid()
                        )
                    ) : null}

                    {isConnected ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/30 px-4 py-2.5 text-xs">
                            <div className="flex items-center gap-3">
                                <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                                    <ShieldCheck size={14} className="text-status-connected" />
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
                                        title={t("connection.copyIp")}
                                        aria-label={t("connection.copyIp")}
                                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                                    >
                                        {copiedIp ? <Check size={12} className="text-status-connected" /> : <Copy size={12} />}
                                    </button>
                                ) : null}
                                {ipInfo?.region ? (
                                    <span className="rounded-md bg-muted px-1.5 text-[10px] text-muted-foreground">{ipInfo.region}</span>
                                ) : null}
                            </div>
                            {killSwitch ? (
                                <span className="flex items-center gap-1 text-[11px] text-primary">
                                    <Lock size={11} /> {t("connection.killSwitchOn")}
                                </span>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Optional quick switcher card, from the layout settings. */}
                    {layout.showQuickSwitch ? (
                        <div className="rounded-2xl bg-muted/50 p-5 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3.5 min-w-0">
                                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                    <Server size={18} className="text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-[11px] text-muted-foreground font-normal">{t("connection.activeServer")}</div>
                                    <div className="text-sm font-semibold truncate">{activeServerLabel}</div>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onNavigateTab?.("proxies")}
                                className="h-8 text-xs shrink-0"
                            >
                                {t("connection.change")} →
                            </Button>
                        </div>
                    ) : null}

                    {isConnected && layout.showSpeedTest ? <SpeedTest /> : null}
                </div>
            </div>
        </div>
    );
}

export default ConnectionView;
