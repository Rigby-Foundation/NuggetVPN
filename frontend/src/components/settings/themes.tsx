import { useMemo, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useVpn } from "@/app/vpn-context";
import { SettingsGroup } from "@/components/settings/shell";
import { ThemeColorPicker } from "@/components/settings/theme-color-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage, invoke } from "@/lib/backend";
import { cssColorToHex } from "@/lib/color";
import { useT } from "@/lib/i18n";
import { hasNativeRuntime, isAndroid, isIOS } from "@/lib/platform";
import {
  deleteCustomTheme, resolveTheme, saveCustomTheme, selectTheme, useThemeState, useWallpaperPreview,
} from "@/lib/theme";
import {
  backgroundImage, backgroundMode, defaultPalette,
  paletteTokens, pluginThemes, themePresets,
  type CustomTheme, type ThemePalette,
} from "@/lib/theme-palette";
import { cn } from "@/lib/utils";
import type { UserFile } from "@/types";

const themeGrid = "grid gap-1 rounded-xl border border-border/60 p-1 @min-[600px]:grid-cols-2";
type Swatches = readonly [string, string, string];

function swatches(palette: ThemePalette): Swatches {
  const tokens = paletteTokens(palette);
  return [tokens["--background"], tokens["--card"], tokens["--primary"]];
}

const baseThemes = [
  { id: "system", label: "settings.appearance.systemTheme", colors: ["#fafafa", "#18181b", "#868495"] },
  { id: "light", label: "theme.light", colors: ["#ffffff", "#f4f4f5", "#4431be"] },
  { id: "dark", label: "theme.dark", colors: ["#0a0a0c", "#18181b", "#6259f4"] },
] as const;

