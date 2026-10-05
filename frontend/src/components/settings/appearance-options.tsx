import { ReactNode, useState } from "react";
import toast from "react-hot-toast";
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Blend,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    Gauge,
    Layout,
    LayoutDashboard,
    LayoutGrid,
    LayoutList,
    Loader2,
    Minus,
    PanelBottom,
    PanelLeft,
    PanelRight,
    PanelTop,
    Plus,
    RotateCcw,
    Server,
    Shield,
    Signal,
    Sparkles,
    Trash2,
    Upload,
    X,
    type LucideIcon,
} from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import { Switch } from "@/components/ui/switch";
import {
    CardLayout,
    CockpitAlign,
    DashboardWidth,
    DEFAULT_LAYOUT,
    effectiveFont,
    fontLabel,
    fontsFor,
    LayoutPrefs,
    MOTIONS,
    NavPosition,
    RADII,
    TelemetryMetric,
    TelemetryPlacement,
    UserFont,
    USER_FONT_PREFIX,
} from "@/lib/appearance";
import { errorMessage, invoke } from "@/lib/backend";
import { MessageKey, scriptOf, useI18n, useT } from "@/lib/i18n";
import { isMobileDevice } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * The sample uses the app's own fallback stack, not the bare family, so it
 * shows what the app would actually render — including the system font
 * standing in where a font lacks glyphs.
 */
const sampleFont = (family: string) => `${family}, ui-sans-serif, system-ui, sans-serif`;

const SPECIMEN_TEXT: Record<string, string> = {
    latin: "Sphinx of black quartz, judge my vow",
    cyrillic: "Съешь же ещё этих мягких французских булок",
    hans: "天地玄黄 宇宙洪荒 鸣琴垂拱",
    jpan: "いろはにほへと ちりぬるを わかよたれそ",
    arab: "نص تجريبي لاختبار جمال الخط العربي",
};

const SCRIPT_NAMES: Record<string, string> = {
    latin: "Latin",
    cyrillic: "Cyrillic",
    hans: "CJK (SC)",
    jpan: "Japanese",
    arab: "Arabic",
};

/**
 * Live Hero Studio Preview
 * Gives users immediate, satisfying visual feedback of their chosen theme,
 * font, corner radius, and mode without needing to navigate away.
 */
