/**
 * Theme presets.
 *
 * next-themes writes the chosen theme onto <html> as a single class — it calls
 * classList.add() with the mapped value, which rejects a space — so a preset
 * cannot also carry `.dark`. App.css instead names the dark presets alongside
 * `.dark` in the two places that matter, the token block and the `dark:`
 * variant, and each preset then restates only the tokens it changes.
 *
 * Adding a preset means touching both files.
 *
 * `swatch` is what the picker draws: background, card and accent, which is
 * enough to tell the presets apart at a glance without rendering the app four
 * times over.
 */
export interface ThemePreset {
    id: string;
    label: string;
    /** Why this one exists, shown under the name. */
    hint: string;
    /** Classes next-themes applies for this preset. */
    className: string;
    swatch: { background: string; card: string; accent: string };
}

export const THEME_PRESETS: ThemePreset[] = [
    {
        id: "light",
        label: "Light",
        hint: "The default light theme",
        className: "light",
        swatch: {
            background: "oklch(1 0 0)",
            card: "oklch(0.967 0.001 286)",
            accent: "oklch(0.58 0.145 58)",
        },
    },
    {
        id: "paper",
        label: "Paper",
        hint: "Warm light, easier at night",
        className: "theme-paper",
        swatch: {
            background: "oklch(0.975 0.008 85)",
            card: "oklch(0.93 0.015 85)",
            accent: "oklch(0.58 0.145 58)",
        },
    },
    {
        id: "dark",
        label: "Dark",
        hint: "The default dark theme",
        className: "dark",
        swatch: {
            background: "oklch(0.141 0.005 286)",
            card: "oklch(0.274 0.006 286)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "oled",
        label: "OLED black",
        hint: "True black — saves power on an OLED screen",
        className: "theme-oled",
        swatch: {
            background: "oklch(0 0 0)",
            card: "oklch(0.235 0 0)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "slate",
        label: "Slate",
        hint: "Cool grey instead of warm",
        className: "theme-slate",
        swatch: {
            background: "oklch(0.17 0.02 255)",
            card: "oklch(0.31 0.025 255)",
            accent: "oklch(0.79 0.145 70)",
        },
    },
    {
        id: "contrast",
        label: "High contrast",
        hint: "Brighter text and stronger borders",
        className: "theme-contrast",
        swatch: {
            background: "oklch(0 0 0)",
            card: "oklch(0.28 0 0)",
            accent: "oklch(0.86 0.16 80)",
        },
    },
];

/** Theme ids, plus "system", for the provider. */
export const THEME_IDS = ["system", ...THEME_PRESETS.map((preset) => preset.id)];

/** The class map next-themes applies per theme id. */
export const THEME_CLASSES = Object.fromEntries(
    THEME_PRESETS.map((preset) => [preset.id, preset.className])
);
