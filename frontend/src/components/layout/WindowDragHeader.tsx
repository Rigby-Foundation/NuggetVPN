import { ChevronDown, Plus, Server, Zap, Check } from "lucide-react";

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
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { ConfigSource, ConnectionState, Profile, ProxyMode } from "@/types";

interface WindowDragHeaderProps {
    platform?: string;
    onClose: () => void;
    onMinimize: () => void;
    onMaximize: () => void;
    showControls?: boolean;
    showBrand?: boolean;
    showServerSelector?: boolean;

    sources?: ConfigSource[];
    selectedSourceDomain?: string;
    selectedProfileId?: string;
    locked?: boolean;
    onSourceSelect?: (source: ConfigSource) => void;
    onAddProfile?: () => void;
    profiles?: Profile[];
    profilePings?: Record<string, number | null>;
    selectedProxyMode?: ProxyMode;
    onSelectProxy?: (id: string) => void;
    onSelectAuto?: () => void;
    connectionState?: ConnectionState;
    onTabChange?: (tab: string) => void;
}

export function WindowDragHeader({
    platform,
    onClose,
    onMinimize,
    onMaximize,
    showControls = true,
    showBrand = true,
    showServerSelector = false,
    sources = [],
    selectedSourceDomain = "",
    selectedProfileId = "",
    locked = false,
    onSourceSelect,
    onAddProfile,
    profiles = [],
    profilePings = {},
    selectedProxyMode = "auto",
    onSelectProxy,
    onSelectAuto,
    connectionState,
    onTabChange,
}: WindowDragHeaderProps) {
    const { t, dir } = useI18n();
    const isMac = platform === "macos";
    const isPhone = platform === "android" || platform === "ios";

    const isConnected = connectionState?.status === "connected";
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
        <header
            className={cn(
                "drag-region flex items-center justify-between border-b bg-card/50 backdrop-blur-md px-3 sm:px-4 shrink-0 select-none z-20",
                isMac ? "h-11 pt-0.5" : "h-9"
            )}
            dir={dir}
        >
            {/* Left Area: Mac Window Controls and/or Brand */}
            <div className="flex items-center gap-3 shrink-0">
                {isMac && showControls ? (
                    <div className="me-1">
                        <MacWindowControls
                            onClose={onClose}
                            onMinimize={onMinimize}
                            onMaximize={onMaximize}
                        />
                    </div>
                ) : null}

                {showBrand ? (
                    <button
                        type="button"
                        onClick={() => onTabChange?.("connection")}
                        className="text-xs font-semibold tracking-tight unbounded hover:opacity-85 transition-opacity"
                    >
                        Nugget
                    </button>
                ) : null}
            </div>

            {/* Right Area: Optional Server Selector & Windows/Linux Controls */}
            <div className="flex items-center gap-2 shrink-0">
                {showServerSelector ? (
                    <>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={locked}
                                    className="h-7 max-w-[190px] sm:max-w-[210px] gap-1.5 px-2.5 text-xs font-normal border-border/60 hover:bg-muted/60"
                                >
                                    <Server size={12} className={cn("shrink-0", isConnected ? "text-status-connected" : "text-muted-foreground")} />
                                    <span className="truncate">{activeServerLabel}</span>
                                    {activePing !== null && activePing !== undefined ? (
                                        <span className="hidden sm:inline text-[10px] font-mono text-muted-foreground/80 shrink-0">
                                            {activePing}ms
                                        </span>
                                    ) : null}
                                    <ChevronDown size={11} className="opacity-50 shrink-0 ms-0.5" />
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
                                            onClick={() => onSelectProxy?.(p.id)}
                                            className="flex items-center justify-between text-xs gap-2"
                                        >
                                            <span className="truncate flex-1">{p.name}</span>
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
                                    onClick={() => onTabChange?.("proxies")}
                                    className="text-xs text-primary font-medium"
                                >
                                    {t("proxies.sort.list")} →
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {onAddProfile ? (
                            <Tooltip delayDuration={350}>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={onAddProfile}
                                        disabled={locked}
                                        aria-label={t("topbar.add")}
                                        className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                                    >
                                        <Plus size={14} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                    {t("topbar.add")}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                    </>
                ) : null}

                {!isMac && !isPhone && showControls ? (
                    <div className="ms-1 border-s border-border/50 ps-1">
                        <WindowControls
                            onClose={onClose}
                            onMinimize={onMinimize}
                            onMaximize={onMaximize}
                        />
                    </div>
                ) : null}
            </div>
        </header>
    );
}

export default WindowDragHeader;
