/**
 * Terminal colour codes in core log lines, turned into styled segments.
 *
 * sing-box colours its log for a terminal: the level word, and — through the
 * 256-colour palette — each connection's id, so one connection can be followed
 * through the log by colour. Those colours were chosen for a dark terminal:
 * pale pastels that would vanish on a light theme. So only the hue is kept;
 * lightness comes from --log-l, which each theme sets for its own background.
 */

export interface AnsiSegment {
    text: string;
    /** A CSS colour, or undefined for the line's own colour. */
    color?: string;
    bold?: boolean;
}

// The colour for a hue, readable on the current theme.
const tint = (hue: number) => `hsl(${Math.round(hue)} 70% var(--log-l))`;
const MUTED = "var(--muted-foreground)";

// The eight basic colours, as hues. Black and white carry no hue, so they fall
// back to the muted text colour rather than to invisible or glaring.
const BASIC: Array<string | undefined> = [
    MUTED, // black
    tint(4), // red
    tint(140), // green
    tint(45), // yellow
    tint(220), // blue
    tint(300), // magenta
    tint(185), // cyan
    MUTED, // white
];

/** The xterm 256-colour palette entry as RGB. */
function xterm256(index: number): [number, number, number] | null {
    if (index < 16) return null; // the basic colours, handled by BASIC
    if (index >= 232) {
        const level = 8 + (index - 232) * 10;
        return [level, level, level];
    }
    const cube = index - 16;
    const step = (value: number) => (value === 0 ? 0 : 55 + value * 40);
    return [step(Math.floor(cube / 36)), step(Math.floor(cube / 6) % 6), step(cube % 6)];
}

/** An RGB colour as a theme-aware tint, or the muted colour if it is grey. */
function fromRGB([r, g, b]: [number, number, number]): string {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 24) {
        return MUTED;
    }
    let hue: number;
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue *= 60;
    return tint(hue < 0 ? hue + 360 : hue);
}

// eslint-disable-next-line no-control-regex
const SEQUENCE = /\x1b\[([0-9;]*)m/g;

/** Removes the codes, for exports and for matching on text. */
export function stripAnsi(line: string): string {
    return line.replace(SEQUENCE, "");
}

/** Splits a line into runs of text with the colour and weight each carries. */
export function parseAnsi(line: string): AnsiSegment[] {
    const segments: AnsiSegment[] = [];
    let color: string | undefined;
    let bold = false;
    let last = 0;

    const push = (text: string) => {
        if (text) segments.push({ text, color, bold: bold || undefined });
    };

    for (const match of line.matchAll(SEQUENCE)) {
        push(line.slice(last, match.index));
        last = (match.index ?? 0) + match[0].length;

        const codes = match[1] === "" ? [0] : match[1].split(";").map(Number);
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            if (code === 0) {
                color = undefined;
                bold = false;
            } else if (code === 1) {
                bold = true;
            } else if (code === 22) {
                bold = false;
            } else if (code === 39) {
                color = undefined;
            } else if (code >= 30 && code <= 37) {
                color = BASIC[code - 30];
            } else if (code >= 90 && code <= 97) {
                color = BASIC[code - 90];
            } else if (code === 38 && codes[i + 1] === 5) {
                const index = codes[i + 2];
                const rgb = xterm256(index);
                color = rgb ? fromRGB(rgb) : BASIC[index % 8];
                i += 2;
            } else if (code === 38 && codes[i + 1] === 2) {
                color = fromRGB([codes[i + 2], codes[i + 3], codes[i + 4]]);
                i += 4;
            }
            // Backgrounds and anything else are ignored: the log sits on the
            // theme's own surface.
        }
    }
    push(line.slice(last));
    return segments;
}
