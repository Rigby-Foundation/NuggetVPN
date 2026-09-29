/**
 * Appearance preferences other than the theme preset: font, corner radius,
 * page transition, and user-made themes.
 *
 * They live beside the theme, in this renderer's storage, for the same reason
 * the theme does: they have to apply before the first frame, and a round trip
 * to Go at startup would show the default font and corners and then jump.
 */

import "@fontsource-variable/rubik";
import "@fontsource-variable/manrope";
import "@fontsource-variable/geologica";
import "@fontsource-variable/onest";

import type { MessageKey, Translate } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FontOption {
    id: string;
    /** A font's own name, which is not translated; see fontLabel. */
    label: string;
    /** Goes into --app-font; the stack in App.css supplies the fallbacks. */
    family: string;
}

/** All self-hosted: a VPN client fetching fonts from Google would be a leak. */
export const FONTS: FontOption[] = [
    { id: "google-sans", label: "Google Sans", family: "'Google Sans'" },
    { id: "rubik", label: "Rubik", family: "'Rubik Variable'" },
    { id: "manrope", label: "Manrope", family: "'Manrope Variable'" },
    { id: "geologica", label: "Geologica", family: "'Geologica Variable'" },
    { id: "onest", label: "Onest", family: "'Onest Variable'" },
    { id: "system", label: "", family: "system-ui" },
];

/** A font's name as shown: its own name, or the translated "System". */
export function fontLabel(t: Translate, id: string): string {
    if (id === "system") return t("appearance.font.system");
    return FONTS.find((font) => font.id === id)?.label ?? id;
}

export interface RadiusOption {
    id: string;
    label: MessageKey;
    value: string;
}

export const RADII: RadiusOption[] = [
    { id: "small", label: "appearance.radius.small", value: "0.375rem" },
    { id: "medium", label: "appearance.radius.medium", value: "0.625rem" },
    { id: "large", label: "appearance.radius.large", value: "0.875rem" },
    { id: "round", label: "appearance.radius.round", value: "1.25rem" },
];

export interface MotionOption {
    id: string;
    label: MessageKey;
    hint: MessageKey;
}

export const MOTIONS: MotionOption[] = [
    { id: "slide", label: "appearance.motion.slide", hint: "appearance.motion.slide.hint" },
    { id: "rise", label: "appearance.motion.rise", hint: "appearance.motion.rise.hint" },
    { id: "fade", label: "appearance.motion.fade", hint: "appearance.motion.fade.hint" },
    { id: "none", label: "appearance.motion.none", hint: "appearance.motion.none.hint" },
];

// ---------------------------------------------------------------------------
// Custom themes
// ---------------------------------------------------------------------------

/**
 * A theme the user made.
 *
 * It is described in the same knobs the presets are made of, not as a list of
 * arbitrary colours, so every derived token stays consistent with the rest:
 * cards are always a step above the page, borders always visible. The accent's
 * lightness is not offered at all — it is fixed per mode, because that is what
 * keeps the text on a primary button readable whatever hue is picked.
 */
export interface CustomTheme {
    id: string;
    name: string;
    mode: "light" | "dark";
    /** The page: hue 0–360, tint (chroma) and lightness. */
    background: { h: number; c: number; l: number };
    /** The accent: hue and vividness (chroma). */
    accent: { h: number; c: number };
}

/** Prefix for a stored custom theme's id. */
export const CUSTOM_PREFIX = "custom-";

/**
 * The two theme ids next-themes knows custom themes by, one per mode.
 *
 * next-themes captures its theme-to-class map once, on first render, so a
 * theme added later would never get its class applied. It is therefore given
 * two fixed ids, and which custom theme is showing is tracked separately
 * (AppearancePrefs.activeCustom): the id decides the class, the record decides
 * the colours.
 */
export const CUSTOM_THEME_IDS = { dark: "custom-dark", light: "custom-light" } as const;

export function isCustomThemeId(theme: string | undefined): boolean {
    return theme === CUSTOM_THEME_IDS.dark || theme === CUSTOM_THEME_IDS.light;
}

/** The class a custom theme needs; the prefix marks it light or dark. */
export function customClass(theme: Pick<CustomTheme, "mode">): string {
    return theme.mode === "dark" ? "theme-dark-custom" : "theme-light-custom";
}

/** The classes next-themes applies for the two custom ids. */
export const CUSTOM_THEME_CLASSES = {
    [CUSTOM_THEME_IDS.dark]: customClass({ mode: "dark" }),
    [CUSTOM_THEME_IDS.light]: customClass({ mode: "light" }),
};

/** Lightness range offered for the page in each mode. */
export const BACKGROUND_LIGHTNESS = {
    dark: { min: 0, max: 0.3 },
    light: { min: 0.9, max: 1 },
} as const;

/** The accent lightness each mode uses, chosen for 4.5:1 against its text. */
const ACCENT_LIGHTNESS = { dark: 0.78, light: 0.56 } as const;

/**
 * The knob values a custom theme sets.
 *
 * The two raised surfaces are derived from the page lightness, stepping toward
 * the foreground: up in a dark theme, down in a light one.
 */
