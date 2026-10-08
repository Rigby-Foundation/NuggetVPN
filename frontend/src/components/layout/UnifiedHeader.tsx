import { Activity, BarChart3, Check, ChevronDown, FileText, Loader2, Plus, Power, Server, Settings, Signal, Waypoints, Zap } from "lucide-react";

import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { WindowControls } from "@/components/layout/WindowControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRate } from "@/lib/format";
import { MessageKey, useI18n, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { ConfigSource, ConnectionState, Profile, ProxyMode, TrafficSample } from "@/types";
import { Flag } from "@/components/ui/flag";
import { useUnsupported } from "@/lib/core-support";
import { withoutFlagEmoji } from "@/lib/flags";
import { maximiseOnDoubleClick } from "@/components/layout/header-double-click";

export { NAV_TABS } from "@/lib/tabs";
import { NAV_TABS } from "@/lib/tabs";

interface UnifiedHeaderProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onClose: () => void;
    onMinimize: () => void;
    onMaximize: () => void;
    platform?: string;

    sources: ConfigSource[];
    selectedSourceDomain: string;
    selectedProfileId: string;
    locked: boolean;
    onSourceSelect: (source: ConfigSource) => void;
    onAddProfile: () => void;

    profiles: Profile[];
    profilePings: Record<string, number | null>;
    selectedProxyMode: ProxyMode;
    onSelectProxy: (id: string) => void;
    onSelectAuto: () => void;

    connectionState: ConnectionState;
    traffic: TrafficSample;
    onToggleConnection: () => void;
}

