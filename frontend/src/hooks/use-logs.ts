import { useCallback, useEffect, useRef, useState } from "react";

import { EVENTS, eventPayload, listen } from "@/lib/backend";

/** Options offered in the logs view. */
export const LOG_LIMITS = [
    { value: "100", label: "100 lines" },
    { value: "500", label: "500 lines" },
    { value: "1000", label: "1000 lines" },
    { value: "20000", label: "20,000 lines" },
] as const;

const DEFAULT_LIMIT = "1000";

interface LogBatch {
    lines: string[];
}

/**
 * The rolling log buffer.
 *
 * The limit is held in a ref as well as state so the event subscription can
 * read the current value without being torn down and rebuilt every time the
 * user changes it. That coupling used to run the other way: the log limit was a
 * dependency of the effect that also ran application startup, so picking a
 * different limit from the dropdown silently re-ran the whole boot sequence,
 * subscription refresh included.
 */
export function useLogs() {
    const [logs, setLogs] = useState<string[]>([]);
    const [limit, setLimit] = useState<string>(DEFAULT_LIMIT);
    const limitRef = useRef(Number(DEFAULT_LIMIT));

    const append = useCallback((lines: string[]) => {
        if (lines.length === 0) {
            return;
        }
        setLogs((previous) => {
            const next = previous.concat(lines);
            return next.length > limitRef.current
                ? next.slice(-limitRef.current)
                : next;
        });
    }, []);

    useEffect(() => {
        const unlisten = listen(EVENTS.log, (data) => {
            const batch = eventPayload<LogBatch>(data);
            append(batch?.lines ?? []);
        });
        return unlisten;
    }, [append]);

    const changeLimit = useCallback((value: string) => {
        const parsed = Number(value);
        const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
        limitRef.current = resolved;
        setLimit(value);
        setLogs((previous) =>
            previous.length > resolved ? previous.slice(-resolved) : previous
        );
    }, []);

    const clear = useCallback(() => setLogs([]), []);

    return { logs, limit, changeLimit, append, clear };
}
