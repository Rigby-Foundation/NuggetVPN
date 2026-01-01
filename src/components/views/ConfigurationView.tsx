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
    <div className="absolute inset-0 flex flex-col p-6">
      <h2 className="text-lg font-bold mb-4">Configuration</h2>
      <ScrollArea className="overflow-scroll">
        <div className="space-y-2 pr-4">
          {profiles.map((p) => (
            <Card
              key={p.id}
              className="flex flex-row justify-between p-4 group hover:border-primary/50 transition-colors"
            >
              <div className="flex justify-between w-full items-center">
                <div>
                  <div className="font-bold">{p.name}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-1">
                    {p.server} ({p.protocol})
                  </div>
                </div>
                <div className="flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(p.id)}
                    className="hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
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
      </ScrollArea>
    </div>
  );
}

export default ConfigurationView;
