import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Search, X, XCircle } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import { kindMeta } from "@/components/routing/nodes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLabels } from "@/components/routing/app-picker";
import { errorMessage, invoke } from "@/lib/backend";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LiveConnection, Profile, RoutingRule } from "@/types";

/** How often the list is read while the screen is open. */
const POLL_MS = 1000;
/** GetConnections' rule for traffic no rule matched; see app.DefaultRuleHits. */
const DEFAULT_RULE = "__default";

type Sort = "recent" | "traffic" | "speed";
const SORT_LABELS = {
    recent: "connections.sort.recent",
    traffic: "connections.sort.traffic",
    speed: "connections.sort.speed",
} as const;

interface Row extends LiveConnection {
    /** Bytes per second since the previous read, both ways. */
    rate: number;
}

interface ConnectionsViewProps {
    connected: boolean;
    rules: RoutingRule[];
    profiles: Profile[];
}

/**
 * What is going through the tunnel right now: every open connection, the
 * program behind it, the routing rule that caught it and the server it went
 * through — the answer to "why is this site going direct?".
 */
function ConnectionsView({ connected, rules, profiles }: ConnectionsViewProps) {
    const t = useT();
    const appLabels = useAppLabels();
    const [rows, setRows] = useState<Row[]>([]);
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<Sort>("recent");
    const [paused, setPaused] = useState(false);
    const previous = useRef(new Map<string, { bytes: number; at: number }>());

    useEffect(() => {
        if (!connected) {
            setRows([]);
            previous.current.clear();
            return;
        }
        if (paused) return;
        let cancelled = false;
        const read = async () => {
            try {
                const list = await invoke<LiveConnection[]>("get_connections");
                if (cancelled) return;
                const now = Date.now();
                const seen = new Map<string, { bytes: number; at: number }>();
                const next = (list ?? []).map((connection) => {
                    const bytes = connection.upload + connection.download;
                    const before = previous.current.get(connection.id);
                    const seconds = before ? (now - before.at) / 1000 : 0;
                    const rate = before && seconds > 0 ? Math.max(0, (bytes - before.bytes) / seconds) : 0;
                    seen.set(connection.id, { bytes, at: now });
                    return { ...connection, rate };
                });
                previous.current = seen;
                setRows(next);
            } catch {
                // A missed read is replaced by the next one.
            }
        };
        void read();
        const timer = window.setInterval(read, POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [connected, paused]);

    const ruleLabel = (id: string, text?: string) => {
        if (id === DEFAULT_RULE) return t("routing.catchAll");
        // An external core's own description, where it maps to no rule.
        if (!id && text) return text;
        if (!id) return t("connections.builtIn");
        const index = rules.findIndex((rule) => rule.id === id);
        if (index < 0) return t("connections.oldRule");
        return `${index + 1}. ${t(kindMeta(rules[index].kind).label)}`;
    };
    const via = (row: Row) => {
        if (row.route === "direct") return t("routing.action.direct");
        return profiles.find((profile) => profile.id === row.server)?.name ?? t("routing.action.proxy");
    };

    const shown = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        const matching = needle
            ? rows.filter((row) =>
                  [row.host, row.destination, row.app, row.protocol, ruleLabel(row.rule, row.rule_text), via(row)]
                      .filter(Boolean)
                      .some((field) => String(field).toLowerCase().includes(needle))
              )
            : rows;
        const sorted = [...matching];
        if (sort === "recent") sorted.sort((a, b) => b.started - a.started);
        if (sort === "traffic") sorted.sort((a, b) => b.upload + b.download - (a.upload + a.download));
        if (sort === "speed") sorted.sort((a, b) => b.rate - a.rate);
        return sorted;
        // ruleLabel and via only read rules, profiles and t.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, filter, sort, rules, profiles, t]);

    const close = async (id?: string) => {
        try {
            await invoke(id ? "close_connection" : "close_all_connections", id ? { id } : {});
            setRows((current) => (id ? current.filter((row) => row.id !== id) : []));
        } catch (error) {
            toast.error(errorMessage(error), { id: "close-connection" });
        }
    };

    const now = Date.now();
    const totals = rows.reduce(
        (sum, row) => ({ up: sum.up + row.upload, down: sum.down + row.download }),
        { up: 0, down: 0 }
    );

    return (
        <PageShell
            fill
            title={t("connections.title")}
            description={
                connected
                    ? t("connections.summary", { count: rows.length, up: formatBytes(totals.up), down: formatBytes(totals.down) })
                    : t("connections.offline")
            }
            actions={
                connected ? (
                    <>
                        <Button size="sm" variant="ghost" onClick={() => setPaused((value) => !value)}>
                            {t(paused ? "connections.resume" : "connections.pause")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void close()}>
                            <XCircle size={14} className="me-2" aria-hidden="true" />
                            {t("connections.closeAll")}
                        </Button>
                    </>
                ) : null
            }
        >
            {!connected ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t("connections.offlineHint")}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-48 flex-1">
                            <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <Input
                                value={filter}
                                onChange={(event) => setFilter(event.target.value)}
                                placeholder={t("connections.filter")}
                                aria-label={t("connections.filter")}
                                className="h-8 ps-8 text-xs"
                            />
                        </div>
                        <div className="flex rounded-lg bg-muted/60 p-0.5" role="radiogroup" aria-label={t("connections.sort")}>
                            {(["recent", "traffic", "speed"] as const).map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    role="radio"
                                    aria-checked={sort === option}
                                    onClick={() => setSort(option)}
                                    className={cn(
                                        "rounded-md px-2.5 py-1 text-xs transition-colors",
                                        sort === option ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {t(SORT_LABELS[option])}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card/40 custom-scrollbar">
                        {shown.length === 0 ? (
                            <p className="p-6 text-center text-xs text-muted-foreground">
                                {rows.length === 0 ? t("connections.none") : t("connections.noMatch")}
                            </p>
                        ) : (
                            // Below sm the table is laid out as cards: the site on top,
                            // app and rule under it, then the server, with the data
                            // on the right. Five columns left a phone a word per cell.
                            <table className="w-full table-fixed text-xs max-sm:block">
                                <thead className="max-sm:hidden sticky top-0 z-10 bg-card/95 text-start text-[11px] text-muted-foreground backdrop-blur">
                                    <tr>
                                        <th className="w-[30%] px-3 py-2 text-start font-medium">{t("connections.col.site")}</th>
                                        <th className="w-[16%] px-2 py-2 text-start font-medium">{t("connections.col.app")}</th>
                                        <th className="w-[17%] px-2 py-2 text-start font-medium">{t("connections.col.rule")}</th>
                                        <th className="w-[15%] px-2 py-2 text-start font-medium">{t("connections.col.via")}</th>
                                        <th className="w-[16%] px-2 py-2 text-end font-medium">{t("connections.col.traffic")}</th>
                                        <th className="w-10 px-2 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="max-sm:block">
                                    {shown.map((row) => {
                                        const rule = rules.find((item) => item.id === row.rule);
                                        const meta = rule ? kindMeta(rule.kind) : null;
                                        return (
                                            <tr key={row.id} className="group border-t border-border/60 hover:bg-muted/30 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-3 max-sm:py-2 max-sm:first:border-t-0">
                                                <td className="px-3 py-1.5 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-1 max-sm:p-0">
                                                    <span className="block truncate font-medium" title={row.host || row.destination}>
                                                        {row.host || row.destination}
                                                    </span>
                                                    <span className="block truncate font-mono text-[10px] text-muted-foreground" dir="ltr">
                                                        {[row.network, row.protocol, row.host ? row.destination : "", formatDuration(Math.max(0, now - row.started))]
                                                            .filter(Boolean)
                                                            .join(" · ")}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1.5 max-sm:col-start-1 max-sm:row-start-2 max-sm:p-0">
                                                    <span className="block truncate" title={row.app_path}>
                                                        {(row.app && appLabels.get(row.app)) || row.app || <span className="text-muted-foreground">—</span>}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1.5 max-sm:col-start-2 max-sm:row-start-2 max-sm:p-0">
                                                    <span className="flex items-center gap-1.5 truncate">
                                                        {meta ? <meta.icon size={12} style={{ color: meta.accent }} className="shrink-0" aria-hidden="true" /> : null}
                                                        <span className="truncate" title={row.rule_text}>{ruleLabel(row.rule, row.rule_text)}</span>
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1.5 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-3 max-sm:p-0 max-sm:text-muted-foreground">
                                                    <span className={cn("block truncate", row.route === "direct" && "text-muted-foreground")}>{via(row)}</span>
                                                </td>
                                                <td className="px-2 py-1.5 text-end tabular-nums max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1 max-sm:p-0">
                                                    <span className="block text-[11px]">
                                                        <ArrowUp size={10} className="inline" aria-hidden="true" /> {formatBytes(row.upload)}{" "}
                                                        <ArrowDown size={10} className="inline" aria-hidden="true" /> {formatBytes(row.download)}
                                                    </span>
                                                    <span className={cn("block text-[10px]", row.rate > 0 ? "text-foreground" : "text-muted-foreground")}>
                                                        {formatRate(row.rate)}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1.5 text-end max-sm:col-start-3 max-sm:row-start-3 max-sm:p-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => void close(row.id)}
                                                        aria-label={t("connections.close", { name: row.host || row.destination })}
                                                        title={t("connections.closeHint")}
                                                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                                                    >
                                                        <X size={13} aria-hidden="true" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </PageShell>
    );
}

export default ConnectionsView;
