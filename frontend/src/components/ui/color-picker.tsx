import { CSSProperties, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";

import { oklchToHex, oklchToRgb, parseHex } from "@/lib/color";
import { useT } from "@/lib/i18n";

export type ColorPatch = { h?: number; c?: number; l?: number };

const FIELD_W = 180;
const FIELD_H = 90;

/**
 * A colour picker: a field of hue (across) by vividness (up), a lightness
 * strip when the caller lets lightness change, and a hex box.
 *
 * It works in OKLCH, the space the themes are made of, so the field only
 * offers colours the theme can take: vividness stops at maxChroma and
 * lightness stays inside lightnessRange. A hex typed in is pulled into those
 * limits.
 */
export function ColorPicker({
    h,
    c,
    l,
    maxChroma,
    minChroma = 0,
    fieldLightness = l,
    lightnessRange,
    lightnessLabel,
    onChange,
}: {
    h: number;
    c: number;
    /** The colour's real lightness: the swatch, the thumb and the hex use it. */
    l: number;
    maxChroma: number;
    minChroma?: number;
    /** The lightness the field is drawn at, when the real one is too dark to see hues in. */
    fieldLightness?: number;
    /** When given, a strip changes lightness within it. */
    lightnessRange?: { min: number; max: number };
    lightnessLabel?: string;
    onChange: (patch: ColorPatch) => void;
}) {
    const t = useT();
    const canvas = useRef<HTMLCanvasElement>(null);
    const field = useRef<HTMLDivElement>(null);

    // The field is redrawn only when what it shows changes, not on every drag.
    useEffect(() => {
        const context = canvas.current?.getContext("2d");
        if (!context) return;
        const image = context.createImageData(FIELD_W, FIELD_H);
        for (let y = 0; y < FIELD_H; y++) {
            const chroma = maxChroma - (y / (FIELD_H - 1)) * (maxChroma - minChroma);
            for (let x = 0; x < FIELD_W; x++) {
                const [r, g, b] = oklchToRgb(fieldLightness, chroma, (x / (FIELD_W - 1)) * 360);
                const i = (y * FIELD_W + x) * 4;
                image.data[i] = r;
                image.data[i + 1] = g;
                image.data[i + 2] = b;
                image.data[i + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
    }, [fieldLightness, maxChroma, minChroma]);

    const pick = (event: PointerEvent<HTMLDivElement>) => {
        const box = field.current!.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
        onChange({ h: Math.round(x * 360), c: round(maxChroma - y * (maxChroma - minChroma)) });
    };

    const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
        const big = event.shiftKey ? 10 : 1;
        const chromaStep = ((maxChroma - minChroma) / 50) * big;
        const moves: Record<string, ColorPatch> = {
            ArrowLeft: { h: (h - big + 360) % 360 },
            ArrowRight: { h: (h + big) % 360 },
            ArrowUp: { c: round(Math.min(maxChroma, c + chromaStep)) },
            ArrowDown: { c: round(Math.max(minChroma, c - chromaStep)) },
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        onChange(move);
    };

    const hex = oklchToHex(l, c, h);
    const [text, setText] = useState(hex);
    const [editing, setEditing] = useState(false);
    const cancelled = useRef(false);
    useEffect(() => {
        if (!editing) setText(hex);
    }, [hex, editing]);

    const commit = () => {
        setEditing(false);
        const parsed = cancelled.current ? null : parseHex(text);
        cancelled.current = false;
        if (!parsed) {
            setText(hex);
            return;
        }
        const patch: ColorPatch = { c: round(Math.min(maxChroma, Math.max(minChroma, parsed.c))) };
        // A grey has no hue of its own; keep the one already chosen.
        if (parsed.c > 0.005) patch.h = Math.round(parsed.h);
        if (lightnessRange) patch.l = round(Math.min(lightnessRange.max, Math.max(lightnessRange.min, parsed.l)));
        onChange(patch);
    };

    const current = `oklch(${l} ${c} ${h})`;
    const x = (h / 360) * 100;
    const y = ((maxChroma - c) / (maxChroma - minChroma || 1)) * 100;

    return (
        <div className="space-y-2.5">
            <div
                ref={field}
                role="slider"
                tabIndex={0}
                aria-label={t("color.field")}
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={h}
                aria-valuetext={`${h}°, ${Math.round(((c - minChroma) / (maxChroma - minChroma || 1)) * 100)}%`}
                className="relative h-28 cursor-crosshair touch-none select-none rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    event.currentTarget.focus();
                    pick(event);
                }}
                onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
                }}
                onKeyDown={nudge}
            >
                <canvas ref={canvas} width={FIELD_W} height={FIELD_H} className="h-full w-full rounded-[inherit]" />
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_4px_rgb(0_0_0/0.4)]"
                    style={{ left: `${x}%`, top: `${y}%`, background: `oklch(${fieldLightness} ${c} ${h})` }}
                />
            </div>

            {lightnessRange ? (
                <input
                    type="range"
                    className="knob-slider"
                    aria-label={lightnessLabel}
                    min={lightnessRange.min}
                    max={lightnessRange.max}
                    step={0.005}
                    value={l}
                    onChange={(event) => onChange({ l: Number(event.target.value) })}
                    style={
                        {
                            "--track": `linear-gradient(to right, oklch(${lightnessRange.min} ${c} ${h}), oklch(${lightnessRange.max} ${c} ${h}))`,
                            "--thumb": current,
                        } as CSSProperties
                    }
                />
            ) : null}

            <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-8 shrink-0 rounded-md border" style={{ background: current }} />
                <input
                    value={text}
                    spellCheck={false}
                    maxLength={7}
                    aria-label={t("color.hex")}
                    className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 font-mono text-xs uppercase outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onFocus={() => setEditing(true)}
                    onChange={(event) => setText(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                            // Undo the typing, not close the dialog around it.
                            event.stopPropagation();
                            cancelled.current = true;
                            event.currentTarget.blur();
                        }
                    }}
                />
            </div>
        </div>
    );
}

const round = (value: number) => Math.round(value * 1000) / 1000;
