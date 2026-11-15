import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import { SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage, invoke } from "@/lib/backend";
import {
  bundledFonts,
  fontChoiceLabel,
  fontChoiceValue,
  loadImportedFont,
  useFontChoice,
  type FontChoice,
} from "@/lib/fonts";
import { useT } from "@/lib/i18n";
import { hasNativeRuntime } from "@/lib/platform";
import type { UserFile } from "@/types";

const fontPresets: FontChoice[] = [
  ...Object.keys(bundledFonts).map((id): FontChoice => ({
    kind: "bundled",
    id: id as keyof typeof bundledFonts,
  })),
  { kind: "system" },
];

export function FontSettings() {
  const t = useT();
  const native = hasNativeRuntime();
  const [choice, setChoice] = useFontChoice();
  const [installed, setInstalled] = useState<string[]>([]);
  const [imported, setImported] = useState<UserFile[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!native) return;
    let current = true;
    void invoke<string[]>("list_system_fonts").then((fonts) => {
      if (current) setInstalled(fonts ?? []);
    }).catch(() => {});
    void invoke<UserFile[]>("list_user_files", { kind: "fonts" }).then((files) => {
      if (current) setImported(files ?? []);
    }).catch(() => {});
    return () => { current = false; };
  }, [native]);

  const installedChoices = installed.map((name): FontChoice => ({ kind: "installed", name }));
  if (choice.kind === "installed" && !installed.includes(choice.name)) {
    installedChoices.unshift(choice);
  }
  const importedChoices = imported.map((font): FontChoice => ({ kind: "imported", font }));
  if (choice.kind === "imported" && !imported.some(({ id }) => id === choice.font.id)) {
    importedChoices.unshift(choice);
  }
  const label = (font: FontChoice) => fontChoiceLabel(font, t("appearance.font.system"));
  const renderItem = (font: FontChoice) => {
    const value = fontChoiceValue(font);
    return <SelectItem key={value} value={value}>{label(font)}</SelectItem>;
  };

  async function selectFont(value: string | null) {
    const next = [...fontPresets, ...installedChoices, ...importedChoices]
      .find((item) => fontChoiceValue(item) === value);
    if (!next) return;
    if (next.kind !== "imported") {
      setChoice(next);
      return;
    }
    setBusy(true);
    try {
      await loadImportedFont(next.font);
      setChoice(next);
    } catch {
      toast.error(t("appearance.font.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function importFont() {
    setBusy(true);
    try {
      const font = await invoke<UserFile | null>("import_user_file", { kind: "fonts" });
      if (!font) return;
      try {
        await loadImportedFont(font);
      } catch {
        await invoke("remove_user_file", { kind: "fonts", id: font.id }).catch(() => {});
        toast.error(t("appearance.font.loadFailed"));
        return;
      }
      setImported((fonts) => [...fonts.filter(({ id }) => id !== font.id), font]);
      setChoice({ kind: "imported", font });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup
      title={t("appearance.font")}
      description={t("appearance.font.description")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={fontChoiceValue(choice)} onValueChange={selectFont} disabled={busy}>
          <SelectTrigger className="w-full max-w-64" aria-label={t("appearance.font")}>
            <SelectValue>{label(choice)}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="max-h-[min(22rem,var(--available-height))] overscroll-contain">
            <SelectGroup>{fontPresets.map(renderItem)}</SelectGroup>
            {installedChoices.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t("appearance.font.installed")}</SelectLabel>
                {installedChoices.map(renderItem)}
              </SelectGroup>
            )}
            {importedChoices.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t("appearance.font.imported")}</SelectLabel>
                {importedChoices.map(renderItem)}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={!native || busy} onClick={importFont}>
          <Upload aria-hidden="true" />
          {t("appearance.font.add")}
        </Button>
      </div>
    </SettingsGroup>
  );
}
