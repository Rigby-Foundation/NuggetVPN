import { useEffect, useState } from "react";
import { EVENTS, eventPayload, invoke, listen } from "@/lib/backend";
import type { TrafficSample } from "@/types";

export function useTraffic(session: string | null): TrafficSample | null {
  const [latest, setLatest] = useState<{
    session: string;
    sample: TrafficSample;
  } | null>(null);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let received = false;
    const stop = listen(EVENTS.traffic, (data) => {
      received = true;
      setLatest({ session, sample: eventPayload<TrafficSample>(data) });
    });
    void invoke<TrafficSample>("get_traffic")
      .then((sample) => {
        if (!disposed && !received) setLatest({ session, sample });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop();
    };
  }, [session]);

  return latest?.session === session ? latest.sample : null;
}
