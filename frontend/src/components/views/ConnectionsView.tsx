import { ReactNode, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Search, X, XCircle } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import { kindMeta } from "@/components/routing/nodes";
import { Button } from "@/components/ui/button";
import { Flag } from "@/components/ui/flag";
import { AppIcon } from "@/components/ui/app-icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { rememberProgramPaths, useFileIcons } from "@/lib/app-icons";
import { isSystemProgram, useShowSystem } from "@/lib/system-apps";
import { useAppLabels } from "@/components/routing/app-picker";
import { errorMessage, invoke } from "@/lib/backend";
import { withoutFlagEmoji } from "@/lib/flags";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useRemembered, useScrollMemory } from "@/lib/remember";
import { cn } from "@/lib/utils";
import { LiveConnection, Profile, RoutingRule } from "@/types";
import { usePageVisible } from "@/hooks/use-page-visible";

/** How often the list is read while the screen is open. */
const POLL_MS = 1000;
/** GetConnections' rule for traffic no rule matched; see app.DefaultRuleHits. */
const DEFAULT_RULE = "__default";
/** The group for connections no program could be found for. */
const NO_APP = "\u0000";
/** The group system programs fold into while "Show system" is off. */
const SYSTEM = "\u0001system";
/** How long a closed connection stays in the list, dimmed. */
const RECENT_MS = 30_000;

type SortKey = "name" | "count" | "down" | "up" | "rate";

interface Row extends LiveConnection {
    /** Bytes per second since the previous read, both ways. */
    rate: number;
    /** When it closed, for one kept a while after; see RECENT_MS. */
    closedAt?: number;
}

interface AppGroup {
    key: string;
    rows: Row[];
    /** Rows still open; the rest closed a moment ago. */
    open: number;
    down: number;
    up: number;
    rate: number;
}

interface ConnectionsViewProps {
    connected: boolean;
    rules: RoutingRule[];
    profiles: Profile[];
}

/**
 * What is going through the tunnel right now, by program: how many
 * connections each has open, through which server, caught by which rule, and
 * how much it moved. A program opens on its own list of hosts — the answer to
 * "why is this site going direct?" one level down.
 */
