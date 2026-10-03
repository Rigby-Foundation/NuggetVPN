/**
 * Theme presets.
 *
 * next-themes writes the chosen theme onto <html> as a single class — it calls
 * classList.add() with the mapped value, which rejects a space — so a preset
 * cannot also carry `.dark`. The `theme-dark-` prefix is what marks a preset as
 * dark instead: App.css matches it both in the base dark token block and in the
 * `dark:` variant, so adding a preset never means extending a list of selectors.
 *
 * Each preset is a handful of token knobs in App.css. `swatch` is the picker's
 * copy of the two surface colours and the accent, since the picker has to draw
 * a theme it is not currently wearing.
 */
import type { MessageKey } from "@/lib/i18n";

export interface ThemePreset {
    id: string;
    label: MessageKey;
    /** Why this one exists, shown under the name. */
    hint: MessageKey;
    /** Whether the theme is light or dark. */
    mode: "light" | "dark";
    /**
     * "palette" for the well-known community palettes (Dracula, Catppuccin…),
     * which the picker groups on their own rather than mixing them into the
     * light and dark lists.
     */
    family?: "palette";
    /** The class next-themes applies for this preset. */
    className: string;
    swatch: {
        /** The page colour. */
        background: string;
        /** A surface on top of it — the gradient runs between the two. */
        surface: string;
        accent: string;
    };
}

