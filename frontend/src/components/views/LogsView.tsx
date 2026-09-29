import { memo, useEffect, useRef } from "react";
import { Download, Trash2 } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { LOG_LIMITS } from "@/hooks/use-logs";
import { parseAnsi, stripAnsi } from "@/lib/ansi";

interface LogsViewProps {
    logs: string[];
    logLimit: string;
    onLogLimitChange: (value: string) => void;
    onDumpLogs: () => void;
    onClear: () => void;
}

/** The line's base colour, by its level; the core's own colours sit on top. */
function toneFor(line: string): string {
    const plain = stripAnsi(line);
    if (/^(ERROR|FATAL|PANIC)/.test(plain)) return "text-status-error";
    if (/^WARN/.test(plain)) return "text-status-connecting";
    return "text-muted-foreground";
}

/**
 * One log line, with the core's colour codes rendered rather than printed.
 * Memoised: new lines arrive constantly, and the thousands already on screen
 * should not be parsed again each time.
 */
const LogLine = memo(function LogLine({ line }: { line: string }) {
    return (
        <li className={`py-0.5 break-words ${toneFor(line)}`}>
            {parseAnsi(line).map((segment, index) =>
                segment.color || segment.bold ? (
                    <span
                        key={index}
                        style={{ color: segment.color }}
                        className={segment.bold ? "font-semibold" : undefined}
                    >
                        {segment.text}
                    </span>
                ) : (
                    segment.text
                )
            )}
        </li>
    );
});

function LogsView({
    logs,
    logLimit,
    onLogLimitChange,
    onDumpLogs,
    onClear,
}: LogsViewProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef(true);

    // Follow the tail, but stop fighting the user the moment they scroll up to
    // read something.
    useEffect(() => {
        const container = scrollRef.current;
        if (!container || !pinnedRef.current) {
            return;
        }
        container.scrollTop = container.scrollHeight;
    }, [logs]);

    const handleScroll = () => {
        const container = scrollRef.current;
        if (!container) {
            return;
        }
        const distance =
            container.scrollHeight - container.scrollTop - container.clientHeight;
        pinnedRef.current = distance < 40;
    };

    return (
        <PageShell
            fill
            title="Logs"
            description={`${logs.length.toLocaleString()} lines from the core`}
            actions={
                <>
                    <Button variant="ghost" size="sm" onClick={onClear}>
                        <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                        Clear
                    </Button>
                    <Button variant="outline" size="sm" onClick={onDumpLogs}>
                        <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                        Export
                    </Button>
                    <Select value={logLimit} onValueChange={onLogLimitChange}>
                        <SelectTrigger className="w-[140px]" aria-label="Lines to keep">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {LOG_LIMITS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </>
            }
        >
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 rounded-lg border bg-card/40 p-3 overflow-y-auto custom-scrollbar"
            >
                {logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 text-center">
                        Nothing logged yet.
                    </p>
                ) : (
                    <ol className="font-mono text-xs leading-relaxed">
                        {logs.map((line, index) => (
                            <LogLine key={`${index}-${line}`} line={line} />
                        ))}
                    </ol>
                )}
            </div>
        </PageShell>
    );
}

export default LogsView;