export function UnifiedHeader({
    activeTab,
    onTabChange,
    onClose,
    onMinimize,
    onMaximize,
    platform,
    sources,
    selectedSourceDomain,
    selectedProfileId,
    locked,
    onSourceSelect,
    onAddProfile,
    profiles,
    profilePings,
    selectedProxyMode,
    onSelectProxy,
    onSelectAuto,
    connectionState,
    traffic,
    onToggleConnection,
}: UnifiedHeaderProps) {
    const { t, dir } = useI18n();
    const unsupported = useUnsupported();
    const isMac = platform === "macos";
    const isPhone = platform === "android" || platform === "ios";

    const isConnected = connectionState.status === "connected";
    const isConnecting = connectionState.status === "connecting";
    const isError = connectionState.status === "error";
    const isBusy = isConnecting && !connectionState.reconnecting;

    // Find the currently active server / configuration
    const activeProfile = profiles.find((p) => p.id === selectedProfileId);
    const domain = selectedSourceDomain.trim() || LOCAL;
    const isAuto = selectedProxyMode === "auto";

    // Active server display text
    const activeServerLabel = isAuto
        ? t("proxies.auto")
        : (activeProfile?.name || t("topbar.none"));

    const activePing = activeProfile ? profilePings[activeProfile.id] : null;

    // Filter candidate servers for current source domain (top 5 for quick switch)
    const availableProfiles = profiles.filter((p) => ((p.source_domain || "").trim() || LOCAL) === domain);
    const quickPickProfiles = availableProfiles.slice(0, 6);

    return (
        <header
            className={cn(
                "drag-region relative z-30 flex flex-col w-full shrink-0 select-none border-b bg-card/70 px-3 sm:px-4 backdrop-blur-md transition-colors overflow-hidden",
                "pt-[env(safe-area-inset-top,0px)]"
            )}
            dir={dir}
            onDoubleClick={maximiseOnDoubleClick(onMaximize, platform)}
        >
            {/* Three columns, the tabs in a middle one of their own: centred
                between the sides, the tabs moved whenever a side changed
                width — the live speed every second, the server picker on
                leaving the home tab — and slid away from the pointer. */}
            <div className={cn("grid h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-2", isMac && "pt-1")}>
                {/* Left Area: Window Controls + Brand Beacon */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 justify-self-start">
                {isMac ? (
                    <div className="me-1">
                        <MacWindowControls
                            onClose={onClose}
                            onMinimize={onMinimize}
                            onMaximize={onMaximize}
                        />
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={() => onTabChange("connection")}
                    className="text-sm font-semibold tracking-tight unbounded hover:opacity-85 transition-opacity"
                >
                    Nugget
                </button>
            </div>

            {/* Center Area: Segmented Modern Capsule Navigation */}
            <nav
                className="hidden md:flex items-center gap-0.5 rounded-xl border border-border/50 bg-muted/40 p-1 backdrop-blur-xs min-w-0"
                aria-label={t("nav.menu")}
            >
                {NAV_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <Tooltip key={tab.id} delayDuration={300}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => onTabChange(tab.id)}
                                    aria-current={isActive ? "page" : undefined}
                                    // Every tab the same shape, active or not: only the active
                                    // one showing its name made the others shift on each click.
                                    // Names appear for all of them once the window is wide enough.
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-lg p-1.5 xl:px-2.5 xl:py-1 text-xs transition-colors select-none shrink-0",
                                        isActive
                                            ? "bg-background text-foreground shadow-xs"
                                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                                    )}
                                >
                                    <Icon size={14} className={isActive ? "text-primary" : "text-muted-foreground"} />
                                    <span className="hidden xl:inline truncate max-w-[110px]">{t(tab.label)}</span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                                {t(tab.label)}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </nav>

            {/* Right Area: Telemetry, Quick Server Switcher, Quick Connect, and Window Controls */}
            <div className="col-start-3 flex items-center gap-1.5 sm:gap-2 min-w-0 justify-self-end">
                {/* Live Speeds (when connected on wide screens) */}
                {isConnected && (traffic.down_rate > 0 || traffic.up_rate > 0) ? (
                    <div className="hidden 2xl:flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] font-mono text-muted-foreground tnum">
                        <span className="text-status-connected flex items-center gap-0.5">
                            ↓ {formatRate(traffic.down_rate)}
                        </span>
                        <span className="opacity-40">·</span>
                        <span className="flex items-center gap-0.5">
                            ↑ {formatRate(traffic.up_rate)}
                        </span>
                    </div>
                ) : null}

                {/* Quick Server Switcher Dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={locked}
                                className="h-8 max-w-[190px] sm:max-w-[200px] md:max-w-[170px] lg:max-w-[220px] gap-1.5 px-2.5 text-xs font-normal border-border/60 hover:bg-muted/60 shrink-0"
                            >
                                <Server size={13} className={cn("shrink-0", isConnected ? "text-status-connected" : "text-muted-foreground")} />
                                <span className="truncate">{activeServerLabel}</span>
                                {activePing !== null && activePing !== undefined ? (
                                    <span className="hidden xl:inline text-[10px] font-mono text-muted-foreground/80 shrink-0">
                                        {activePing}ms
                                    </span>
                                ) : null}
                                <ChevronDown size={12} className="opacity-50 shrink-0 ms-0.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                                {t("proxies.title")}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                onClick={onSelectAuto}
                                className="flex items-center justify-between text-xs"
                            >
                                <span className="flex items-center gap-2">
                                    <Zap size={14} className="text-primary" />
                                    {t("proxies.auto")}
                                </span>
                                {isAuto ? <Check size={14} className="text-primary" /> : null}
                            </DropdownMenuItem>
                            {quickPickProfiles.length > 0 ? <DropdownMenuSeparator /> : null}
                            {quickPickProfiles.map((p) => {
                                const ping = profilePings[p.id];
                                const isChosen = !isAuto && selectedProfileId === p.id;
                                return (
                                    <DropdownMenuItem
                                        key={p.id}
                                        disabled={Boolean(unsupported[p.id])}
                                        title={unsupported[p.id]}
                                        onClick={() => onSelectProxy(p.id)}
                                        className="flex items-center justify-between text-xs gap-2"
                                    >
                                        <Flag name={p.name} size={18} />
                                        <span className="truncate flex-1">{withoutFlagEmoji(p.name)}</span>
                                        {ping ? (
                                            <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                                {ping}ms
                                            </span>
                                        ) : null}
                                        {isChosen ? <Check size={14} className="text-primary shrink-0" /> : null}
                                    </DropdownMenuItem>
                                );
                            })}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => onTabChange("proxies")}
                                className="text-xs text-primary font-medium"
                            >
                                {t("proxies.sort.list")} →
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                {/* Add Profile / Config Modal Trigger */}
                <Tooltip delayDuration={350}>
                    <TooltipTrigger asChild>
                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={onAddProfile}
                            disabled={locked}
                            aria-label={t("topbar.add")}
                            className="h-8 w-8 rounded-lg shrink-0 text-muted-foreground hover:text-foreground"
                        >
                            <Plus size={15} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                        {t("topbar.add")}
                    </TooltipContent>
                </Tooltip>

                {/* Windows/Linux Controls */}
                {!isMac && !isPhone ? (
                    <div className="ms-1 border-s border-border/50 ps-1">
                        <WindowControls
                            onClose={onClose}
                            onMinimize={onMinimize}
                            onMaximize={onMaximize}
                        />
                    </div>
                ) : null}
            </div>
            </div>
        </header>
    );
}

export default UnifiedHeader;