export const THEME_PRESETS: ThemePreset[] = [
    {
        id: "light",
        label: "theme.light",
        hint: "theme.light.hint",
        mode: "light",
        className: "light",
        swatch: {
            background: "oklch(1 0 0)",
            surface: "oklch(0.945 0.001 286.375)",
            accent: "oklch(0.58 0.145 58)",
        },
    },
    {
        id: "paper",
        label: "theme.paper",
        hint: "theme.paper.hint",
        mode: "light",
        className: "theme-light-paper",
        swatch: {
            background: "oklch(0.975 0.012 85)",
            surface: "oklch(0.93 0.015 85)",
            accent: "oklch(0.58 0.145 58)",
        },
    },
    {
        id: "frost",
        label: "theme.frost",
        hint: "theme.frost.hint",
        mode: "light",
        className: "theme-light-frost",
        swatch: {
            background: "oklch(0.985 0.01 245)",
            surface: "oklch(0.93 0.012 245)",
            accent: "oklch(0.55 0.15 250)",
        },
    },

    {
        id: "dark",
        label: "theme.dark",
        hint: "theme.dark.hint",
        mode: "dark",
        className: "dark",
        swatch: {
            background: "oklch(0.141 0.006 286.033)",
            surface: "oklch(0.274 0.006 286.033)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "oled",
        label: "theme.oled",
        hint: "theme.oled.hint",
        mode: "dark",
        className: "theme-dark-oled",
        swatch: {
            background: "oklch(0 0 0)",
            surface: "oklch(0.2 0 0)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "contrast",
        label: "theme.contrast",
        hint: "theme.contrast.hint",
        mode: "dark",
        className: "theme-dark-contrast",
        swatch: {
            background: "oklch(0 0 0)",
            surface: "oklch(0.28 0 0)",
            accent: "oklch(0.86 0.16 80)",
        },
    },
    {
        id: "slate",
        label: "theme.slate",
        hint: "theme.slate.hint",
        mode: "dark",
        className: "theme-dark-slate",
        swatch: {
            background: "oklch(0.17 0.02 255)",
            surface: "oklch(0.29 0.02 255)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "stone",
        label: "theme.stone",
        hint: "theme.stone.hint",
        mode: "dark",
        className: "theme-dark-stone",
        swatch: {
            background: "oklch(0.16 0.012 75)",
            surface: "oklch(0.285 0.012 75)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "nord",
        label: "theme.nord",
        hint: "theme.nord.hint",
        mode: "dark",
        className: "theme-dark-nord",
        swatch: {
            background: "oklch(0.205 0.025 258)",
            surface: "oklch(0.325 0.025 258)",
            accent: "oklch(0.82 0.075 220)",
        },
    },
    {
        id: "cosmos",
        label: "theme.cosmos",
        hint: "theme.cosmos.hint",
        mode: "dark",
        className: "theme-dark-cosmos",
        swatch: {
            background: "oklch(0.145 0.05 255)",
            surface: "oklch(0.275 0.05 255)",
            accent: "oklch(0.8 0.12 210)",
        },
    },
    {
        id: "violet",
        label: "theme.violet",
        hint: "theme.violet.hint",
        mode: "dark",
        className: "theme-dark-violet",
        swatch: {
            background: "oklch(0.155 0.04 305)",
            surface: "oklch(0.285 0.04 305)",
            accent: "oklch(0.74 0.18 300)",
        },
    },
    {
        id: "emerald",
        label: "theme.emerald",
        hint: "theme.emerald.hint",
        mode: "dark",
        className: "theme-dark-emerald",
        swatch: {
            background: "oklch(0.15 0.028 165)",
            surface: "oklch(0.275 0.028 165)",
            accent: "oklch(0.78 0.15 160)",
        },
    },
    {
        id: "sunset",
        label: "theme.sunset",
        hint: "theme.sunset.hint",
        mode: "dark",
        className: "theme-dark-sunset",
        swatch: {
            background: "oklch(0.16 0.035 40)",
            surface: "oklch(0.285 0.035 40)",
            accent: "oklch(0.77 0.17 35)",
        },
    },
    {
        id: "rose",
        label: "theme.rose",
        hint: "theme.rose.hint",
        mode: "dark",
        className: "theme-dark-rose",
        swatch: {
            background: "oklch(0.155 0.035 350)",
            surface: "oklch(0.28 0.035 350)",
            accent: "oklch(0.75 0.17 350)",
        },
    },
    {
        id: "mocha",
        label: "theme.mocha",
        hint: "theme.mocha.hint",
        mode: "dark",
        className: "theme-dark-mocha",
        swatch: {
            background: "oklch(0.165 0.03 55)",
            surface: "oklch(0.29 0.03 55)",
            accent: "oklch(0.79 0.1 65)",
        },
    },
    {
        id: "sakura",
        label: "theme.sakura",
        hint: "theme.sakura.hint",
        mode: "light",
        className: "theme-light-p-sakura",
        swatch: { background: "#fff7f9", surface: "#fbe4eb", accent: "#c2336a" },
    },
    {
        id: "mint",
        label: "theme.mint",
        hint: "theme.mint.hint",
        mode: "light",
        className: "theme-light-p-mint",
        swatch: { background: "#f4fbf8", surface: "#dcefe6", accent: "#0f7a5f" },
    },
    {
        id: "contrast-light",
        label: "theme.contrast-light",
        hint: "theme.contrast-light.hint",
        mode: "light",
        className: "theme-light-p-contrast",
        swatch: { background: "#ffffff", surface: "#e8e8e8", accent: "#7a3f00" },
    },
    {
        id: "ember",
        label: "theme.ember",
        hint: "theme.ember.hint",
        mode: "dark",
        className: "theme-dark-p-ember",
        swatch: { background: "#1a1210", surface: "#33231d", accent: "#ff6b3d" },
    },
    {
        id: "crimson",
        label: "theme.crimson",
        hint: "theme.crimson.hint",
        mode: "dark",
        className: "theme-dark-p-crimson",
        swatch: { background: "#14090d", surface: "#2c151e", accent: "#a81228" },
    },
    {
        id: "ocean",
        label: "theme.ocean",
        hint: "theme.ocean.hint",
        mode: "dark",
        className: "theme-dark-p-ocean",
        swatch: { background: "#0b1a26", surface: "#173246", accent: "#3fb6d9" },
    },
    {
        id: "teal",
        label: "theme.teal",
        hint: "theme.teal.hint",
        mode: "dark",
        className: "theme-dark-p-teal",
        swatch: { background: "#0d1a1a", surface: "#1b3434", accent: "#2dd4bf" },
    },
    {
        id: "solarized-light",
        label: "theme.solarized-light",
        hint: "theme.solarized-light.hint",
        mode: "light",
        family: "palette",
        className: "theme-light-p-solarized",
        swatch: { background: "#fdf6e3", surface: "#e4dcc4", accent: "#b58900" },
    },
    {
        id: "ctp-latte",
        label: "theme.ctp-latte",
        hint: "theme.ctp-latte.hint",
        mode: "light",
        family: "palette",
        className: "theme-light-p-latte",
        swatch: { background: "#eff1f5", surface: "#ccd0da", accent: "#8839ef" },
    },
    {
        id: "ctp-frappe",
        label: "theme.ctp-frappe",
        hint: "theme.ctp-frappe.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-ctp-frappe",
        swatch: { background: "#303446", surface: "#51576d", accent: "#ca9ee6" },
    },
    {
        id: "ctp-macchiato",
        label: "theme.ctp-macchiato",
        hint: "theme.ctp-macchiato.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-ctp-macchiato",
        swatch: { background: "#24273a", surface: "#494d64", accent: "#c6a0f6" },
    },
    {
        id: "ctp-mocha",
        label: "theme.ctp-mocha",
        hint: "theme.ctp-mocha.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-ctp-mocha",
        swatch: { background: "#1e1e2e", surface: "#45475a", accent: "#cba6f7" },
    },
    {
        id: "dracula",
        label: "theme.dracula",
        hint: "theme.dracula.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-dracula",
        swatch: { background: "#282a36", surface: "#44475a", accent: "#bd93f9" },
    },
    {
        id: "gruvbox",
        label: "theme.gruvbox",
        hint: "theme.gruvbox.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-gruvbox",
        swatch: { background: "#282828", surface: "#3c3836", accent: "#fabd2f" },
    },
    {
        id: "tokyo-night",
        label: "theme.tokyo-night",
        hint: "theme.tokyo-night.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-tokyo",
        swatch: { background: "#1a1b26", surface: "#292e42", accent: "#7aa2f7" },
    },
    {
        id: "rose-pine",
        label: "theme.rose-pine",
        hint: "theme.rose-pine.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-rose-pine",
        swatch: { background: "#191724", surface: "#26233a", accent: "#ebbcba" },
    },
    {
        id: "everforest",
        label: "theme.everforest",
        hint: "theme.everforest.hint",
        mode: "dark",
        family: "palette",
        className: "theme-dark-p-everforest",
        swatch: { background: "#2d353b", surface: "#3d484d", accent: "#a7c080" },
    },
];

/** Theme ids, plus "system", for the provider. */
export const THEME_IDS = ["system", ...THEME_PRESETS.map((preset) => preset.id)];

/** The class map next-themes applies per theme id. */
export const THEME_CLASSES = Object.fromEntries(
    THEME_PRESETS.map((preset) => [preset.id, preset.className])
);
