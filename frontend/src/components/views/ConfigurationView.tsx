import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ConfigSource } from "@/types";

interface ConfigurationViewProps {
  sources: ConfigSource[];
  selectedSource: string;
  selectedProfileId: string;
  refreshingSourceDomain: string;
  onSelectSource: (source: ConfigSource) => void;
  onDeleteSource: (source: ConfigSource) => void;
  onRefreshSource: (source: ConfigSource) => void;
  onAdd: () => void;
}

function ConfigurationView({
  sources,
  selectedSource,
  selectedProfileId,
  refreshingSourceDomain,
  onSelectSource,
  onDeleteSource,
  onRefreshSource,
  onAdd,
}: ConfigurationViewProps) {
  const isSelected = (source: ConfigSource) =>
    source.kind === "subscription"
      ? selectedSource === source.domain
      : selectedSource === "local" && selectedProfileId === source.profileId;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-6">
          <h2 className="text-lg font-bold mb-4">Configuration</h2>
          <div className="space-y-2">
            {sources.length === 0 && (
              <div className="text-xs text-muted-foreground">
                No configurations yet. Import a subscription or add a profile.
              </div>
            )}

            {sources.map((source) => {
              const sourceDomain =
                source.kind === "subscription"
                  ? (source.domain || "").trim() || "local"
                  : "local";
              const isRefreshingThis =
                source.kind === "subscription" &&
                refreshingSourceDomain === sourceDomain;
              return (
              <Card
                key={source.key}
                className={cn(
                  "p-4 group hover:border-primary/50 transition-colors overflow-hidden cursor-pointer",
                  isSelected(source) && "border-primary/60 bg-primary/5"
                )}
                onClick={() => onSelectSource(source)}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">
                      {source.label}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                      {source.detail}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRefreshSource(source);
                    }}
                    disabled={isRefreshingThis || source.kind !== "subscription"}
                    className="shrink-0"
                    title={
                      source.kind === "subscription"
                        ? "Refresh subscription"
                        : "Only subscriptions can be refreshed"
                    }
                  >
                    <RefreshCw
                      size={16}
                      className={cn(isRefreshingThis && "animate-spin")}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteSource(source);
                    }}
                    className="shrink-0 hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </Card>
              );
            })}

            <Button
              variant="outline"
              className="w-full py-8 border-dashed"
              onClick={onAdd}
            >
              <Plus size={16} className="mr-2" /> Add Profile / Subscription
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export default ConfigurationView;