export function customThemeKnobs(theme: CustomTheme): Record<string, string> {
    const { h, c, l } = theme.background;
    const dark = theme.mode === "dark";
    const card = dark ? l + 0.07 : Math.min(1, l + 0.02);
    const lift = dark ? l + 0.13 : l - 0.035;
    return {
        "--ui-h": String(h),
        "--ui-c": String(c),
        "--ui-bg-l": String(l),
        "--ui-card-l": String(Math.min(1, card)),
        "--ui-lift-l": String(Math.max(0, lift)),
        "--brand-l": String(ACCENT_LIGHTNESS[theme.mode]),
        "--brand-c": String(theme.accent.c),
        "--brand-h": String(theme.accent.h),
    };
}

/** A swatch for the picker, from the same numbers. */
export function customThemeSwatch(theme: CustomTheme) {
    const knobs = customThemeKnobs(theme);
    const { h, c } = theme.background;
    return {
        background: `oklch(${knobs["--ui-bg-l"]} ${c} ${h})`,
        surface: `oklch(${knobs["--ui-lift-l"]} ${c} ${h})`,
        accent: `oklch(${knobs["--brand-l"]} ${theme.accent.c} ${theme.accent.h})`,
    };
}

export function newCustomTheme(mode: "light" | "dark" = "dark"): CustomTheme {
    return {
        id: CUSTOM_PREFIX + Math.random().toString(36).slice(2, 10),
        name: "",
        mode,
        background: mode === "dark" ? { h: 285, c: 0.02, l: 0.15 } : { h: 85, c: 0.01, l: 0.98 },
        accent: { h: 70, c: 0.15 },
    };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface AppearancePrefs {
    font: string;
    radius: string;
    motion: string;
    customThemes: CustomTheme[];
    /** Which custom theme a custom-dark or custom-light theme id shows. */
    activeCustom: string;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
    font: "google-sans",
    radius: "medium",
    motion: "fade",
    customThemes: [],
    activeCustom: "",
};

const STORAGE_KEY = "nugget.appearance";

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, number));
}

/** Rebuilds a stored theme field by field, so a hand-edited or old entry cannot break the page. */
function sanitizeTheme(raw: unknown): CustomTheme | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Partial<CustomTheme>;
    if (typeof value.id !== "string" || !value.id.startsWith(CUSTOM_PREFIX)) return null;
    const mode = value.mode === "light" ? "light" : "dark";
    const range = BACKGROUND_LIGHTNESS[mode];
    return {
        id: value.id,
        name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, 40) : "",
        mode,
        background: {
            h: clamp(value.background?.h, 0, 360, 285),
            c: clamp(value.background?.c, 0, 0.08, 0.02),
            l: clamp(value.background?.l, range.min, range.max, mode === "dark" ? 0.15 : 0.98),
        },
        accent: {
            h: clamp(value.accent?.h, 0, 360, 70),
            c: clamp(value.accent?.c, 0, 0.25, 0.15),
        },
    };
}

export function loadAppearance(): AppearancePrefs {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (!raw || typeof raw !== "object") return DEFAULT_APPEARANCE;
        const pick = <T extends { id: string }>(options: T[], id: unknown, fallback: string) =>
            options.some((option) => option.id === id) ? (id as string) : fallback;
        const customThemes: CustomTheme[] = Array.isArray(raw.customThemes)
            ? (raw.customThemes.map(sanitizeTheme).filter(Boolean) as CustomTheme[])
            : [];
        return {
            font: pick(FONTS, raw.font, DEFAULT_APPEARANCE.font),
            radius: pick(RADII, raw.radius, DEFAULT_APPEARANCE.radius),
            motion: pick(MOTIONS, raw.motion, DEFAULT_APPEARANCE.motion),
            customThemes,
            activeCustom: customThemes.some((theme) => theme.id === raw.activeCustom)
                ? raw.activeCustom
                : "",
        };
    } catch {
        return DEFAULT_APPEARANCE;
    }
}

export function saveAppearance(prefs: AppearancePrefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Storage can be unavailable; the choice still applies for this run.
    }
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

const KNOB_NAMES = Object.keys(customThemeKnobs(newCustomTheme()));

/** The custom theme on screen for a given next-themes id, if any. */
export function activeCustomTheme(prefs: AppearancePrefs, theme: string | null | undefined) {
    if (!isCustomThemeId(theme ?? undefined)) return undefined;
    return prefs.customThemes.find((item) => item.id === prefs.activeCustom);
}

/** Writes font, radius and motion onto <html>. */
export function applyAppearance(prefs: AppearancePrefs) {
    const root = document.documentElement;
    const font = FONTS.find((option) => option.id === prefs.font) ?? FONTS[0];
    const radius = RADII.find((option) => option.id === prefs.radius) ?? RADII[1];
    root.style.setProperty("--app-font", font.family);
    root.style.setProperty("--radius", radius.value);
    root.dataset.motion = prefs.motion;
}

/**
 * Sets or clears a custom theme's knobs on <html>.
 *
 * They go on as inline style, which outranks the preset blocks, and are
 * removed again whenever a built-in theme is active so none of them leak into
 * it.
 */
export function applyCustomTheme(theme: CustomTheme | undefined) {
    const root = document.documentElement;
    for (const name of KNOB_NAMES) {
        root.style.removeProperty(name);
    }
    if (!theme) return;
    for (const [name, value] of Object.entries(customThemeKnobs(theme))) {
        root.style.setProperty(name, value);
    }
}
