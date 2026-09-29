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
// Full coverage for the non-Latin, non-Cyrillic scripts the UI is shown in.
// The CJK fonts are sliced by unicode-range, so a page only ever loads the
// few slices its characters fall in.
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-sans-jp";
import "@fontsource-variable/vazirmatn";

import type { MessageKey, Script, Translate } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FontOption {
    id: string;
    /** A font's own name, which is not translated; see fontLabel. */
    label: string;
    /** Goes into --app-font; the stack in App.css supplies the fallbacks. */
    family: string;
    /**
     * The scripts the font covers completely — every letter, not most of
     * them. Read from each font package's own subset list, not assumed.
     * The picker offers a font only for languages written in one of these.
     */
    scripts: readonly Script[] | "all";
}

/** All self-hosted: a VPN client fetching fonts from Google would be a leak. */
export const FONTS: FontOption[] = [
    { id: "google-sans", label: "Google Sans", family: "'Google Sans'", scripts: ["latin"] },
    { id: "rubik", label: "Rubik", family: "'Rubik Variable'", scripts: ["latin", "cyrillic", "arab"] },
    { id: "manrope", label: "Manrope", family: "'Manrope Variable'", scripts: ["latin", "cyrillic"] },
    { id: "geologica", label: "Geologica", family: "'Geologica Variable'", scripts: ["latin", "cyrillic"] },
    { id: "onest", label: "Onest", family: "'Onest Variable'", scripts: ["latin", "cyrillic"] },
    { id: "noto-sans-sc", label: "Noto Sans SC", family: "'Noto Sans SC Variable'", scripts: ["latin", "cyrillic", "hans"] },
    { id: "noto-sans-jp", label: "Noto Sans JP", family: "'Noto Sans JP Variable'", scripts: ["latin", "cyrillic", "jpan"] },
    { id: "vazirmatn", label: "Vazirmatn", family: "'Vazirmatn Variable'", scripts: ["latin", "arab"] },
    // The system UI font: whatever the OS draws its own interface with, which
    // covers the OS's language by definition.
    { id: "system", label: "", family: "system-ui", scripts: "all" },
];

/**
 * The font each script falls back to when the chosen one does not cover it.
 * Every script the UI can be shown in needs an entry here.
 */
const DEFAULT_FONT: Record<Script, string> = {
    latin: "google-sans",
    cyrillic: "onest",
    hans: "noto-sans-sc",
    jpan: "noto-sans-jp",
    arab: "vazirmatn",
};

/**
 * A font the user added, from a file. Stored in the backend's data folder
 * and loaded from /user-files/fonts/; listed here so the choice can be
 * applied at start, before the backend answers.
 */
export interface UserFont {
    id: string;
    name: string;
    url: string;
}

/** Prefix for the id of a user font among the font options. */
export const USER_FONT_PREFIX = "user:";

const USER_FONT_URL = /^\/user-files\/fonts\/[a-f0-9]{16}\.(ttf|otf|woff2?)$/;

let userFontOptions: FontOption[] = [];

/**
 * Makes the user's fonts available: an @font-face for each, and an entry
 * among the font options. Which scripts a file covers cannot be known ahead,
 * so a user font is offered for every language; the fallback stack draws any
 * letter it lacks.
 */
export function setUserFonts(fonts: UserFont[]) {
    const valid = fonts.filter((font) => USER_FONT_URL.test(font.url) && /^[a-f0-9]{16}$/.test(font.id));
    userFontOptions = valid.map((font) => ({
        id: USER_FONT_PREFIX + font.id,
        label: font.name || font.id,
        family: `'User ${font.id}'`,
        scripts: "all" as const,
    }));
    let style = document.getElementById("user-fonts") as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = "user-fonts";
        document.head.appendChild(style);
    }
    style.textContent = valid
        .map((font) => `@font-face { font-family: 'User ${font.id}'; src: url("${font.url}"); font-display: swap; }`)
        .join("\n");
}

/** Every font on offer: the bundled ones and the user's. */
export function allFonts(): FontOption[] {
    return [...FONTS, ...userFontOptions];
}

/** Whether a font fully covers a script. */
export function covers(font: FontOption, script: Script): boolean {
    return font.scripts === "all" || font.scripts.includes(script);
}

/** The fonts offered for a script: only the ones that cover it completely. */
export function fontsFor(script: Script): FontOption[] {
    return allFonts().filter((font) => covers(font, script));
}

/**
 * The font actually used: the chosen one if it covers the language, or the
 * script's default if it does not. The choice itself is kept, so switching
 * back to a language it covers restores it.
 */
export function effectiveFont(chosen: string, script: Script): FontOption {
    const font = allFonts().find((option) => option.id === chosen);
    if (font && covers(font, script)) {
        return font;
    }
    return FONTS.find((option) => option.id === DEFAULT_FONT[script]) ?? FONTS[FONTS.length - 1];
}

