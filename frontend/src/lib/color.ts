import { toOklch } from "@/lib/appearance";

/**
 * OKLCH → sRGB, 0–255 per channel, clipped into the sRGB gamut (Björn
 * Ottosson's matrices, the inverse of toOklch).
 */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
    const rad = (h * Math.PI) / 180;
    const a = c * Math.cos(rad);
    const b = c * Math.sin(rad);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ];
    return linear.map((v) => {
        const clipped = Math.min(1, Math.max(0, v));
        const encoded = clipped <= 0.0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - 0.055;
        return Math.round(encoded * 255);
    }) as [number, number, number];
}

export function oklchToHex(l: number, c: number, h: number): string {
    return "#" + oklchToRgb(l, c, h).map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** "#abc", "abc", "#aabbcc" or "aabbcc" as OKLCH; null if it isn't one. */
export function parseHex(text: string): { l: number; c: number; h: number } | null {
    let hex = text.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, (ch) => ch + ch);
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return toOklch("#" + hex);
}
