import { contrastText, linearChannels, luminance, normalizeHex } from "@/lib/color";
import type { MessageKey } from "@/lib/i18n";
import type { PluginInfo } from "@/types";

export type ThemeMode = "light" | "dark";
type Hue = { h: number; c: number };
type Color = Hue & { l: number };

export interface ThemePalette {
  mode: ThemeMode;
  background: Color;
  accent: Hue;
  colors?: { background?: string; accent?: string };
  image?: { url: string; blur: number; brightness: number; saturate: number; dim: number; panel: number };
}

export interface CustomTheme extends ThemePalette {
  id: string;
  name: string;
}

const backgroundLightness = {
  dark: { min: 0, max: 0.38 },
  light: { min: 0.88, max: 1 },
};

const defaultAccent = { h: 277, c: 0.15 };
const defaultBackground = {
  dark: { h: 285, c: 0.018, l: 0.16 },
  light: { h: 85, c: 0.012, l: 0.98 },
};

export function defaultPalette(mode: ThemeMode): ThemePalette {
  return { mode, background: defaultBackground[mode], accent: defaultAccent };
}

export function backgroundMode(hex: string): ThemeMode {
  return contrastText(hex) === "#fff" ? "dark" : "light";
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

export function backgroundImage(url: string): ThemePalette["image"] {
  const safeURL = /^\/user-files\/backgrounds\/[a-f0-9]{16}\.(png|jpe?g|webp|gif)$/i.test(url)
    || /^\/plugins\/[a-z0-9._-]+\/(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*\.(png|jpe?g|webp|gif)$/i.test(url);
  if (!safeURL) return undefined;
  return { url, blur: 12, brightness: 0.9, saturate: 1, dim: 0.35, panel: 0.65 };
}

export function sanitizeTheme(raw: unknown, source: "custom" | "plugin" = "custom"): CustomTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CustomTheme>;
  const prefix = source === "custom" ? "custom-" : "plugin:";
  if (typeof value.id !== "string" || !value.id.startsWith(prefix) || value.id.length > 200) return null;
  const background = normalizeHex(value.colors?.background);
  const accent = normalizeHex(value.colors?.accent);
  const mode = background ? backgroundMode(background) : value.mode === "light" ? "light" : "dark";
  const range = backgroundLightness[mode];
  const defaults = defaultBackground[mode];
  const image = typeof value.image?.url === "string" ? backgroundImage(value.image.url) : undefined;
  if (image) {
    image.blur = clamp(value.image?.blur, 0, 40, image.blur);
    image.brightness = clamp(value.image?.brightness, 0.3, 1.5, image.brightness);
    image.saturate = clamp(value.image?.saturate, 0, 2, image.saturate);
    image.dim = clamp(value.image?.dim, 0, 0.9, image.dim);
    image.panel = clamp(value.image?.panel, 0.2, 1, image.panel);
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name.trim().slice(0, 60) : "",
    mode,
    background: {
      h: clamp(value.background?.h, 0, 360, defaults.h),
      c: clamp(value.background?.c, 0, 0.08, defaults.c),
      l: clamp(value.background?.l, range.min, range.max, defaults.l),
    },
    accent: {
      h: clamp(value.accent?.h, 0, 360, defaultAccent.h),
      c: clamp(value.accent?.c, 0, 0.25, defaultAccent.c),
    },
    colors: background || accent ? { background: background ?? undefined, accent: accent ?? undefined } : undefined,
    image,
  };
}

export function pluginThemes(plugins: PluginInfo[]): CustomTheme[] {
  return plugins.flatMap((plugin) =>
    !plugin.enabled || plugin.approval_required ? [] : plugin.themes.flatMap((theme) => {
      const valid = sanitizeTheme(theme, "plugin");
      return valid ? [valid] : [];
    }),
  );
}

export function oklch(l: number, { h, c }: Hue) {
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}

// Convert wallpaper seeds and preset colors from sRGB using the OKLab matrices.
function hexToOklch(hex: unknown): Color | null {
  if (typeof hex !== "string" || !/^#[a-f0-9]{6}$/i.test(hex)) return null;
  const [r, g, b] = linearChannels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: lightness, c: Math.hypot(a, bAxis), h: (Math.atan2(bAxis, a) * 180 / Math.PI + 360) % 360 };
}

export function wallpaperPalette(raw: unknown): ThemePalette | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { seed?: unknown; neutral2?: unknown; accent1?: unknown };
  const accent = hexToOklch(value.seed ?? (Array.isArray(value.accent1) ? value.accent1[2] : null));
  if (!accent) return null;
  const neutral = hexToOklch(Array.isArray(value.neutral2) ? value.neutral2[1] : null) ?? accent;
  return {
    mode: "dark",
    background: { h: neutral.h, c: Math.min(neutral.c * 0.55, 0.035), l: 0.16 },
    accent: { h: accent.h, c: Math.min(accent.c, 0.2) },
  };
}

