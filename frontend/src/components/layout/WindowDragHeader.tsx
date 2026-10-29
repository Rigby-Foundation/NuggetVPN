import { ServerPicker } from "./ServerPicker";
import { ConnectionStatus } from "./ConnectionStatus";
import { Plus } from "lucide-react";

import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { WindowControls } from "@/components/layout/WindowControls";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConfigSource, ConnectionState, Profile, ProxyMode } from "@/types";
import { maximiseOnDoubleClick } from "@/components/layout/header-double-click";

interface WindowDragHeaderProps {
    platform?: string;
    onClose: () => void;
    onMinimize: () => void;
    onMaximize: () => void;
    showControls?: boolean;
    showBrand?: boolean;
    /** No background or rule of its own: the top of an inset content panel. */
    flat?: boolean;
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
    flat = false,
}: WindowDragHeaderProps) {
    const { t, dir } = useI18n();
    const isMac = platform === "macos";
    const isPhone = platform === "android" || platform === "ios";

    return (
        <header
            className={cn(
                "drag-region flex items-center justify-between px-3 sm:px-4 shrink-0 select-none z-20",
                !flat && "border-b bg-card/50 backdrop-blur-md",
                isMac ? "h-11 pt-0.5" : "h-9"
            )}
            dir={dir}
            onDoubleClick={maximiseOnDoubleClick(onMaximize, platform)}
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
                        <ConnectionStatus state={connectionState} className="max-w-32" />
                            <ServerPicker
                                profiles={profiles} profilePings={profilePings}
                                selectedSourceDomain={selectedSourceDomain} selectedProfileId={selectedProfileId}
                                selectedProxyMode={selectedProxyMode} connectionState={connectionState}
                                locked={locked} onSelectProxy={onSelectProxy} onSelectAuto={onSelectAuto}
                                onTabChange={onTabChange} />

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
