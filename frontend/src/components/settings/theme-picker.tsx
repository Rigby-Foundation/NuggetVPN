import { Check, Laptop } from "lucide-react";

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

function ThemePicker({ theme, setTheme }: Props) {
    const light = THEME_PRESETS.filter((preset) => preset.mode === "light");
    const dark = THEME_PRESETS.filter((preset) => preset.mode === "dark");

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
        </div>
    );
}

export default ThemePicker;
