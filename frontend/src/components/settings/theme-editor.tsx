import { CSSProperties, useEffect, useState } from "react";
import { ImagePlus, Loader2, Moon, Sun, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
    BACKGROUND_LIGHTNESS,
    customClass,
    customThemeKnobs,
    CustomTheme,
    defaultThemeImage,
    THEME_IMAGE_LIMITS,
    ThemeImage,
} from "@/lib/appearance";
import { UserFile } from "@/types";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The custom theme editor.
 *
 * Colours are chosen as hue, tint and lightness on sliders, the same numbers
 * the presets are made of, rather than through a colour-picker popup. That
 * keeps the result coherent — a page, its cards and its borders always relate
 * the way they do in the built-in themes — and a slider cannot produce an
 * unreadable accent, because the accent's lightness is not one of them.
 */

/** A hue wheel unrolled, at the given lightness and chroma. */
export function hueTrack(l: number, c: number): string {
    const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => `oklch(${l} ${c} ${h})`);
    return `linear-gradient(to right, ${stops.join(", ")})`;
}

export function Slider({
    label,
    value,
    min,
    max,
    step,
    track,
    thumb,
    onChange,
    format,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    track: string;
    thumb: string;
    onChange: (value: number) => void;
    format?: (value: number) => string;
}) {
    return (
        <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs">
                <span className="font-medium">{label}</span>
                <span className="tabular-nums text-muted-foreground">
                    {format ? format(value) : value}
                </span>
            </span>
            <input
                type="range"
                className="knob-slider"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                style={{ ["--track" as string]: track, ["--thumb" as string]: thumb } as CSSProperties}
            />
        </label>
    );
}

