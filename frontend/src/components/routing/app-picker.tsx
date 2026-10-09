import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * An installed app; see app.InstalledApp. package is how a rule names it: the
 * package on Android, the program's path on a computer (an .app bundle, an
 * .exe), or on Linux the program a menu entry starts.
 */
export interface InstalledApp {
    package: string;
    label: string;
    system: boolean;
    /** Running now; on a computer, possibly listed only for that reason. */
    running?: boolean;
}

// Loaded once per run: the list does not change while the app is open often
// enough to be worth asking again, and icons are costly to draw.
let appsPromise: Promise<InstalledApp[]> | null = null;
const icons = new Map<string, Promise<string>>();

/** The installed apps; fresh asks again, for what is running now. */
export function loadInstalledApps(fresh = false): Promise<InstalledApp[]> {
    if (!appsPromise || fresh) {
        appsPromise = invoke<InstalledApp[]>("list_installed_apps").then((apps) => apps ?? []).catch(() => {
            appsPromise = null;
            return [];
        });
    }
    return appsPromise;
}

function loadIcon(packageName: string): Promise<string> {
    let icon = icons.get(packageName);
    if (!icon) {
        icon = invoke<string>("get_app_icon", { packageName }).catch(() => "");
        icons.set(packageName, icon);
    }
    return icon;
}

/** An app's icon, loaded when it scrolls into view. */
export function AppIcon({ packageName, size = 28 }: { packageName: string; size?: number }) {
    const [src, setSrc] = useState("");
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        let cancelled = false;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect();
                void loadIcon(packageName).then((icon) => {
                    if (!cancelled) setSrc(icon);
                });
            }
        });
        observer.observe(element);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [packageName]);
    return (
        <span ref={ref} className="grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted" style={{ width: size, height: size }}>
            {src ? <img src={src} alt="" width={size} height={size} /> : null}
        </span>
    );
}

const SELF_PACKAGE = "org.rigbyfoundation.nuggetvpn";
const SELF_LABELS = new Set(["NuggetVPN", "Nugget"]);

/** The names of the apps a rule lists, for showing packages as apps. */
export function useAppLabels(): Map<string, string> {
    const [labels, setLabels] = useState<Map<string, string>>(new Map());
    useEffect(() => {
        void loadInstalledApps().then((apps) =>
            setLabels(
                new Map([
                    // This app is left out of the picker (routing itself makes
                    // no sense) but its own requests still show up by package.
                    [SELF_PACKAGE, "NuggetVPN"],
                    ...apps.map((app): [string, string] => [app.package, app.label]),
                ])
            )
        );
    }, []);
    return labels;
}

/**
 * Choosing apps: the installed apps, searchable, with their icons. Apps that
 * came with the system are left out unless asked for; most of them never
 * touch the network the user cares about. Entries already in the rule that
 * are not in the list (a process name typed in) stay as they are.
 */
export function AppPicker({
    open,
    values,
    onClose,
    onChange,
}: {
    open: boolean;
    values: string[];
    onClose: () => void;
    onChange: (values: string[]) => void;
}) {
    const t = useT();
    const [apps, setApps] = useState<InstalledApp[] | null>(null);
    const [query, setQuery] = useState("");
    const [showSystem, setShowSystem] = useState(false);
    const [chosen, setChosen] = useState<Set<string>>(new Set(values));

    useEffect(() => {
        if (!open) return;
        setChosen(new Set(values));
        setQuery("");
        // Asked again on every opening: the list includes what is running,
        // which changes.
        void loadInstalledApps(true).then(setApps);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return (apps ?? [])
            // Routing this app itself makes no sense.
            .filter((app) => !SELF_LABELS.has(app.label) || chosen.has(app.package))
            .filter((app) => showSystem || !app.system || chosen.has(app.package))
            .filter((app) => !needle || app.label.toLowerCase().includes(needle) || app.package.toLowerCase().includes(needle))
            // Chosen apps first, so what is in the rule is in sight.
            .sort((a, b) => Number(chosen.has(b.package)) - Number(chosen.has(a.package)));
    }, [apps, chosen, query, showSystem]);

    const toggle = (packageName: string) =>
        setChosen((current) => {
            const next = new Set(current);
            if (next.has(packageName)) next.delete(packageName);
            else next.add(packageName);
            return next;
        });

    return (
        <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
            {/* No focus on the search box at first: on a phone that raises
                the keyboard over half the list. */}
            <DialogContent className="flex h-[85vh] flex-col gap-3 p-4 sm:max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>{t("apps.title")}</DialogTitle>
                    <DialogDescription>{t("apps.description")}</DialogDescription>
                </DialogHeader>
                <div className="relative">
                    <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("apps.search")} className="h-9 ps-8" />
                </div>
                <label className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
                    {t("apps.system")}
                    <Switch checked={showSystem} onCheckedChange={setShowSystem} aria-label={t("apps.system")} />
                </label>
                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
                    {apps === null ? (
                        <div className="grid h-full place-items-center">
                            <Loader2 size={18} className="animate-spin text-muted-foreground" aria-hidden="true" />
                        </div>
                    ) : shown.length === 0 ? (
                        <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("apps.none")}</p>
                    ) : (
                        <ul>
                            {shown.map((app) => {
                                const on = chosen.has(app.package);
                                return (
                                    <li key={app.package}>
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={on}
                                            onClick={() => toggle(app.package)}
                                            className={cn(
                                                "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors",
                                                on ? "bg-primary/10" : "hover:bg-muted/50"
                                            )}
                                        >
                                            <AppIcon packageName={app.package} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex min-w-0 items-center gap-1.5">
                                                    <span className="truncate text-sm">{app.label}</span>
                                                    {app.running ? (
                                                        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
                                                            {t("apps.running")}
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <span className="block truncate font-mono text-[10px] text-muted-foreground" dir="ltr" title={app.package}>
                                                    {app.package}
                                                </span>
                                            </span>
                                            <span
                                                className={cn(
                                                    "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                                                    on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                                                )}
                                                aria-hidden="true"
                                            >
                                                {on ? <Check size={12} strokeWidth={3} /> : null}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <DialogFooter className="flex-row gap-2 sm:justify-between">
                    <span className="self-center text-xs text-muted-foreground">{t("apps.chosen", { count: chosen.size })}</span>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            onClick={() => {
                                onChange([...chosen]);
                                onClose();
                            }}
                        >
                            {t("common.save")}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
