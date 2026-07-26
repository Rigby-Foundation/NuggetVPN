import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfigSource } from "@/types";

interface TopBarProps {
  sources: ConfigSource[];
  selectedSourceDomain: string;
  selectedProfileId: string;
  isConnected: boolean;
  onSourceSelect: (source: ConfigSource) => void;
  onAddProfile: () => void;
}

function TopBar({
  sources,
  selectedSourceDomain,
  selectedProfileId,
  isConnected,
  onSourceSelect,
  onAddProfile,
}: TopBarProps) {
  const isSelected = (source: ConfigSource) =>
    source.kind === "subscription"
      ? source.domain === selectedSourceDomain
      : selectedSourceDomain === "local" && source.profileId === selectedProfileId;

  const selectedSource =
    sources.find(isSelected) ||
    sources.find(
      (source) =>
        source.kind === "subscription" &&
        source.domain === selectedSourceDomain
    ) ||
    sources[0];
  const displayName = sources.length
    ? selectedSource?.label || "Select Configuration"
    : "Select Configuration";

  return (
    <div
      className="h-16 border-b flex items-center justify-between px-6 shrink-0"
      data-tauri-drag-region
    >
      <div className="flex flex-col min-w-0 flex-1 mr-4">
        <span className="text-[10px] font-bold text-muted-foreground">
          Current Configuration
        </span>
        <div className="relative group flex items-center gap-2 min-w-0">
          {sources.length === 0 ? (
            <span className="font-medium text-muted-foreground">
              No configurations
            </span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  disabled={isConnected}
                  className="p-0! h-auto font-bold text-lg max-w-full"
                >
                  <span className="truncate">{displayName}</span>
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 max-h-96 overflow-y-auto">
                {sources.map((source) => (
                  <DropdownMenuItem
                    key={source.key}
                    onClick={() => onSourceSelect(source)}
                    className="flex items-center justify-between text-xs font-medium"
                  >
                    <span className="truncate">{source.label}</span>
                    <span className="text-muted-foreground font-mono">
                      {source.kind === "subscription"
                        ? source.count
                        : source.detail}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <Button
          size="icon"
          variant="secondary"
          onClick={onAddProfile}
          disabled={isConnected}
          className="rounded-full"
        >
          <Plus size={16} />
        </Button>
      </div>
    </div>
  );
}

export default TopBar;
