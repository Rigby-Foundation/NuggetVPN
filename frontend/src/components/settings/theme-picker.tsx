import { useState } from "react";
import { Check, Laptop, Palette, Pencil, Plus, Sparkles, Sun, Moon } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import ThemeEditor from "@/components/settings/theme-editor";
import {
    customThemeSwatch,
    CustomTheme,
    newCustomTheme,
} from "@/lib/appearance";
import { useT } from "@/lib/i18n";
import { THEME_PRESETS } from "@/lib/themes";
import { cn } from "@/lib/utils";

interface Props {
    theme: string | undefined;
    setTheme: (value: string) => void;
}

interface SwatchPreset {
    id?: string;
    label: string;
    hint: string;
    mode?: "light" | "dark";
    family?: string;
    swatch: { background: string; surface: string; accent: string };
}

function ThemeCard({
    preset,
    active,
    onSelect,
    onEdit,
    tag,
}: {
    preset: SwatchPreset;
    active: boolean;
    onSelect: () => void;
    onEdit?: () => void;
    tag?: string;
}) {
    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onSelect}
                aria-pressed={active}
                title={preset.hint}
                className={cn(
                    "w-full flex flex-col text-start rounded-xl border p-2.5 transition-all",
                    active
                        ? "border-primary bg-primary/[0.04] ring-1 ring-primary shadow-xs"
                        : "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
                )}
            >
                {/* Miniature App Frame Preview */}
                <div
                    className="relative h-12 w-full rounded-lg border overflow-hidden transition-transform group-hover:scale-[1.01]"
                    style={{ background: preset.swatch.background }}
                    aria-hidden="true"
                >
                    {/* Simulated elevated card surface */}
                    <div
                        className="absolute inset-x-2 top-2 bottom-0 rounded-t-md border-t border-x"
                        style={{
                            background: preset.swatch.surface,
                            borderColor: "rgba(255,255,255,0.08)",
                        }}
                    >
                        {/* Accent dot and pill inside the mini window */}
                        <div className="flex items-center justify-between p-1.5">
                            <span
                                className="h-2 w-6 rounded-full shadow-xs"
                                style={{ background: preset.swatch.accent }}
                            />
                            <span
                                className="h-1.5 w-1.5 rounded-full opacity-70"
                                style={{ background: preset.swatch.accent }}
                            />
                        </div>
                    </div>
                </div>

                {/* Title & Tag */}
                <div className="mt-2.5 flex items-center justify-between gap-1.5">
                    <span className="truncate text-xs font-semibold">{preset.label}</span>
                    {active ? (
                        <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs"
                            aria-hidden="true"
                        >
                            <Check size={9} strokeWidth={3} />
                        </span>
                    ) : tag ? (
                        <span className="rounded bg-muted/60 px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                            {tag}
                        </span>
                    ) : null}
                </div>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground leading-snug">
                    {preset.hint}
                </span>
            </button>

            {onEdit ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                    className="absolute end-2 top-2 rounded-md bg-black/40 p-1 text-white backdrop-blur-sm transition-opacity hover:bg-black/70"
                    aria-label="Edit"
                >
                    <Pencil size={11} />
                </button>
            ) : null}
        </div>
    );
}

/** A custom theme shown the way a preset is, from its own numbers. */
function asPreset(theme: CustomTheme, t: ReturnType<typeof useT>): SwatchPreset {
    return {
        id: theme.id,
        label: theme.name || t("picker.untitled"),
        hint: t(theme.mode === "dark" ? "picker.customDark" : "picker.customLight"),
        mode: theme.mode,
        swatch: customThemeSwatch(theme),
    };
}

type TabKind = "all" | "dark" | "light" | "palettes" | "custom";

