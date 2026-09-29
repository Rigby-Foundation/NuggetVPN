import { KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckSquare, Copy, Plus, RefreshCw, Trash2, X } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
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
import { ConfigSource } from "@/types";

interface ConfigurationViewProps {
    sources: ConfigSource[];
    selectedSource: string;
    selectedProfileId: string;
    refreshingSourceDomain: string;
    onSelectSource: (source: ConfigSource) => void;
    onDeleteSource: (source: ConfigSource) => void;
    onRefreshSource: (source: ConfigSource) => void;
    onDeleteSources: (sources: ConfigSource[]) => Promise<void>;
    onRefreshSources: (sources: ConfigSource[]) => Promise<void>;
    onCopySources: (sources: ConfigSource[]) => Promise<void>;
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
    onSelectSource,
    onDeleteSource,
    onRefreshSource,
    onDeleteSources,
    onRefreshSources,
    onCopySources,
    onAdd,
}: ConfigurationViewProps) {
    const t = useT();
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
                <div className={cn("enter-stagger space-y-2", selecting && "pb-20")}>
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
                                <div className="p-4 flex items-center gap-3">
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
                                        {source.kind === "subscription" && source.info ? (
                                            <SubscriptionUsage info={source.info} />
                                        ) : null}
                                    </span>

                                    {refreshing && selecting ? (
                                        <RefreshCw size={16} className="shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
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
                            onClick={() => setConfirmDelete(true)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                            <Trash2 size={14} className="me-1.5" aria-hidden="true" />
                            {t("configuration.bulk.delete")}
                        </Button>
                    </div>
                </div>
            ) : null}

            {confirmDelete ? (
                <Dialog open onOpenChange={(open) => (open ? undefined : setConfirmDelete(false))}>
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
            ) : null}
        </PageShell>
    );
}

export default ConfigurationView;
