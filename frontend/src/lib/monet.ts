/**
 * Material You on Android: the "system" theme takes its colours from the
 * wallpaper, the way the phone's own apps do, instead of plain black or
 * white.
 *
 * Android 12 and later derive tonal palettes from the wallpaper
 * (system_accent1_*, system_neutral1_*, …). The backend hands a few tones of
 * them over as hex; this turns them into the theme editor's numbers — hue,
 * tint and lightness in OKLCH — so the result is an ordinary custom theme,
 * with every other part of the theming working as it does anywhere.
 */
import { BACKGROUND_LIGHTNESS, CustomTheme } from "@/lib/appearance";

/** What GetSystemPalette returns; see NuggetBridge.systemPalette. */
export interface SystemPalette {
    dark: boolean;
    /** accent1 tones 100, 200, 500, 600. */
    accent1: string[];
    /** neutral1 tones 10, 50, 900. */
    neutral1: string[];
    /** neutral2 tones 100, 500, 800. */
    neutral2: string[];
}

export const MONET_THEME_ID = "custom-monet";

/** sRGB hex to OKLCH, per Björn Ottosson's OKLab. */
export function hexToOklch(hex: string): { l: number; c: number; h: number } | null {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const value = parseInt(match[1], 16);
    const linear = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const [r, g, b] = linear;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const c = Math.sqrt(A * A + B * B);
    let h = (Math.atan2(B, A) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { l: L, c, h };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * The theme for a palette. The page is tinted with the neutral2 hue — the
 * faint colour cast Android gives its own surfaces — and the accent is
 * accent1, vivid enough to read as the wallpaper's colour.
 */
export function monetTheme(palette: SystemPalette): CustomTheme | null {
    const mode = palette.dark ? "dark" : "light";
    const surface = hexToOklch(palette.neutral2[1] ?? "");
    const accent = hexToOklch(palette.accent1[2] ?? "");
    if (!surface || !accent) return null;
    const range = BACKGROUND_LIGHTNESS[mode];
    return {
        id: MONET_THEME_ID,
        name: "Material You",
        mode,
        background: {
            h: surface.h,
            // Android's surfaces are only just tinted; a little more reads
            // as intended on a page this large.
            c: clamp(surface.c * 0.6, 0.004, 0.03),
            l: mode === "dark" ? clamp(0.16, range.min, range.max) : clamp(0.975, range.min, range.max),
        },
        accent: { h: accent.h, c: clamp(accent.c, 0.06, 0.2) },
    };
}

const STORAGE_KEY = "nugget.monet";

/** The last Monet theme, so the first frame after start already has it. */
export function loadMonet(): CustomTheme | null {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        return raw && typeof raw === "object" && raw.id === MONET_THEME_ID ? (raw as CustomTheme) : null;
    } catch {
        return null;
    }
}

export function saveMonet(theme: CustomTheme | null) {
    try {
        if (theme) localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // No storage: it is fetched again next time.
    }
}

/**
 * The page's background as #RRGGBB, however the theme wrote it: drawn on a
 * one-pixel canvas and read back, since the tokens are OKLCH.
 */
export function backgroundHex(): string | null {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // The theme's own token: the page itself is see-through, for the window.
    const probe = document.createElement("span");
    probe.style.color = "var(--background)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    context.fillStyle = color || "#000";
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
}
