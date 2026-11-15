import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/routing/controls";
import { groupProfiles, serverSelection } from "@/lib/server-selection";
import {
  MouseEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import {
  Activity,
  Check,
  CheckSquare,
  ChevronRight,
  Download,
  Link2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Server,
  Star,
  StarOff,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { Page } from "@/components/Page";
import {
  EmptyState,
  IconButton,
  SearchField,
  Surface,
} from "@/components/Workspace";
import { errorMessage } from "@/lib/backend";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRemembered } from "@/lib/remember";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Flag } from "@/components/ui/flag";
import { withoutFlagEmoji } from "@/lib/flags";
import { Translate, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LOCAL, profileDomain } from "@/hooks/use-profiles";
import { Profile, ProxyMode } from "@/types";
import { EditProxyDialog } from "./EditProxyDialog";
import { ExportDialog } from "./ExportDialog";

interface ProxiesViewProps {
  sourceControl?: ReactNode;
  profiles: Profile[];
  unsupportedProfiles?: Record<string, string>;
  profilePings: Record<string, number | null>;
  selectedSourceDomain: string;
  selectedProxyMode: ProxyMode;
  selectedProfileId: string;
  activeProfileId?: string;
  isRefreshingSource: boolean;
  onSelectProxy: (id: string) => void;
  onSelectAuto: () => void;
  onRefreshSource: () => void;
  /** Measures the given servers, or every server of the list with none. */
  onTest: (ids?: string[]) => Promise<void>;
  onSetFavorite: (ids: string[], favorite: boolean) => Promise<void>;
  onAddToChain: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onUpdateProfile?: (
    id: string,
    name: string,
    link: string,
  ) => Promise<unknown>;
}

type Sort = "list" | "name" | "ping";
const SORT_LABELS = {
  list: "proxies.sort.list",
  name: "proxies.sort.name",
  ping: "proxies.sort.ping",
} as const;

function pingLabel(t: Translate, ping: number | null | undefined): string {
  if (ping === undefined) return "—";
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
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40",
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
    const all = JSON.parse(
      localStorage.getItem(COLLAPSED_KEY) ?? "{}",
    ) as Record<string, string[]>;
    return Array.isArray(all[domain]) ? all[domain] : [];
  } catch {
    return [];
  }
}

function saveCollapsed(domain: string, groups: string[]) {
  try {
    const all = JSON.parse(
      localStorage.getItem(COLLAPSED_KEY) ?? "{}",
    ) as Record<string, string[]>;
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
  children,
}: {
  name: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section>
      <button
        data-page-part="2"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-y border-border/60 bg-muted/35 px-3 py-2 text-start text-xs font-semibold hover:bg-muted/65 sm:px-4"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground rtl:-scale-x-100",
            open && "rotate-90 rtl:rotate-90",
          )}
        />
        <span className="truncate">{name}</span>
        <span className="ms-auto shrink-0 font-normal tabular-nums text-muted-foreground">
          {t("connections.servers", { count })}
        </span>
      </button>
      {open && <div className="divide-y divide-border/50">{children}</div>}
    </section>
  );
}

