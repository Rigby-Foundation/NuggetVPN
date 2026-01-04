import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ConfigurationViewProps {
  sources: { domain: string; count: number }[];
  selectedSource: string;
  onSelectSource: (domain: string) => void;
  onDeleteSource: (domain: string) => void;
  onAdd: () => void;
}

function ConfigurationView({
  sources,
  selectedSource,
  onSelectSource,
  onDeleteSource,
  onAdd,
}: ConfigurationViewProps) {
  const domainLabel = (domain: string) =>
    domain === "local" ? "Local" : domain;

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

            {sources.map((source) => (
              <Card
                key={source.domain}
                className={cn(
                  "p-4 group hover:border-primary/50 transition-colors overflow-hidden cursor-pointer",
                  selectedSource === source.domain && "border-primary/60 bg-primary/5"
                )}
                onClick={() => onSelectSource(source.domain)}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">
                      {domainLabel(source.domain)}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                      {source.count} proxies
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteSource(source.domain);
                    }}
                    className="shrink-0 hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </Card>
            ))}

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
