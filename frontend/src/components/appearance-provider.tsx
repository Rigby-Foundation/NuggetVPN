import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
} from "react";

import { ThemeProvider, useTheme } from "@/components/theme-provider";
import {
    activeCustomTheme,
    AppearancePrefs,
    applyAppearance,
    applyAccent,
    applyCustomTheme,
    CUSTOM_THEME_CLASSES,
    CUSTOM_THEME_IDS,
    CustomTheme,
    DEFAULT_APPEARANCE,
    DEFAULT_LAYOUT,
    LayoutPrefs,
    loadAppearance,
    PLUGIN_THEME_PREFIX,
    saveAppearance,
    setPluginFonts,
    setUserFonts,
    UserFont,
    USER_FONT_PREFIX,
} from "@/lib/appearance";
import { invoke } from "@/lib/backend";
import { backgroundHex, loadMonet, monetTheme, saveMonet, SystemPalette } from "@/lib/monet";
import { isAndroid } from "@/lib/platform";
import { currentLanguage, scriptOf, useI18n } from "@/lib/i18n";
import { THEME_CLASSES, THEME_IDS } from "@/lib/themes";

interface AppearanceContext {
    prefs: AppearancePrefs;
    setFont: (id: string) => void;
    setRadius: (id: string) => void;
    /** Chooses a radius of its own, in rem. */
    setRadiusCustom: (rem: number) => void;
    setMotion: (id: string) => void;
    setMotionSpeed: (speed: number) => void;
    setMotionStagger: (ms: number) => void;
    setUnits: (units: AppearancePrefs["units"]) => void;
    /** An accent over the theme's; null goes back to the theme's. */
    setAccent: (accent: AppearancePrefs["accent"]) => void;
    setLayout: (layout: Partial<LayoutPrefs>) => void;
    resetLayout: () => void;
    /** The custom theme on screen, if one is. */
    activeCustom: CustomTheme | undefined;
    /** Shows a custom theme. */
    showCustomTheme: (theme: CustomTheme) => void;
    /** Adds the theme, or replaces the one with the same id. */
    saveCustomTheme: (theme: CustomTheme) => void;
    deleteCustomTheme: (id: string) => void;
    /** Adds a font the backend stored, and chooses it. */
    addUserFont: (font: UserFont) => void;
    removeUserFont: (id: string) => void;
    /** Whether "system" follows the wallpaper's colours (Android 12+). */
    hasMonet: boolean;
    /** Replaces the themes and fonts the enabled plugins bring. */
    setPluginContent: (themes: CustomTheme[], fonts: UserFont[]) => void;
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
    const { theme, setTheme, resolvedTheme } = useTheme();
    // Android 12's wallpaper colours, which "system" follows there.
    const [monet, setMonet] = useState<CustomTheme | null>(() => (isAndroid ? loadMonet() : null));
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
        applyCustomTheme(activeCustom ?? (theme === "system" ? monet ?? undefined : undefined));
        // After the theme, which clears and rewrites the same properties.
        applyAccent(prefs.accent);
    }, [activeCustom, theme, monet, prefs.accent]);

    useEffect(() => {
        if (!isAndroid) return;
        const load = () =>
            invoke<SystemPalette | null>("get_system_palette")
                .then((palette) => {
                    const next = palette ? monetTheme(palette) : null;
                    setMonet(next);
                    saveMonet(next);
                })
                .catch(() => undefined);
        void load();
        // The wallpaper, or dark mode, may have changed while away.
        const onVisible = () => {
            if (document.visibilityState === "visible") void load();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, []);

    // The status and navigation bars follow the page.
    useEffect(() => {
        if (!isAndroid) return;
        const frame = requestAnimationFrame(() => {
            const color = backgroundHex();
            if (!color) return;
            const dark = document.documentElement.classList.contains("dark") ||
                [...document.documentElement.classList].some((name) => name.startsWith("theme-dark-"));
            void invoke("set_system_bars", { color, light: !dark }).catch(() => undefined);
        });
        return () => cancelAnimationFrame(frame);
    }, [theme, resolvedTheme, activeCustom, monet]);

    const update = useCallback((patch: Partial<AppearancePrefs>) => {
        setPrefs((current) => ({ ...current, ...patch }));
    }, []);

    // The backend's folder is the truth about user fonts: a backup restored,
    // or a file removed by hand, shows here once the app starts.
    useEffect(() => {
        invoke<UserFont[]>("list_user_files", { kind: "fonts" })
            .then((fonts) => {
                if (!Array.isArray(fonts)) return;
                setUserFonts(fonts);
                setPrefs((current) => {
                    const ids = new Set(fonts.map((font) => USER_FONT_PREFIX + font.id));
                    const font = current.font.startsWith(USER_FONT_PREFIX) && !ids.has(current.font) ? DEFAULT_APPEARANCE.font : current.font;
                    return { ...current, userFonts: fonts, font };
                });
            })
            .catch(() => undefined);
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
            setRadiusCustom: (radiusCustom) => update({ radius: "custom", radiusCustom }),
            setMotion: (motion) => update({ motion }),
            setMotionSpeed: (motionSpeed) => update({ motionSpeed }),
            setMotionStagger: (motionStagger) => update({ motionStagger }),
            setUnits: (units) => update({ units }),
            setAccent: (accent) => update({ accent }),
            setLayout: (layoutPatch) => {
                setPrefs((current) => ({
                    ...current,
                    layout: {
                        ...current.layout,
                        ...layoutPatch,
                        ...(layoutPatch.telemetryVisible ? {
                            telemetryVisible: {
                                ...current.layout.telemetryVisible,
                                ...layoutPatch.telemetryVisible,
                            },
                        } : {}),
                    },
                }));
            },
            resetLayout: () => {
                setPrefs((current) => ({
                    ...current,
                    layout: { ...DEFAULT_LAYOUT },
                }));
            },
            activeCustom,
            hasMonet: monet !== null,
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
            addUserFont: (font) => {
                setPrefs((current) => {
                    const userFonts = [...current.userFonts.filter((item) => item.id !== font.id), font];
                    setUserFonts(userFonts);
                    return { ...current, userFonts, font: USER_FONT_PREFIX + font.id };
                });
            },
            removeUserFont: (id) => {
                void invoke("remove_user_file", { kind: "fonts", id }).catch(() => undefined);
                setPrefs((current) => {
                    const userFonts = current.userFonts.filter((item) => item.id !== id);
                    setUserFonts(userFonts);
                    return {
                        ...current,
                        userFonts,
                        font: current.font === USER_FONT_PREFIX + id ? DEFAULT_APPEARANCE.font : current.font,
                    };
                });
            },
            setPluginContent: (themes, fonts) => {
                setPluginFonts(fonts);
                // The plugin theme on screen went with its plugin.
                if (activeCustom?.id.startsWith(PLUGIN_THEME_PREFIX) && !themes.some((item) => item.id === activeCustom.id)) {
                    setTheme("system");
                }
                setPrefs((current) => {
                    const ids = new Set(fonts.map((font) => USER_FONT_PREFIX + font.id));
                    const fontGone = current.font.startsWith(USER_FONT_PREFIX + "plugin-") && !ids.has(current.font);
                    const activeGone = current.activeCustom.startsWith("plugin:") && !themes.some((item) => item.id === current.activeCustom);
                    return {
                        ...current,
                        pluginThemes: themes,
                        pluginFonts: fonts,
                        font: fontGone ? DEFAULT_APPEARANCE.font : current.font,
                        activeCustom: activeGone ? "" : current.activeCustom,
                    };
                });
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
        [activeCustom, monet, prefs, setTheme, update, showCustomTheme]
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
        applyCustomTheme(activeCustomTheme(prefs, stored) ?? (isAndroid && stored === "system" ? loadMonet() ?? undefined : undefined));
    } catch {
        // No storage: the defaults stand, and next-themes catches up on mount.
    }
}
