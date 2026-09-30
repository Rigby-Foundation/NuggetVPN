import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppSettings, RoutingSetup, ScheduleEntry } from "@/types";

/** The week as shown: Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const field =
    "h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The routing schedule: which setup is on at which times of the week, and
 * which one outside all of them. The app switches when the schedule's
 * choice changes, so picking a setup by hand holds until the next change.
 */
export function ScheduleDialog({
    settings,
    busy,
    nameOf,
    onClose,
    onSave,
}: {
    settings: AppSettings;
    busy: boolean;
    nameOf: (setup: RoutingSetup | undefined) => string;
    onClose: () => void;
    onSave: (schedule: ScheduleEntry[], fallback: string) => void;
}) {
    const { t, language } = useI18n();
    const setups = settings.routing_setups ?? [];
    const [entries, setEntries] = useState<ScheduleEntry[]>(() => structuredClone(settings.routing_schedule ?? []));
    const [fallback, setFallback] = useState(settings.schedule_fallback ?? "");

    // Short weekday names in the UI's language.
    const dayNames = useMemo(() => {
        const format = new Intl.DateTimeFormat(language, { weekday: "short" });
        // 2026-09-27 was a Sunday.
        return Array.from({ length: 7 }, (_, day) => format.format(new Date(2026, 8, 27 + day)));
    }, [language]);

    const update = (index: number, patch: Partial<ScheduleEntry>) =>
        setEntries((current) => current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));

    const add = () =>
        setEntries((current) => [
            ...current,
            {
                id: `schedule-${Date.now().toString(36)}`,
                setup: setups.find((setup) => setup.id !== settings.active_routing_setup)?.id ?? setups[0]?.id ?? "",
                days: [1, 2, 3, 4, 5],
                start: "09:00",
                end: "18:00",
            },
        ]);

    const valid = entries.every((entry) => entry.setup && entry.days.length > 0 && entry.start && entry.end && entry.start !== entry.end);

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t("schedule.title")}</DialogTitle>
                    <DialogDescription>{t("schedule.description")}</DialogDescription>
                </DialogHeader>

                <div className="max-h-[55vh] space-y-2 overflow-y-auto">
                    {entries.length === 0 ? <p className="py-2 text-xs text-muted-foreground">{t("schedule.empty")}</p> : null}
                    {entries.map((entry, index) => (
                        <div key={entry.id} className="space-y-2 rounded-lg border p-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    className={cn(field, "min-w-0 flex-1")}
                                    value={entry.setup}
                                    onChange={(event) => update(index, { setup: event.target.value })}
                                    aria-label={t("schedule.setup")}
                                >
                                    {setups.map((setup) => (
                                        <option key={setup.id} value={setup.id}>
                                            {nameOf(setup)}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="time"
                                    className={field}
                                    value={entry.start}
                                    onChange={(event) => update(index, { start: event.target.value })}
                                    aria-label={t("schedule.from")}
                                />
                                <span className="text-xs text-muted-foreground">–</span>
                                <input
                                    type="time"
                                    className={field}
                                    value={entry.end}
                                    onChange={(event) => update(index, { end: event.target.value })}
                                    aria-label={t("schedule.until")}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setEntries((current) => current.filter((_, position) => position !== index))}
                                    aria-label={t("schedule.remove")}
                                >
                                    <Trash2 size={13} aria-hidden="true" />
                                </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                                {WEEK.map((day) => {
                                    const on = entry.days.includes(day);
                                    return (
                                        <button
                                            key={day}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() =>
                                                update(index, { days: on ? entry.days.filter((item) => item !== day) : [...entry.days, day] })
                                            }
                                            className={cn(
                                                "h-7 min-w-9 rounded-md px-1.5 text-[11px] font-medium transition-colors",
                                                on ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                                            )}
                                        >
                                            {dayNames[day]}
                                        </button>
                                    );
                                })}
                                {entry.end < entry.start ? (
                                    <span className="ms-1 text-[11px] text-muted-foreground">{t("schedule.overnight")}</span>
                                ) : null}
                            </div>
                        </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add} disabled={setups.length === 0}>
                        <Plus size={13} aria-hidden="true" /> {t("schedule.add")}
                    </Button>
                </div>

                <label className="flex items-center gap-3 text-xs">
                    <span className="min-w-0 flex-1 text-muted-foreground">{t("schedule.otherwise")}</span>
                    <select className={field} value={fallback} onChange={(event) => setFallback(event.target.value)}>
                        <option value="">{t("schedule.leave")}</option>
                        {setups.map((setup) => (
                            <option key={setup.id} value={setup.id}>
                                {nameOf(setup)}
                            </option>
                        ))}
                    </select>
                </label>

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button type="button" disabled={busy || !valid} onClick={() => onSave(entries, fallback)}>
                        {t("common.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
