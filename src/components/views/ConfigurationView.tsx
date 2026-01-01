import { Plus, Trash2 } from "lucide-react";

import { Profile } from "@/types";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConfigurationViewProps {
  profiles: Profile[];
  onDelete: (id: string) => void;
  onAdd: () => void;
}

function ConfigurationView({
  profiles,
  onDelete,
  onAdd,
}: ConfigurationViewProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-6">
          <h2 className="text-lg font-bold mb-4">Configuration</h2>
          <div className="space-y-2">
            {profiles.map((p) => (
              <Card
                key={p.id}
                className="p-4 group hover:border-primary/50 transition-colors overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                      {p.server} ({p.protocol})
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(p.id)}
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
              <Plus size={16} className="mr-2" /> Add New Profile
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export default ConfigurationView;
