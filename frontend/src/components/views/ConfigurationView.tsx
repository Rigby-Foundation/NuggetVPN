import { KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckSquare, Copy, Download, Pencil, Plus, QrCode, RefreshCw, Trash2, X } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import PageShell from "@/components/layout/PageShell";
import { ShareDialog } from "@/components/qr";
import { SubscriptionUsage } from "@/components/subscription-usage";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import SelectableCard from "@/components/ui/selectable-card";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { useT } from "@/lib/i18n";
import { ConfigSource, Profile } from "@/types";
import { EditConfigDialog } from "./EditConfigDialog";
import { EditProxyDialog } from "./EditProxyDialog";
import { ExportDialog } from "./ExportDialog";

interface ConfigurationViewProps {
    sources: ConfigSource[];
    selectedSource: string;
    selectedProfileId: string;
    refreshingSourceDomain: string;
    profiles?: Profile[];
    onSelectSource: (source: ConfigSource) => void;
    onDeleteSource: (source: ConfigSource) => void;
    onRefreshSource: (source: ConfigSource) => void;
    onDeleteSources: (sources: ConfigSource[]) => Promise<void>;
    onRefreshSources: (sources: ConfigSource[]) => Promise<void>;
    onCopySources: (sources: ConfigSource[]) => Promise<void>;
    onUpdateSubscriptionUrl?: (domain: string, newUrl: string) => Promise<unknown>;
    onUpdateProfile?: (id: string, name: string, configLink: string) => Promise<unknown>;
    /** The link that adds the same thing elsewhere; "" when there is none. */
    linkOf: (source: ConfigSource) => string;
    /** The profiles a source holds, whose servers can be shared one by one. */
    profileIdsOf: (source: ConfigSource) => string[];
    onAdd: () => void;
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

function ConfigurationView({
    sources,
    selectedSource,
    selectedProfileId,
    refreshingSourceDomain,
    profiles,
    onSelectSource,
    onDeleteSource,
    onRefreshSource,
    onDeleteSources,
    onRefreshSources,
    onCopySources,
    onUpdateSubscriptionUrl,
    onUpdateProfile,
    linkOf,
    profileIdsOf,
    onAdd,
}: ConfigurationViewProps) {
    const t = useT();
    const { prefs } = useAppearance();
    const cardLayout = prefs.layout.configCardLayout;
    const detailOf = (source: ConfigSource) =>
        source.kind === "subscription" ? t("sources.proxies", { count: source.count }) : source.detail;
    const isSelected = (source: ConfigSource) =>
        source.kind === "subscription"
            ? selectedSource === source.domain
            : selectedSource === LOCAL && selectedProfileId === source.profileId;

    // Multi-select. "Picked" rather than "selected": selected already means the
    // configuration the app connects with.
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const anchorRef = useRef<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [sharing, setSharing] = useState<ConfigSource | null>(null);
    const [editingSource, setEditingSource] = useState<ConfigSource | null>(null);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [exportingProfiles, setExportingProfiles] = useState<Profile[] | null>(null);
    const [exportTitle, setExportTitle] = useState("");
    const [busy, setBusy] = useState(false);

    // Sources that disappear (deleted, refreshed away) leave the selection.
    useEffect(() => {
        const keys = new Set(sources.map((source) => source.key));
        setPicked((current) => {
            const next = new Set([...current].filter((key) => keys.has(key)));
            return next.size === current.size ? current : next;
        });
    }, [sources]);

    const pickedSources = useMemo(() => sources.filter((source) => picked.has(source.key)), [sources, picked]);
    const pickedSubscriptions = pickedSources.filter((source) => source.kind === "subscription").length;
    const allPicked = sources.length > 0 && picked.size === sources.length;

    const stopSelecting = () => {
        setSelecting(false);
        setPicked(new Set());
        anchorRef.current = null;
    };

    // Escape leaves selection mode, Ctrl+A picks everything.
    useEffect(() => {
        if (!selecting) return;
        const onKey = (event: globalThis.KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, [role=dialog]")) return;
            if (event.key === "Escape") stopSelecting();
            if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                setPicked(new Set(sources.map((source) => source.key)));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selecting, sources]);

    /**
     * A click picks while selecting. Outside selection mode it selects the
     * configuration as always — unless Ctrl/⌘ or Shift is held, which starts
     * selecting, the way a file list does.
     */
    const handleCard = (
        source: ConfigSource,
        event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>
    ) => {
        const toggle = event.ctrlKey || event.metaKey;
        const range = event.shiftKey;
        if (!selecting && !toggle && !range) {
            onSelectSource(source);
            return;
        }
        setSelecting(true);

        if (range && anchorRef.current) {
            const keys = sources.map((item) => item.key);
            const from = keys.indexOf(anchorRef.current);
            const to = keys.indexOf(source.key);
            if (from >= 0 && to >= 0) {
                const [low, high] = from < to ? [from, to] : [to, from];
                setPicked((current) => new Set([...current, ...keys.slice(low, high + 1)]));
                return;
            }
        }
        anchorRef.current = source.key;
        setPicked((current) => {
            const next = new Set(current);
            if (next.has(source.key)) next.delete(source.key);
            else next.add(source.key);
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

    const headerActions =
        sources.length === 0 ? null : selecting ? (
            <Button size="sm" variant="ghost" onClick={stopSelecting}>
                <X size={14} className="me-2" aria-hidden="true" />
                {t("common.cancel")}
            </Button>
        ) : (
            <>
                {sources.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
                        <CheckSquare size={14} className="me-2" aria-hidden="true" />
                        {t("configuration.bulk.select")}
                    </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={onAdd}>
                    <Plus size={14} className="me-2" aria-hidden="true" />
                    {t("configuration.add")}
                </Button>
            </>
        );

    return (
        <PageShell
            title={t("configuration.title")}
            description={
                selecting ? t("configuration.bulk.hint") : t("configuration.description")
            }
            actions={headerActions}
        >
            {sources.length === 0 ? (
                <div className="rounded-lg border border-dashed py-14 px-6 text-center">
                    <p className="text-sm font-medium">{t("configuration.emptyTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                        {t("configuration.emptyHint")}
                    </p>
                    <Button onClick={onAdd}>
                        <Plus size={16} className="me-2" aria-hidden="true" />
                        {t("configuration.emptyButton")}
                    </Button>
                </div>
            ) : (
                <div className={cn("enter-stagger", cardLayout === "grid" ? "grid gap-2.5 grid-cols-1 sm:grid-cols-2" : "space-y-2", selecting && "pb-20")}>
                    {sources.map((source) => {
                        const domain =
                            source.kind === "subscription"
                                ? (source.domain || "").trim() || LOCAL
                                : LOCAL;
                        const refreshing =
                            source.kind === "subscription" &&
                            refreshingSourceDomain === domain;
                        const isPicked = picked.has(source.key);

                        return (
                            <SelectableCard
                                key={source.key}
                                selected={selecting ? isPicked : isSelected(source)}
                                onSelect={(event) => handleCard(source, event)}
                                label={`${source.label}, ${detailOf(source)}`}
                                className="group select-none"
                            >
                                {/* Usage wraps onto a row of its own, the card's full width:
                                    beside the buttons it had a phone's width to share. */}
                                <div className="p-4 flex flex-wrap items-center gap-x-3">
                                    {selecting ? <Tick checked={isPicked} /> : null}
                                    <span className="flex-1 min-w-0">
                                        <span className="block font-medium truncate">
                                            {source.label}
                                        </span>
                                        <span className="block text-xs text-muted-foreground font-mono mt-0.5 truncate">
                                            {source.kind === "subscription" && source.label !== source.domain
                                                ? `${source.domain} · ${detailOf(source)}`
                                                : detailOf(source)}
                                        </span>
                                    </span>

                                    {refreshing && selecting ? (
                                        <RefreshCw size={16} className="shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                                    ) : null}

                                    {!selecting && linkOf(source) ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t("share.button", { name: source.label })}
                                            title={t("share.button", { name: source.label })}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setSharing(source);
                                            }}
                                            className="shrink-0"
                                        >
                                            <QrCode size={16} aria-hidden="true" />
                                        </Button>
                                    ) : null}

                                    {!selecting ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Edit configuration"
                                            title="Edit configuration"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (source.kind === "profile") {
                                                    const p = (profiles || []).find((item) => item.id === source.profileId);
                                                    if (p) {
                                                        setEditingProfile(p);
                                                        return;
                                                    }
                                                }
                                                setEditingSource(source);
                                            }}
                                            className="shrink-0"
                                        >
                                            <Pencil size={16} aria-hidden="true" />
                                        </Button>
                                    ) : null}

                                    {!selecting ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Export configuration"
                                            title="Export configuration"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                const pIds = new Set(profileIdsOf(source));
                                                const pList = (profiles || []).filter((p) => pIds.has(p.id));
                                                setExportTitle(source.label);
                                                setExportingProfiles(pList);
                                            }}
                                            className="shrink-0"
                                        >
                                            <Download size={16} aria-hidden="true" />
                                        </Button>
                                    ) : null}

                                    {!selecting && source.kind === "subscription" ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t("configuration.refresh", { name: source.label })}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onRefreshSource(source);
                                            }}
                                            disabled={refreshing}
                                            className="shrink-0"
                                        >
                                            <RefreshCw
                                                size={16}
                                                className={cn(refreshing && "animate-spin")}
                                                aria-hidden="true"
                                            />
                                        </Button>
                                    ) : null}

                                    {!selecting ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t("configuration.delete", { name: source.label })}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDeleteSource(source);
                                            }}
                                            className="shrink-0 hover:text-destructive hover:bg-destructive/10"
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </Button>
                                    ) : null}

                                    {source.kind === "subscription" && source.info ? (
                                        <span className="block basis-full">
                                            <SubscriptionUsage info={source.info} />
                                        </span>
                                    ) : null}
                                </div>
                            </SelectableCard>
                        );
                    })}
                </div>
            )}

            {selecting ? (
                // The action bar floats over the bottom of the list, so it is
                // in reach however far down the list is scrolled.
                <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
                    <div
                        role="toolbar"
                        aria-label={t("configuration.bulk.actions")}
                        className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/95 p-1.5 shadow-lg backdrop-blur"
                    >
                        <span className="px-2 text-sm tabular-nums">
                            {t("configuration.bulk.count", { count: picked.size })}
                        </span>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                                setPicked(allPicked ? new Set() : new Set(sources.map((source) => source.key)))
                            }
                        >
                            {t(allPicked ? "configuration.bulk.none" : "configuration.bulk.all")}
                        </Button>
                        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || pickedSubscriptions === 0}
                            title={pickedSubscriptions === 0 ? t("configuration.bulk.refreshNone") : undefined}
                            onClick={() => void run(() => onRefreshSources(pickedSources))}
                        >
                            <RefreshCw size={14} className={cn("me-1.5", busy && refreshingSourceDomain && "animate-spin")} aria-hidden="true" />
                            {t("configuration.bulk.refresh")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || picked.size === 0}
                            onClick={() => void run(() => onCopySources(pickedSources))}
                        >
                            <Copy size={14} className="me-1.5" aria-hidden="true" />
                            {t("configuration.bulk.copy")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || picked.size === 0}
                            onClick={() => {
                                const allIds = new Set(pickedSources.flatMap((s) => profileIdsOf(s)));
                                const pList = (profiles || []).filter((p) => allIds.has(p.id));
                                setExportTitle(
                                    pickedSources.length === 1
                                        ? pickedSources[0].label
                                        : `${pickedSources.length} Configurations (${pList.length} proxies)`
                                );
                                setExportingProfiles(pList);
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

            {sharing ? (
                <ShareDialog title={sharing.label} link={linkOf(sharing)} profileIds={profileIdsOf(sharing)} onClose={() => setSharing(null)} />
            ) : null}

            <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t("configuration.bulk.deleteTitle", { count: pickedSources.length })}</DialogTitle>
                        <DialogDescription>
                            {pickedSources.slice(0, 5).map((source) => source.label).join(", ")}
                            {pickedSources.length > 5
                                ? t("configuration.bulk.andMore", { count: pickedSources.length - 5 })
                                : ""}
                        </DialogDescription>
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
                                    await onDeleteSources(pickedSources);
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

            {editingSource ? (
                <EditConfigDialog
                    isOpen={Boolean(editingSource)}
                    source={editingSource}
                    profiles={profiles || []}
                    onClose={() => setEditingSource(null)}
                    onUpdateSubscriptionUrl={onUpdateSubscriptionUrl}
                    onUpdateProfile={onUpdateProfile}
                    onExport={(pList, title) => {
                        setExportTitle(title);
                        setExportingProfiles(pList);
                    }}
                />
            ) : null}

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

export default ConfigurationView;
