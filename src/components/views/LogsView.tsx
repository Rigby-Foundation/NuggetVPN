import { RefObject } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LogsViewProps {
  logs: string[];
  logLimit: string;
  onLogLimitChange: (value: string) => void;
  logEndRef: RefObject<HTMLDivElement>;
}

function LogsView({
  logs,
  logLimit,
  onLogLimitChange,
  logEndRef,
}: LogsViewProps) {
  return (
    <div className="absolute inset-0 flex flex-col p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">System Logs</h2>
        <Select value={logLimit} onValueChange={onLogLimitChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select limit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="100">100 lines</SelectItem>
            <SelectItem value="500">500 lines</SelectItem>
            <SelectItem value="1000">1000 lines</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="flex-1 rounded-lg border p-4">
        <div className="font-mono text-xs text-muted-foreground">
          {logs.map((log, index) => (
            <div
              key={index}
              className="mb-1 border-b border-border/50 pb-1 last:border-0"
            >
              {log}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

export default LogsView;
