import { RefObject, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download } from "lucide-react";

interface LogsViewProps {
  logs: string[];
  logLimit: string;
  onLogLimitChange: (value: string) => void;
  onDumpLogs: () => void;
  logEndRef: RefObject<HTMLDivElement>;
}

function LogsView({
  logs,
  logLimit,
  onLogLimitChange,
  onDumpLogs,
  logEndRef,
}: LogsViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="absolute inset-0 flex flex-col p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">System Logs</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onDumpLogs}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Select value={logLimit} onValueChange={onLogLimitChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select limit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100 lines</SelectItem>
              <SelectItem value="500">500 lines</SelectItem>
              <SelectItem value="1000">1000 lines</SelectItem>
              <SelectItem value="999999">Unlimited</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div 
        ref={scrollContainerRef}
        className="flex-1 rounded-lg border p-4 overflow-y-auto"
      >
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
      </div>
    </div>
  );
}

export default LogsView;
