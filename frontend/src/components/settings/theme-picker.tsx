import { useState } from "react";
import { Check, Laptop, Pencil, Plus } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import ThemeEditor from "@/components/settings/theme-editor";
import {
    customThemeSwatch,
    CustomTheme,
    newCustomTheme,
} from "@/lib/appearance";
import { THEME_PRESETS, type ThemePreset } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The theme picker.
 *
 * A dropdown of theme names asks you to remember what each one looks like, so
 * each option draws itself instead: a band running from the page colour to a
 * surface on top of it, with the accent beside it. The accent is the part that
 * separates presets sharing a ground — sunset and mocha are both warm, and it
 * is the accent that tells them apart.
 */

interface Props {
    theme: string | undefined;
    setTheme: (value: string) => void;
}

function Option({
    active,
    label,
    hint,
    accent,
    preview,
    onSelect,
}: {
    active: boolean;
    label: string;
    hint: string;
    /** Drawn as the selection outline, so the choice shows in its own colour. */
    accent: string;
    preview: React.ReactNode;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            title={hint}
            className={cn(
                "rounded-xl border-2 p-2 text-left transition-colors",
                active ? "" : "border-transparent hover:border-border"
            )}
            style={active ? { borderColor: accent } : undefined}
        >
            {preview}
            <span className="mt-2 flex items-center gap-1.5 px-0.5">
                <span className="truncate text-xs font-medium">{label}</span>
                {active ? (
                    <Check
                        size={12}
                        className="shrink-0"
                        style={{ color: accent }}
                        aria-hidden="true"
                    />
                ) : null}
            </span>
            <span className="block truncate px-0.5 text-[11px] leading-snug text-muted-foreground">
                {hint}
            </span>
        </button>
    );
}

function PresetOption({
    preset,
    active,
    onSelect,
}: {
    preset: ThemePreset;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <Option
            active={active}
            label={preset.label}
            hint={preset.hint}
            accent={preset.swatch.accent}
            onSelect={onSelect}
            preview={
                <span
                    className="flex h-14 w-full items-end justify-end rounded-lg border p-2"
                    style={{
                        background: `linear-gradient(135deg, ${preset.swatch.background}, ${preset.swatch.surface})`,
                    }}
                    aria-hidden="true"
                >
                    {/* The ground is most of what you see in the app, so it is
                        most of the swatch; the accent is the smaller mark,
                        which is also the proportion it has on screen. */}
                    <span
                        className="h-3.5 w-3.5 rounded-full"
                        style={{ background: preset.swatch.accent }}
                    />
                </span>
            }
        />
    );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {title}
            </h4>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{children}</div>
        </div>
    );
}

/** A custom theme shown the way a preset is, from its own numbers. */
function asPreset(theme: CustomTheme): ThemePreset {
    return {
        id: theme.id,
        label: theme.name,
        hint: theme.mode === "dark" ? "Custom, dark" : "Custom, light",
        mode: theme.mode,
        className: "",
        swatch: customThemeSwatch(theme),
    };
}

function ThemePicker({ theme, setTheme }: Props) {
    const light = THEME_PRESETS.filter((preset) => preset.mode === "light");
    const dark = THEME_PRESETS.filter((preset) => preset.mode === "dark");
    const { prefs, activeCustom, showCustomTheme, saveCustomTheme, deleteCustomTheme } =
        useAppearance();
    const [editing, setEditing] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);

    // A new theme starts from whichever mode is on screen, so the first thing
    // the preview shows is close to what the user is looking at already.
    const currentlyDark = document.documentElement.classList.contains("dark") ||
        [...document.documentElement.classList].some((name) => name.startsWith("theme-dark-"));

    return (
        <div className="space-y-5">
            {/* System is not one preset among fifteen, it is the choice not to
                pick one, so it gets its own row rather than a swatch in the
                grid — which also stops it stranding two empty cells. */}
            <button
                type="button"
                onClick={() => setTheme("system")}
                aria-pressed={theme === "system"}
                className={cn(
                    "flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors",
                    theme === "system"
                        ? "border-primary"
                        : "border-transparent bg-muted/30 hover:border-border"
                )}
            >
                <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground"
                    aria-hidden="true"
                >
                    <Laptop size={17} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">System</span>
                        {theme === "system" ? (
                            <Check size={12} className="text-primary" aria-hidden="true" />
                        ) : null}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                        Follows the desktop setting
                    </span>
                </span>
            </button>

            <Group title="Light">
                {light.map((preset) => (
                    <PresetOption
                        key={preset.id}
                        preset={preset}
                        active={theme === preset.id}
                        onSelect={() => setTheme(preset.id)}
                    />
                ))}
            </Group>

            <Group title="Dark">
                {dark.map((preset) => (
                    <PresetOption
                        key={preset.id}
                        preset={preset}
                        active={theme === preset.id}
                        onSelect={() => setTheme(preset.id)}
                    />
                ))}
            </Group>

            <Group title="Custom">
                {prefs.customThemes.map((custom) => (
                    // The edit control sits beside the option, not inside it:
                    // a button inside a button is invalid and would steal the
                    // click that selects the theme.
                    <div key={custom.id} className="relative">
                        <PresetOption
                            preset={asPreset(custom)}
                            active={activeCustom?.id === custom.id}
                            onSelect={() => showCustomTheme(custom)}
                        />
                        <button
                            type="button"
                            onClick={() => setEditing({ theme: custom, isNew: false })}
                            aria-label={`Edit ${custom.name}`}
                            className="absolute left-3.5 top-3.5 grid h-6 w-6 place-items-center rounded-md bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
                        >
                            <Pencil size={11} aria-hidden="true" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() =>
                        setEditing({ theme: newCustomTheme(currentlyDark ? "dark" : "light"), isNew: true })
                    }
                    className="flex flex-col rounded-xl border-2 border-transparent p-2 text-left hover:border-border"
                >
                    <span className="grid h-14 w-full place-items-center rounded-lg border-2 border-dashed text-muted-foreground">
                        <Plus size={18} aria-hidden="true" />
                    </span>
                    <span className="mt-2 px-0.5 text-xs font-medium">New theme</span>
                    <span className="block px-0.5 text-[11px] text-muted-foreground">Pick your own colours</span>
                </button>
            </Group>

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