function ThemeRow({ id, name, colors, selected, onEdit }: {
  id: string;
  name: string;
  colors: Swatches;
  selected: boolean;
  onEdit?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => selectTheme(id)}
        className={cn(
          "flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring compact:min-h-11",
          selected && "bg-accent text-accent-foreground",
        )}
      >
        <span aria-hidden="true" className="grid h-[18px] w-9 shrink-0 grid-cols-3 overflow-hidden rounded-sm ring-1 ring-foreground/12">
          {colors.map((color, index) => <span key={index} style={{ backgroundColor: color }} />)}
        </span>
        <span className="min-w-0 flex-1 wrap-break-word text-[13px] font-medium">{name}</span>
        {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
      </button>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          aria-label={t("picker.edit", { name })}
          className="size-8 shrink-0 compact:size-11"
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function ThemeEditor({ initial, isNew, onClose }: {
  initial: CustomTheme;
  isNew: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const [pickingImage, setPickingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const tokens = paletteTokens(draft);
  const pickerColors = useMemo(() => ({
    background: cssColorToHex(tokens["--background"]) ?? "#0a0a0c",
    accent: cssColorToHex(tokens["--primary"]) ?? "#6259f4",
  }), [tokens["--background"], tokens["--primary"]]);
  const updateColor = (key: "background" | "accent", hex: string) => {
    setDraft((current) => {
      if (key === "accent") return { ...current, colors: { ...current.colors, accent: hex } };
      return {
        ...current,
        mode: backgroundMode(hex),
        colors: { background: hex, accent: current.colors?.accent ?? pickerColors.accent },
      };
    });
  };
  const chooseImage = async () => {
    setPickingImage(true);
    setImageError("");
    try {
      const file = await invoke<UserFile | null>("import_user_file", { kind: "backgrounds" });
      const image = file && backgroundImage(file.url);
      if (image) setDraft((current) => ({ ...current, image }));
    } catch (error) {
      setImageError(errorMessage(error));
    } finally {
      setPickingImage(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent initialFocus={isAndroid || isIOS ? false : undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pe-9">
          <DialogTitle>{t(isNew ? "editor.newTitle" : "editor.editTitle")}</DialogTitle>
          <DialogDescription>{t("editor.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.name.trim()) return;
            saveCustomTheme(draft);
            onClose();
          }}
        >
          <div className="space-y-2">
            <label className="block text-xs font-medium" htmlFor="theme-name">{t("editor.name")}</label>
            <Input id="theme-name" maxLength={60} value={draft.name} onChange={(event) => {
              const name = event.currentTarget.value;
              setDraft((current) => ({ ...current, name }));
            }} />
          </div>

          <div className="relative overflow-hidden rounded-xl border bg-background p-3 text-foreground" style={tokens as CSSProperties}>
            {draft.image && (
              <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: `url("${draft.image.url}")` }} />
            )}
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("editor.preview")}</p>
                <p className="truncate text-xs text-muted-foreground">{draft.name.trim() || t("picker.untitled")}</p>
              </div>
              <span aria-hidden="true" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                {t("connection.connect")}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ThemeColorPicker label={t("editor.background")} value={pickerColors.background} onChange={(hex) => updateColor("background", hex)} />
            <ThemeColorPicker label={t("editor.accent")} value={pickerColors.accent} onChange={(hex) => updateColor("accent", hex)} />
          </div>

          {(hasNativeRuntime() || draft.image) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="me-auto text-xs font-medium">{t("editor.image")}</span>
              {hasNativeRuntime() && (
                <Button type="button" size="sm" variant="outline" disabled={pickingImage} onClick={() => void chooseImage()}>
                  <ImagePlus aria-hidden="true" />{t(draft.image ? "editor.image.change" : "editor.image.choose")}
                </Button>
              )}
              {draft.image && (
                <Button type="button" size="sm" variant="ghost" aria-label={t("editor.image.remove")} onClick={() => setDraft({ ...draft, image: undefined })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
              {imageError && <p className="basis-full text-xs text-destructive" role="alert">{imageError}</p>}
            </div>
          )}

          <DialogFooter className="mx-0 mb-0 rounded-none bg-transparent px-0 pt-3 pb-0">
            {!isNew && (
              <Button type="button" variant="ghost" className="sm:me-auto" onClick={() => { deleteCustomTheme(initial); onClose(); }}>
                <Trash2 aria-hidden="true" />{t("editor.delete")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={!draft.name.trim()}>{t(isNew ? "editor.create" : "common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ThemeSettings() {
  const t = useT();
  const { plugins } = useVpn();
  const installed = useMemo(() => pluginThemes(plugins), [plugins]);
  const state = useThemeState();
  const [editing, setEditing] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);
  useWallpaperPreview();
  const active = state.selected;
  const systemMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const wallpaper = resolveTheme({ ...state, selected: "wallpaper" }, installed, systemMode).palette;
  const newTheme = () => {
    const { mode, palette } = resolveTheme(state, installed, systemMode);
    const root = getComputedStyle(document.documentElement);
    setEditing({
      theme: {
        ...(palette ?? {
          ...defaultPalette(mode),
          colors: {
            background: cssColorToHex(root.getPropertyValue("--background")) ?? undefined,
            accent: cssColorToHex(root.getPropertyValue("--primary")) ?? undefined,
          },
        }),
        id: `custom-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`,
        name: "",
      },
      isNew: true,
    });
  };
  const presetCard = ({ id, label, palette }: (typeof themePresets)[number]) => (
    <ThemeRow key={id} id={id} name={t(label)} colors={swatches(palette)} selected={active === id} />
  );
  const customCard = (theme: CustomTheme, editable: boolean) => (
    <ThemeRow
      key={theme.id}
      id={theme.id}
      name={theme.name || t("picker.untitled")}
      colors={swatches(theme)}
      selected={active === theme.id}
      onEdit={editable ? () => setEditing({ theme, isNew: false }) : undefined}
    />
  );

  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("appearance.theme")}</h3>
        <Button type="button" variant="outline" onClick={newTheme}><Plus aria-hidden="true" />{t("picker.new")}</Button>
      </div>
      {state.custom.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t("picker.custom")}</h4>
          <div className={themeGrid}>{state.custom.map((theme) => customCard(theme, true))}</div>
        </section>
      )}
      <div className={themeGrid}>
        {baseThemes.map(({ id, label, colors }) => (
          <ThemeRow key={id} id={id} name={t(label)} colors={colors} selected={active === id} />
        ))}
        {wallpaper && (
          <ThemeRow id="wallpaper" name={t("appearance.wallpaper")} colors={swatches(wallpaper)} selected={active === "wallpaper"} />
        )}
        {themePresets.slice(0, 15).map(presetCard)}
      </div>
      <details className="group" open={themePresets.slice(15).some((theme) => theme.id === active)}>
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open:rotate-0 rtl:rotate-90" aria-hidden="true" />
          {t("appearance.moreThemes")}
        </summary>
        <div className={cn(themeGrid, "mt-1.5")}>{themePresets.slice(15).map(presetCard)}</div>
      </details>
      {installed.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t("picker.plugins")}</h4>
          <div className={themeGrid}>{installed.map((theme) => customCard(theme, false))}</div>
        </section>
      )}
      {editing && <ThemeEditor initial={editing.theme} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </SettingsGroup>
  );
}