/** A font's name as shown: its own name, or the translated "System". */
export function fontLabel(t: Translate, id: string): string {
    if (id === "system") return t("appearance.font.system");
    return allFonts().find((font) => font.id === id)?.label ?? id;
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
    /** A picture behind the app, with its effects; none when absent. */
    image?: ThemeImage;
}

/**
 * A custom theme's background picture and what is done to it. The effects
 * are CSS filters on the picture, a wash of the theme's own background
 * colour over it, and how much of the picture the app's panels let through.
 */
export interface ThemeImage {
    /** /user-files/backgrounds/<file>, from the backend. */
    url: string;
    /** Blur radius, px: 0–40. */
    blur: number;
    /** 0.3–1.5; 1 leaves it as it is. */
    brightness: number;
    /** 0–2; 0 is black and white, 1 as it is. */
    saturate: number;
    /** How much of the theme's background colour is washed over it: 0–0.9. */
    dim: number;
    /** How opaque the app's panels are over it: 0.2 (glassy) to 1 (solid). */
    panel: number;
}

export const THEME_IMAGE_LIMITS = {
    blur: { min: 0, max: 40, step: 1, fallback: 12 },
    brightness: { min: 0.3, max: 1.5, step: 0.05, fallback: 0.9 },
    saturate: { min: 0, max: 2, step: 0.05, fallback: 1 },
    dim: { min: 0, max: 0.9, step: 0.05, fallback: 0.35 },
    panel: { min: 0.2, max: 1, step: 0.05, fallback: 0.65 },
} as const;

const BACKGROUND_URL = /^\/user-files\/backgrounds\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/;

/** A new picture's effects: blurred and darkened enough for text to read. */
export function defaultThemeImage(url: string): ThemeImage {
    return {
        url,
        blur: THEME_IMAGE_LIMITS.blur.fallback,
        brightness: THEME_IMAGE_LIMITS.brightness.fallback,
        saturate: THEME_IMAGE_LIMITS.saturate.fallback,
        dim: THEME_IMAGE_LIMITS.dim.fallback,
        panel: THEME_IMAGE_LIMITS.panel.fallback,
    };
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
    /** The fonts the user added; see UserFont. */
    userFonts: UserFont[];
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
    font: "google-sans",
    radius: "medium",
    motion: "fade",
    customThemes: [],
    activeCustom: "",
    userFonts: [],
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
        image: sanitizeImage(value.image),
    };
}

function sanitizeImage(raw: unknown): ThemeImage | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Partial<ThemeImage>;
    if (typeof value.url !== "string" || !BACKGROUND_URL.test(value.url)) return undefined;
    const limit = (key: keyof typeof THEME_IMAGE_LIMITS) => {
        const { min, max, fallback } = THEME_IMAGE_LIMITS[key];
        return clamp(value[key], min, max, fallback);
    };
    return {
        url: value.url,
        blur: limit("blur"),
        brightness: limit("brightness"),
        saturate: limit("saturate"),
        dim: limit("dim"),
        panel: limit("panel"),
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
        const userFonts: UserFont[] = Array.isArray(raw.userFonts)
            ? raw.userFonts.filter(
                  (font: unknown): font is UserFont =>
                      !!font &&
                      typeof (font as UserFont).id === "string" &&
                      typeof (font as UserFont).url === "string" &&
                      typeof (font as UserFont).name === "string"
              )
            : [];
        // Before picking the font: a user font is only a valid choice once
        // it is registered.
        setUserFonts(userFonts);
        return {
            userFonts,
            font: pick(allFonts(), raw.font, DEFAULT_APPEARANCE.font),
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
export function applyAppearance(prefs: AppearancePrefs, script: Script) {
    const root = document.documentElement;
    const font = effectiveFont(prefs.font, script);
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
    applyBackdrop(theme?.image);
    if (!theme) return;
    for (const [name, value] of Object.entries(customThemeKnobs(theme))) {
        root.style.setProperty(name, value);
    }
}

/**
 * Puts a theme's picture behind the app, or takes it away.
 *
 * The picture is a fixed layer at the back of the page with the effects as
 * CSS filters. data-backdrop on <html> makes the page, cards and sidebar
 * see-through by --backdrop-panel (see App.css); menus and dialogs stay
 * solid, so they are always readable.
 */
export function applyBackdrop(image: ThemeImage | undefined) {
    const root = document.documentElement;
    let layer = document.getElementById("app-backdrop");
    if (!image || !BACKGROUND_URL.test(image.url)) {
        layer?.remove();
        delete root.dataset.backdrop;
        root.style.removeProperty("--backdrop-panel");
        root.style.removeProperty("--backdrop-dim");
        return;
    }
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "app-backdrop";
        layer.setAttribute("aria-hidden", "true");
        document.body.prepend(layer);
    }
    layer.style.backgroundImage = `url("${image.url}")`;
    layer.style.filter = `blur(${image.blur}px) brightness(${image.brightness}) saturate(${image.saturate})`;
    root.dataset.backdrop = "";
    root.style.setProperty("--backdrop-panel", String(image.panel));
    root.style.setProperty("--backdrop-dim", String(image.dim));
}
