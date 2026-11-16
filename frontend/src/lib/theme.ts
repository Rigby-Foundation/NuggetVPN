import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "@/lib/backend";
import { cssColorToHex } from "@/lib/color";
import { hasNativeRuntime, isAndroid, isIOS } from "@/lib/platform";
import {
  defaultPalette,
  paletteTokens,
  pluginThemes,
  sanitizeTheme,
  themePresets,
  wallpaperPalette,
  type CustomTheme,
  type ThemeMode,
  type ThemePalette,
} from "@/lib/theme-palette";
import type { PluginInfo } from "@/types";

const appearanceKey = "nugget.appearance";
const wallpaperID = "wallpaper";
const presetPalettes = new Map<string, ThemePalette>(themePresets.map(({ id, palette }) => [id, palette]));

interface ThemeState {
  selected: string;
  custom: CustomTheme[];
  wallpaper: ThemePalette | null | undefined;
}

function storedAppearance(): { customThemes?: unknown; activeCustom?: unknown } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(appearanceKey) ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function storedThemes(): ThemeState {
  const appearance = storedAppearance();
  const custom = Array.isArray(appearance.customThemes)
    ? appearance.customThemes.flatMap((item) => {
        const valid = sanitizeTheme(item);
        return valid ? [valid] : [];
      })
    : [];
  let selected = "dark";
  try {
    const saved = localStorage.getItem("theme") ?? selected;
    const legacyCustom = saved === "custom-dark" || saved === "custom-light";
    const id = legacyCustom && typeof appearance.activeCustom === "string" ? appearance.activeCustom : saved;
    const basic = id.toLowerCase();
    if (["light", "dark", "system"].includes(basic)) selected = basic;
    else if (id === wallpaperID || presetPalettes.has(id) || custom.some((item) => item.id === id) || id.startsWith("plugin:")) {
      selected = id;
    }
  } catch {
    // Use the default if storage is unavailable.
  }
  return { selected, custom, wallpaper: undefined };
}

let themeState = storedThemes();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => listeners.forEach((listener) => listener());
const themeSnapshot = () => themeState;

export function useThemeState() {
  return useSyncExternalStore(subscribe, themeSnapshot, themeSnapshot);
}

export function selectTheme(selected: string) {
  themeState = { ...themeState, selected };
  try {
    localStorage.setItem("theme", selected);
  } catch {
    // The choice still applies in this window.
  }
  notify();
}

function storeCustomThemes(custom: CustomTheme[], selected: string) {
  themeState = { ...themeState, custom };
  try {
    localStorage.setItem(appearanceKey, JSON.stringify({ ...storedAppearance(), customThemes: custom }));
  } catch {
    // These themes still work for the current session.
  }
  selectTheme(selected);
}

export function saveCustomTheme(theme: CustomTheme) {
  const valid = sanitizeTheme(theme);
  if (!valid || !valid.name) return;
  const exists = themeState.custom.some((item) => item.id === valid.id);
  const custom = exists
    ? themeState.custom.map((item) => item.id === valid.id ? valid : item)
    : [...themeState.custom, valid];
  storeCustomThemes(custom, valid.id);
}

export function deleteCustomTheme(theme: CustomTheme) {
  const custom = themeState.custom.filter((item) => item.id !== theme.id);
  const selected = themeState.selected === theme.id ? theme.mode : themeState.selected;
  storeCustomThemes(custom, selected);
}

let wallpaperRequest: Promise<void> | undefined;

async function refreshWallpaper() {
  if (!hasNativeRuntime()) return;
  wallpaperRequest ??= invoke("get_system_palette")
    .then((value) => {
      const wallpaper = wallpaperPalette(value);
      if (JSON.stringify(wallpaper) !== JSON.stringify(themeState.wallpaper)) {
        themeState = { ...themeState, wallpaper };
        notify();
      }
    })
    .catch(() => {
      if (themeState.wallpaper === undefined) {
        themeState = { ...themeState, wallpaper: null };
        notify();
      }
    })
    .finally(() => { wallpaperRequest = undefined; });
  await wallpaperRequest;
}

export function useWallpaperPreview() {
  useEffect(() => { void refreshWallpaper(); }, []);
}

export function resolveTheme(state: ThemeState, plugins: CustomTheme[], systemMode: ThemeMode): { mode: ThemeMode; palette?: ThemePalette } {
  const { selected, custom, wallpaper } = state;
  if (selected === "system") return { mode: systemMode };
  if (selected === wallpaperID) {
    return wallpaper ? {
      mode: systemMode,
      palette: {
        ...wallpaper,
        mode: systemMode,
        background: { ...wallpaper.background, l: systemMode === "dark" ? 0.16 : 0.96 },
      },
    } : { mode: systemMode };
  }
  const palette = presetPalettes.get(selected)
    ?? custom.find((theme) => theme.id === selected)
    ?? plugins.find((theme) => theme.id === selected);
  return { mode: palette?.mode ?? (selected === "light" ? "light" : "dark"), palette };
}

export type PageMotion = "rise" | "slide" | "fade" | "none";
function storedPageMotion(): PageMotion {
  try {
    const value = localStorage.getItem("kage.pageMotion");
    if (value === "none" || value === "fade" || value === "slide") return value;
  } catch {
    // Use the default if storage is unavailable.
  }
  return "rise";
}
let pageMotion = storedPageMotion();
const motionSnapshot = () => pageMotion;
function setPageMotion(value: PageMotion) {
  pageMotion = value;
  try {
    localStorage.setItem("kage.pageMotion", value);
  } catch {
    // The choice still applies in this window.
  }
  listeners.forEach((listener) => listener());
}
export function usePageMotion() {
  return [
    useSyncExternalStore(subscribe, motionSnapshot, motionSnapshot),
    setPageMotion,
  ] as const;
}
const paletteProperties = Object.keys(paletteTokens(defaultPalette("dark")));

export function useApplyTheme(plugins: PluginInfo[]) {
  const state = useThemeState();
  const installed = useMemo(() => pluginThemes(plugins), [plugins]);

  useEffect(() => {
    if (state.selected !== wallpaperID) return;
    const refresh = () => { void refreshWallpaper(); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [state.selected]);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    const apply = () => {
      const { mode, palette } = resolveTheme(state, installed, media.matches ? "dark" : "light");
      root.classList.toggle("dark", mode === "dark");
      const tokens = palette ? paletteTokens(palette) : null;
      for (const property of paletteProperties) root.style.removeProperty(property);
      if (tokens) {
        for (const [property, value] of Object.entries(tokens)) root.style.setProperty(property, value);
      }

      const image = palette?.image;
      if (image) {
        const tint = Math.max(0.7, image.dim + (1 - image.dim) * image.panel);
        root.style.setProperty("--theme-image", `url("${image.url}")`);
        root.style.setProperty("--theme-image-tint", `color-mix(in srgb, var(--background) ${tint * 100}%, transparent)`);
      } else {
        root.style.removeProperty("--theme-image");
        root.style.removeProperty("--theme-image-tint");
      }

      if ((isAndroid || isIOS) && hasNativeRuntime()) {
        const color = (tokens && cssColorToHex(tokens["--sidebar"])) ?? (mode === "dark" ? "#18181B" : "#FAFAFA");
        void invoke("set_system_bars", { color, light: mode === "light" }).catch(() => undefined);
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state, installed]);
}
