import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCAL } from "@/hooks/use-profiles";
import { ConfigSource } from "@/types";

interface TopBarProps {
    sources: ConfigSource[];
    selectedSourceDomain: string;
    selectedProfileId: string;
    /** Switching configuration mid-tunnel is not allowed. */
    locked: boolean;
    onSourceSelect: (source: ConfigSource) => void;
    onAddProfile: () => void;
}

function TopBar({
    sources,
    selectedSourceDomain,
    selectedProfileId,
    locked,
    onSourceSelect,
    onAddProfile,
}: TopBarProps) {
    const isSelected = (source: ConfigSource) =>
        source.kind === "subscription"
            ? source.domain === selectedSourceDomain
            : selectedSourceDomain === LOCAL && source.profileId === selectedProfileId;

    const selected =
        sources.find(isSelected) ??
        sources.find(
            (source) =>
                source.kind === "subscription" && source.domain === selectedSourceDomain
        ) ??
        sources[0];

    return (
        <div className="drag-region h-16 border-b flex items-center justify-between gap-4 px-6 shrink-0">
            <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Configuration
                </span>
                {sources.length === 0 ? (
                    <span className="text-base font-medium text-muted-foreground">
                        None yet
                    </span>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                disabled={locked}
                                title={
                                    locked
                                        ? "Disconnect before switching configuration"
                                        : undefined
                                }
                                className="p-0! h-auto font-semibold text-base max-w-full justify-start hover:bg-transparent"
                            >
                                <span className="truncate">
                                    {selected?.label ?? "Select a configuration"}
                                </span>
                                <ChevronDown
                                    className="ml-1.5 h-4 w-4 opacity-60 shrink-0"
                                    aria-hidden="true"
                                />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-72 max-h-96 overflow-y-auto">
                            {sources.map((source) => (
                                <DropdownMenuItem
                                    key={source.key}
                                    onClick={() => onSourceSelect(source)}
                                    className="flex items-center justify-between gap-3 text-xs"
                                >
                                    <span className="truncate">{source.label}</span>
                                    <span className="text-muted-foreground font-mono shrink-0">
                                        {source.detail}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <Button
                size="icon"
                variant="secondary"
                onClick={onAddProfile}
                disabled={locked}
                aria-label="Add a profile or subscription"
                className="rounded-full shrink-0"
            >
                <Plus size={16} aria-hidden="true" />
            </Button>
        </div>
    );
}

export default TopBar;