/** A small slice of the real UI, drawn in the theme being edited. */
function Preview({ theme }: { theme: CustomTheme }) {
    const t = useT();
    const image = theme.image;
    // The class re-declares every token on this element, from the knobs set
    // inline beside it, so real components render in the edited theme without
    // touching the rest of the window. With a picture, the page and card
    // colours take the panel opacity, as they do across the app.
    const glass = image
        ? {
              "--background": `oklch(var(--ui-bg-l) var(--ui-c) var(--ui-h) / ${image.panel})`,
              "--card": `oklch(var(--ui-card-l) var(--ui-c) var(--ui-h) / ${Math.min(1, image.panel + 0.1)})`,
          }
        : {};
    return (
        <div
            className={cn(customClass(theme), "relative isolate overflow-hidden rounded-xl border bg-background p-3 text-foreground")}
            style={{ ...customThemeKnobs(theme), ...glass } as CSSProperties}
        >
            {image ? (
                <>
                    <div
                        aria-hidden="true"
                        className="absolute -inset-6 -z-10 bg-cover bg-center"
                        style={{
                            backgroundImage: `url("${image.url}")`,
                            filter: `blur(${image.blur / 2}px) brightness(${image.brightness}) saturate(${image.saturate})`,
                        }}
                    />
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10"
                        style={{ background: "oklch(var(--ui-bg-l) var(--ui-c) var(--ui-h))", opacity: image.dim }}
                    />
                </>
            ) : null}
            <div className="space-y-3 rounded-lg border bg-card p-3 text-card-foreground">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">Frankfurt</div>
                        <div className="text-xs text-muted-foreground">VLESS · 42 ms</div>
                    </div>
                    <Badge>{t("status.connected")}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted px-2.5 py-2">
                    <span className="text-xs text-muted-foreground">{t("editor.previewSwitch")}</span>
                    <Switch checked aria-label={t("editor.previewSwitch")} />
                </div>
                <div className="flex gap-2">
                    <Button size="sm" className="flex-1">
                        {t("connection.connect")}
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1">
                        {t("editor.previewDetails")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function Segmented({
    value,
    onChange,
}: {
    value: "light" | "dark";
    onChange: (value: "light" | "dark") => void;
}) {
    const t = useT();
    return (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(
                [
                    ["dark", t("picker.dark"), Moon],
                    ["light", t("picker.light"), Sun],
                ] as const
            ).map(([id, label, Icon]) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    aria-pressed={value === id}
                    className={cn(
                        "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                        value === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Icon size={13} aria-hidden="true" /> {label}
                </button>
            ))}
        </div>
    );
}

export default function ThemeEditor({
    theme,
    isNew,
    onSave,
    onDelete,
    onClose,
}: {
    /** The theme to edit; null closes the editor. */
    theme: CustomTheme | null;
    isNew: boolean;
    onSave: (theme: CustomTheme) => void;
    onDelete: (id: string) => void;
    onClose: () => void;
}) {
    const t = useT();
    const [draft, setDraft] = useState<CustomTheme | null>(theme);
    useEffect(() => setDraft(theme), [theme]);
    const [picking, setPicking] = useState(false);
    const [imageError, setImageError] = useState("");

    if (!draft) {
        return null;
    }

    const set = (patch: Partial<CustomTheme>) => setDraft({ ...draft, ...patch });
    const setBackground = (patch: Partial<CustomTheme["background"]>) =>
        set({ background: { ...draft.background, ...patch } });
    const setAccent = (patch: Partial<CustomTheme["accent"]>) =>
        set({ accent: { ...draft.accent, ...patch } });
    const setImage = (patch: Partial<ThemeImage>) =>
        draft.image && set({ image: { ...draft.image, ...patch } });

    const pickImage = async () => {
        setPicking(true);
        setImageError("");
        try {
            const file = await invoke<UserFile | null>("import_user_file", { kind: "backgrounds" });
            if (file) set({ image: draft.image ? { ...draft.image, url: file.url } : defaultThemeImage(file.url) });
        } catch (error) {
            setImageError(errorMessage(error));
        } finally {
            setPicking(false);
        }
    };

    // Switching mode moves the page lightness into the new mode's range,
    // mirrored, so "quite dark" becomes "quite light" rather than jumping.
    const switchMode = (mode: "light" | "dark") => {
        if (mode === draft.mode) return;
        const from = BACKGROUND_LIGHTNESS[draft.mode];
        const to = BACKGROUND_LIGHTNESS[mode];
        const position = (draft.background.l - from.min) / (from.max - from.min);
        set({ mode, background: { ...draft.background, l: to.max - position * (to.max - to.min) } });
    };

    const range = BACKGROUND_LIGHTNESS[draft.mode];
    const { h, c, l } = draft.background;
    const percent = (value: number) => `${Math.round(value * 100)}%`;

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t(isNew ? "editor.newTitle" : "editor.editTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("editor.description")}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-3.5">
                        <Input
                            value={draft.name}
                            maxLength={40}
                            onChange={(event) => set({ name: event.target.value })}
                            aria-label={t("editor.name")}
                            placeholder={t("editor.name")}
                        />
                        <Segmented value={draft.mode} onChange={switchMode} />

                        <section className="space-y-2.5">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {t("editor.background")}
                            </h4>
                            <Slider
                                label={t("editor.hue")}
                                value={h}
                                min={0}
                                max={360}
                                step={1}
                                format={(value) => `${value}°`}
                                track={hueTrack(draft.mode === "dark" ? 0.35 : 0.9, 0.08)}
                                thumb={`oklch(${l} ${c} ${h})`}
                                onChange={(value) => setBackground({ h: value })}
                            />
                            <Slider
                                label={t("editor.tint")}
                                value={c}
                                min={0}
                                max={0.08}
                                step={0.002}
                                format={(value) => percent(value / 0.08)}
                                track={`linear-gradient(to right, oklch(${l} 0 ${h}), oklch(${l} 0.08 ${h}))`}
                                thumb={`oklch(${l} ${c} ${h})`}
                                onChange={(value) => setBackground({ c: value })}
                            />
                            <Slider
                                label={t(draft.mode === "dark" ? "editor.darkness" : "editor.brightness")}
                                value={l}
                                min={range.min}
                                max={range.max}
                                step={0.005}
                                format={(value) => percent((value - range.min) / (range.max - range.min))}
                                track={`linear-gradient(to right, oklch(${range.min} ${c} ${h}), oklch(${range.max} ${c} ${h}))`}
                                thumb={`oklch(${l} ${c} ${h})`}
                                onChange={(value) => setBackground({ l: value })}
                            />
                        </section>

                        <section className="space-y-2.5">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {t("editor.accent")}
                            </h4>
                            <Slider
                                label={t("editor.hue")}
                                value={draft.accent.h}
                                min={0}
                                max={360}
                                step={1}
                                format={(value) => `${value}°`}
                                track={hueTrack(0.75, 0.15)}
                                thumb={`oklch(0.75 ${draft.accent.c} ${draft.accent.h})`}
                                onChange={(value) => setAccent({ h: value })}
                            />
                            <Slider
                                label={t("editor.vividness")}
                                value={draft.accent.c}
                                min={0.02}
                                max={0.22}
                                step={0.005}
                                format={(value) => percent((value - 0.02) / 0.2)}
                                track={`linear-gradient(to right, oklch(0.75 0.02 ${draft.accent.h}), oklch(0.75 0.22 ${draft.accent.h}))`}
                                thumb={`oklch(0.75 ${draft.accent.c} ${draft.accent.h})`}
                                onChange={(value) => setAccent({ c: value })}
                            />
                        </section>

                        <section className="space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <h4 className="text-xs font-medium text-muted-foreground">{t("editor.image")}</h4>
                                <div className="flex items-center gap-1">
                                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => void pickImage()} disabled={picking}>
                                        {picking ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} aria-hidden="true" />}
                                        {t(draft.image ? "editor.image.change" : "editor.image.choose")}
                                    </Button>
                                    {draft.image ? (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7"
                                            onClick={() => set({ image: undefined })}
                                            aria-label={t("editor.image.remove")}
                                        >
                                            <Trash2 size={12} aria-hidden="true" />
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                            {imageError ? <p className="text-[11px] text-status-error">{imageError}</p> : null}
                            {draft.image ? (
                                <>
                                    {(
                                        [
                                            ["blur", "editor.image.blur", (value: number) => `${value}px`],
                                            ["brightness", "editor.image.brightness", (value: number) => percent(value)],
                                            ["saturate", "editor.image.saturation", (value: number) => percent(value)],
                                            ["dim", "editor.image.dim", (value: number) => percent(value)],
                                            ["panel", "editor.image.panel", (value: number) => percent(value)],
                                        ] as const
                                    ).map(([key, label, format]) => {
                                        const limit = THEME_IMAGE_LIMITS[key];
                                        return (
                                            <Slider
                                                key={key}
                                                label={t(label)}
                                                value={draft.image![key]}
                                                min={limit.min}
                                                max={limit.max}
                                                step={limit.step}
                                                format={format}
                                                track="linear-gradient(to right, var(--muted), var(--primary))"
                                                thumb="var(--primary)"
                                                onChange={(value) => setImage({ [key]: value })}
                                            />
                                        );
                                    })}
                                </>
                            ) : (
                                <p className="text-[11px] text-muted-foreground">{t("editor.image.hint")}</p>
                            )}
                        </section>
                    </div>

                    <div className="space-y-2">
                        <h4 className="text-xs font-medium text-muted-foreground">
                            {t("editor.preview")}
                        </h4>
                        <Preview theme={draft} />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                    {isNew ? (
                        <span />
                    ) : (
                        <Button
                            variant="ghost"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            onClick={() => onDelete(draft.id)}
                        >
                            <Trash2 size={14} /> {t("configuration.bulk.deleteAction")}
                        </Button>
                    )}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
                            {t(isNew ? "editor.create" : "common.save")}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
