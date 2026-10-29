import { Loader2, ShieldAlert } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/types";

/** Text and shape carry the state even in a monochrome custom theme. */
export function ConnectionStatus({ state, className }: { state?: ConnectionState; className?: string }) {
    const t = useT();
    const status = state?.status ?? "idle";
    const label = state?.blocked ? t("connection.blocked") : state?.reconnecting
        ? t("connection.reconnecting", { attempt: state.attempt ?? 1 })
        : t(status === "connected" ? "status.connected" : status === "connecting" ? "status.connecting" : status === "error" ? "status.error" : "status.idle");
    return (
        <span role="status" title={label} className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs font-medium", className,
            state?.blocked || status === "error" ? "text-status-error" : status === "connected" ? "text-status-connected" : "text-muted-foreground")}
        >
            {status === "connecting" ? <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden="true" />
                : state?.blocked || status === "error" ? <ShieldAlert size={13} className="shrink-0" aria-hidden="true" />
                : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status === "connected" ? "bg-status-connected" : "border border-current")} aria-hidden="true" />}
            <span className="truncate">{label}</span>
        </span>
    );
}
