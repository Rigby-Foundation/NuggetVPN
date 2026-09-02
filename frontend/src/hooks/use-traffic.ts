import { useEffect, useState } from "react";

import { EVENTS, eventPayload, invoke, listen } from "@/lib/backend";
import { TrafficSample } from "@/types";

const EMPTY: TrafficSample = {
    up: 0,
    down: 0,
    up_rate: 0,
    down_rate: 0,
    total_up: 0,
    total_down: 0,
};

/**
 * Byte counters, pushed once a second by the core.
 *
 * Nothing is polled and nothing is derived here. The rates, the session totals
 * and the lifetime totals are all computed where the numbers live, so a
 * renderer that is reloaded, backgrounded or briefly janky cannot lose a
 * sample or double-count one.
 */
export function useTraffic(connected: boolean): TrafficSample {
    const [traffic, setTraffic] = useState<TrafficSample>(EMPTY);

    useEffect(() => {
        const unlisten = listen(EVENTS.traffic, (data) => {
            setTraffic(eventPayload<TrafficSample>(data));
        });
        return unlisten;
    }, []);

    useEffect(() => {
        if (!connected) {
            setTraffic(EMPTY);
            return;
        }
        // Attaching to a session already in progress: take the current value
        // rather than showing zeroes until the next tick.
        invoke<TrafficSample>("get_traffic")
            .then(setTraffic)
            .catch(() => undefined);
    }, [connected]);

    return traffic;
}