function ProxiesView({
  sourceControl,
  profiles,
  unsupportedProfiles = {},
  profilePings,
  selectedSourceDomain,
  selectedProxyMode,
  selectedProfileId,
  activeProfileId,
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
  const domain = selectedSourceDomain.trim() || LOCAL;
  const isSubscription = domain !== LOCAL;
  const domainProfiles = useMemo(
    () => profiles.filter((profile) => profileDomain(profile) === domain),
    [profiles, domain],
  );

  // Remembered across tabs with the scroll position, which only means
  // something for the same list.
  const [query, setQuery] = useRemembered("proxies.query", "");
  const [sort, setSort] = useRemembered<Sort>("proxies.sort", "list");
  const [starredOnly, setStarredOnly] = useRemembered("proxies.starred", false);
  const [testing, setTesting] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [exportingProfiles, setExportingProfiles] = useState<Profile[] | null>(
    null,
  );
  const [exportTitle, setExportTitle] = useState("");

  // Multi-select, as on the Configuration screen.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const { best } = serverSelection({
    profiles,
    unsupported: unsupportedProfiles,
    pings: profilePings,
    domain,
    mode: selectedProxyMode,
    profileId: selectedProfileId,
  });

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = domainProfiles.filter(
      (profile) =>
        (!starredOnly || profile.favorite) &&
        (!needle ||
          [
            profile.name,
            profile.description,
            profile.server,
            profile.protocol,
          ].some((field) => (field ?? "").toLowerCase().includes(needle))),
    );
    const pingOf = (profile: Profile) => {
      const ping = profilePings[profile.id];
      return ping === null || ping === undefined
        ? Number.POSITIVE_INFINITY
        : ping;
    };
    const order = new Map(
      domainProfiles.map((profile, index) => [profile.id, index]),
    );
    return [...list].sort((a, b) => {
      // Starred servers first, whatever the sort.
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "ping")
        return pingOf(a) - pingOf(b) || order.get(a.id)! - order.get(b.id)!;
      return order.get(a.id)! - order.get(b.id)!;
    });
  }, [domainProfiles, query, starredOnly, sort, profilePings]);

  const sections = useMemo(
    () => groupProfiles(shown, domainProfiles),
    [shown, domainProfiles],
  );
  const [collapsed, setCollapsed] = useState<string[]>(() =>
    loadCollapsed(domain),
  );
  useEffect(() => setCollapsed(loadCollapsed(domain)), [domain]);
  const toggleGroup = (name: string) =>
    setCollapsed((current) => {
      const next = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      saveCollapsed(domain, next);
      return next;
    });

  const renderRow = (profile: Profile, index: number) => {
    const ping = profilePings[profile.id];
    const selected =
      selectedProxyMode === "manual" && selectedProfileId === profile.id;
    const active = profile.id === activeProfileId;
    const pressed = selecting ? picked.has(profile.id) : selected;
    const name = withoutFlagEmoji(profile.name) || profile.name;
    return (
      <div
        key={profile.id}
        data-page-part={Math.min(index + 2, 6)}
        className={cn(
          "flex min-w-0 items-center pe-2 transition-colors hover:bg-muted/30",
          pressed && "bg-primary/8 shadow-[inset_2px_0_var(--primary)]",
          selecting && "pe-0",
        )}
      >
        <button
          type="button"
          onClick={(event) => handleCard(profile, event)}
          aria-pressed={pressed}
          disabled={!selecting && !!unsupportedProfiles[profile.id]}
          title={unsupportedProfiles[profile.id]}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-3 sm:px-4"
        >
          {selecting && <Tick checked={pressed} />}
          <Flag name={profile.name} size={28} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold" title={name}>
                {name}
              </span>
              {selected && !selecting && (
                <Check
                  size={13}
                  className="shrink-0 text-primary"
                  aria-label={t("proxies.selected")}
                />
              )}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {unsupportedProfiles[profile.id] ? t("ui.xrayUnsupported") : profile.protocol.toUpperCase()}
              {profile.server && profile.server !== "Auto"
                ? ` · ${profile.server}`
                : ""}
            </span>
            {profile.description && (
              <span
                className="mt-0.5 block line-clamp-2 whitespace-pre-line text-xs leading-snug text-muted-foreground"
                title={profile.description}
              >
                {profile.description}
              </span>
            )}
          </span>
          {active && (
            <span
              className="shrink-0 text-[11px] font-medium text-status-connected"
              title={t("status.connected")}
            >
              <span
                className="inline-block size-1.5 rounded-full bg-current sm:me-1"
                aria-hidden="true"
              />
              <span className="sr-only sm:not-sr-only">
                {t("status.connected")}
              </span>
            </span>
          )}
          <span
            className={cn(
              "w-12 shrink-0 text-end text-xs tabular-nums sm:w-16",
              pingTone(ping),
            )}
          >
            {pingLabel(t, ping)}
          </span>
        </button>
        {!selecting && (
          <div className="flex shrink-0 items-center">
            <IconButton
              label={t(profile.favorite ? "proxies.unstar" : "proxies.star", {
                name: profile.name,
              })}
              aria-pressed={!!profile.favorite}
              className={cn(profile.favorite && "text-status-connecting")}
              onClick={() =>
                void run(() => onSetFavorite([profile.id], !profile.favorite))
              }
            >
              <Star
                size={14}
                className={profile.favorite ? "fill-current" : ""}
                aria-hidden="true"
              />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`${t("nav.more")} · ${name}`}>
                  <MoreHorizontal size={17} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={busy || testing || !!unsupportedProfiles[profile.id]}
                  onClick={() => void run(() => onTest([profile.id]))}
                >
                  <Activity size={14} />
                  {t("proxies.bulk.test")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditingProfile(profile)}>
                  <Pencil size={14} />
                  {t("server.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setExportTitle(profile.name);
                    setExportingProfiles([profile]);
                  }}
                >
                  <Download size={14} />
                  {t("server.export")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
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

  const handleCard = (
    profile: Profile,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const toggle = event.ctrlKey || event.metaKey;
    const range = event.shiftKey;
    if (!selecting && !toggle && !range) {
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
        setPicked(
          (current) => new Set([...current, ...ids.slice(low, high + 1)]),
        );
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
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const pickedIds = [...picked];
  const allPicked =
    shown.length > 0 && shown.every((profile) => picked.has(profile.id));
  const pickedStarred = domainProfiles.filter(
    (profile) => picked.has(profile.id) && profile.favorite,
  ).length;

  const testAll = async () => {
    setTesting(true);
    try {
      await onTest();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Page
      title={t("ui.profilesPage")}
      description={t("connections.servers", { count: domainProfiles.length })}
      actions={sourceControl}
      className="gap-5 p-4 sm:px-8 sm:pt-8"
    >
      {domainProfiles.length > 0 ? (
        <>
          <div data-page-part="1" className="flex flex-wrap items-center gap-2">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={t("ui.serverSearch")}
            />
            <Button
              type="button"
              size="lg"
              variant={starredOnly ? "secondary" : "outline"}
              className="text-[13px]"
              aria-pressed={starredOnly}
              onClick={() => setStarredOnly(!starredOnly)}
            >
              <Star size={14} className={starredOnly ? "fill-current" : ""} />
              {t("proxies.starred")}
            </Button>
            <Select<Sort>
              value={sort}
              onValueChange={(value) => {
                if (value !== null) setSort(value);
              }}
            >
              <SelectTrigger
                aria-label={t("connections.sort")}
                className="h-9! text-[13px]"
              >
                <SelectValue>{t(SORT_LABELS[sort])}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {(["list", "name", "ping"] as const).map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(SORT_LABELS[option])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selecting ? (
              <Button size="lg" className="text-[13px]" variant="ghost" onClick={stopSelecting}>
                <X size={14} />
                {t("common.cancel")}
              </Button>
            ) : (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="text-[13px]"
                  onClick={() => void testAll()}
                  disabled={testing || busy}
                >
                  <Activity
                    size={14}
                    className={cn(testing && "motion-safe:animate-pulse")}
                  />
                  {testing ? t("ui.testing") : t("proxies.testAll")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton className="size-9" label={t("ui.serverActions")}>
                      <MoreHorizontal size={17} />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSelecting(true)}>
                      <CheckSquare size={14} />
                      {t("configuration.bulk.select")}
                    </DropdownMenuItem>
                    {isSubscription && (
                      <DropdownMenuItem
                        disabled={isRefreshingSource}
                        onClick={onRefreshSource}
                      >
                        <RefreshCw size={14} />
                        {t("proxies.refresh")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        setExportTitle(
                          domain === LOCAL ? t("ui.personal") : domain,
                        );
                        setExportingProfiles(domainProfiles);
                      }}
                    >
                      <Download size={14} />
                      {t("logs.export")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>

          <Surface className={cn("bg-card/35", selecting && "mb-2")}>
            <div
              data-page-part="2"
              className={cn(
                "flex items-center justify-between bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground sm:px-4",
                !selecting && "pe-[5.5rem] sm:pe-24",
              )}
            >
              <span>{t("share.servers.unnamed")}</span>
              <span>{t("connection.latency")}</span>
            </div>
            {isSubscription && !selecting && (
              <button
                data-page-part="2"
                type="button"
                aria-pressed={selectedProxyMode === "auto"}
                onClick={onSelectAuto}
                className={cn(
                  "flex w-full items-center gap-3 border-t border-border/60 px-3 py-3 text-start hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4",
                  selectedProxyMode === "auto" &&
                    "bg-primary/8 shadow-[inset_2px_0_var(--primary)]",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Zap size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    {t("proxies.auto")}
                    {selectedProxyMode === "auto" && (
                      <Check
                        size={13}
                        className="shrink-0 text-primary"
                        aria-label={t("proxies.selected")}
                      />
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {best
                      ? t("proxies.fastest", { name: best.name })
                      : t("proxies.autoHint")}
                  </span>
                </span>
              </button>
            )}
            {shown.length > 0 ? (
              <div className="divide-y divide-border/50">
                {sections.map(({ name, profiles }) =>
                  name ? (
                    <ServerGroup
                      key={name}
                      name={name}
                      count={profiles.length}
                      open={!!query.trim() || !collapsed.includes(name)}
                      onToggle={() => toggleGroup(name)}
                    >
                      {profiles.map(renderRow)}
                    </ServerGroup>
                  ) : (
                    <div key="" className="divide-y divide-border/50">
                      {profiles.map(renderRow)}
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {t("proxies.noMatch")}
              </p>
            )}
          </Surface>
        </>
      ) : (
        <Surface data-page-part="1">
          <EmptyState
            icon={Server}
            title={t("ui.serverListEmpty")}
            description={t("configuration.emptyHint")}
          />
        </Surface>
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
                setPicked(
                  allPicked
                    ? new Set()
                    : new Set(shown.map((profile) => profile.id)),
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
              disabled={busy || picked.size === 0}
              onClick={() => void run(() => onTest(pickedIds))}
            >
              <Activity size={14} className="me-1.5" aria-hidden="true" />
              {t("proxies.bulk.test")}
            </Button>
            {pickedStarred < picked.size ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || picked.size === 0}
                onClick={() => void run(() => onSetFavorite(pickedIds, true))}
              >
                <Star size={14} className="me-1.5" aria-hidden="true" />
                {t("proxies.bulk.star")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || picked.size === 0}
                onClick={() => void run(() => onSetFavorite(pickedIds, false))}
              >
                <StarOff size={14} className="me-1.5" aria-hidden="true" />
                {t("proxies.bulk.unstar")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || picked.size === 0 || pickedIds.some((id) => !!unsupportedProfiles[id])}
              onClick={() => void run(() => onAddToChain(pickedIds))}
            >
              <Link2 size={14} className="me-1.5" aria-hidden="true" />
              {t("proxies.bulk.chain")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || picked.size === 0}
              onClick={() => {
                const selected = domainProfiles.filter((p) => picked.has(p.id));
                setExportTitle(
                  t("connections.servers", { count: selected.length }),
                );
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
            <DialogTitle>
              {t("proxies.bulk.deleteTitle", { count: picked.size })}
            </DialogTitle>
            <DialogDescription>
              {t("proxies.bulk.deleteHint")}
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
    </Page>
  );
}

export default ProxiesView;
