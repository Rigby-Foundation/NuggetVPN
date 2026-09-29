import { ReactNode, useState } from "react";
import toast from "react-hot-toast";
import { ArrowRight, ArrowUp, Blend, Loader2, Minus, Plus, X, type LucideIcon } from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import { effectiveFont, fontLabel, fontsFor, MOTIONS, RADII, UserFont, USER_FONT_PREFIX } from "@/lib/appearance";
import { errorMessage, invoke } from "@/lib/backend";
import { scriptOf, useI18n, useT } from "@/lib/i18n";
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
 * The sample word is in the app's own language, and so in the script the
 * font will actually be asked to draw — Cyrillic for Russian and Ukrainian,
 * CJK for Chinese and Japanese, where a font is likeliest to fall back.
 */

export function FontPicker() {
    const { prefs, setFont, addUserFont, removeUserFont } = useAppearance();
    const { t, language } = useI18n();
    const [adding, setAdding] = useState(false);
    const add = async () => {
        setAdding(true);
        try {
            const font = await invoke<UserFont | null>("import_user_file", { kind: "fonts" });
            if (font) addUserFont(font);
        } catch (error) {
            toast.error(errorMessage(error), { id: "add-font" });
        } finally {
            setAdding(false);
        }
    };
    const sample = t("appearance.fontSample");
    // Only fonts that draw every letter of this language are offered, so none
    // of them can quietly fall back to another font mid-word.
    const script = scriptOf(language);
    const current = effectiveFont(prefs.font, script).id;
    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {fontsFor(script).map((font) => {
                const userFont = font.id.startsWith(USER_FONT_PREFIX);
                return (
                    <div key={font.id} className="group relative">
                        <ChoiceCard active={current === font.id} onSelect={() => setFont(font.id)} className="h-full w-full">
                            <span className="text-lg font-semibold leading-tight" style={{ fontFamily: sampleFont(font.family) }}>
                                Aa {sample}
                            </span>
                            <span className="max-w-full truncate text-xs text-muted-foreground" style={{ fontFamily: sampleFont(font.family) }}>
                                {fontLabel(t, font.id)}
                            </span>
                        </ChoiceCard>
                        {userFont ? (
                            <button
                                type="button"
                                onClick={() => removeUserFont(font.id.slice(USER_FONT_PREFIX.length))}
                                aria-label={t("appearance.font.remove", { name: font.label })}
                                className="absolute end-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                            >
                                <X size={13} aria-hidden="true" />
                            </button>
                        ) : null}
                    </div>
                );
            })}
            <button
                type="button"
                onClick={() => void add()}
                disabled={adding}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-4 text-center text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-60"
            >
                {adding ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} aria-hidden="true" />}
                <span className="text-xs">{t("appearance.font.add")}</span>
            </button>
        </div>
    );
}

export function RadiusPicker() {
    const { prefs, setRadius } = useAppearance();
    const t = useT();
    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {RADII.map((radius) => (
                <ChoiceCard key={radius.id} active={prefs.radius === radius.id} onSelect={() => setRadius(radius.id)}>
                    <span
                        className="h-9 w-9 border-2 border-foreground/40 bg-background/60"
                        style={{ borderRadius: radius.value }}
                        aria-hidden="true"
                    />
                    <span className="text-xs font-medium">{t(radius.label)}</span>
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
    const t = useT();
    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {MOTIONS.map((motion) => {
                const Icon = MOTION_ICONS[motion.id] ?? Minus;
                return (
                    <ChoiceCard key={motion.id} active={prefs.motion === motion.id} onSelect={() => setMotion(motion.id)}>
                        <Icon size={18} aria-hidden="true" />
                        <span className="text-xs font-medium">{t(motion.label)}</span>
                        <span className="text-[11px] text-muted-foreground">{t(motion.hint)}</span>
                    </ChoiceCard>
                );
            })}
        </div>
    );
}
