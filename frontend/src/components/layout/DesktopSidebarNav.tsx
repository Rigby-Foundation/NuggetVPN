import { Activity, BarChart3, Check, ChevronDown, FileText, Plus, Power, Server, Settings, Signal, Waypoints, Zap } from "lucide-react";

import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { WindowControls } from "@/components/layout/WindowControls";
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
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { ConfigSource, ConnectionState, Profile, ProxyMode, TrafficSample } from "@/types";
import { NAV_TABS } from "./UnifiedHeader";
import { Flag } from "@/components/ui/flag";
import { useUnsupported } from "@/lib/core-support";
import { withoutFlagEmoji } from "@/lib/flags";

interface DesktopSidebarNavProps {
    position: "left" | "right";
    /** On the window's background, beside an inset content panel: no
        background or border of its own. */
    inset?: boolean;
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
}

export function DesktopSidebarNav({
    position,
    inset = false,
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
}: DesktopSidebarNavProps) {
    const { t, dir } = useI18n();
    const unsupported = useUnsupported();
    const isMac = platform === "macos";
    const isPhone = platform === "android" || platform === "ios";

    const isConnected = connectionState.status === "connected";
    const isAuto = selectedProxyMode === "auto";
    const activeProfile = profiles.find((p) => p.id === selectedProfileId);
    const domain = selectedSourceDomain.trim() || LOCAL;

    const activeServerLabel = isAuto
        ? t("proxies.auto")
        : (activeProfile?.name || t("topbar.none"));

    const activePing = activeProfile ? profilePings[activeProfile.id] : null;

    const availableProfiles = profiles.filter((p) => ((p.source_domain || "").trim() || LOCAL) === domain);
    const quickPickProfiles = availableProfiles.slice(0, 6);

    return (
        <aside
            className={cn(
                "relative z-20 flex h-full w-56 sm:w-60 flex-col justify-between select-none transition-all duration-200 shrink-0",
                inset
                    ? "bg-transparent"
                    : cn("bg-card/75 backdrop-blur-md", position === "left" ? "border-e" : "border-s")
            )}
            dir={dir}
        >
            {/* Top Brand / Controls Header */}
            <div className={cn(
                "drag-region flex items-center justify-between px-4 shrink-0",
                !inset && "border-b border-border/40",
                isMac ? "h-14 pt-1" : "h-13"
            )}>
                <div className="flex items-center gap-2.5 min-w-0">
                    {isMac && position === "left" ? (
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
                        className="text-sm font-semibold tracking-tight unbounded hover:opacity-85 transition-opacity truncate"
                    >
                        Nugget
                    </button>
                </div>

                {!isMac && !isPhone && position === "right" ? (
                    <WindowControls
                        onClose={onClose}
                        onMinimize={onMinimize}
                        onMaximize={onMaximize}
                    />
                ) : null}
            </div>

            {/* Navigation Tabs List */}
            <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
                {NAV_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => onTabChange(tab.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-all duration-150 select-none",
                                isActive
                                    ? "bg-primary/10 text-primary font-semibold shadow-2xs"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            )}
                        >
                            <Icon size={16} className={cn("shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                            <span className="truncate">{t(tab.label)}</span>
                        </button>
                    );
                })}
            </div>

            {/* Bottom Footer: Speeds, Server Picker & Add Button */}
            <div className="p-3 border-t border-border/40 space-y-2 bg-card/40 shrink-0">
                {/* Live Speeds pill */}
                {isConnected && (traffic.down_rate > 0 || traffic.up_rate > 0) ? (
                    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/40 px-2 py-1 text-[11px] font-mono text-muted-foreground tnum">
                        <span className="text-status-connected flex items-center gap-0.5">
                            ↓ {formatRate(traffic.down_rate)}
                        </span>
                        <span className="flex items-center gap-0.5 text-primary">
                            ↑ {formatRate(traffic.up_rate)}
                        </span>
                    </div>
                ) : null}

                {/* Server Quick Selector Dropdown */}
                <div className="flex items-center gap-1.5">
                    {/* The home screen has its own server picker; two at once is one too many. */}
                    {activeTab !== "connection" ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={locked}
                                    className="h-8 flex-1 justify-between gap-1.5 px-2.5 text-xs font-normal border-border/60 hover:bg-muted/60 min-w-0"
                                >
                                    <span className="flex items-center gap-1.5 truncate min-w-0">
                                        <Server size={13} className={cn("shrink-0", isConnected ? "text-status-connected" : "text-muted-foreground")} />
                                        <span className="truncate">{activeServerLabel}</span>
                                    </span>
                                    <ChevronDown size={12} className="opacity-50 shrink-0 ms-1" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side={position === "left" ? "right" : "left"} align="end" className="w-64 max-h-80 overflow-y-auto">
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
                    ) : null}

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
                        <TooltipContent side="top" className="text-xs">
                            {t("topbar.add")}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </aside>
    );
}

export default DesktopSidebarNav;
