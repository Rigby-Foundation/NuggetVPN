import { ReactNode, useEffect, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    Clock,
    Globe,
    Loader2,
    Power,
    ShieldAlert,
    TriangleAlert,
} from "lucide-react";

import { SpeedTest } from "@/components/speed-test";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";
import { MessageKey, useT } from "@/lib/i18n";
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
        label: "status.idle",
        hint: "connection.hint.idle",
        ring: "border-border",
        disc: "bg-muted/60 border border-border",
        icon: "text-muted-foreground",
        dot: "bg-status-idle",
    },
    connecting: {
        label: "status.connecting",
        hint: "connection.hint.connecting",
        ring: "border-status-connecting/40",
        disc: "bg-status-connecting/15 border border-status-connecting/40",
        icon: "text-status-connecting",
        dot: "bg-status-connecting",
    },
    connected: {
        label: "status.connected",
        hint: "connection.hint.connected",
        ring: "border-status-connected/40",
        disc:
            "bg-linear-to-tr from-status-connected to-status-connecting " +
            "shadow-[0_0_60px_-8px_var(--status-connected)]",
        icon: "text-primary-foreground",
        dot: "bg-status-connected",
    },
    error: {
        label: "status.idle",
        hint: "connection.hint.error",
        ring: "border-status-error/40",
        disc: "bg-status-error/10 border border-status-error/40",
        icon: "text-status-error",
        dot: "bg-status-error",
    },
} as const satisfies Record<string, { label: MessageKey; hint: MessageKey; ring: string; disc: string; icon: string; dot: string }>;

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
                <span className="block text-xs text-muted-foreground">
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
    const t = useT();
    const presentation = PRESENTATION[state.status];
    const elapsed = useElapsed(state.status === "connected" ? state.since : undefined);
    // A reconnect can be stopped from the button; a first connect cannot.
    const busy = state.status === "connecting" && !state.reconnecting;

    // What the button will do, which is not always the inverse of the label:
    // from an error state the action is to try again.
    const action = t(
        state.status === "connected" || state.reconnecting || state.blocked ? "connection.disconnect" : "connection.connect"
    );

    return (
        <div className="enter-stagger absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 py-6 overflow-y-auto">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                    className={cn("h-2 w-2 rounded-full", presentation.dot)}
                    aria-hidden="true"
                />
                <span className="font-medium text-foreground">{t(presentation.label)}</span>
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
                            {state.error || t(presentation.hint)}
                        </p>
                        {state.blocked ? null : (
                            <Button size="sm" variant="ghost" onClick={onDismissError}>
                                {t("connection.dismiss")}
                            </Button>
                        )}
                    </>
                ) : state.reconnecting ? (
                    <p className="text-sm text-muted-foreground">
                        {t("connection.reconnecting", { attempt: state.attempt ?? 1 })}
                    </p>
                ) : (
                    <p className="text-sm text-muted-foreground">{t(presentation.hint)}</p>
                )}
                {state.blocked ? (
                    <p className="flex items-center gap-1.5 rounded-full bg-status-error/10 px-3 py-1 text-xs text-status-error">
                        <ShieldAlert size={13} aria-hidden="true" />
                        {t("connection.blocked")}
                    </p>
                ) : null}
            </div>

            {state.status === "connected" ? (
                // Fourth in the page's sequence: after the status line, the
                // button and the hint.
                <div
                    className="enter-stagger grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-2xl"
                    style={{ ["--enter-offset" as string]: 3 }}
                >
                    <Stat
                        icon={<ArrowUp size={16} />}
                        label={t("connection.upload")}
                        value={formatRate(traffic.up_rate)}
                        hint={t("connection.thisSession", { amount: formatBytes(traffic.up) })}
                    />
                    <Stat
                        icon={<ArrowDown size={16} />}
                        label={t("connection.download")}
                        value={formatRate(traffic.down_rate)}
                        hint={t("connection.thisSession", { amount: formatBytes(traffic.down) })}
                    />
                    <Stat icon={<Clock size={16} />} label={t("connection.duration")} value={elapsed} />
                    <Stat
                        icon={<Globe size={16} />}
                        label={t("connection.publicIp")}
                        value={
                            !ipCheckEnabled
                                ? t("connection.ipOff")
                                : isCheckingIp
                                  ? t("connection.checking")
                                  : ipInfo?.ip || "—"
                        }
                        hint={
                            !ipCheckEnabled
                                ? t("connection.ipOffHint")
                                : ipInfo?.region || undefined
                        }
                    />
                </div>
            ) : null}
            {state.status === "connected" ? (
                <div className="enter-stagger flex w-full justify-center" style={{ ["--enter-offset" as string]: 4 }}>
                    <SpeedTest />
                </div>
            ) : null}
        </div>
    );
}

export default ConnectionView;
