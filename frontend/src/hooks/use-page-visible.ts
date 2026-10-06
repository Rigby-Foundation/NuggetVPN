import { useEffect, useState } from "react";

/**
 * Whether the window is on screen. Polling should stop while it is not: a
 * window hidden in the tray keeps its timers running, and the ping sweep
 * alone starts a process per server on macOS and Linux every time.
 */
export function usePageVisible(): boolean {
    const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
    useEffect(() => {
        const update = () => setVisible(document.visibilityState !== "hidden");
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    return visible;
}
