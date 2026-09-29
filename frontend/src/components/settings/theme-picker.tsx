import { Check, Laptop } from "lucide-react";

import { THEME_PRESETS, type ThemePreset } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The theme picker.
 *
 * A dropdown of theme names asks you to remember what each one looks like, so
 * each option draws itself instead: the page colour, a card on top of it and
 * the accent, which is the part that actually differs between presets.
 */

interface Props {
    theme: string | undefined;
    setTheme: (value: string) => void;
}

function Swatch({ preset }: { preset: ThemePreset }) {
    return (
        <span
            className="flex h-14 w-full items-end gap-1.5 rounded-lg border p-1.5"
            style={{ background: preset.swatch.background }}
            aria-hidden="true"
        >
            <span
                className="h-full flex-1 rounded"
                style={{ background: preset.swatch.card }}
            />
            <span
                className="h-full w-2.5 rounded"
                style={{ background: preset.swatch.accent }}
            />
        </span>
    );
}

function Option({
    active,
    label,
    hint,
    preview,
    onSelect,
}: {
    active: boolean;
    label: string;
    hint: string;
    preview: React.ReactNode;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            className={cn(
                "group relative rounded-xl border-2 p-2 text-left transition-colors",
                active ? "border-primary" : "border-transparent hover:border-border"
            )}
        >
            {preview}
            <span className="mt-2 flex items-center gap-1.5 px-0.5">
                <span className="truncate text-xs font-medium">{label}</span>
                {active ? (
                    <Check size={12} className="shrink-0 text-primary" aria-hidden="true" />
                ) : null}
            </span>
            <span className="block px-0.5 text-[11px] leading-snug text-muted-foreground">
                {hint}
            </span>
        </button>
    );
}

function ThemePicker({ theme, setTheme }: Props) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Option
                active={theme === "system"}
                label="System"
                hint="Follows the desktop setting"
                onSelect={() => setTheme("system")}
                preview={
                    <span
                        className="grid h-14 w-full place-items-center rounded-lg border bg-muted/40 text-muted-foreground"
                        aria-hidden="true"
                    >
                        <Laptop size={20} />
                    </span>
                }
            />

            {THEME_PRESETS.map((preset) => (
                <Option
                    key={preset.id}
                    active={theme === preset.id}
                    label={preset.label}
                    hint={preset.hint}
                    onSelect={() => setTheme(preset.id)}
                    preview={<Swatch preset={preset} />}
                />
            ))}
        </div>
    );
}

export default ThemePicker;