function ThemePicker({ theme, setTheme }: Props) {
    const t = useT();
    const [currentTab, setCurrentTab] = useState<TabKind>("all");

    const translated = (preset: (typeof THEME_PRESETS)[number]): SwatchPreset => ({
        id: preset.id,
        label: t(preset.label),
        hint: t(preset.hint),
        mode: preset.mode,
        family: preset.family,
        swatch: preset.swatch,
    });

    const own = THEME_PRESETS.filter((preset) => !preset.family);
    const light = own.filter((preset) => preset.mode === "light");
    const dark = own.filter((preset) => preset.mode === "dark");
    const palettes = THEME_PRESETS.filter((preset) => preset.family === "palette").sort(
        (a, b) => Number(a.mode === "dark") - Number(b.mode === "dark")
    );

    const { prefs, activeCustom, hasMonet, showCustomTheme, saveCustomTheme, deleteCustomTheme } =
        useAppearance();
    const [editing, setEditing] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);

    const currentlyDark =
        typeof document !== "undefined" &&
        (document.documentElement.classList.contains("dark") ||
            [...document.documentElement.classList].some((name) => name.startsWith("theme-dark-")));

    // Filter presets based on selected category tab
    const filteredPresets = (() => {
        switch (currentTab) {
            case "dark":
                return dark.map(translated);
            case "light":
                return light.map(translated);
            case "palettes":
                return palettes.map(translated);
            case "custom":
                return [];
            case "all":
            default:
                return [...dark, ...light, ...palettes].map(translated);
        }
    })();

    const showCustomSection = currentTab === "all" || currentTab === "custom";

    return (
        <div className="space-y-4">
            {/* System Mode Action Banner */}
            <button
                type="button"
                onClick={() => setTheme("system")}
                aria-pressed={theme === "system"}
                className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-start transition-all",
                    theme === "system"
                        ? "border-primary bg-primary/[0.04] ring-1 ring-primary shadow-xs"
                        : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40"
                )}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground"
                        aria-hidden="true"
                    >
                        <Laptop size={16} />
                    </span>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{t("picker.system")}</span>
                            <span className="rounded-full bg-muted/70 px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                                Auto
                            </span>
                        </div>
                        <span className="block text-[11px] text-muted-foreground truncate">
                            {t(hasMonet ? "picker.systemMonet" : "picker.systemHint")}
                        </span>
                    </div>
                </div>

                <div
                    className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all",
                        theme === "system"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30 bg-transparent"
                    )}
                    aria-hidden="true"
                >
                    {theme === "system" ? <Check size={10} strokeWidth={3} /> : null}
                </div>
            </button>

            {/* Filter Tabs Bar */}
            <div
                className="flex flex-wrap items-center gap-1 border-b border-border/50 pb-2.5"
                role="tablist"
                aria-label="Theme categories"
            >
                {(
                    [
                        { id: "all", label: "All Themes" },
                        { id: "dark", label: t("picker.dark") },
                        { id: "light", label: t("picker.light") },
                        { id: "palettes", label: t("picker.palettes") },
                        { id: "custom", label: t("picker.custom") },
                    ] as const
                ).map((tab) => {
                    const active = currentTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setCurrentTab(tab.id)}
                            className={cn(
                                "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                                active
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                            )}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Presets Grid */}
            {filteredPresets.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                    {filteredPresets.map((preset) => (
                        <ThemeCard
                            key={preset.id}
                            preset={preset}
                            active={theme === preset.id}
                            onSelect={() => setTheme(preset.id!)}
                            tag={preset.family === "palette" ? "Palette" : preset.mode}
                        />
                    ))}
                </div>
            ) : null}

            {/* Custom & Plugin Themes */}
            {showCustomSection ? (
                <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">
                            {t("picker.custom")}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                            {prefs.customThemes.length} saved
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                        {prefs.customThemes.map((custom) => (
                            <ThemeCard
                                key={custom.id}
                                preset={asPreset(custom, t)}
                                active={activeCustom?.id === custom.id}
                                onSelect={() => showCustomTheme(custom)}
                                onEdit={() => setEditing({ theme: custom, isNew: false })}
                                tag="Custom"
                            />
                        ))}

                        {/* Create New Theme Card */}
                        <button
                            type="button"
                            onClick={() =>
                                setEditing({
                                    theme: newCustomTheme(currentlyDark ? "dark" : "light"),
                                    isNew: true,
                                })
                            }
                            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-muted/20 p-3 text-center transition-all hover:border-foreground/40 hover:bg-muted/40 hover:text-foreground"
                        >
                            <div className="grid h-9 w-9 place-items-center rounded-lg border border-dashed text-muted-foreground">
                                <Plus size={16} aria-hidden="true" />
                            </div>
                            <span className="text-xs font-medium">{t("picker.new")}</span>
                            <span className="text-[10px] text-muted-foreground">{t("picker.newHint")}</span>
                        </button>
                    </div>

                    {/* Plugin themes if present */}
                    {prefs.pluginThemes.length > 0 ? (
                        <div className="pt-2">
                            <span className="text-xs font-semibold text-muted-foreground block mb-2">
                                {t("picker.plugins")}
                            </span>
                            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                                {prefs.pluginThemes.map((custom) => (
                                    <ThemeCard
                                        key={custom.id}
                                        preset={asPreset(custom, t)}
                                        active={activeCustom?.id === custom.id}
                                        onSelect={() => showCustomTheme(custom)}
                                        tag="Plugin"
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <ThemeEditor
                theme={editing?.theme ?? null}
                isNew={editing?.isNew ?? false}
                onClose={() => setEditing(null)}
                onSave={(custom) => {
                    saveCustomTheme(custom);
                    if (editing?.isNew) {
                        showCustomTheme(custom);
                    }
                    setEditing(null);
                }}
                onDelete={(id) => {
                    deleteCustomTheme(id);
                    setEditing(null);
                }}
            />
        </div>
    );
}

export default ThemePicker;