const presetColors = [
  ["oled", "#000000", "#7aa6ef"],
  ["cosmos", "#080f20", "#3fb6d9"],
  ["violet", "#20162f", "#b28af2"],
  ["ocean", "#142132", "#78a9ef"],
  ["tokyo-night", "#1a1b26", "#7aa2f7"],
  ["dracula", "#282a36", "#bd93f9"],
  ["ctp-mocha", "#1e1e2e", "#cba6f7"],
  ["ctp-latte", "#eff1f5", "#8839ef", "light"],
  ["nord", "#2e3440", "#88c0d0"],
  ["gruvbox", "#282828", "#fabd2f"],
  ["slate", "#22262f", "#a9b9d6"],
  ["stone", "#2a2723", "#c4ad95"],
  ["emerald", "#14261f", "#6ec7a2"],
  ["sunset", "#2d1d16", "#f29662"],
  ["rose", "#2a161e", "#ea8ca9"],
  ["paper", "#fbf8ef", "#a87539", "light"],
  ["frost", "#f4f9ff", "#3c6ca8", "light"],
  ["sakura", "#fff7f9", "#c2336a", "light"],
  ["mint", "#f4fbf8", "#0f7a5f", "light"],
  ["contrast", "#000000", "#fbd823"],
  ["contrast-light", "#ffffff", "#7a3f00", "light"],
  ["mocha", "#211810", "#bc9777"],
  ["ember", "#1a1210", "#ff6b3d"],
  ["crimson", "#14090d", "#e66e82"],
  ["teal", "#0d1a1a", "#2dd4bf"],
  ["solarized-light", "#fdf6e3", "#b58900", "light"],
  ["ctp-frappe", "#303446", "#ca9ee6"],
  ["ctp-macchiato", "#24273a", "#c6a0f6"],
  ["rose-pine", "#191724", "#ebbcba"],
  ["everforest", "#2d353b", "#a7c080"],
] as const;

export const themePresets = presetColors.map(([id, background, accent, mode]) => ({
  id,
  label: `theme.${id}` satisfies MessageKey,
  palette: {
    mode: mode ?? "dark",
    background: hexToOklch(background)!,
    accent: hexToOklch(accent)!,
  } satisfies ThemePalette,
}));

export function paletteTokens(palette: ThemePalette) {
  const { background, accent, colors, mode } = palette;
  const dark = mode === "dark";
  const exactBackground = colors?.background;
  const page = exactBackground ?? oklch(background.l, background);
  const card = exactBackground
    ? `color-mix(in srgb, ${page} 85%, ${dark ? "#29292f" : "#f0f0f3"})`
    : oklch(Math.min(1, background.l + (dark ? 0.065 : 0.015)), background);
  const raised = exactBackground
    ? `color-mix(in srgb, ${page} 70%, ${dark ? "#48484e" : "#d8d8dd"})`
    : oklch(background.l + (dark ? 0.13 : -0.058), background);
  const foreground = exactBackground ? contrastText(exactBackground) : dark ? "#f8f8fb" : "#191920";
  const muted = exactBackground
    ? `color-mix(in srgb, ${foreground} ${(dark ? luminance(page) <= 0.10 : luminance(page) >= 0.31) ? 82 : 100}%, ${page})`
    : oklch(dark ? 0.77 : 0.43, { h: background.h, c: Math.min(0.02, background.c) });
  const primary = colors?.accent ?? oklch(dark ? 0.79 : 0.48, accent);
  const onPrimary = colors?.accent ? contrastText(colors.accent) : dark ? "#18181d" : "#fff";
  const ring = colors?.accent ? `color-mix(in srgb, ${primary}, ${foreground} 55%)` : primary;
  const border = `color-mix(in srgb, ${foreground} 16%, ${page})`;
  return {
    "--background": page,
    "--foreground": foreground,
    "--card": card,
    "--card-foreground": foreground,
    "--popover": card,
    "--popover-foreground": foreground,
    "--primary": primary,
    "--primary-foreground": onPrimary,
    "--muted": raised,
    "--muted-foreground": muted,
    "--secondary": raised,
    "--secondary-foreground": foreground,
    "--accent": raised,
    "--accent-foreground": foreground,
    "--border": border,
    "--input": border,
    "--ring": ring,
    "--sidebar": card,
    "--sidebar-foreground": foreground,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": onPrimary,
    "--sidebar-accent": raised,
    "--sidebar-accent-foreground": foreground,
    "--sidebar-border": border,
    "--sidebar-ring": ring,
  };
}
