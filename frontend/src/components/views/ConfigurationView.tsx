import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowUpRight,
  Check,
  CheckSquare,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { Page } from "@/components/Page";
import {
  ActionButton,
  EmptyState,
  Glyph,
  IconButton,
  Surface,
} from "@/components/Workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/routing/controls";
import { Flag } from "@/components/ui/flag";
import { errorMessage } from "@/lib/backend";
import { withoutFlagEmoji } from "@/lib/flags";
import { ShareDialog } from "@/components/qr";
import { SubscriptionUsage } from "@/components/subscription-usage";
import { ProviderBanner, ProviderLogo } from "@/components/provider-branding";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  unsupportedProfiles?: Record<string, string>;
  onSelectSource: (source: ConfigSource) => void;
  onOpenSource: (source: ConfigSource) => void;
  onDeleteSources: (sources: ConfigSource[]) => Promise<void>;
  onRefreshSources: (sources: ConfigSource[]) => Promise<void>;
  onCopySources: (sources: ConfigSource[]) => Promise<void>;
  onUpdateSubscriptionUrl?: (
    domain: string,
    newUrl: string,
  ) => Promise<unknown>;
  onUpdateProfile?: (
    id: string,
    name: string,
    configLink: string,
  ) => Promise<unknown>;
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
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40",
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
  unsupportedProfiles = {},
  onSelectSource,
  onOpenSource,
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
  const subscriptions = useMemo(
    () => sources.filter((source) => source.kind === "subscription"),
    [sources],
  );
  const individual = useMemo(
    () => sources.filter((source) => source.kind === "profile"),
    [sources],
  );
  const displayOrder = useMemo(
    () => [...subscriptions, ...individual],
    [subscriptions, individual],
  );
  const detailOf = (source: ConfigSource) =>
    source.kind === "subscription"
      ? t("sources.proxies", { count: source.count })
      : source.detail;
  const isSelected = (source: ConfigSource) =>
    source.kind === "subscription"
      ? selectedSource === source.domain
      : selectedSource === LOCAL && selectedProfileId === source.profileId;

  // Multi-select. "Picked" rather than "selected": selected already means the
  // configuration the app connects with.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [deleting, setDeleting] = useState<ConfigSource[] | null>(null);
  const [sharing, setSharing] = useState<ConfigSource | null>(null);
  const [editingSource, setEditingSource] = useState<ConfigSource | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [exportingProfiles, setExportingProfiles] = useState<Profile[] | null>(
    null,
  );
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

  const pickedSources = useMemo(
    () => sources.filter((source) => picked.has(source.key)),
    [sources, picked],
  );
  const pickedSubscriptions = pickedSources.filter(
    (source) => source.kind === "subscription",
  ).length;
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
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const toggle = event.ctrlKey || event.metaKey;
    const range = event.shiftKey;
    if (!selecting && !toggle && !range) {
      onSelectSource(source);
      return;
    }
    setSelecting(true);

    if (range && anchorRef.current) {
      const keys = displayOrder.map((item) => item.key);
      const from = keys.indexOf(anchorRef.current);
      const to = keys.indexOf(source.key);
      if (from >= 0 && to >= 0) {
        const [low, high] = from < to ? [from, to] : [to, from];
        setPicked(
          (current) => new Set([...current, ...keys.slice(low, high + 1)]),
        );
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
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportSources = (items: ConfigSource[]) => {
    const ids = new Set(items.flatMap(profileIdsOf));
    setExportTitle(
      items.length === 1 ? items[0].label : t("configuration.title"),
    );
    setExportingProfiles(
      (profiles ?? []).filter((profile) => ids.has(profile.id)),
    );
  };

  const editSource = (source: ConfigSource) => {
    if (source.kind === "subscription") {
      setEditingSource(source);
    } else {
      const profile = profiles?.find((item) => item.id === source.profileId);
      if (profile) setEditingProfile(profile);
    }
  };

  const renderMenu = (source: ConfigSource) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("ui.configActions", { name: source.label })}>
          <MoreHorizontal size={17} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => editSource(source)}>
          <Pencil size={14} />
          {source.kind === "subscription"
            ? t("ui.editSubUrl")
            : t("ui.editConfig")}
        </DropdownMenuItem>
        {linkOf(source) && (
          <>
            <DropdownMenuItem
              onClick={() => void run(() => onCopySources([source]))}
            >
              <Copy size={14} />
              {t("configuration.bulk.copy")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSharing(source)}>
              <QrCode size={14} />
              {t("ui.shareQr")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={() => exportSources([source])}>
          <Download size={14} />
          {t("logs.export")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => setDeleting([source])}
        >
          <Trash2 size={14} />
          {t("configuration.bulk.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const headerActions = selecting ? (
    <Button size="sm" variant="ghost" onClick={stopSelecting}>
      <X size={14} />
      {t("common.cancel")}
    </Button>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {sources.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
          <CheckSquare size={14} />
          {t("configuration.bulk.select")}
        </Button>
      )}
      <ActionButton onClick={onAdd}>
        <Plus size={16} aria-hidden="true" />
        {t("configuration.add")}
      </ActionButton>
    </div>
  );

  return (
    <Page
      title={t("configuration.title")}
      description={t("configuration.description")}
      actions={headerActions}
      className="gap-6 p-4 sm:px-8 sm:pt-8"
    >
      {sources.length === 0 && (
        <Surface data-page-part="1">
          <EmptyState
            icon={Link2}
            title={t("configuration.emptyTitle")}
            description={t("configuration.emptyHint")}
          >
            <Button onClick={onAdd}>
              <Plus size={16} />
              {t("configuration.emptyButton")}
            </Button>
          </EmptyState>
        </Surface>
      )}

      {subscriptions.length > 0 && (
        <section className="@container space-y-3">
          <div data-page-part="1" className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t("ui.subscriptions")}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {subscriptions.length}
            </span>
          </div>
          <div className="grid gap-3 @min-[600px]:grid-cols-2 @min-[980px]:grid-cols-3">
            {subscriptions.map((source, index) => {
              const active = isSelected(source);
              const checked = picked.has(source.key);
              const refreshing = refreshingSourceDomain === source.domain;
              return (
                <article
                  key={source.key}
                  data-page-part={Math.min(index + 2, 6)}
                  className={cn(
                    "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/45 transition-colors hover:bg-card/65 [&_button]:pointer-events-auto",
                    (selecting ? checked : active) && "border-primary/60",
                  )}
                >
                  <ProviderBanner info={source.info} />
                  <button
                    type="button"
                    aria-label={source.label}
                    aria-pressed={selecting ? checked : active}
                    onClick={(event) => handleCard(source, event)}
                    className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                  <div className="pointer-events-none relative flex min-h-30 flex-1 flex-col gap-3 p-4">
                    <div className="flex items-start gap-2.5">
                      <ProviderLogo
                        info={source.info}
                        className="size-10 rounded-xl"
                        fallback={<Glyph icon={Link2} active={active} />}
                      />
                      <div className="min-w-0 flex-1">
                        <h3
                          className="truncate text-sm font-semibold"
                          title={source.label}
                        >
                          {source.label}
                        </h3>
                        {source.label !== source.domain && (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={source.domain}
                          >
                            {source.domain}
                          </p>
                        )}
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {detailOf(source)}
                        </p>
                      </div>
                      {!selecting && renderMenu(source)}
                    </div>
                    {source.info && <SubscriptionUsage info={source.info} />}
                  </div>
                  <div className="pointer-events-none relative flex flex-wrap items-center gap-2 border-t border-border/60 bg-background/35 px-3 py-2">
                    {selecting ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={checked}
                        onClick={(event) => handleCard(source, event)}
                      >
                        <Tick checked={checked} />
                        {checked
                          ? t("proxies.selected")
                          : t("configuration.bulk.select")}
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenSource(source)}
                        >
                          {t("ui.viewServers")}{" "}
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </Button>
                        {active && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Check size={12} />
                            {t("proxies.selected")}
                          </span>
                        )}
                        <IconButton
                          label={t("configuration.refresh", {
                            name: source.label,
                          })}
                          className="ms-auto"
                          disabled={busy || refreshing}
                          onClick={() =>
                            void run(() => onRefreshSources([source]))
                          }
                        >
                          <RefreshCw
                            size={14}
                            className={cn(
                              refreshing && "motion-safe:animate-spin",
                            )}
                          />
                        </IconButton>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {individual.length > 0 && (
        <section className="space-y-3">
          <div data-page-part="1" className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t("ui.individualConfigs")}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {individual.length}
            </span>
          </div>
          <Surface data-page-stagger className="divide-y divide-border/60 bg-card/35">
            {individual.map((source) => {
              const selected = selecting
                ? picked.has(source.key)
                : isSelected(source);
              const name = withoutFlagEmoji(source.label) || source.label;
              return (
                <div
                  key={source.key}
                  className={cn(
                    "flex min-w-0 items-center pe-2 hover:bg-muted/35",
                    selected &&
                      "bg-primary/8 shadow-[inset_2px_0_var(--primary)]",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={!selecting && !!unsupportedProfiles[source.profileId ?? ""]}
                    title={unsupportedProfiles[source.profileId ?? ""]}
                    onClick={(event) => handleCard(source, event)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-start focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
                  >
                    {selecting && <Tick checked={selected} />}
                    <Flag name={source.label} size={28} />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[13px] font-semibold"
                        title={name}
                      >
                        {name}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <FileCode2 size={12} />
                        {detailOf(source).toUpperCase()}
                      </span>
                    </span>
                    {!selecting &&
                      (selected ? (
                        <Check size={14} aria-label={t("proxies.selected")} />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
                      ))}
                  </button>
                  {!selecting && renderMenu(source)}
                </div>
              );
            })}
          </Surface>
        </section>
      )}

      {selecting ? (
        // The action bar floats over the bottom of the list, so it is
        // in reach however far down the list is scrolled.
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
                setPicked(
                  allPicked
                    ? new Set()
                    : new Set(sources.map((source) => source.key)),
                )
              }
            >
              {t(
                allPicked
                  ? "configuration.bulk.none"
                  : "configuration.bulk.all",
              )}
            </Button>
            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || pickedSubscriptions === 0}
              title={
                pickedSubscriptions === 0
                  ? t("configuration.bulk.refreshNone")
                  : undefined
              }
              onClick={() => void run(() => onRefreshSources(pickedSources))}
            >
              <RefreshCw
                size={14}
                className={cn(
                  "me-1.5",
                  busy && refreshingSourceDomain && "animate-spin",
                )}
                aria-hidden="true"
              />
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
              onClick={() => exportSources(pickedSources)}
            >
              <Download size={14} className="me-1.5" aria-hidden="true" />
              {t("logs.export")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || picked.size === 0}
              onClick={() => setDeleting(pickedSources)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 size={14} className="me-1.5" aria-hidden="true" />
              {t("configuration.bulk.delete")}
            </Button>
          </div>
        </div>
      ) : null}

      {sharing ? (
        <ShareDialog
          title={sharing.label}
          link={linkOf(sharing)}
          profileIds={profileIdsOf(sharing)}
          onClose={() => setSharing(null)}
        />
      ) : null}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("configuration.bulk.deleteTitle", {
                count: deleting?.length ?? 0,
              })}
            </DialogTitle>
            <DialogDescription>
              {deleting
                ?.slice(0, 5)
                .map((source) => source.label)
                .join(", ")}
              {deleting && deleting.length > 5
                ? t("configuration.bulk.andMore", {
                    count: deleting.length - 5,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!deleting) return;
                  await onDeleteSources(deleting);
                  setDeleting(null);
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
    </Page>
  );
}

export default ConfigurationView;
