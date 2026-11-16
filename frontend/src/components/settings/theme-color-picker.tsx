import { useId, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Input } from "@/components/ui/input";
import { hexChannels, normalizeHex, rgbToHex } from "@/lib/color";
import { useT } from "@/lib/i18n";

type HSV = { hue: number; saturation: number; brightness: number };

function hexToHSV(hex: string): HSV {
  const [r, g, b] = hexChannels(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = (g - b) / delta;
    else if (max === g) hue = 2 + (b - r) / delta;
    else hue = 4 + (r - g) / delta;
  }
  return {
    hue: (hue * 60 + 360) % 360,
    saturation: max === 0 ? 0 : delta / max,
    brightness: max / 255,
  };
}

function hsvToHex({ hue, saturation, brightness }: HSV) {
  const chroma = brightness * saturation;
  const offset = brightness - chroma;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs(section % 2 - 1));
  const colors = [
    [chroma, intermediate, 0],
    [intermediate, chroma, 0],
    [0, chroma, intermediate],
    [0, intermediate, chroma],
    [intermediate, 0, chroma],
    [chroma, 0, intermediate],
  ];
  return rgbToHex(colors[Math.floor(section) % 6].map((channel) => (channel + offset) * 255));
}

function unit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function ThemeColorPicker({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const t = useT();
  const id = useId();
  const [input, setInput] = useState<string | null>(null);
  const [lastPick, setLastPick] = useState<{ hex: string; hsv: HSV }>();
  const hsv = lastPick?.hex === value ? lastPick.hsv : hexToHSV(value);
  const { hue, saturation, brightness } = hsv;
  const pick = (next: HSV) => {
    const hex = hsvToHex(next);
    setLastPick({ hex, hsv: next });
    if (hex !== value) onChange(hex);
  };
  const pickAtPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pick({
      hue,
      saturation: unit((event.clientX - bounds.left) / bounds.width),
      brightness: 1 - unit((event.clientY - bounds.top) / bounds.height),
    });
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowDown: [0, -step],
      ArrowUp: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pick({ hue, saturation: unit(saturation + move[0]), brightness: unit(brightness + move[1]) });
  };

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend id={id} className="mb-2 text-xs font-semibold">{label}</legend>
      <div dir="ltr" className="space-y-2">
        <div
          role="slider"
          tabIndex={0}
          aria-labelledby={`${id} ${id}-field`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(saturation * 100)}
          aria-valuetext={`${Math.round(saturation * 100)}%, ${Math.round(brightness * 100)}%`}
          className="relative isolate h-24 cursor-crosshair touch-none select-none rounded-lg outline-none ring-1 ring-inset ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            background: `linear-gradient(transparent, #000), linear-gradient(90deg, #fff, hsl(${hue} 100% 50%))`,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            pickAtPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) pickAtPointer(event);
          }}
          onKeyDown={nudge}
        >
          <span id={`${id}-field`} className="sr-only">{t("color.field")}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#0008]"
            style={{ left: `${saturation * 100}%`, top: `${(1 - brightness) * 100}%`, backgroundColor: value }}
          />
        </div>
        <div className="relative flex h-6 items-center">
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-2 rounded-full bg-[linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)]" />
          <span id={`${id}-hue`} className="sr-only">{t("editor.hue")}</span>
          <input
            type="range"
            min={0}
            max={360}
            value={Math.round(hue)}
            aria-labelledby={`${id} ${id}-hue`}
            className="theme-hue-slider relative h-6 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ "--picker-hue": `hsl(${hue} 100% 50%)` } as CSSProperties}
            onChange={(event) => pick({ ...hsv, hue: event.currentTarget.valueAsNumber })}
          />
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-8 shrink-0 rounded-md border border-foreground/15" style={{ backgroundColor: value }} />
          <span id={`${id}-hex`} className="sr-only">{t("color.hex")}</span>
          <Input
            aria-labelledby={`${id} ${id}-hex`}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            maxLength={7}
            className="font-mono"
            value={input ?? value}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setInput(text);
              const hex = normalizeHex(text);
              if (hex && /^#?[a-f\d]{6}$/i.test(text) && hex !== value) onChange(hex);
            }}
            onBlur={() => {
              const hex = normalizeHex(input);
              if (hex && hex !== value) onChange(hex);
              setInput(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.currentTarget.blur();
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}
