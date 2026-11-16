import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Clock3, Plug, Trash2 } from "lucide-react";
import { useVpn } from "@/app/vpn-context";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ServerLabel } from "@/components/ui/flag";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LOCAL, profileDomain } from "@/hooks/use-profiles";
import { errorMessage, invoke } from "@/lib/backend";
import { formatBytes, formatDuration } from "@/lib/format";
import { useI18n, useT, type MessageKey } from "@/lib/i18n";
import { hasNativeRuntime } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { ConfigSource, Profile } from "@/types";

type Bytes = { up: number; down: number };
type Day = Bytes & { day: string; proxied: Bytes; direct: Bytes; connected_ms: number; sessions: number };
type Analytics = { days: Day[]; servers: Record<string, Bytes>; programs: (Bytes & { program: string })[] };
type Breakdown = Bytes & { id: string; name: string; source?: string };
type Period = "1" | "7" | "30" | "90";
const periods: Record<Period, MessageKey> = {
  "1": "stats.today", "7": "stats.week", "30": "stats.month", "90": "stats.quarter",
};
const total = ({ up, down }: Bytes) => up + down;

function BreakdownTable({ entries, empty, servers }: {
  entries: Breakdown[];
  empty: string;
  servers?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">{empty}</p>;
  return (
    <>
      <table className="w-full table-fixed border-collapse text-start text-sm">
        <thead className="border-b border-border/65 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-start font-medium sm:px-5">{t("stats.name")}</th>
            <th scope="col" className="hidden w-24 px-3 text-end font-medium @min-[550px]:table-cell">{t("stats.received")}</th>
            <th scope="col" className="hidden w-24 px-3 text-end font-medium @min-[550px]:table-cell">{t("stats.sent")}</th>
            <th scope="col" className="w-25 px-4 text-end font-medium sm:px-5">{t("stats.volume")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/45">
          {(expanded ? entries : entries.slice(0, 8)).map((entry) => (
            <tr key={entry.id}>
              <th scope="row" className="px-4 py-2.5 text-start font-medium sm:px-5">
                <div title={entry.name} className="truncate">
                  {servers ? <ServerLabel name={entry.name} /> : entry.name}
                </div>
                {entry.source && <div className="truncate text-xs font-normal text-muted-foreground">{entry.source}</div>}
              </th>
              <td className="hidden px-3 text-end text-muted-foreground tabular-nums @min-[550px]:table-cell">{formatBytes(entry.down)}</td>
              <td className="hidden px-3 text-end text-muted-foreground tabular-nums @min-[550px]:table-cell">{formatBytes(entry.up)}</td>
              <td className="px-4 text-end font-medium whitespace-nowrap tabular-nums sm:px-5">{formatBytes(total(entry))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > 8 && (
        <div className="border-t border-border/60 px-3 py-2 sm:px-4">
          <Button variant="ghost" onClick={() => setExpanded(!expanded)}>
            {t(expanded ? "stats.collapse" : "stats.allEntries", { count: entries.length })}
          </Button>
        </div>
      )}
    </>
  );
}

function groupedEntries(data: Analytics, profiles: Profile[], sources: ConfigSource[], t: ReturnType<typeof useT>) {
  const profileFor = new Map(profiles.map((profile) => [profile.id, profile]));
  const subscriptionFor = new Map(sources.filter((source) => source.kind === "subscription").map((source) => [source.domain, source.label]));
  const servers: Breakdown[] = [];
  const subscriptions = new Map<string, Breakdown>();
  for (const [id, bytes] of Object.entries(data.servers)) {
    const profile = profileFor.get(id);
    const domain = profile && profileDomain(profile);
    const name = domain ? (domain === LOCAL ? t("ui.individualConfigs") : subscriptionFor.get(domain) ?? domain) : t("stats.removedServers");
    servers.push({ id, name: profile?.name || t("stats.removedServers"), source: profile ? name : undefined, ...bytes });
    const key = domain ?? "";
    const group = subscriptions.get(key) ?? { id: key, name, up: 0, down: 0 };
    group.up += bytes.up;
    group.down += bytes.down;
    subscriptions.set(key, group);
  }
  const sort = (a: Breakdown, b: Breakdown) => total(b) - total(a) || a.name.localeCompare(b.name);
  return {
    servers: servers.sort(sort),
    subscriptions: [...subscriptions.values()].sort(sort),
    apps: data.programs.map((row) => ({
      id: row.program, name: row.program || t("stats.unknownApp"), up: row.up, down: row.down,
    })),
  };
}

function TrafficTimeline({ days, statistics }: { days: Day[]; statistics: ReturnType<typeof summarize> }) {
  const { t, language } = useI18n();
  const [selected, setSelected] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const chosen = days.find((day) => day.day === selected) ?? days.at(-1);
  const active = days.find((day) => day.day === focused) ?? chosen;
  const peak = Math.max(1000, ...days.map((day) => Math.max(day.up, day.down)));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const maxBytes = (peak <= 2 * magnitude ? 2 : peak <= 5 * magnitude ? 5 : 10) * magnitude;
  const date = (value: string, long = false) => new Intl.DateTimeFormat(language, {
    month: "short", day: "numeric", ...(long ? { weekday: "long" } : {}), timeZone: "UTC",
  }).format(new Date(value));
  const markCount = days.length <= 7 ? days.length : 5;
  const marks = new Set(Array.from({ length: markCount }, (_, index) =>
    Math.round(index * (days.length - 1) / Math.max(1, markCount - 1))));

  return (
    <section data-page-part="1" className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card/45" aria-labelledby="timeline-heading">
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 id="timeline-heading" className="text-sm font-medium text-muted-foreground">{t("stats.chart")}</h2>
            <div className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{formatBytes(total(statistics))}</div>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <ArrowDown className="size-4 text-chart-2" aria-hidden="true" />
              <div><dt className="text-xs text-muted-foreground">{t("stats.received")}</dt><dd className="font-medium tabular-nums">{formatBytes(statistics.down)}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <ArrowUp className="size-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
              <div><dt className="text-xs text-muted-foreground">{t("stats.sent")}</dt><dd className="font-medium tabular-nums">{formatBytes(statistics.up)}</dd></div>
            </div>
          </dl>
        </div>
        {active && (
          <div className="space-y-3" dir="ltr">
            <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-[10px] tabular-nums sm:text-[11px]">
              <div aria-hidden="true" className="relative text-right text-muted-foreground">
                <span className="absolute right-0 top-0 -translate-y-1/2">{formatBytes(maxBytes)}</span>
                <span className="absolute right-0 top-1/2 -translate-y-1/2">{formatBytes(maxBytes / 2)}</span>
                <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
              </div>
              <div className="relative">
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/55" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/55" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border" />
                <div
                  role="radiogroup"
                  aria-labelledby="timeline-heading"
                  className="grid h-35 sm:h-44"
                  style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                  onPointerLeave={() => setFocused(null)}
                  onKeyDown={(event) => {
                    const index = days.findIndex((day) => day.day === chosen?.day);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? days.length - 1
                      : event.key === "ArrowLeft" ? Math.max(0, index - 1)
                      : event.key === "ArrowRight" ? Math.min(days.length - 1, index + 1) : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    setFocused(null);
                    setSelected(days[next].day);
                    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
                  }}
                >
                  {days.map((day) => (
                    <button
                      key={day.day}
                      type="button"
                      role="radio"
                      aria-checked={day.day === chosen?.day}
                      aria-label={t("stats.dayLabel", { day: date(day.day, true), down: formatBytes(day.down), up: formatBytes(day.up) })}
                      tabIndex={day.day === chosen?.day ? 0 : -1}
                      onPointerEnter={(event) => { if (event.pointerType === "mouse") setFocused(day.day); }}
                      onClick={() => setSelected(day.day)}
                      className="relative flex min-w-0 justify-center rounded-sm px-px outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 w-10 max-w-full rounded-sm transition-colors motion-reduce:transition-none sm:w-12", day.day === active.day && "bg-muted/35")} />
                      <span aria-hidden="true" className="relative flex h-full w-full max-w-8 items-end justify-center gap-px sm:max-w-10 sm:gap-1">
                        {total(day) === 0 ? (
                          <span className="h-px w-3 -translate-y-px bg-muted-foreground/45" />
                        ) : (
                          <>
                            <span className="w-1/2 rounded-t-xs bg-chart-2" style={{ height: day.down > 0 ? `max(2px, ${day.down / maxBytes * 100}%)` : 0 }} />
                            <span className="w-1/2 rounded-t-xs bg-teal-700 dark:bg-teal-400" style={{ height: day.up > 0 ? `max(2px, ${day.up / maxBytes * 100}%)` : 0 }} />
                          </>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div aria-hidden="true" className="relative col-start-2 h-4 whitespace-nowrap text-center text-muted-foreground">
                {[...marks].map((index) => (
                  <span
                    key={days[index].day}
                    className="absolute -translate-x-1/2"
                    style={{ left: `${(index + 0.5) / days.length * 100}%` }}
                  >
                    <span className={cn(days.length > 1 && days.length <= 7 && "hidden sm:inline")}>{date(days[index].day)}</span>
                    {days.length > 1 && days.length <= 7 && (
                      <span className="sm:hidden">{new Intl.DateTimeFormat(language, { day: "numeric", timeZone: "UTC" }).format(new Date(days[index].day))}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/35 px-3 py-2 text-xs" dir="auto">
              <span className="font-medium">{date(active.day, true)}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground tabular-nums">
                <span>↓ {formatBytes(active.down)}</span><span>↑ {formatBytes(active.up)}</span>
              </span>
            </div>
          </div>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-7 gap-y-3 border-t border-border/60 bg-background/25 px-4 py-3 text-sm sm:px-6">
        <div className="flex items-center gap-2"><Clock3 className="size-4 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">{t("stats.connectedTime")}</dt><dd className="font-medium tabular-nums">{formatDuration(statistics.connected)}</dd></div>
        <div className="flex items-center gap-2"><Plug className="size-4 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">{t("stats.sessions")}</dt><dd className="font-medium tabular-nums">{statistics.sessions.toLocaleString(language)}</dd></div>
      </dl>
    </section>
  );
}

function summarize(days: Day[]) {
  return days.reduce((sum, day) => ({
    up: sum.up + day.up,
    down: sum.down + day.down,
    direct: sum.direct + total(day.direct),
    proxied: sum.proxied + total(day.proxied),
    connected: sum.connected + day.connected_ms,
    sessions: sum.sessions + day.sessions,
  }), { up: 0, down: 0, direct: 0, proxied: 0, connected: 0, sessions: 0 });
}

function Routes({ statistics }: { statistics: ReturnType<typeof summarize> }) {
  const t = useT();
  const size = total(statistics);
  if (!size) return null;
  const segments = [
    { label: t("routing.action.proxy"), count: statistics.proxied, color: "bg-chart-2" },
    { label: t("routing.action.direct"), count: statistics.direct, color: "bg-teal-700 dark:bg-teal-400" },
    { label: t("stats.unclassified"), count: Math.max(0, size - statistics.proxied - statistics.direct), color: "bg-muted-foreground/60" },
  ];
  return (
    <section data-page-part="2" className="space-y-2.5 px-1" aria-labelledby="analytics-routes">
      <h2 id="analytics-routes" className="text-sm font-semibold">{t("stats.routes")}</h2>
      <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {segments.map(({ label, count, color }) => <span key={label} className={color} style={{ width: `${count / size * 100}%` }} />)}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {segments.filter(({ count }) => count > 0).map(({ label, count, color }) => (
          <li key={label} className="flex items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-xs", color)} aria-hidden="true" />
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{formatBytes(count)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AnalyticsPage() {
  const t = useT();
  const { profiles, sources, settings, patchSettings } = useVpn();
  const [period, setPeriod] = useState<Period>("7");
  const [result, setResult] = useState<{ period: Period; data: Analytics }>();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [revision, setRevision] = useState(0);
  const native = hasNativeRuntime();
  useEffect(() => {
    if (!native || clearing) return;
    let active = true;
    let pending = false;
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const data = await invoke<Analytics>("get_traffic_analytics", { days: Number(period) });
        if (active) { setResult({ period, data }); setError(""); }
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 4_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [period, revision, native, clearing]);
  const data = result?.period === period ? result.data : undefined;
  const clear = async () => {
    setClearing(true);
    try {
      await invoke("clear_statistics");
      setResult(undefined);
      setConfirm(false);
    } catch (cause) {
      setError(errorMessage(cause));
      setConfirm(false);
    } finally {
      setClearing(false);
    }
  };
  const statistics = summarize(data?.days ?? []);
  const entries = data && groupedEntries(data, profiles, sources, t);
  const empty = total(statistics) === 0 && statistics.sessions === 0;
  return (
    <Page
      title={t("stats.analytics")}
      description={t("stats.local")}
      className="@container mx-auto w-full max-w-6xl gap-5 px-4 pb-7 pt-4 sm:px-8 sm:pt-8"
      actions={(
        <div className="flex items-center gap-2">
          <Select<Period> value={period} onValueChange={(value) => { if (value) setPeriod(value); }}>
            <SelectTrigger aria-label={t("stats.period")} className="min-w-28"><SelectValue>{t(periods[period])}</SelectValue></SelectTrigger>
            <SelectContent>
              {(Object.keys(periods) as Period[]).map((key) => <SelectItem key={key} value={key}>{t(periods[key])}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" aria-label={t("stats.clear")} disabled={!native || clearing} onClick={() => setConfirm(true)}><Trash2 aria-hidden="true" /></Button>
        </div>
      )}
    >
      {settings.app_stats === false && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/45 px-4 py-2.5 text-sm">
          <p>{t("stats.paused")}</p>
          <Button size="sm" variant="outline" onClick={() => patchSettings({ app_stats: true })}>{t("stats.turnOn")}</Button>
        </div>
      )}
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 p-3 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("ui.retry")}</Button>
        </div>
      )}
      {data && entries ? (
        <>
          <TrafficTimeline key={period} days={data.days} statistics={statistics} />
          <Routes statistics={statistics} />
          {empty && <p className="px-1 text-sm text-muted-foreground">{t("stats.noTraffic")}</p>}
          <section data-page-part="3" className="overflow-hidden rounded-2xl border border-border/60 bg-card/35" aria-labelledby="analytics-breakdown">
            <Tabs defaultValue="servers" className="gap-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 px-4 py-3 sm:px-5">
                <h2 id="analytics-breakdown" className="text-sm font-semibold">{t("stats.breakdown")}</h2>
                <TabsList aria-labelledby="analytics-breakdown" className="h-auto! max-w-full flex-wrap justify-start">
                  <TabsTrigger className="text-xs" value="servers">{t("stats.servers")}</TabsTrigger>
                  <TabsTrigger className="text-xs" value="subscriptions">{t("ui.subscriptions")}</TabsTrigger>
                  <TabsTrigger className="text-xs" value="apps">{t("stats.programs")}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="servers"><BreakdownTable entries={entries.servers} empty={t("stats.noBreakdown")} servers /></TabsContent>
              <TabsContent value="subscriptions"><BreakdownTable entries={entries.subscriptions} empty={t("stats.noBreakdown")} /></TabsContent>
              <TabsContent value="apps"><BreakdownTable entries={entries.apps} empty={t("stats.noBreakdown")} /></TabsContent>
            </Tabs>
          </section>
        </>
      ) : !error && <p className="px-1 text-sm text-muted-foreground" role="status">{t(native ? "ui.loading" : "ui.nativeAction")}</p>}
      {confirm && (
        <Dialog open onOpenChange={(open) => { if (!open && !clearing) setConfirm(false); }}>
          <DialogContent showCloseButton={!clearing}>
            <DialogHeader>
              <DialogTitle>{t("stats.clear.title")}</DialogTitle>
              <DialogDescription>{t("stats.clearHistory")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={clearing} onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
              <Button variant="destructive" disabled={clearing} onClick={() => void clear()}>{t("stats.clear")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}
