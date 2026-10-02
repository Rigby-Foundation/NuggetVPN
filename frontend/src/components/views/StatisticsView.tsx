import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, AppWindow, ArrowDown, ArrowUp, HeartPulse, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useAppLabels } from "@/components/routing/app-picker";
import { errorMessage, invoke } from "@/lib/backend";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppSettings, AppUsage, HealthSample, Profile, ServerHealth } from "@/types";

interface StatisticsViewProps {
    profiles: Profile[];
    settings: AppSettings;
    onSettingsChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

const PERIODS = [
    { days: 1, label: "stats.today" },
    { days: 7, label: "stats.week" },
    { days: 30, label: "stats.month" },
] as const;

/** A program's file name without the extension Windows adds. */
function programName(program: string): string {
    return program.replace(/\.exe$/i, "");
}

function Section({ icon: Icon, title, action, children }: { icon: typeof HeartPulse; title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border bg-card/60 p-4">
            <header className="mb-3 flex items-center gap-2">
                <Icon size={15} className="text-muted-foreground" aria-hidden="true" />
                <h3 className="flex-1 text-sm font-medium">{title}</h3>
                {action}
            </header>
            {children}
        </section>
    );
}

/** Day by day, download over upload. */
function DayChart({ days }: { days: AppUsage["days"] }) {
    const t = useT();
    const largest = Math.max(1, ...days.map((day) => day.up + day.down));
    return (
        <div className="mb-4 flex h-24 items-end gap-[3px]" role="img" aria-label={t("stats.chart")}>
            {days.map((day) => {
                const total = day.up + day.down;
                return (
                    <div
                        key={day.day}
                        className="group relative flex h-full flex-1 flex-col justify-end"
                        title={`${new Date(day.day + "T12:00:00").toLocaleDateString()} · ↓ ${formatBytes(day.down)} ↑ ${formatBytes(day.up)}`}
                    >
                        <div className="rounded-t-[3px] bg-primary/80" style={{ height: `${(day.down / largest) * 100}%` }} />
                        <div className="bg-primary/35" style={{ height: `${(day.up / largest) * 100}%` }} />
                        {total === 0 ? <div className="h-px bg-border" /> : null}
                    </div>
                );
            })}
        </div>
    );
}

/** The last day of checks: latency as a line, failures as red marks. */
function Timeline({ samples }: { samples: HealthSample[] }) {
    const now = Date.now() / 1000;
    const from = now - 24 * 3600;
    const pings = samples.filter((sample) => sample.kind === "ping" && sample.ms >= 0);
    const highest = Math.max(50, ...pings.map((sample) => sample.ms));
    const x = (at: number) => ((at - from) / (now - from)) * 100;
    const y = (ms: number) => 22 - (ms / highest) * 18;
    const line = pings.map((sample) => `${x(sample.at).toFixed(1)},${y(sample.ms).toFixed(1)}`).join(" ");
    return (
        <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
            <line x1="0" x2="100" y1="23.5" y2="23.5" className="stroke-border" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            {pings.length > 1 ? (
                <polyline points={line} fill="none" className="stroke-primary" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ) : null}
            {samples
                .filter((sample) => sample.ms < 0 || sample.kind === "drop")
                .map((sample, index) => (
                    <line
                        key={index}
                        x1={x(sample.at)}
                        x2={x(sample.at)}
                        y1="2"
                        y2="24"
                        className="stroke-status-error"
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                    />
                ))}
        </svg>
    );
}

/** Apps that get a slice of their own; the rest share "Other". */
const SLICES = 7;

interface Slice {
    key: string;
    label: string;
    size: number;
    color: string;
}

/**
 * Each app's share of the traffic. Hovering a slice or its legend row shows
 * that app in the middle; the list below has the exact numbers.
 */
function ShareChart({ slices, total }: { slices: Slice[]; total: number }) {
    const t = useT();
    const [active, setActive] = useState<string | null>(null);
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    // A sliver of card between slices, so neighbours never run together.
    const gap = slices.length > 1 ? 1.2 : 0;
    let offset = 0;
    const focused = slices.find((slice) => slice.key === active);
    const share = (size: number) => `${size / total >= 0.1 ? Math.round((size / total) * 100) : ((size / total) * 100).toFixed(1)}%`;

    return (
        <div className="mb-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="relative h-36 w-36 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={t("stats.share")}>
                    {slices.map((slice) => {
                        const length = (slice.size / total) * circumference;
                        const dash = Math.max(0.4, length - gap);
                        const start = offset;
                        offset += length;
                        return (
                            <circle
                                key={slice.key}
                                cx="50"
                                cy="50"
                                r={radius}
                                fill="none"
                                stroke={slice.color}
                                strokeWidth={active === slice.key ? 15 : 12}
                                strokeDasharray={`${dash} ${circumference - dash}`}
                                strokeDashoffset={-start}
                                className="cursor-default transition-[stroke-width,opacity] duration-150"
                                opacity={active && active !== slice.key ? 0.35 : 1}
                                onMouseEnter={() => setActive(slice.key)}
                                onMouseLeave={() => setActive(null)}
                            >
                                <title>{`${slice.label} · ${share(slice.size)} · ${formatBytes(slice.size)}`}</title>
                            </circle>
                        );
                    })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                    <span className="tnum text-sm font-semibold">{focused ? share(focused.size) : formatBytes(total)}</span>
                    <span className="w-full truncate text-[11px] text-muted-foreground">
                        {focused ? focused.label : t("stats.total")}
                    </span>
                </div>
            </div>
            <ul className="grid w-full min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {slices.map((slice) => (
                    <li
                        key={slice.key}
                        className={cn(
                            "flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-xs transition-colors",
                            active === slice.key && "bg-muted/60"
                        )}
                        onMouseEnter={() => setActive(slice.key)}
                        onMouseLeave={() => setActive(null)}
                    >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                        <span className="tnum shrink-0 text-muted-foreground">{share(slice.size)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function percent(value: number): string {
    return value < 0 ? "—" : `${Math.round(value * 100)}%`;
}

function StatisticsView({ profiles, settings, onSettingsChange }: StatisticsViewProps) {
    const t = useT();
    // On a phone traffic is counted by package; show the app it belongs to.
    const appLabels = useAppLabels();
    const [days, setDays] = useState(1);
    const [usage, setUsage] = useState<AppUsage | null>(null);
    const [health, setHealth] = useState<Record<string, ServerHealth>>({});
    const [confirmClear, setConfirmClear] = useState(false);
    const appStatsOn = settings.app_stats !== false;
    const healthOn = settings.server_health !== false;

    const load = useCallback(() => {
        invoke<AppUsage>("get_app_usage", { days }).then(setUsage).catch(() => undefined);
        invoke<Record<string, ServerHealth>>("get_server_health").then((value) => setHealth(value ?? {})).catch(() => undefined);
    }, [days]);

    useEffect(() => {
        load();
        const timer = setInterval(load, 10_000);
        return () => clearInterval(timer);
    }, [load]);

    const servers = useMemo(() => {
        const byId = new Map(profiles.map((profile) => [profile.id, profile]));
        return Object.entries(health)
            .filter(([id]) => byId.has(id))
            .map(([id, record]) => ({ profile: byId.get(id)!, record }))
            .sort(
                (a, b) =>
                    Number(b.record.failing) - Number(a.record.failing) ||
                    a.record.uptime_24h - b.record.uptime_24h ||
                    a.profile.name.localeCompare(b.profile.name)
            );
    }, [health, profiles]);

    const programs = usage?.programs ?? [];
    const largest = Math.max(1, ...programs.map((program) => program.up + program.down));
    const total = programs.reduce((sum, program) => ({ up: sum.up + program.up, down: sum.down + program.down }), { up: 0, down: 0 });
    const label = (program: string) => (program ? appLabels.get(program) || programName(program) : t("stats.unknownApp"));
    const ranked = [...programs].sort((a, b) => b.up + b.down - (a.up + a.down));
    const slices: Slice[] = ranked.slice(0, SLICES).map((program, index) => ({
        key: program.program,
        label: label(program.program),
        size: program.up + program.down,
        color: `var(--series-${index + 1})`,
    }));
    const rest = ranked.slice(SLICES).reduce((sum, program) => sum + program.up + program.down, 0);
    if (rest > 0) {
        slices.push({ key: "\u0000other", label: t("stats.other"), size: rest, color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" });
    }

    const clear = async () => {
        setConfirmClear(false);
        try {
            await invoke("clear_statistics");
            load();
        } catch (error) {
            toast.error(errorMessage(error), { id: "stats" });
        }
    };

    return (
        <div className="enter-stagger absolute inset-0 overflow-y-auto px-6 py-5">
            <div className="mx-auto max-w-4xl space-y-4">
                <header className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                        <h2 className="text-base font-semibold">{t("stats.title")}</h2>
                        <p className="text-xs text-muted-foreground">{t("stats.subtitle")}</p>
                    </div>
                    <div className="flex rounded-lg bg-muted/50 p-0.5" role="tablist">
                        {PERIODS.map((period) => (
                            <button
                                key={period.days}
                                type="button"
                                role="tab"
                                aria-selected={days === period.days}
                                onClick={() => setDays(period.days)}
                                className={cn(
                                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                                    days === period.days ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t(period.label)}
                            </button>
                        ))}
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setConfirmClear(true)} aria-label={t("stats.clear")} title={t("stats.clear")}>
                        <Trash2 size={15} aria-hidden="true" />
                    </Button>
                </header>

                <Section
                    icon={AppWindow}
                    title={t("stats.apps")}
                    action={
                        programs.length > 0 ? (
                            <span className="tnum text-[11px] text-muted-foreground">
                                ↓ {formatBytes(total.down)} · ↑ {formatBytes(total.up)}
                            </span>
                        ) : null
                    }
                >
                    {!appStatsOn ? (
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            {t("stats.apps.off")}
                            <Button size="sm" variant="outline" onClick={() => onSettingsChange("app_stats", true)}>
                                {t("stats.turnOn")}
                            </Button>
                        </div>
                    ) : (
                        <>
                            {days > 1 && usage ? <DayChart days={usage.days} /> : null}
                            {programs.length > 0 && total.up + total.down > 0 ? (
                                <ShareChart slices={slices} total={total.up + total.down} />
                            ) : null}
                            {programs.length === 0 ? (
                                <p className="text-xs text-muted-foreground">{t("stats.apps.empty")}</p>
                            ) : (
                                <ul className="space-y-2">
                                    {programs.slice(0, 40).map((program) => {
                                        const size = program.up + program.down;
                                        return (
                                            <li key={program.program} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,12rem)_1fr_auto] sm:gap-y-0">
                                                <span className="truncate font-medium" title={program.program}>
                                                    {label(program.program)}
                                                </span>
                                                <span className="order-last col-span-full h-1.5 overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1">
                                                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(1, (size / largest) * 100)}%` }} />
                                                </span>
                                                <span className="tnum flex gap-3 text-muted-foreground">
                                                    <span className="inline-flex items-center gap-0.5">
                                                        <ArrowDown size={11} aria-hidden="true" />
                                                        {formatBytes(program.down)}
                                                    </span>
                                                    <span className="inline-flex w-20 items-center gap-0.5">
                                                        <ArrowUp size={11} aria-hidden="true" />
                                                        {formatBytes(program.up)}
                                                    </span>
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </>
                    )}
                </Section>

                <Section icon={HeartPulse} title={t("stats.health")}>
                    {!healthOn ? (
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            {t("stats.health.off")}
                            <Button size="sm" variant="outline" onClick={() => onSettingsChange("server_health", true)}>
                                {t("stats.turnOn")}
                            </Button>
                        </div>
                    ) : servers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("stats.health.empty")}</p>
                    ) : (
                        <>
                            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_3.5rem_4rem] sm:grid-cols-[minmax(0,12rem)_1fr_3.5rem_3.5rem_4rem] gap-3 text-[11px] text-muted-foreground">
                                <span>{t("stats.health.server")}</span>
                                <span className="hidden sm:block">{t("stats.health.day")}</span>
                                <span className="text-end">24h</span>
                                <span className="hidden text-end sm:block">7d</span>
                                <span className="text-end">{t("stats.health.latency")}</span>
                            </div>
                            <ul className="space-y-2">
                                {servers.map(({ profile, record }) => (
                                    <li key={profile.id} className="grid grid-cols-[minmax(0,1fr)_3.5rem_4rem] sm:grid-cols-[minmax(0,12rem)_1fr_3.5rem_3.5rem_4rem] items-center gap-x-3 gap-y-1 text-xs sm:gap-y-3">
                                        <span className="flex min-w-0 items-center gap-1.5">
                                            {record.failing ? (
                                                <AlertTriangle size={12} className="shrink-0 text-status-error" aria-label={t("stats.health.failing")} />
                                            ) : null}
                                            <span className="truncate font-medium" title={profile.name}>
                                                {profile.name}
                                            </span>
                                        </span>
                                        <span className="order-last col-span-full sm:order-none sm:col-span-1">
                                            <Timeline samples={record.recent} />
                                        </span>
                                        <span className={cn("tnum text-end", record.uptime_24h >= 0 && record.uptime_24h < 0.9 && "text-status-error")}>
                                            {percent(record.uptime_24h)}
                                        </span>
                                        <span className="tnum hidden text-end text-muted-foreground sm:block">{percent(record.uptime_7d)}</span>
                                        <span className="tnum text-end text-muted-foreground">{record.latency_ms ? `${record.latency_ms} ms` : "—"}</span>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-3 text-[11px] text-muted-foreground">{t("stats.health.hint")}</p>
                        </>
                    )}
                </Section>
            </div>

            {confirmClear ? (
                <Dialog open onOpenChange={(open) => (open ? undefined : setConfirmClear(false))}>
                    <DialogContent className="sm:max-w-sm">
                        <DialogHeader>
                            <DialogTitle>{t("stats.clear.title")}</DialogTitle>
                            <DialogDescription>{t("stats.clear.description")}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button variant="destructive" onClick={() => void clear()}>
                                {t("stats.clear")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    );
}

export default StatisticsView;
