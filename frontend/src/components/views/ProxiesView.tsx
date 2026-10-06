import { KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Activity, Check, CheckSquare, Download, Link2, Pencil, RefreshCw, Search, Star, StarOff, Trash2, X, Zap } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import PageShell from "@/components/layout/PageShell";
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

    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<Sort>("list");
    const [starredOnly, setStarredOnly] = useState(false);
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

    const best = domainProfiles.reduce<Profile | null>((winner, profile) => {
        const ping = profilePings[profile.id];
        if (ping === null || ping === undefined) return winner;
        if (!winner) return profile;
        const bestPing = profilePings[winner.id];
        if (bestPing === null || bestPing === undefined) return profile;
        return ping < bestPing ? profile : winner;
    }, null);

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
                                    setExportTitle(domain !== LOCAL ? `${domain}` : "Proxies");
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
                            <div className="p-4 flex items-center justify-between gap-4">
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
                            {shown.map((profile) => {
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
                                        className={cn("group select-none", blocked && !selecting && "opacity-55 hover:border-border")}
                                    >
                                        <div className="p-3.5 flex items-center gap-3">
                                            {selecting ? <Tick checked={isPicked} /> : null}
                                            <Flag name={profile.name} size={34} />
                                            <div className="min-w-0 flex-1 flex flex-col justify-between gap-1.5">
                                                {/* Top row: Name & badge on left, Ping on right */}
                                                <div className="flex items-center justify-between gap-2 min-w-0">
                                                    <div className="font-medium flex items-center gap-2 min-w-0">
                                                        <span className="truncate">{withoutFlagEmoji(profile.name)}</span>
                                                        {blocked ? (
                                                            <Badge variant="outline" title={blocked} className="shrink-0 text-[10px] h-5 px-1.5 font-normal text-muted-foreground">
                                                                {t("core.needsOther")}
                                                            </Badge>
                                                        ) : null}
                                                        {selected && !selecting ? (
                                                            <Badge variant="secondary" className="gap-1 shrink-0 text-[10px] h-5 px-1.5 font-normal">
                                                                <Check size={11} aria-hidden="true" /> {t("proxies.selected")}
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                    <span className={cn("text-xs font-mono tnum shrink-0", pingTone(ping))}>
                                                        {pingLabel(t, ping)}
                                                    </span>
                                                </div>

                                                {/* Bottom row: Server & Protocol on left, Action buttons on right */}
                                                <div className="flex items-center justify-between gap-2 min-w-0">
                                                    <span
                                                        className="text-xs text-muted-foreground font-mono truncate"
                                                        title={`${profile.server} (${profile.protocol})`}
                                                    >
                                                        {profile.server} · {profile.protocol}
                                                    </span>

                                                    {!selecting ? (
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setEditingProfile(profile);
                                                                }}
                                                                aria-label="Edit proxy"
                                                                title="Edit proxy"
                                                                className="rounded p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                                                            >
                                                                <Pencil size={13} aria-hidden="true" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setExportTitle(profile.name);
                                                                    setExportingProfiles([profile]);
                                                                }}
                                                                aria-label="Export proxy"
                                                                title="Export proxy"
                                                                className="rounded p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                                                            >
                                                                <Download size={13} aria-hidden="true" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    void onSetFavorite([profile.id], !profile.favorite);
                                                                }}
                                                                aria-pressed={!!profile.favorite}
                                                                aria-label={t(profile.favorite ? "proxies.unstar" : "proxies.star", { name: profile.name })}
                                                                className={cn(
                                                                    "rounded p-1 transition-colors hover:bg-muted",
                                                                    profile.favorite
                                                                        ? "text-status-connecting"
                                                                        : "text-muted-foreground/70 hover:text-foreground"
                                                                )}
                                                            >
                                                                <Star size={13} className={profile.favorite ? "fill-current" : ""} aria-hidden="true" />
                                                            </button>
                                                        </div>
                                                    ) : profile.favorite ? (
                                                        <Star size={13} className="shrink-0 fill-current text-status-connecting" aria-hidden="true" />
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    </SelectableCard>
                                );
                            })}
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
                                setExportTitle(`${selected.length} Proxies`);
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
