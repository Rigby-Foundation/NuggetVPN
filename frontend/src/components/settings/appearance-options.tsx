import { ReactNode } from "react";
import { ArrowRight, ArrowUp, Blend, Minus, type LucideIcon } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import { FONTS, MOTIONS, RADII } from "@/lib/appearance";
import { cn } from "@/lib/utils";

/**
 * Font, corner and transition pickers.
 *
 * Like the theme picker, each option shows itself rather than naming itself:
 * the font sample is set in that font, the corner is drawn at that radius.
 */

function ChoiceCard({
    active,
    onSelect,
    children,
    className,
}: {
    active: boolean;
    onSelect: () => void;
    children: ReactNode;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-muted/30 px-3 py-4 text-center transition-colors",
                active ? "border-primary bg-primary/5" : "border-transparent hover:border-border",
                className
            )}
        >
            {children}
        </button>
    );
}

/**
 * The sample uses the app's own fallback stack, not the bare family, so it
 * shows what the app would actually render — including the system font
 * standing in where a font lacks glyphs (Google Sans has no Cyrillic here).
 */
const sampleFont = (family: string) => `${family}, ui-sans-serif, system-ui, sans-serif`;

/**
 * The greeting in the sample follows the system language. The app has no
 * language setting of its own, so the system locale is the only signal of
 * what script someone will actually be reading.
 */
const SAMPLE_WORD = (() => {
    try {
        return navigator.language.toLowerCase().startsWith("ru") ? "Привет" : "Hello";
    } catch {
        return "Hello";
    }
})();

export function FontPicker() {
    const { prefs, setFont } = useAppearance();
    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {FONTS.map((font) => (
                <ChoiceCard key={font.id} active={prefs.font === font.id} onSelect={() => setFont(font.id)}>
                    <span className="text-lg font-semibold leading-tight" style={{ fontFamily: sampleFont(font.family) }}>
                        Aa {SAMPLE_WORD}
                    </span>
                    <span className="text-xs text-muted-foreground" style={{ fontFamily: sampleFont(font.family) }}>
                        {font.label}
                    </span>
                </ChoiceCard>
            ))}
        </div>
    );
}

export function RadiusPicker() {
    const { prefs, setRadius } = useAppearance();
    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {RADII.map((radius) => (
                <ChoiceCard key={radius.id} active={prefs.radius === radius.id} onSelect={() => setRadius(radius.id)}>
                    <span
                        className="h-9 w-9 border-2 border-foreground/40 bg-background/60"
                        style={{ borderRadius: radius.value }}
                        aria-hidden="true"
                    />
                    <span className="text-xs font-medium">{radius.label}</span>
                </ChoiceCard>
            ))}
        </div>
    );
}

const MOTION_ICONS: Record<string, LucideIcon> = {
    slide: ArrowRight,
    rise: ArrowUp,
    fade: Blend,
    none: Minus,
};

export function MotionPicker() {
    const { prefs, setMotion } = useAppearance();
    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {MOTIONS.map((motion) => {
                const Icon = MOTION_ICONS[motion.id] ?? Minus;
                return (
                    <ChoiceCard key={motion.id} active={prefs.motion === motion.id} onSelect={() => setMotion(motion.id)}>
                        <Icon size={18} aria-hidden="true" />
                        <span className="text-xs font-medium">{motion.label}</span>
                        <span className="text-[11px] text-muted-foreground">{motion.hint}</span>
                    </ChoiceCard>
                );
            })}
        </div>
    );
}
