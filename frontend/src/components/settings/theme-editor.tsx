import { CSSProperties, useEffect, useState } from "react";
import { ImagePlus, Loader2, Moon, Sun, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useAppearance } from "@/components/appearance-provider";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
    BACKGROUND_LIGHTNESS,
    customClass,
    customThemeKnobs,
    CustomTheme,
    defaultThemeImage,
    templateFrom,
    THEME_IMAGE_LIMITS,
    ThemeImage,
} from "@/lib/appearance";
import { THEME_PRESETS } from "@/lib/themes";
import { UserFile } from "@/types";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The custom theme editor.
 *
 * Colours are picked in OKLCH, the space the presets are made of, and only
 * the parts a theme varies are offered: the page's hue, tint and lightness,
 * the accent's hue and vividness. The accent's lightness is fixed per mode,
 * so no pick can make the text on a button unreadable.
 */

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
    const { prefs } = useAppearance();
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

    // Another theme as the starting point: a preset's colours, or a copy of
    // one of the user's own (with its picture). The name and id stay this
    // theme's, so nothing is overwritten.
    const customs = [...prefs.customThemes, ...prefs.pluginThemes].filter((custom) => custom.id !== draft.id);
    const startFrom = (value: string) => {
        const [kind, id] = value.split("|");
        if (kind === "preset") {
            const preset = THEME_PRESETS.find((item) => item.id === id);
            if (preset) set({ ...templateFrom(preset), image: undefined });
            return;
        }
        const custom = customs.find((item) => item.id === id);
        if (custom) {
            set({ mode: custom.mode, background: { ...custom.background }, accent: { ...custom.accent }, image: custom.image ? { ...custom.image } : undefined });
        }
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
                        <Select value="" onValueChange={startFrom}>
                            <SelectTrigger className="w-full" aria-label={t("editor.startFrom")}>
                                <SelectValue placeholder={t("editor.startFrom")} />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                                {customs.length > 0 ? (
                                    <SelectGroup>
                                        <SelectLabel>{t("editor.startFrom.custom")}</SelectLabel>
                                        {customs.map((custom) => (
                                            <SelectItem key={custom.id} value={`custom|${custom.id}`}>
                                                {custom.name || t("editor.untitled")}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ) : null}
                                <SelectGroup>
                                    <SelectLabel>{t("editor.startFrom.presets")}</SelectLabel>
                                    {THEME_PRESETS.map((preset) => (
                                        <SelectItem key={preset.id} value={`preset|${preset.id}`}>
                                            {t(preset.label)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <Segmented value={draft.mode} onChange={switchMode} />

                        <section className="space-y-2.5">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {t("editor.background")}
                            </h4>
                            <ColorPicker
                                h={h}
                                c={c}
                                l={l}
                                maxChroma={0.08}
                                fieldLightness={draft.mode === "dark" ? 0.45 : 0.88}
                                lightnessRange={range}
                                lightnessLabel={t(draft.mode === "dark" ? "editor.darkness" : "editor.brightness")}
                                onChange={setBackground}
                            />
                        </section>

                        <section className="space-y-2.5">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {t("editor.accent")}
                            </h4>
                            <ColorPicker
                                h={draft.accent.h}
                                c={draft.accent.c}
                                l={Number(customThemeKnobs(draft)["--brand-l"])}
                                minChroma={0.02}
                                maxChroma={0.22}
                                onChange={setAccent}
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