export function AppearanceHeroPreview({
    theme,
    setTheme,
}: {
    theme?: string;
    setTheme?: (value: string) => void;
}) {
    const { prefs } = useAppearance();
    const { t, language } = useI18n();
    const script = scriptOf(language);
    const activeFont = effectiveFont(prefs.font, script);
    const radiusEntry = RADII.find((r) => r.id === prefs.radius) ?? RADII[1];

    return (
        <div className="relative overflow-hidden rounded-2xl border bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-all">
            {/* Top Header */}
            <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)] animate-pulse" />
                <span className="text-xs font-semibold text-foreground/80">
                    Live Preview
                </span>
            </div>

            {/* Live Interactive Specimen Stage */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* Visual Specimen Area */}
                <div className="md:col-span-8 space-y-2.5">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">
                            {fontLabel(t, activeFont.id)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">•</span>
                        <span className="text-[11px] text-muted-foreground">
                            Radius: {t(radiusEntry.label)} ({radiusEntry.value})
                        </span>
                    </div>

                    <p
                        className="text-xl md:text-2xl font-semibold tracking-tight text-foreground leading-snug transition-all"
                        style={{ fontFamily: sampleFont(activeFont.family) }}
                    >
                        {SPECIMEN_TEXT[script] ?? SPECIMEN_TEXT.latin}
                    </p>

                    <p
                        className="text-xs text-muted-foreground/80 leading-relaxed"
                        style={{ fontFamily: sampleFont(activeFont.family) }}
                    >
                        ABCDEFGHIJKLMNOPQRSTUVWXYZ • abcdefghijklmnopqrstuvwxyz • 0123456789
                    </p>
                </div>

                {/* Simulated UI Micro-Component */}
                <div className="md:col-span-4 flex flex-col gap-2.5 rounded-xl border bg-muted/30 p-3.5 shadow-inner">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <Shield size={13} className="text-primary" />
                            <span>Protected</span>
                        </span>
                        <span className="font-mono text-[11px]">18 ms</span>
                    </div>

                    <div className="flex items-center justify-between rounded-lg bg-background/80 px-2.5 py-1.5 border text-xs">
                        <span className="font-medium truncate">Zurich #04</span>
                        <span className="text-[10px] text-muted-foreground font-mono">WireGuard</span>
                    </div>

                    <button
                        type="button"
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-opacity hover:opacity-95"
                        style={{ borderRadius: radiusEntry.value }}
                    >
                        <Sparkles size={13} />
                        <span>Interactive Accent</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Modern Typeface Specimen Gallery
 * Replaces the cookie-cutter 3-column pill cards with a spacious,
 * legible specimen grid featuring real typography samples and script badges.
 */
export function FontPicker() {
    const { prefs, setFont, addUserFont, removeUserFont } = useAppearance();
    const { t, language } = useI18n();
    const [adding, setAdding] = useState(false);

    const add = async () => {
        setAdding(true);
        try {
            const font = await invoke<UserFont | null>("import_user_file", { kind: "fonts" });
            if (font) {
                addUserFont(font);
                toast.success(font.name || "Font imported");
            }
        } catch (error) {
            toast.error(errorMessage(error), { id: "add-font" });
        } finally {
            setAdding(false);
        }
    };

    const script = scriptOf(language);
    const current = effectiveFont(prefs.font, script).id;
    const availableFonts = fontsFor(script);
    const specimen = SPECIMEN_TEXT[script] ?? SPECIMEN_TEXT.latin;

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {availableFonts.map((font) => {
                    const userFont = font.id.startsWith(USER_FONT_PREFIX);
                    const active = current === font.id;

                    const badges: string[] = [];
                    if (font.scripts === "all") {
                        badges.push("System Native");
                    } else if (Array.isArray(font.scripts)) {
                        font.scripts.forEach((s) => {
                            if (SCRIPT_NAMES[s]) badges.push(SCRIPT_NAMES[s]);
                        });
                    }

                    return (
                        <div key={font.id} className="group relative">
                            <button
                                type="button"
                                onClick={() => setFont(font.id)}
                                aria-pressed={active}
                                className={cn(
                                    "flex flex-col w-full text-start rounded-xl border p-3.5 transition-all",
                                    active
                                        ? "border-primary bg-primary/[0.04] ring-1 ring-primary shadow-xs"
                                        : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
                                )}
                            >
                                {/* Header: Font name, script tags, active radio */}
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-semibold text-sm truncate">
                                            {fontLabel(t, font.id)}
                                        </span>
                                        {userFont ? (
                                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                                                User
                                            </span>
                                        ) : null}
                                    </div>

                                    {/* Selection dot */}
                                    <div
                                        className={cn(
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all",
                                            active
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-muted-foreground/30 bg-transparent group-hover:border-muted-foreground/60"
                                        )}
                                        aria-hidden="true"
                                    >
                                        {active ? <Check size={10} strokeWidth={3} /> : null}
                                    </div>
                                </div>

                                {/* Script badges */}
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {badges.map((b) => (
                                        <span
                                            key={b}
                                            className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                        >
                                            {b}
                                        </span>
                                    ))}
                                </div>

                                {/* Live Specimen Text */}
                                <div className="mt-3 border-t border-border/40 pt-2.5">
                                    <p
                                        className="text-sm font-medium tracking-normal text-foreground/90 truncate"
                                        style={{ fontFamily: sampleFont(font.family) }}
                                    >
                                        {specimen}
                                    </p>
                                    <p
                                        className="mt-0.5 text-xs text-muted-foreground"
                                        style={{ fontFamily: sampleFont(font.family) }}
                                    >
                                        Aa Bb Gg 123
                                    </p>
                                </div>
                            </button>

                            {userFont ? (
                                <button
                                    type="button"
                                    onClick={() => removeUserFont(font.id.slice(USER_FONT_PREFIX.length))}
                                    aria-label={t("appearance.font.remove", { name: font.label })}
                                    className="absolute end-2 top-2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                                >
                                    <Trash2 size={13} aria-hidden="true" />
                                </button>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {/* Custom Font Import Button */}
            <button
                type="button"
                onClick={() => void add()}
                disabled={adding}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-3 text-center text-xs font-medium text-muted-foreground transition-all hover:border-foreground/40 hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            >
                {adding ? (
                    <Loader2 size={15} className="animate-spin" />
                ) : (
                    <Upload size={15} aria-hidden="true" />
                )}
                <span>{t("appearance.font.add")} (TTF, OTF, WOFF2)</span>
            </button>
        </div>
    );
}

const RADIUS_CURVATURES: Record<string, { desc: string; px: string }> = {
    small: { desc: "Sharp", px: "6px" },
    medium: { desc: "Balanced", px: "10px" },
    large: { desc: "Smooth", px: "14px" },
    round: { desc: "Pill", px: "20px" },
};

/**
 * Modern Segmented Corner Curvature Deck
 * Replaces Beam's 4 giant floating cards with an intuitive,
 * interactive geometry controller.
 */
export function RadiusPicker() {
    const { prefs, setRadius } = useAppearance();
    const t = useT();

    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {RADII.map((radius) => {
                const active = prefs.radius === radius.id;
                const info = RADIUS_CURVATURES[radius.id] ?? { desc: "", px: radius.value };

                return (
                    <button
                        key={radius.id}
                        type="button"
                        onClick={() => setRadius(radius.id)}
                        aria-pressed={active}
                        className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-xl border p-3.5 text-center transition-all",
                            active
                                ? "border-primary bg-primary/[0.05] ring-1 ring-primary shadow-xs"
                                : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
                        )}
                    >
                        {/* Curvature Geometry Icon */}
                        <div
                            className={cn(
                                "flex h-9 w-9 items-center justify-center border-2 transition-all",
                                active
                                    ? "border-primary bg-primary/20 text-primary shadow-xs"
                                    : "border-foreground/30 bg-muted/40 text-muted-foreground"
                            )}
                            style={{ borderRadius: radius.value }}
                            aria-hidden="true"
                        >
                            <span className="text-[10px] font-mono font-bold">{info.px}</span>
                        </div>

                        <div>
                            <span className="block text-xs font-semibold">{t(radius.label)}</span>
                            <span className="block text-[11px] text-muted-foreground">{info.desc}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

const MOTION_ICONS: Record<string, LucideIcon> = {
    slide: ArrowRight,
    rise: ArrowUp,
    fade: Blend,
    none: Minus,
};

/**
 * Modern Segmented Motion Controller
 * Replaces Beam's 4 giant floating motion cards with a cohesive controller.
 */
export function MotionPicker() {
    const { prefs, setMotion } = useAppearance();
    const t = useT();

    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {MOTIONS.map((motion) => {
                const Icon = MOTION_ICONS[motion.id] ?? Minus;
                const active = prefs.motion === motion.id;

                return (
                    <button
                        key={motion.id}
                        type="button"
                        onClick={() => setMotion(motion.id)}
                        aria-pressed={active}
                        className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-xl border p-3.5 text-center transition-all",
                            active
                                ? "border-primary bg-primary/[0.05] ring-1 ring-primary shadow-xs"
                                : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
                        )}
                    >
                        <div
                            className={cn(
                                "grid h-9 w-9 place-items-center rounded-lg border transition-all",
                                active
                                    ? "border-primary bg-primary/20 text-primary shadow-xs"
                                    : "border-border bg-muted/40 text-muted-foreground"
                            )}
                        >
                            <Icon size={17} aria-hidden="true" />
                        </div>

                        <div>
                            <span className="block text-xs font-semibold">{t(motion.label)}</span>
                            <span className="block text-[11px] text-muted-foreground truncate max-w-[110px]">
                                {t(motion.hint)}
                            </span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Interactive Layout Customizer
 * Allows users to configure navigation placement, dashboard alignment,
 * telemetry placement & reordering, width density, and component visibility.
 */
export function LayoutPicker() {
    const { prefs, setLayout, resetLayout } = useAppearance();
    const { t } = useI18n();
    const layout = prefs.layout;

    const navOptions: { id: NavPosition; label: MessageKey; icon: LucideIcon; mockup: "top" | "sidebar-left" | "sidebar-right" | "bottom" }[] = [
        { id: "top", label: "appearance.layout.navPosition.top", icon: PanelTop, mockup: "top" },
        { id: "sidebar-left", label: "appearance.layout.navPosition.sidebarLeft", icon: PanelLeft, mockup: "sidebar-left" },
        { id: "sidebar-right", label: "appearance.layout.navPosition.sidebarRight", icon: PanelRight, mockup: "sidebar-right" },
        { id: "bottom", label: "appearance.layout.navPosition.bottom", icon: PanelBottom, mockup: "bottom" },
    ];

    const cockpitOptions: { id: CockpitAlign; label: MessageKey }[] = [
        { id: "center", label: "appearance.layout.cockpitAlign.center" },
        { id: "top", label: "appearance.layout.cockpitAlign.top" },
    ];

    const telemetryPlacementOptions: { id: TelemetryPlacement; label: MessageKey }[] = [
        { id: "inside", label: "appearance.layout.telemetryPlacement.inside" },
        { id: "below", label: "appearance.layout.telemetryPlacement.below" },
    ];

    const dashboardWidthOptions: { id: DashboardWidth; label: MessageKey }[] = [
        { id: "compact", label: "appearance.layout.dashboardWidth.compact" },
        { id: "normal", label: "appearance.layout.dashboardWidth.normal" },
        { id: "wide", label: "appearance.layout.dashboardWidth.wide" },
    ];

    const cardsDensityOptions: { id: CardLayout; label: MessageKey }[] = [
        { id: "list", label: "appearance.layout.cardsDensity.list" },
        { id: "grid", label: "appearance.layout.cardsDensity.grid" },
    ];

    const metricInfo: Record<TelemetryMetric, { label: MessageKey; icon: LucideIcon }> = {
        download: { label: "appearance.layout.telemetryOrder.download", icon: ArrowDown },
        upload: { label: "appearance.layout.telemetryOrder.upload", icon: ArrowUp },
        latency: { label: "appearance.layout.telemetryOrder.latency", icon: Signal },
    };

    const handleMoveMetric = (index: number, direction: -1 | 1) => {
        const order = [...layout.telemetryOrder];
        const target = index + direction;
        if (target < 0 || target >= order.length) return;
        const temp = order[index];
        order[index] = order[target];
        order[target] = temp;
        setLayout({ telemetryOrder: order });
    };

    const handleToggleMetricVisible = (metric: TelemetryMetric) => {
        const currentVis = layout.telemetryVisible?.[metric] !== false;
        setLayout({
            telemetryVisible: {
                ...layout.telemetryVisible,
                [metric]: !currentVis,
            },
        });
    };

    const handleReset = () => {
        resetLayout();
        toast.success(t("appearance.layout.resetDone"), { id: "reset-layout" });
    };

    return (
        <div className="space-y-6">
            {/* 1. Global Navigation Placement */}
            {!isMobileDevice && (
            <div>
                <label className="text-xs font-semibold text-foreground/90 block mb-2.5">
                    {t("appearance.layout.navPosition")}
                </label>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {navOptions.map((opt) => {
                        const active = layout.navPosition === opt.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setLayout({ navPosition: opt.id })}
                                aria-pressed={active}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-2.5 rounded-xl border p-3 text-center transition-all",
                                    active
                                        ? "border-primary bg-primary/[0.05] ring-1 ring-primary shadow-xs"
                                        : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
                                )}
                            >
                                {/* Miniature wireframe UI diagram */}
                                <div
                                    className={cn(
                                        "relative h-12 w-full max-w-[80px] rounded-md border p-1 flex transition-all overflow-hidden",
                                        active ? "border-primary/40 bg-muted/40" : "border-border bg-muted/20"
                                    )}
                                    aria-hidden="true"
                                >
                                    {opt.mockup === "top" && (
                                        <div className="flex flex-col w-full h-full gap-1">
                                            <div className="h-2.5 w-full rounded-[2px] bg-primary" />
                                            <div className="flex-1 w-full rounded-[2px] bg-muted-foreground/15" />
                                        </div>
                                    )}
                                    {opt.mockup === "sidebar-left" && (
                                        <div className="flex flex-row w-full h-full gap-1">
                                            <div className="w-3.5 h-full rounded-[2px] bg-primary shrink-0" />
                                            <div className="flex-1 h-full rounded-[2px] bg-muted-foreground/15" />
                                        </div>
                                    )}
                                    {opt.mockup === "sidebar-right" && (
                                        <div className="flex flex-row w-full h-full gap-1">
                                            <div className="flex-1 h-full rounded-[2px] bg-muted-foreground/15" />
                                            <div className="w-3.5 h-full rounded-[2px] bg-primary shrink-0" />
                                        </div>
                                    )}
                                    {opt.mockup === "bottom" && (
                                        <div className="flex flex-col w-full h-full gap-1">
                                            <div className="flex-1 w-full rounded-[2px] bg-muted-foreground/15" />
                                            <div className="h-2.5 w-full rounded-[2px] bg-primary" />
                                        </div>
                                    )}
                                </div>

                                <span className="block text-xs font-semibold">{t(opt.label)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            )}

            {/* 2. Cockpit Alignment & Telemetry Placement */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-2">
                        {t("appearance.layout.cockpitAlign")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {cockpitOptions.map((opt) => {
                            const active = layout.cockpitAlign === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setLayout({ cockpitAlign: opt.id })}
                                    aria-pressed={active}
                                    className={cn(
                                        "flex items-center justify-center gap-1.5 rounded-xl border py-2.5 px-3 text-xs font-medium transition-all",
                                        active
                                            ? "border-primary bg-primary/[0.05] text-foreground font-semibold ring-1 ring-primary shadow-xs"
                                            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground"
                                    )}
                                >
                                    {active ? <Check size={13} className="text-primary" /> : null}
                                    <span>{t(opt.label)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-2">
                        {t("appearance.layout.telemetryPlacement")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {telemetryPlacementOptions.map((opt) => {
                            const active = layout.telemetryPlacement === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setLayout({ telemetryPlacement: opt.id })}
                                    aria-pressed={active}
                                    className={cn(
                                        "flex items-center justify-center gap-1.5 rounded-xl border py-2.5 px-3 text-xs font-medium transition-all",
                                        active
                                            ? "border-primary bg-primary/[0.05] text-foreground font-semibold ring-1 ring-primary shadow-xs"
                                            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground"
                                    )}
                                >
                                    {active ? <Check size={13} className="text-primary" /> : null}
                                    <span>{t(opt.label)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 3. Telemetry Metric Ordering & Visibility */}
            <div>
                <label className="text-xs font-semibold text-foreground/90 block mb-2.5">
                    {t("appearance.layout.telemetryOrder")}
                </label>
                <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-2.5">
                    {layout.telemetryOrder.map((metric, idx) => {
                        const info = metricInfo[metric];
                        if (!info) return null;
                        const isVisible = layout.telemetryVisible?.[metric] !== false;
                        const Icon = info.icon;
                        const isFirst = idx === 0;
                        const isLast = idx === layout.telemetryOrder.length - 1;

                        return (
                            <div
                                key={metric}
                                className={cn(
                                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-colors",
                                    isVisible
                                        ? "border-border/60 bg-background/80 text-foreground"
                                        : "border-border/30 bg-muted/20 text-muted-foreground opacity-60"
                                )}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className={cn(
                                        "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
                                        isVisible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                    )}>
                                        <Icon size={14} />
                                    </div>
                                    <span className="font-medium truncate">{t(info.label)}</span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                    {/* Reorder Buttons */}
                                    <button
                                        type="button"
                                        disabled={isFirst}
                                        onClick={() => handleMoveMetric(idx, -1)}
                                        title="Move Earlier"
                                        className="h-7 w-7 rounded-md border border-border/50 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isLast}
                                        onClick={() => handleMoveMetric(idx, 1)}
                                        title="Move Later"
                                        className="h-7 w-7 rounded-md border border-border/50 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                                    >
                                        <ChevronRight size={14} />
                                    </button>

                                    {/* Visibility Toggle */}
                                    <button
                                        type="button"
                                        onClick={() => handleToggleMetricVisible(metric)}
                                        title={isVisible ? "Hide metric" : "Show metric"}
                                        className={cn(
                                            "h-7 w-7 rounded-md border border-border/50 flex items-center justify-center transition-colors ms-1",
                                            isVisible
                                                ? "bg-primary/15 text-primary border-primary/30"
                                                : "text-muted-foreground hover:bg-muted"
                                        )}
                                    >
                                        {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 4. Dashboard Width & Switches */}
            <div className="space-y-3 pt-1 border-t border-border/40">
                <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-2">
                        {t("appearance.layout.dashboardWidth")}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        {dashboardWidthOptions.map((opt) => {
                            const active = layout.dashboardWidth === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setLayout({ dashboardWidth: opt.id })}
                                    aria-pressed={active}
                                    className={cn(
                                        "flex items-center justify-center gap-1.5 rounded-xl border py-2 px-2.5 text-xs font-medium transition-all text-center",
                                        active
                                            ? "border-primary bg-primary/[0.05] text-foreground font-semibold ring-1 ring-primary shadow-xs"
                                            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground"
                                    )}
                                >
                                    {active ? <Check size={12} className="text-primary" /> : null}
                                    <span className="truncate">{t(opt.label)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-3">
                    <div className="space-y-0.5 pr-2">
                        <span className="text-xs font-medium block">{t("appearance.layout.showQuickSwitch")}</span>
                        <span className="text-[11px] text-muted-foreground block">{t("appearance.layout.showQuickSwitch.hint")}</span>
                    </div>
                    <Switch
                        checked={layout.showQuickSwitch}
                        onCheckedChange={(checked) => setLayout({ showQuickSwitch: checked })}
                    />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-3">
                    <div className="space-y-0.5 pr-2">
                        <span className="text-xs font-medium block">{t("appearance.layout.showSpeedTest")}</span>
                        <span className="text-[11px] text-muted-foreground block">{t("appearance.layout.showSpeedTest.hint")}</span>
                    </div>
                    <Switch
                        checked={layout.showSpeedTest}
                        onCheckedChange={(checked) => setLayout({ showSpeedTest: checked })}
                    />
                </div>
            </div>

            {/* 5. Cards Density for Lists */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border/40">
                <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-1.5">
                        {t("proxies.title")} ({t("appearance.layout.cardsDensity")})
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                        {cardsDensityOptions.map((opt) => {
                            const active = layout.proxiesCardLayout === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setLayout({ proxiesCardLayout: opt.id })}
                                    aria-pressed={active}
                                    className={cn(
                                        "flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2 text-xs transition-all",
                                        active
                                            ? "border-primary bg-primary/10 text-primary font-medium"
                                            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
                                    )}
                                >
                                    {opt.id === "list" ? <LayoutList size={12} /> : <LayoutGrid size={12} />}
                                    <span>{t(opt.label)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-1.5">
                        {t("configuration.title")} ({t("appearance.layout.cardsDensity")})
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                        {cardsDensityOptions.map((opt) => {
                            const active = layout.configCardLayout === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setLayout({ configCardLayout: opt.id })}
                                    aria-pressed={active}
                                    className={cn(
                                        "flex items-center justify-center gap-1 rounded-lg border py-1.5 px-2 text-xs transition-all",
                                        active
                                            ? "border-primary bg-primary/10 text-primary font-medium"
                                            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
                                    )}
                                >
                                    {opt.id === "list" ? <LayoutList size={12} /> : <LayoutGrid size={12} />}
                                    <span>{t(opt.label)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 6. Reset Layout Action */}
            <div className="pt-2 flex justify-end">
                <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded"
                >
                    <RotateCcw size={13} />
                    <span>{t("appearance.layout.reset")}</span>
                </button>
            </div>
        </div>
    );
}
