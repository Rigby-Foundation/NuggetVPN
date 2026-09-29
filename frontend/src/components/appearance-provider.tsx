import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useState,
} from "react";

import { ThemeProvider, useTheme } from "@/components/theme-provider";
import {
    activeCustomTheme,
    AppearancePrefs,
    applyAppearance,
    applyCustomTheme,
    CUSTOM_THEME_CLASSES,
    CUSTOM_THEME_IDS,
    CustomTheme,
    loadAppearance,
    saveAppearance,
} from "@/lib/appearance";
import { currentLanguage, scriptOf, useI18n } from "@/lib/i18n";
import { THEME_CLASSES, THEME_IDS } from "@/lib/themes";

interface AppearanceContext {
    prefs: AppearancePrefs;
    setFont: (id: string) => void;
    setRadius: (id: string) => void;
    setMotion: (id: string) => void;
    /** The custom theme on screen, if one is. */
    activeCustom: CustomTheme | undefined;
    /** Shows a custom theme. */
    showCustomTheme: (theme: CustomTheme) => void;
    /** Adds the theme, or replaces the one with the same id. */
    saveCustomTheme: (theme: CustomTheme) => void;
    deleteCustomTheme: (id: string) => void;
}

const Context = createContext<AppearanceContext | null>(null);

export function useAppearance(): AppearanceContext {
    const value = useContext(Context);
    if (!value) {
        throw new Error("useAppearance must be used inside AppearanceProvider");
    }
    return value;
}

// Static on purpose: next-themes reads its theme-to-class map once, on first
// render, and ignores later changes. Custom themes all go through the two
// fixed ids at the end — see CUSTOM_THEME_IDS.
const PROVIDER_THEMES = [...THEME_IDS, CUSTOM_THEME_IDS.dark, CUSTOM_THEME_IDS.light];
export const PROVIDER_CLASSES: Record<string, string> = { ...THEME_CLASSES, ...CUSTOM_THEME_CLASSES };

function Appearance({ children }: { children: ReactNode }) {
    const { theme, setTheme } = useTheme();
    const [prefs, setPrefs] = useState(loadAppearance);
    // The font follows the language as well as the choice: switching to a
    // language the chosen font does not cover changes the font in use.
    const script = scriptOf(useI18n().language);

    useLayoutEffect(() => {
        applyAppearance(prefs, script);
        saveAppearance(prefs);
    }, [prefs, script]);

    const activeCustom = activeCustomTheme(prefs, theme);

    // Layout effect, so the colours change in the same frame as the class and
    // a switch never paints one frame of the half-applied result.
    useLayoutEffect(() => {
        applyCustomTheme(activeCustom);
    }, [activeCustom]);

    const update = useCallback((patch: Partial<AppearancePrefs>) => {
        setPrefs((current) => ({ ...current, ...patch }));
    }, []);

    const showCustomTheme = useCallback(
        (custom: CustomTheme) => {
            update({ activeCustom: custom.id });
            setTheme(CUSTOM_THEME_IDS[custom.mode]);
        },
        [setTheme, update]
    );

    const context = useMemo<AppearanceContext>(
        () => ({
            prefs,
            setFont: (font) => update({ font }),
            setRadius: (radius) => update({ radius }),
            setMotion: (motion) => update({ motion }),
            activeCustom,
            showCustomTheme,
            saveCustomTheme: (custom) => {
                setPrefs((current) => {
                    const exists = current.customThemes.some((item) => item.id === custom.id);
                    return {
                        ...current,
                        customThemes: exists
                            ? current.customThemes.map((item) => (item.id === custom.id ? custom : item))
                            : [...current.customThemes, custom],
                    };
                });
                // Editing the theme on screen can change its mode, which is a
                // different next-themes id.
                if (activeCustom?.id === custom.id) {
                    setTheme(CUSTOM_THEME_IDS[custom.mode]);
                }
            },
            deleteCustomTheme: (id) => {
                if (activeCustom?.id === id) {
                    setTheme("system");
                }
                setPrefs((current) => ({
                    ...current,
                    customThemes: current.customThemes.filter((item) => item.id !== id),
                    activeCustom: current.activeCustom === id ? "" : current.activeCustom,
                }));
            },
        }),
        [activeCustom, prefs, setTheme, update, showCustomTheme]
    );

    return <Context.Provider value={context}>{children}</Context.Provider>;
}

/** Owns every appearance preference, and the theme provider beneath them. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
    return (
        // disableTransitionOnChange: without it every element with a colour
        // transition fades separately from the old theme, so for a moment the
        // window is two themes at once.
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            themes={PROVIDER_THEMES}
            value={PROVIDER_CLASSES}
        >
            <Appearance>{children}</Appearance>
        </ThemeProvider>
    );
}

/**
 * Apply the stored theme, font, corners and custom colours before React
 * renders, so the first frame is already the user's.
 *
 * The theme class has to be done here too. next-themes sets it from an inline
 * <script> it renders — which only runs in server-rendered HTML. Rendered on
 * the client, as here, the script is inert, the first frame is painted with no
 * class (the light tokens), and the class arrives an effect later: a flash of
 * light theme on every launch for anyone on a dark one.
 */
export function bootAppearance() {
    const prefs = loadAppearance();
    applyAppearance(prefs, scriptOf(currentLanguage()));
    try {
        const stored = localStorage.getItem("theme") ?? "system";
        const resolved =
            stored === "system"
                ? matchMedia("(prefers-color-scheme: dark)").matches
                    ? "dark"
                    : "light"
                : stored;
        const className = PROVIDER_CLASSES[resolved];
        if (className) {
            document.documentElement.classList.add(className);
        }
        applyCustomTheme(activeCustomTheme(prefs, stored));
    } catch {
        // No storage: the defaults stand, and next-themes catches up on mount.
    }
}
