import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { serverSelection } from "@/lib/server-selection";
import { KeyboardEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Activity, Check, CheckSquare, ChevronRight, Download, Link2, MoreHorizontal, Pencil, RefreshCw, Search, Star, StarOff, Trash2, X, Zap } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import PageShell from "@/components/layout/PageShell";
import { useRemembered } from "@/lib/remember";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Flag } from "@/components/ui/flag";
import SelectableCard from "@/components/ui/selectable-card";
import { useUnsupported } from "@/lib/core-support";
import { withoutFlagEmoji } from "@/lib/flags";
import { Translate, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { Profile, ProxyMode } from "@/types";
import { EditProxyDialog } from "./EditProxyDialog";
import { ExportDialog } from "./ExportDialog";

interface ProxiesViewProps {
    profiles: Profile[];
    profilePings: Record<string, number | null>;
    selectedSourceDomain: string;
    selectedProxyMode: ProxyMode;
    selectedProfileId: string;
    isRefreshingSource: boolean;
    onSelectProxy: (id: string) => void;
    onSelectAuto: () => void;
    onRefreshSource: () => void;
    /** Measures the given servers, or every server of the list with none. */
    onTest: (ids?: string[]) => Promise<void>;
    onSetFavorite: (ids: string[], favorite: boolean) => Promise<void>;
    onAddToChain: (ids: string[]) => Promise<void>;
    onDelete: (ids: string[]) => Promise<void>;
    onUpdateProfile?: (id: string, name: string, link: string) => Promise<unknown>;
}

type Sort = "list" | "name" | "ping";
const SORT_LABELS = { list: "proxies.sort.list", name: "proxies.sort.name", ping: "proxies.sort.ping" } as const;

function pingLabel(t: Translate, ping: number | null | undefined): string {
    if (ping === undefined) return "…";
    if (ping === null) return t("proxies.noPing");
    return t("proxies.ms", { ms: ping });
}

/** Colour the latency so the list can be read without parsing every number. */
function pingTone(ping: number | null | undefined): string {
    if (ping === undefined || ping === null) return "text-muted-foreground";
    if (ping < 120) return "text-status-connected";
    if (ping < 300) return "text-status-connecting";
    return "text-status-error";
}

/** A checkbox drawn to match the cards; the card itself is the control. */
function Tick({ checked }: { checked: boolean }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
            )}
        >
            {checked ? <Check size={12} strokeWidth={3} /> : null}
        </span>
    );
}

const COLLAPSED_KEY = "nugget.servers.collapsed";

/** The groups the user folded, per subscription; kept on this device. */
function loadCollapsed(domain: string): string[] {
    try {
        const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<string, string[]>;
        return Array.isArray(all[domain]) ? all[domain] : [];
    } catch {
        return [];
    }
}

function saveCollapsed(domain: string, groups: string[]) {
    try {
        const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<string, string[]>;
        all[domain] = groups;
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
    } catch {
        // Folded for this run only.
    }
}

/**
 * One of the subscription's sections ("WiFi", "Белый интернет"): a heading
 * that folds and unfolds its servers. The provider marks these with
 * separator entries; they are headings here, never servers.
 */
function ServerGroup({
    name,
    count,
    open,
    onToggle,
    grid,
    children,
}: {
    name: string;
    count: number;
    open: boolean;
    onToggle: () => void;
    grid: boolean;
    children: ReactNode;
}) {
    const t = useT();
    return (
        <section className={cn(grid && "col-span-full")}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="group/heading flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-start text-sm font-semibold transition-colors hover:bg-muted/40"
            >
                <ChevronRight
                    size={15}
                    aria-hidden="true"
                    className={cn("shrink-0 text-muted-foreground transition-transform duration-200 rtl:-scale-x-100", open && "rotate-90 rtl:rotate-90")}
                />
                <span className="truncate">{name}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
                    {t("connections.servers", { count })}
                </span>
                <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
            </button>
            {/* Grid rows animate the height without measuring it. */}
            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="min-h-0 overflow-hidden">
                    <div className={cn("pt-1 pb-2", grid ? "grid gap-2 grid-cols-1 sm:grid-cols-2" : "space-y-2")} inert={!open}>
                        {children}
                    </div>
                </div>
            </div>
        </section>
    );
}

