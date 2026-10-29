import { describe, expect, test } from "bun:test";
import { customThemeKnobs } from "../src/lib/appearance";
import { monetForMode, monetTheme } from "../src/lib/monet";

describe("wallpaper system theme", () => {
    test("keeps wallpaper hues when the system changes light/dark mode", () => {
        const palette = monetTheme({ seed: "#2060e0" });
        expect(palette).not.toBeNull();
        const dark = monetForMode(palette, "dark")!;
        const light = monetForMode(dark, "light")!;
        expect(dark.background.l).toBeLessThan(0.3);
        expect(light.background.l).toBeGreaterThan(0.9);
        expect(dark.accent).toEqual(light.accent);
        expect(dark.background.h).toBe(light.background.h);
        // Switching mode also changes accent contrast, not just the page.
        expect(Number(customThemeKnobs(dark)["--brand-l"])).toBeGreaterThan(
            Number(customThemeKnobs(light)["--brand-l"])
        );
    });

    test("neutral wallpapers stay neutral", () => {
        const theme = monetTheme({ seed: "#808080" })!;
        expect(theme.accent.c).toBeLessThan(0.001);
        expect(theme.background.c).toBeLessThan(0.001);
    });

    test("still accepts Android Material You tones", () => {
        const theme = monetTheme({
            dark: true,
            accent1: ["#dbe1ff", "#b4c5ff", "#536dce", "#3c54b4"],
            neutral1: ["#fffbff", "#f4f0f4", "#1b1b1f"],
            neutral2: ["#e1e2ec", "#747680", "#2f3039"],
        })!;
        expect(theme.mode).toBe("dark");
        expect(theme.accent.c).toBeGreaterThan(0.06);
        expect(monetForMode(theme, "light")!.accent).toEqual(theme.accent);
    });

    test("unavailable or invalid colours leave the system fallback", () => {
        expect(monetTheme({ seed: "invalid" })).toBeNull();
        expect(monetForMode(null, "dark")).toBeNull();
    });
});
