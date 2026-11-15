/**
 * Terminal colour codes in core log lines, turned into styled segments.
 *
 * Keep the hue of foreground colours and adapt their lightness to the theme.
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
const SEQUENCE = /\x1b\[([0-9;:]*)m/g;

function sgrCodes(parameters: string): number[] {
    return parameters.split(";").flatMap((parameter) => {
        const parts = parameter.split(":");
        // In the colon form of RGB, an optional colour-space field can
        // precede the three channels. It is normally empty.
        if (parts.length === 6 && parts[1] === "2") parts.splice(2, 1);
        return parts.map(Number);
    });
}

const isByte = (value: number) => Number.isInteger(value) && value >= 0 && value <= 255;

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

        const codes = sgrCodes(match[1]);
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            // Consume background parameters too, so a channel value is
            // never interpreted as a foreground or reset command.
            if ([38, 48, 58].includes(code)) {
                const mode = codes[i + 1];
                if (mode === 5) {
                    const index = codes[i + 2];
                    if (code === 38 && isByte(index)) {
                        const rgb = xterm256(index);
                        color = rgb ? fromRGB(rgb) : BASIC[index % 8];
                    }
                    i += 2;
                } else if (mode === 2) {
                    const rgb: [number, number, number] = [codes[i + 2], codes[i + 3], codes[i + 4]];
                    if (code === 38 && rgb.every(isByte)) color = fromRGB(rgb);
                    i += 4;
                }
                continue;
            }
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
            }
        }
    }
    push(line.slice(last));
    return segments;
}