function ConnectionsView({ connected, rules, profiles }: ConnectionsViewProps) {
    const t = useT();
    const appLabels = useAppLabels();
    // The last list is kept between visits (see live below), so arriving on
    // Connections shows it at once instead of an empty list that fills in,
    // and animates, a moment later.
    const [rows, setRows] = useState<Row[]>(() => (connected ? live.rows : []));
    // Remembered across tabs, like the rest of the app's places.
    const [openApp, setOpenApp] = useRemembered<string | null>("connections.app", null);
    const [filter, setFilter] = useRemembered("connections.filter", "");
    const [sort, setSort] = useRemembered<{ key: SortKey; descending: boolean }>("connections.sort", { key: "down", descending: true });
    const [paused, setPaused] = useState(false);
    const visible = usePageVisible();
    const { previous, lastOpen, recent, dismissed } = live;
    const [showSystem, setShowSystem] = useShowSystem();
    // The rows rise in when a list is opened, and then stay still: re-sorting
    // moves rows, and a moved element replays its entrance. Keyed by the list
    // shown, so opening another one animates in the same render rather than a
    // render later, which played the entrance twice.
    const listKey = openApp ?? "apps";
    const [settledKey, setSettledKey] = useState<string | null>(null);
    const settled = settledKey === listKey;
    useEffect(() => {
        const timer = window.setTimeout(() => setSettledKey(listKey), 900);
        return () => window.clearTimeout(timer);
    }, [listKey]);
    const scrollRef = useScrollMemory(`connections.${openApp ?? "apps"}`);

    useEffect(() => {
        if (!connected) {
            setRows([]);
            live.clear();
            return;
        }
        if (paused || !visible) return;
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
                for (const [id, row] of lastOpen.current) {
                    if (!seen.has(id) && !dismissed.current.has(id)) recent.current.set(id, { ...row, rate: 0, closedAt: now });
                }
                for (const [id, row] of recent.current) {
                    if (seen.has(id) || now - (row.closedAt ?? 0) > RECENT_MS) recent.current.delete(id);
                }
                lastOpen.current = new Map(next.map((row) => [row.id, row]));
                live.rows = [...next, ...recent.current.values()];
                rememberProgramPaths(next);
                setRows(live.rows);
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
        // live is module state, not a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected, paused, visible]);

    const appName = (key: string) =>
        key === SYSTEM ? t("connections.system") : key === NO_APP ? t("stats.unknownApp") : appLabels.get(key) || key.replace(/\.exe$/i, "");
    const ruleLabel = (id: string, text?: string) => {
        if (id === DEFAULT_RULE) return t("routing.catchAll");
        // An external core's own description, where it maps to no rule.
        if (!id && text) return text;
        if (!id) return t("connections.builtIn");
        const index = rules.findIndex((rule) => rule.id === id);
        if (index < 0) return t("connections.oldRule");
        return `${index + 1}. ${t(kindMeta(rules[index].kind).label)}`;
    };
    const viaName = (row: Row) => {
        if (row.route === "direct") return t("routing.action.direct");
        return profiles.find((profile) => profile.id === row.server)?.name ?? t("routing.action.proxy");
    };
    const host = (row: Row) => row.host || row.destination;

    const matches = (row: Row, needle: string) =>
        [row.host, row.destination, row.app, row.protocol, ruleLabel(row.rule, row.rule_text), viaName(row)]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(needle));

    const groups = useMemo(() => {
        const byApp = new Map<string, AppGroup>();
        for (const row of rows) {
            const key = !showSystem && isSystemProgram(row.app, row.app_path) ? SYSTEM : row.app || NO_APP;
            const group = byApp.get(key) ?? { key, rows: [], open: 0, down: 0, up: 0, rate: 0 };
            group.rows.push(row);
            if (!row.closedAt) group.open += 1;
            group.down += row.download;
            group.up += row.upload;
            group.rate += row.rate;
            byApp.set(key, group);
        }
        return [...byApp.values()];
    }, [rows, showSystem]);

    const needle = filter.trim().toLowerCase();
    const direction = sort.descending ? -1 : 1;
    const byKey = <T,>(value: (item: T) => number | string) => (a: T, b: T) => {
        const x = value(a);
        const y = value(b);
        return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * direction;
    };

    // The program list, or the open program's connections.
    const group = openApp !== null ? groups.find((item) => item.key === openApp) : undefined;
    const shownGroups = useMemo(() => {
        // A program matches by its name or by any of its connections.
        const list = needle
            ? groups.filter((item) => appName(item.key).toLowerCase().includes(needle) || item.rows.some((row) => matches(row, needle)))
            : groups;
        const value = (item: AppGroup) =>
            ({ name: appName(item.key), count: item.open, down: item.down, up: item.up, rate: item.rate })[sort.key];
        return [...list].sort(byKey(value));
        // appName, matches and byKey only read t, labels, rules and sort.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groups, needle, sort, rules, profiles, t, appLabels]);
    const shownRows = useMemo(() => {
        if (!group) return [];
        const list = needle ? group.rows.filter((row) => matches(row, needle)) : group.rows;
        const value = (row: Row) =>
            ({ name: host(row), count: -row.started, down: row.download, up: row.upload, rate: row.rate })[sort.key];
        return [...list].sort(byKey(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group, needle, sort, rules, profiles, t]);

    // A program whose connections have all closed has nothing to show.
    useEffect(() => {
        if (openApp !== null && rows.length > 0 && !group) setOpenApp(null);
    }, [openApp, rows.length, group, setOpenApp]);

    const close = async (ids?: string[]) => {
        try {
            if (ids) await Promise.all(ids.map((id) => invoke("close_connection", { id })));
            else await invoke("close_all_connections", {});
            const gone = ids ?? rows.map((row) => row.id);
            gone.forEach((id) => {
                dismissed.current.add(id);
                recent.current.delete(id);
            });
            setRows((current) => (ids ? current.filter((row) => !ids.includes(row.id)) : []));
        } catch (error) {
            toast.error(errorMessage(error), { id: "close-connection" });
        }
    };

    const openRows = rows.filter((row) => !row.closedAt);
    const totals = openRows.reduce((sum, row) => ({ up: sum.up + row.upload, down: sum.down + row.download }), { up: 0, down: 0 });
    const icons = useFileIcons(groups.map((item) => (item.key === SYSTEM ? undefined : item.rows[0]?.app_path)));
    const now = Date.now();
    const toggleSort = (key: SortKey) =>
        setSort((current) => (current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "name" }));

    // The routes, rules and networks of a set of connections, each once.
    const distinct = <T,>(items: Row[], pick: (row: Row) => T) => [...new Set(items.map(pick))];
    const viaCell = (items: Row[]) => {
        const names = distinct(items, viaName);
        if (names.length > 1) return <span className="text-muted-foreground">{t("connections.servers", { count: names.length })}</span>;
        const direct = items[0]?.route === "direct";
        return (
            <span className={cn("flex min-w-0 items-center gap-1.5", direct && "text-muted-foreground")}>
                {direct ? null : <Flag name={names[0]} size={14} className="shrink-0" />}
                <span className="truncate">{withoutFlagEmoji(names[0] ?? "")}</span>
            </span>
        );
    };
    const ruleCell = (items: Row[]) => {
        const ids = distinct(items, (row) => `${row.rule}\u0000${row.rule_text ?? ""}`);
        if (ids.length > 1) return <span className="text-muted-foreground">{t("connections.rules", { count: ids.length })}</span>;
        const row = items[0];
        const rule = rules.find((item) => item.id === row.rule);
        const meta = rule ? kindMeta(rule.kind) : null;
        return (
            <span className="flex min-w-0 items-center gap-1.5">
                {meta ? <meta.icon size={12} style={{ color: meta.accent }} className="shrink-0" aria-hidden="true" /> : null}
                <span className="truncate" title={row.rule_text}>{ruleLabel(row.rule, row.rule_text)}</span>
            </span>
        );
    };
    const networkCell = (items: Row[]) => (
        <span className="flex gap-1">
            {distinct(items, (row) => row.network.toLowerCase())
                .sort()
                .map((network) => (
                    <span
                        key={network}
                        className={cn(
                            "rounded px-1.5 py-px font-mono text-[10px] uppercase",
                            network === "udp" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                        )}
                    >
                        {network}
                    </span>
                ))}
        </span>
    );
    const dataCells = (down: number, up: number, rate: number) => (
        <>
            <span className="text-end tabular-nums">
                <span className="block">{formatBytes(down)}</span>
                {/* Always two lines, so a row never changes height as its speed comes and goes. */}
                <span className={cn("block text-[10px]", rate > 0 ? "text-foreground" : "text-muted-foreground")}>{rate > 0 ? formatRate(rate) : "\u00a0"}</span>
            </span>
            <span className="text-end tabular-nums text-muted-foreground">{formatBytes(up)}</span>
        </>
    );

    // One grid for header and rows, so the columns line up. The rule and
    // network columns go on a narrow window; the data stays.
    const columns = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_5rem_4.5rem_2rem] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_5.5rem_5.5rem_4.5rem_2rem] items-center gap-x-3 px-3";
    const header = (first: ReactNode) => (
        <div className={cn(columns, "sticky top-0 z-10 border-b bg-card py-2 text-[11px] text-muted-foreground")}>
            {first}
            <span>{t("connections.col.via")}</span>
            <span className="max-sm:hidden">{t("connections.col.rule")}</span>
            <span className="max-sm:hidden">{t("connections.col.network")}</span>
            <SortButton active={sort.key === "down"} descending={sort.descending} onClick={() => toggleSort("down")} end>
                <ArrowDown size={11} aria-hidden="true" /> {t("connections.col.down")}
            </SortButton>
            <SortButton active={sort.key === "up"} descending={sort.descending} onClick={() => toggleSort("up")} end>
                <ArrowUp size={11} aria-hidden="true" /> {t("connections.col.up")}
            </SortButton>
            <span />
        </div>
    );

    return (
        <PageShell
            fill
            title={t("connections.title")}
            description={
                connected
                    ? t("connections.summary", { count: openRows.length, up: formatBytes(totals.up), down: formatBytes(totals.down) })
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
                        {group ? (
                            <Button size="sm" variant="ghost" className="-ms-2 gap-1.5" onClick={() => setOpenApp(null)}>
                                <ArrowLeft size={14} className="rtl:-scale-x-100" aria-hidden="true" />
                                <span className="max-w-48 truncate font-semibold">{appName(group.key)}</span>
                                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                                    {t("connections.active", { count: group.open })}
                                </span>
                            </Button>
                        ) : null}
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
                        <label className="flex h-8 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Switch checked={showSystem} onCheckedChange={setShowSystem} aria-label={t("connections.showSystem")} />
                            {t("connections.showSystem")}
                        </label>
                        {group ? (
                            <Button size="sm" variant="outline" onClick={() => void close(group.rows.filter((row) => !row.closedAt).map((row) => row.id))}>
                                <XCircle size={14} className="me-2" aria-hidden="true" />
                                {t("connections.closeApp")}
                            </Button>
                        ) : null}
                    </div>

                    {/* clip-path, not just overflow, holds the rounded corners: the
                        sticky header is a layer of its own, and the WebView drew
                        it square over the border at the top. */}
                    <div
                        ref={scrollRef}
                        key={listKey}
                        data-settled={settled || undefined}
                        className="enter-stagger min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card/40 text-xs custom-scrollbar [clip-path:inset(0_round_var(--radius-lg))]"
                    >
                        {group ? (
                            <>
                                {header(
                                    <SortButton active={sort.key === "name"} descending={sort.descending} onClick={() => toggleSort("name")}>
                                        {t("connections.col.site")}
                                    </SortButton>
                                )}
                                {shownRows.length === 0 ? (
                                    <p className="p-6 text-center text-muted-foreground">{t("connections.noMatch")}</p>
                                ) : (
                                    shownRows.map((row) => (
                                        <div
                                            key={row.id}
                                            className={cn(columns, "group border-b border-border/50 py-1.5 transition-opacity last:border-b-0 hover:bg-muted/30", row.closedAt && "opacity-45")}
                                        >
                                            <span className="min-w-0">
                                                <span className="block truncate font-medium" title={host(row)}>{host(row)}</span>
                                                <span className="block truncate font-mono text-[10px] text-muted-foreground" dir="ltr">
                                                    {row.closedAt
                                                        ? t("connections.closed")
                                                        : [
                                                              // In System, which program it is.
                                                              group.key === SYSTEM ? appName(row.app || NO_APP) : "",
                                                              row.protocol,
                                                              row.host ? row.destination : "",
                                                              formatDuration(Math.max(0, now - row.started)),
                                                          ]
                                                              .filter(Boolean)
                                                              .join(" · ")}
                                                </span>
                                            </span>
                                            {viaCell([row])}
                                            <span className="min-w-0 max-sm:hidden">{ruleCell([row])}</span>
                                            <span className="max-sm:hidden">{networkCell([row])}</span>
                                            {dataCells(row.download, row.upload, row.rate)}
                                            <button
                                                type="button"
                                                hidden={!!row.closedAt}
                                                onClick={() => void close([row.id])}
                                                aria-label={t("connections.close", { name: host(row) })}
                                                title={t("connections.closeHint")}
                                                className="justify-self-end rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                                            >
                                                <X size={13} aria-hidden="true" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </>
                        ) : (
                            <>
                                {header(
                                    <SortButton active={sort.key === "name"} descending={sort.descending} onClick={() => toggleSort("name")}>
                                        {t("connections.col.app")}
                                    </SortButton>
                                )}
                                {shownGroups.length === 0 ? (
                                    <p className="p-6 text-center text-muted-foreground">
                                        {rows.length === 0 ? t("connections.none") : t("connections.noMatch")}
                                    </p>
                                ) : (
                                    shownGroups.map((item) => (
                                        <button
                                            key={item.key}
                                            type="button"
                                            onClick={() => setOpenApp(item.key)}
                                            className={cn(
                                                columns,
                                                "w-full border-b border-border/50 py-2 text-start transition-opacity last:border-b-0 hover:bg-muted/30",
                                                item.open === 0 && "opacity-45"
                                            )}
                                        >
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-md bg-muted px-1 font-mono text-[10px] tabular-nums">
                                                    {item.open}
                                                </span>
                                                <AppIcon icon={item.key === SYSTEM ? undefined : icons.get(item.rows[0]?.app_path ?? "")} system={item.key === SYSTEM} />
                                                <span className="truncate font-medium" title={item.rows[0]?.app_path}>{appName(item.key)}</span>
                                            </span>
                                            {viaCell(item.rows)}
                                            <span className="min-w-0 max-sm:hidden">{ruleCell(item.rows)}</span>
                                            <span className="max-sm:hidden">{networkCell(item.rows)}</span>
                                            {dataCells(item.down, item.up, item.rate)}
                                            <ChevronRight size={14} className="justify-self-end text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />
                                        </button>
                                    ))
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </PageShell>
    );
}

/**
 * What the screen reads between polls, kept outside the component: leaving
 * Connections and coming back carries on from the same list, speeds and
 * recently closed connections instead of starting over.
 */
const live = {
    rows: [] as Row[],
    previous: { current: new Map<string, { bytes: number; at: number }>() },
    // Connections that closed a moment ago stay, dimmed, instead of the list
    // jumping every second as short ones come and go. One the user closed
    // goes at once.
    lastOpen: { current: new Map<string, Row>() },
    recent: { current: new Map<string, Row>() },
    dismissed: { current: new Set<string>() },
    clear() {
        this.rows = [];
        this.previous.current.clear();
        this.lastOpen.current.clear();
        this.recent.current.clear();
    },
};

/** A column heading that sorts by its column; again reverses. */
function SortButton({
    active,
    descending,
    onClick,
    end,
    children,
}: {
    active: boolean;
    descending: boolean;
    onClick: () => void;
    end?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-sort={active ? (descending ? "descending" : "ascending") : undefined}
            className={cn(
                "flex min-w-0 items-center gap-0.5 font-medium transition-colors hover:text-foreground",
                end && "justify-end",
                active && "text-foreground"
            )}
        >
            {children}
            {active ? <span aria-hidden="true">{descending ? "▾" : "▴"}</span> : null}
        </button>
    );
}

export default ConnectionsView;
