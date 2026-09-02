import { ReactNode, useEffect, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    Clock,
    Globe,
    Loader2,
    Power,
    TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConnectionState, IpInfo, TrafficSample } from "@/types";

interface ConnectionViewProps {
    state: ConnectionState;
    traffic: TrafficSample;
    onToggle: () => void;
    onDismissError: () => void;
    ipInfo: IpInfo | null;
    isCheckingIp: boolean;
    ipCheckEnabled: boolean;
}

/** Per-state presentation. Everything visual keys off this one table. */
const PRESENTATION = {
    idle: {
        label: "Not connected",
        hint: "Tap to connect",
        ring: "border-border",
        disc: "bg-muted/60 border border-border",
        icon: "text-muted-foreground",
        dot: "bg-status-idle",
    },
    connecting: {
        label: "Connecting",
        hint: "Finding the fastest server…",
        ring: "border-status-connecting/40",
        disc: "bg-status-connecting/15 border border-status-connecting/40",
        icon: "text-status-connecting",
        dot: "bg-status-connecting",
    },
    connected: {
        label: "Connected",
        hint: "Your traffic is going through the tunnel",
        ring: "border-status-connected/40",
        disc:
            "bg-linear-to-tr from-status-connected to-status-connecting " +
            "shadow-[0_0_60px_-8px_var(--status-connected)]",
        icon: "text-primary-foreground",
        dot: "bg-status-connected",
    },
    error: {
        label: "Not connected",
        hint: "The last attempt failed",
        ring: "border-status-error/40",
        disc: "bg-status-error/10 border border-status-error/40",
        icon: "text-status-error",
        dot: "bg-status-error",
    },
} as const;

/** Ticks once a second while connected, so the duration counts up. */
function useElapsed(since: number | undefined): string {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!since) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [since]);

    if (!since) {
        return "00:00:00";
    }
    return formatDuration(Math.max(0, now - since));
}

interface StatProps {
    icon: ReactNode;
    label: string;
    value: string;
    hint?: string;
}

function Stat({ icon, label, value, hint }: StatProps) {
    return (
        <div className="flex items-center gap-3 rounded-lg border bg-card/50 px-3 py-2.5 min-w-0">
            <span className="text-muted-foreground shrink-0" aria-hidden="true">
                {icon}
            </span>
            <span className="min-w-0">
                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                    {label}
                </span>
                <span
                    className="block text-sm font-medium tnum truncate"
                    title={hint ?? value}
                >
                    {value}
                </span>
            </span>
        </div>
    );
}

function ConnectionView({
    state,
    traffic,
    onToggle,
    onDismissError,
    ipInfo,
    isCheckingIp,
    ipCheckEnabled,
}: ConnectionViewProps) {
    const presentation = PRESENTATION[state.status];
    const elapsed = useElapsed(state.status === "connected" ? state.since : undefined);
    const busy = state.status === "connecting";

    // What the button will do, which is not always the inverse of the label:
    // from an error state the action is to try again.
    const action = state.status === "connected" ? "Disconnect" : "Connect";

    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 py-6 overflow-y-auto">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                    className={cn("h-2 w-2 rounded-full", presentation.dot)}
                    aria-hidden="true"
                />
                <span className="font-medium text-foreground">{presentation.label}</span>
                {state.profile ? (
                    <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[16rem]" title={state.profile}>
                            {state.profile}
                        </span>
                    </>
                ) : null}
            </div>

            <button
                type="button"
                onClick={onToggle}
                disabled={busy}
                aria-label={`${action}${state.profile ? ` (${state.profile})` : ""}`}
                aria-busy={busy}
                className={cn(
                    "group relative h-52 w-52 rounded-full flex items-center justify-center",
                    "transition-transform duration-300 rounded-full",
                    "disabled:cursor-progress",
                    !busy && "hover:scale-[1.02] active:scale-[0.99]"
                )}
            >
                {/* Halo: breathes when connected, sweeps while connecting. */}
                <span
                    className={cn(
                        "absolute inset-0 rounded-full border-2",
                        presentation.ring,
                        state.status === "connected" && "animate-breathe"
                    )}
                    aria-hidden="true"
                />
                {busy ? (
                    <span
                        className="absolute inset-0 rounded-full border-2 border-transparent border-t-status-connecting animate-sweep"
                        aria-hidden="true"
                    />
                ) : null}

                <span
                    className={cn(
                        "absolute inset-3 rounded-full flex items-center justify-center",
                        "transition-colors duration-500",
                        presentation.disc
                    )}
                    aria-hidden="true"
                >
                    {busy ? (
                        <Loader2 size={56} strokeWidth={1.5} className={cn("animate-spin", presentation.icon)} />
                    ) : state.status === "error" ? (
                        <TriangleAlert size={52} strokeWidth={1.5} className={presentation.icon} />
                    ) : (
                        <Power
                            size={56}
                            strokeWidth={1.5}
                            className={cn(
                                "transition-colors",
                                presentation.icon,
                                state.status === "idle" && "group-hover:text-primary"
                            )}
                        />
                    )}
                </span>
            </button>

            {/* One live region for the whole screen: assistive tech announces
                state changes without the user having to go looking. */}
            <div
                role="status"
                aria-live="polite"
                className="min-h-[3.25rem] flex flex-col items-center justify-start gap-2 text-center"
            >
                {state.status === "error" ? (
                    <>
                        <p className="text-sm text-status-error max-w-md">
                            {state.error || presentation.hint}
                        </p>
                        <Button size="sm" variant="ghost" onClick={onDismissError}>
                            Dismiss
                        </Button>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground">{presentation.hint}</p>
                )}
            </div>

            {state.status === "connected" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-2xl">
                    <Stat
                        icon={<ArrowUp size={16} />}
                        label="Upload"
                        value={formatRate(traffic.up_rate)}
                        hint={`${formatBytes(traffic.up)} this session`}
                    />
                    <Stat
                        icon={<ArrowDown size={16} />}
                        label="Download"
                        value={formatRate(traffic.down_rate)}
                        hint={`${formatBytes(traffic.down)} this session`}
                    />
                    <Stat icon={<Clock size={16} />} label="Duration" value={elapsed} />
                    <Stat
                        icon={<Globe size={16} />}
                        label="Public IP"
                        value={
                            !ipCheckEnabled
                                ? "Off"
                                : isCheckingIp
                                  ? "Checking…"
                                  : ipInfo?.ip || "—"
                        }
                        hint={
                            !ipCheckEnabled
                                ? "The public address check is turned off in settings"
                                : ipInfo?.region || undefined
                        }
                    />
                </div>
            ) : null}
        </div>
    );
}

export default ConnectionView;