function ProxiesView({
    profiles,
    profilePings,
    selectedSourceDomain,
    selectedProxyMode,
    selectedProfileId,
    isRefreshingSource,
    onSelectProxy,
    onSelectAuto,
    onRefreshSource,
    onTest,
    onSetFavorite,
    onAddToChain,
    onDelete,
    onUpdateProfile,
}: ProxiesViewProps) {
    const t = useT();
    const unsupported = useUnsupported();
    const { prefs } = useAppearance();
    const cardLayout = prefs.layout.proxiesCardLayout;
    const domain = selectedSourceDomain.trim() || LOCAL;
    const isSubscription = domain !== LOCAL;
    const domainProfiles = useMemo(
        () =>
            isSubscription
                ? profiles.filter((profile) => ((profile.source_domain || "").trim() || LOCAL) === domain)
                : [],
        [profiles, domain, isSubscription]
    );

    // Remembered across tabs with the scroll position, which only means
    // something for the same list.
    const [query, setQuery] = useRemembered("proxies.query", "");
    const [sort, setSort] = useRemembered<Sort>("proxies.sort", "list");
    const [starredOnly, setStarredOnly] = useRemembered("proxies.starred", false);
    const [testing, setTesting] = useState(false);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [exportingProfiles, setExportingProfiles] = useState<Profile[] | null>(null);
    const [exportTitle, setExportTitle] = useState("");

    // Multi-select, as on the Configuration screen.
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const anchorRef = useRef<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);

    const { best } = serverSelection({ profiles, pings: profilePings, domain, mode: selectedProxyMode,
        profileId: selectedProfileId, unsupported });

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const list = domainProfiles.filter(
            (profile) =>
                (!starredOnly || profile.favorite) &&
                (!needle ||
                    [profile.name, profile.server, profile.protocol].some((field) =>
                        (field ?? "").toLowerCase().includes(needle)
                    ))
        );
        const pingOf = (profile: Profile) => {
            const ping = profilePings[profile.id];
            return ping === null || ping === undefined ? Number.POSITIVE_INFINITY : ping;
        };
        const order = new Map(domainProfiles.map((profile, index) => [profile.id, index]));
        return [...list].sort((a, b) => {
            // Starred servers first, whatever the sort.
            if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "ping") return pingOf(a) - pingOf(b) || (order.get(a.id)! - order.get(b.id)!);
            return order.get(a.id)! - order.get(b.id)!;
        });
    }, [domainProfiles, query, starredOnly, sort, profilePings]);

    // The subscription's own sections, in its order, each holding its servers
    // as the list sorts them. A list with no sections is one nameless one.
    const sections = useMemo(() => {
        if (!shown.some((profile) => profile.group)) return [{ name: null as string | null, profiles: shown }];
        const order = new Map<string, number>();
        domainProfiles.forEach((profile) => {
            const group = profile.group ?? "";
            if (!order.has(group)) order.set(group, order.size);
        });
        const byGroup = new Map<string, Profile[]>();
        for (const profile of shown) {
            const group = profile.group ?? "";
            byGroup.set(group, [...(byGroup.get(group) ?? []), profile]);
        }
        return [...byGroup.entries()]
            .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
            // Servers listed before the first separator have no heading.
            .map(([group, profiles]) => ({ name: group || null, profiles }));
    }, [shown, domainProfiles]);
    const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsed(domain));
    useEffect(() => setCollapsed(loadCollapsed(domain)), [domain]);
    const toggleGroup = (name: string) =>
        setCollapsed((current) => {
            const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
            saveCollapsed(domain, next);
            return next;
        });

    // One server's card; the list draws it in its group, or on its own.
    const renderCard = (profile: Profile) => {
        const ping = profilePings[profile.id];
        const selected =
            selectedProxyMode === "manual" && selectedProfileId === profile.id;
        const isPicked = picked.has(profile.id);
        const blocked = unsupported[profile.id];
        return (
            <SelectableCard
                key={profile.id}
                selected={selecting ? isPicked : selected}
                onSelect={(event) => handleCard(profile, event)}
                label={`${profile.name}, ${profile.protocol}, ${blocked ?? pingLabel(t, ping)}`}
                className={cn("group select-none", blocked && !selecting && "border-dashed hover:border-border")}
            >
                <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
                    {selecting ? <Tick checked={isPicked} /> : null}
                    <Flag name={profile.name} size={28} />
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <span className="truncate">{withoutFlagEmoji(profile.name)}</span>
                            {selected && !selecting ? <Check size={14} className="shrink-0 text-primary" aria-label={t("proxies.selected")} /> : null}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={blocked || `${profile.server} (${profile.protocol})`}>
                            {blocked ? t("core.needsOther") : `${profile.protocol.toUpperCase()} · ${profile.server}`}
                        </div>
                    </div>
                    <span className={cn("w-16 shrink-0 text-end font-mono text-xs tabular-nums", pingTone(ping))}>{pingLabel(t, ping)}</span>
                    {!selecting ? (
                        <div className="hidden shrink-0 items-center gap-0.5 border-s border-border/60 ps-2 sm:flex">
                            <button type="button" onClick={(event) => { event.stopPropagation(); setEditingProfile(profile); }}
                                aria-label={t("server.edit")} title={t("server.edit")}
                                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                <Pencil size={14} aria-hidden="true" />
                            </button>
                            <button type="button" onClick={(event) => { event.stopPropagation(); setExportTitle(profile.name); setExportingProfiles([profile]); }}
                                aria-label={t("server.export")} title={t("server.export")}
                                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                <Download size={14} aria-hidden="true" />
                            </button>
                            <button type="button" onClick={(event) => { event.stopPropagation(); void onSetFavorite([profile.id], !profile.favorite); }}
                                aria-pressed={!!profile.favorite} aria-label={t(profile.favorite ? "proxies.unstar" : "proxies.star", { name: profile.name })}
                                className={cn("grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-muted", profile.favorite ? "text-status-connecting" : "text-muted-foreground hover:text-foreground")}>
                                <Star size={14} className={profile.favorite ? "fill-current" : ""} aria-hidden="true" />
                            </button>
                        </div>
                    ) : null}
                    {!selecting ? <div className="shrink-0 sm:hidden" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><button type="button" className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`${t("nav.more")} · ${profile.name}`}><MoreHorizontal size={17} /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setEditingProfile(profile)}><Pencil size={14} />{t("server.edit")}</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setExportTitle(profile.name); setExportingProfiles([profile]); }}><Download size={14} />{t("server.export")}</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void onSetFavorite([profile.id], !profile.favorite)}><Star size={14} />{t(profile.favorite ? "proxies.unstar" : "proxies.star", { name: profile.name })}</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div> : null}
                </div>
            </SelectableCard>
        );
    };

    // Leaving the list or its servers disappearing clears the selection.
    useEffect(() => {
        setSelecting(false);
        setPicked(new Set());
    }, [domain]);
    useEffect(() => {
        const ids = new Set(domainProfiles.map((profile) => profile.id));
        setPicked((current) => {
            const next = new Set([...current].filter((id) => ids.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [domainProfiles]);

    const stopSelecting = () => {
        setSelecting(false);
        setPicked(new Set());
        anchorRef.current = null;
    };

    useEffect(() => {
        if (!selecting) return;
        const onKey = (event: globalThis.KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, [role=dialog]")) return;
            if (event.key === "Escape") stopSelecting();
            if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                setPicked(new Set(shown.map((profile) => profile.id)));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selecting, shown]);

    const handleCard = (profile: Profile, event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
        const toggle = event.ctrlKey || event.metaKey;
        const range = event.shiftKey;
        if (!selecting && !toggle && !range) {
            // Picking it would only fail on connect, with this same reason.
            if (unsupported[profile.id]) {
                toast.error(unsupported[profile.id], { id: "unsupported" });
                return;
            }
            onSelectProxy(profile.id);
            return;
        }
        setSelecting(true);
        if (range && anchorRef.current) {
            const ids = shown.map((item) => item.id);
            const from = ids.indexOf(anchorRef.current);
            const to = ids.indexOf(profile.id);
            if (from >= 0 && to >= 0) {
                const [low, high] = from < to ? [from, to] : [to, from];
                setPicked((current) => new Set([...current, ...ids.slice(low, high + 1)]));
                return;
            }
        }
        anchorRef.current = profile.id;
        setPicked((current) => {
            const next = new Set(current);
            if (next.has(profile.id)) next.delete(profile.id);
            else next.add(profile.id);
            return next;
        });
    };

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try {
            await work();
        } finally {
            setBusy(false);
        }
    };
    const pickedIds = [...picked];
    const allPicked = shown.length > 0 && shown.every((profile) => picked.has(profile.id));
    const pickedStarred = domainProfiles.filter((profile) => picked.has(profile.id) && profile.favorite).length;

    const testAll = async () => {
        setTesting(true);
        try {
            await onTest();
        } finally {
            setTesting(false);
        }
    };

    return (
        <PageShell
            memoryKey="proxies"
            title={t("proxies.title")}
            description={
                selecting
                    ? t("configuration.bulk.hint")
                    : isSubscription
                      ? t("proxies.description", { count: domainProfiles.length, domain })
                      : t("proxies.single")
            }
            actions={
                !isSubscription ? null : selecting ? (
                    <Button size="sm" variant="ghost" onClick={stopSelecting}>
                        <X size={14} className="me-2" aria-hidden="true" />
                        {t("common.cancel")}
                    </Button>
                ) : (
                    <>
                        <Button size="sm" variant="ghost" onClick={() => void testAll()} disabled={testing}>
                            <Activity size={14} className={cn("me-2", testing && "animate-pulse")} aria-hidden="true" />
                            {t("proxies.testAll")}
                        </Button>
                        {domainProfiles.length > 1 ? (
                            <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
                                <CheckSquare size={14} className="me-2" aria-hidden="true" />
                                {t("configuration.bulk.select")}
                            </Button>
                        ) : null}
                        {domainProfiles.length > 0 ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setExportTitle(domain !== LOCAL ? `${domain}` : t("proxies.title"));
                                    setExportingProfiles(domainProfiles);
                                }}
                            >
                                <Download size={14} className="me-2" aria-hidden="true" />
                                {t("logs.export")}
                            </Button>
                        ) : null}
                        <Button variant="outline" size="sm" onClick={onRefreshSource} disabled={isRefreshingSource}>
                            <RefreshCw size={14} className={cn("me-2", isRefreshingSource && "animate-spin")} aria-hidden="true" />
                            {isRefreshingSource ? t("proxies.refreshing") : t("proxies.refresh")}
                        </Button>
                    </>
                )
            }
        >
            {isSubscription ? (
                <div className={cn("enter-stagger space-y-2", selecting && "pb-20")}>
                    {!selecting ? (
                        <SelectableCard
                            selected={selectedProxyMode === "auto"}
                            onSelect={onSelectAuto}
                            label={t("proxies.autoLabel")}
                        >
                            <div className="px-3 py-3 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span
                                        className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"
                                        aria-hidden="true"
                                    >
                                        <Zap size={16} className="text-primary" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="font-medium flex items-center gap-2">
                                            {t("proxies.auto")}
                                            {selectedProxyMode === "auto" ? (
                                                <Badge variant="secondary" className="gap-1">
                                                    <Check size={12} aria-hidden="true" /> {t("proxies.selected")}
                                                </Badge>
                                            ) : null}
                                        </span>
                                        <span className="block text-xs text-muted-foreground truncate">
                                            {best ? t("proxies.fastest", { name: best.name }) : t("proxies.autoHint")}
                                        </span>
                                    </span>
                                </div>
                                {best ? (
                                    <span className={cn("text-xs font-mono tnum shrink-0", pingTone(profilePings[best.id]))}>
                                        {pingLabel(t, profilePings[best.id])}
                                    </span>
                                ) : null}
                            </div>
                        </SelectableCard>
                    ) : null}

                    {domainProfiles.length > 3 ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <div className="relative min-w-40 flex-1">
                                <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder={t("proxies.search")}
                                    aria-label={t("proxies.search")}
                                    className="h-8 ps-8 text-xs"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => setStarredOnly((value) => !value)}
                                aria-pressed={starredOnly}
                                className={cn(
                                    "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                                    starredOnly ? "border-primary/60 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Star size={13} className={starredOnly ? "fill-current" : ""} aria-hidden="true" />
                                {t("proxies.starred")}
                            </button>
                            <div className="flex rounded-lg bg-muted/60 p-0.5" role="radiogroup" aria-label={t("connections.sort")}>
                                {(["list", "name", "ping"] as const).map((option) => (
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
                    ) : null}

                    {domainProfiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-8 text-center">{t("proxies.empty")}</p>
                    ) : shown.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-8 text-center">{t("proxies.noMatch")}</p>
                    ) : (
                        <div className={cn("enter-stagger", cardLayout === "grid" ? "grid gap-2 grid-cols-1 sm:grid-cols-2" : "space-y-2")}>
                            {sections.map((section) =>
                                section.name === null ? (
                                    section.profiles.map(renderCard)
                                ) : (
                                    <ServerGroup
                                        key={section.name}
                                        name={section.name}
                                        count={section.profiles.length}
                                        // A search shows what it found, wherever it is.
                                        open={!!query.trim() || !collapsed.includes(section.name)}
                                        onToggle={() => toggleGroup(section.name!)}
                                        grid={cardLayout === "grid"}
                                    >
                                        {section.profiles.map(renderCard)}
                                    </ServerGroup>
                                )
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">{t("proxies.pick")}</p>
            )}

            {selecting ? (
                <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
                    <div
                        role="toolbar"
                        aria-label={t("configuration.bulk.actions")}
                        className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border bg-popover/95 p-1.5 shadow-lg backdrop-blur"
                    >
                        <span className="px-2 text-sm tabular-nums">
                            {t("configuration.bulk.count", { count: picked.size })}
                        </span>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                                setPicked(allPicked ? new Set() : new Set(shown.map((profile) => profile.id)))
                            }
                        >
                            {t(allPicked ? "configuration.bulk.none" : "configuration.bulk.all")}
                        </Button>
                        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                        <Button size="sm" variant="ghost" disabled={busy || picked.size === 0} onClick={() => void run(() => onTest(pickedIds))}>
                            <Activity size={14} className="me-1.5" aria-hidden="true" />
                            {t("proxies.bulk.test")}
                        </Button>
                        {pickedStarred < picked.size ? (
                            <Button size="sm" variant="ghost" disabled={busy || picked.size === 0} onClick={() => void run(() => onSetFavorite(pickedIds, true))}>
                                <Star size={14} className="me-1.5" aria-hidden="true" />
                                {t("proxies.bulk.star")}
                            </Button>
                        ) : (
                            <Button size="sm" variant="ghost" disabled={busy || picked.size === 0} onClick={() => void run(() => onSetFavorite(pickedIds, false))}>
                                <StarOff size={14} className="me-1.5" aria-hidden="true" />
                                {t("proxies.bulk.unstar")}
                            </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy || picked.size === 0} onClick={() => void run(() => onAddToChain(pickedIds))}>
                            <Link2 size={14} className="me-1.5" aria-hidden="true" />
                            {t("proxies.bulk.chain")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || picked.size === 0}
                            onClick={() => {
                                const selected = domainProfiles.filter((p) => picked.has(p.id));
                                setExportTitle(t("connections.servers", { count: selected.length }));
                                setExportingProfiles(selected);
                            }}
                        >
                            <Download size={14} className="me-1.5" aria-hidden="true" />
                            {t("logs.export")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || picked.size === 0}
                            onClick={() => setConfirmDelete(true)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                            <Trash2 size={14} className="me-1.5" aria-hidden="true" />
                            {t("configuration.bulk.delete")}
                        </Button>
                    </div>
                </div>
            ) : null}

            <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t("proxies.bulk.deleteTitle", { count: picked.size })}</DialogTitle>
                        <DialogDescription>{t("proxies.bulk.deleteHint")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    await onDelete(pickedIds);
                                    setConfirmDelete(false);
                                    stopSelecting();
                                })
                            }
                        >
                            {t("configuration.bulk.deleteAction")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {editingProfile ? (
                <EditProxyDialog
                    isOpen={Boolean(editingProfile)}
                    profile={editingProfile}
                    onClose={() => setEditingProfile(null)}
                    onSave={async (id, name, link) => {
                        if (onUpdateProfile) {
                            await onUpdateProfile(id, name, link);
                        }
                    }}
                    onExport={(p) => {
                        setExportTitle(p.name);
                        setExportingProfiles([p]);
                    }}
                />
            ) : null}

            {exportingProfiles ? (
                <ExportDialog
                    isOpen={Boolean(exportingProfiles)}
                    profiles={exportingProfiles}
                    title={exportTitle}
                    onClose={() => setExportingProfiles(null)}
                />
            ) : null}
        </PageShell>
    );
}

export default ProxiesView;
