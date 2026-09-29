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
export interface ThemePreset {
    id: string;
    label: string;
    /** Why this one exists, shown under the name. */
    hint: string;
    /** Which group it belongs to in the picker. */
    mode: "light" | "dark";
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
        label: "Light",
        hint: "The default",
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
        label: "Paper",
        hint: "Warm light, easier at night",
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
        label: "Frost",
        hint: "Cool light, blue accent",
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
        label: "Dark",
        hint: "The default",
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
        label: "OLED black",
        hint: "True black — saves power on an OLED screen",
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
        label: "High contrast",
        hint: "Brighter text and stronger borders",
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
        label: "Slate",
        hint: "Cool grey",
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
        label: "Stone",
        hint: "Warm grey",
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
        label: "Nord",
        hint: "The arctic palette, a lighter dark",
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
        label: "Cosmos",
        hint: "Deep space blue, cyan accent",
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
        label: "Violet",
        hint: "Purple throughout",
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
        label: "Emerald",
        hint: "Green throughout",
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
        label: "Sunset",
        hint: "Warm ground, orange accent",
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
        label: "Rose",
        hint: "Pink throughout",
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
        label: "Mocha",
        hint: "Coffee, with a caramel accent",
        mode: "dark",
        className: "theme-dark-mocha",
        swatch: {
            background: "oklch(0.165 0.03 55)",
            surface: "oklch(0.29 0.03 55)",
            accent: "oklch(0.79 0.1 65)",
        },
    },
];

/** Theme ids, plus "system", for the provider. */
export const THEME_IDS = ["system", ...THEME_PRESETS.map((preset) => preset.id)];

/** The class map next-themes applies per theme id. */
export const THEME_CLASSES = Object.fromEntries(
    THEME_PRESETS.map((preset) => [preset.id, preset.className])
);
