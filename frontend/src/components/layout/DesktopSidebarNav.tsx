import { ServerPicker } from "./ServerPicker";
import { ConnectionStatus } from "./ConnectionStatus";
import { Plus } from "lucide-react";

import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { WindowControls } from "@/components/layout/WindowControls";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConfigSource, ConnectionState, Profile, ProxyMode, TrafficSample } from "@/types";
import { NAV_TABS } from "./UnifiedHeader";
import { maximiseOnDoubleClick } from "@/components/layout/header-double-click";

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
    const isMac = platform === "macos";
    const isPhone = platform === "android" || platform === "ios";

    const isConnected = connectionState.status === "connected";
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
            )} onDoubleClick={maximiseOnDoubleClick(onMaximize, platform)}>
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
                <ConnectionStatus state={connectionState} />
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
                        <ServerPicker
                                profiles={profiles} profilePings={profilePings}
                                selectedSourceDomain={selectedSourceDomain} selectedProfileId={selectedProfileId}
                                selectedProxyMode={selectedProxyMode} connectionState={connectionState}
                                locked={locked} onSelectProxy={onSelectProxy} onSelectAuto={onSelectAuto}
                                onTabChange={onTabChange} side={position === "left" ? "right" : "left"} />

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
