import { ChevronDown, Plus } from "lucide-react";

import { formatBytes } from "@/lib/format";
import { Profile } from "@/types";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TopBarProps {
  profiles: Profile[];
  selectedProfileId: string;
  isConnected: boolean;
  onProfileSelect: (id: string) => void;
  onAddProfile: () => void;
}

function TopBar({
  profiles,
  selectedProfileId,
  isConnected,
  onProfileSelect,
  onAddProfile,
}: TopBarProps) {
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div
      className="h-16 border-b flex items-center justify-between px-6 shrink-0"
      data-tauri-drag-region
    >
      <div className="flex flex-col min-w-0 flex-1 mr-4">
        <span className="text-[10px] font-bold text-muted-foreground">
          Current Profile
        </span>
        <div className="relative group flex items-center gap-2 min-w-0">
          {profiles.length === 0 ? (
            <span className="font-medium text-muted-foreground">No profiles</span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  disabled={isConnected}
                  className="p-0! h-auto font-bold text-lg max-w-full"
                >
                  <span className="truncate">{selectedProfile?.name || "Select Profile"}</span>
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 max-h-96 overflow-y-auto">
                {profiles.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => onProfileSelect(p.id)}
                    className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                  >
                    <div className="font-bold truncate w-full">{p.name}</div>
                    <div className="flex w-full items-center justify-between text-xs text-muted-foreground font-mono">
                      <span className="truncate">{p.server}</span>
                      <span className="shrink-0 ml-2">
                        {formatBytes((p.total_up || 0) + (p.total_down || 0))}
                      </span>
                    </div>
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
