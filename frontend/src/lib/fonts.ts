import { useLayoutEffect, useSyncExternalStore } from "react";
import type { UserFile } from "@/types";

export const bundledFonts = {
  "instrument-sans": { label: "Instrument Sans", family: "Instrument Sans Variable" },
  rubik: { label: "Rubik", family: "Rubik Variable" },
  onest: { label: "Onest", family: "Onest Variable" },
  manrope: { label: "Manrope", family: "Manrope Variable" },
} as const;

type BundledFont = keyof typeof bundledFonts;
type ImportedFont = Pick<UserFile, "id" | "name" | "url">;
export type FontChoice =
  | { kind: "bundled"; id: BundledFont }
  | { kind: "system" }
  | { kind: "installed"; name: string }
  | { kind: "imported"; font: ImportedFont };

const storageKey = "kage.font";
const defaultFont: FontChoice = { kind: "bundled", id: "instrument-sans" };
const fallback = "system-ui, sans-serif";

function isBundledFont(id: unknown): id is BundledFont {
  return typeof id === "string" && Object.hasOwn(bundledFonts, id);
}

function isImportedFont(value: unknown): value is ImportedFont {
  if (!value || typeof value !== "object") return false;
  const { id, name, url } = value as Partial<ImportedFont>;
  return (
    typeof id === "string" &&
    /^[a-f0-9]{16}$/.test(id) &&
    typeof name === "string" &&
    typeof url === "string" &&
    /^\/user-files\/fonts\/[a-f0-9]{16}\.(ttf|otf|woff2?)$/.test(url) &&
    url.startsWith(`/user-files/fonts/${id}.`)
  );
}

function readFont(): FontChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved?.kind === "bundled" && isBundledFont(saved.id)) return saved;
    if (saved?.kind === "system") return { kind: "system" };
    if (saved?.kind === "installed" && typeof saved.name === "string" && saved.name.trim()) {
      return saved;
    }
    if (saved?.kind === "imported" && isImportedFont(saved.font)) return saved;

    const legacy = JSON.parse(localStorage.getItem("nugget.appearance") ?? "null");
    if (isBundledFont(legacy?.font)) return { kind: "bundled", id: legacy.font };
    if (legacy?.font === "system") return { kind: "system" };
    if (Array.isArray(legacy?.userFonts)) {
      const font = (legacy.userFonts as unknown[]).filter(isImportedFont)
        .find((file) => `user:${file.id}` === legacy.font);
      if (font) return { kind: "imported", font };
    }
  } catch {
    // Storage may be unavailable or contain an outdated preference.
  }
  return defaultFont;
}

let fontChoice = readFont();
const listeners = new Set<() => void>();
const snapshot = () => fontChoice;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setFontChoice(next: FontChoice) {
  fontChoice = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // The choice still applies in this window.
  }
  listeners.forEach((listener) => listener());
}

export function useFontChoice() {
  return [useSyncExternalStore(subscribe, snapshot, snapshot), setFontChoice] as const;
}

export function fontChoiceValue(choice: FontChoice): string {
  switch (choice.kind) {
    case "bundled": return `bundled:${choice.id}`;
    case "system": return "system";
    case "installed": return `installed:${choice.name}`;
    case "imported": return `imported:${choice.font.id}`;
  }
}

export function fontChoiceLabel(choice: FontChoice, systemLabel: string): string {
  switch (choice.kind) {
    case "bundled": return bundledFonts[choice.id].label;
    case "system": return systemLabel;
    case "installed": return choice.name;
    case "imported": return choice.font.name;
  }
}

const loadedFonts = new Map<string, Promise<string>>();

export async function loadImportedFont(font: ImportedFont): Promise<string> {
  if (!isImportedFont(font)) throw new Error("Invalid font reference");
  const cached = loadedFonts.get(font.url);
  if (cached) return cached;
  const family = `Kage User ${font.id}`;
  const loaded = new FontFace(family, `url("${font.url}")`).load().then((face) => {
    document.fonts.add(face);
    return family;
  });
  loadedFonts.set(font.url, loaded);
  try {
    return await loaded;
  } catch (error) {
    loadedFonts.delete(font.url);
    throw error;
  }
}

function cssFamily(name: string): string {
  const escaped = name.replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, " ");
  return `"${escaped}", ${fallback}`;
}

export function useApplyFont() {
  const [choice] = useFontChoice();
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    switch (choice.kind) {
      case "bundled":
        style.setProperty("--app-font", cssFamily(bundledFonts[choice.id].family));
        break;
      case "system":
        style.setProperty("--app-font", fallback);
        break;
      case "installed":
        style.setProperty("--app-font", cssFamily(choice.name));
        break;
      case "imported": {
        let current = true;
        style.removeProperty("--app-font");
        void loadImportedFont(choice.font).then((family) => {
          if (current) style.setProperty("--app-font", cssFamily(family));
        }).catch(() => {
          // The default font is already in use if the file is missing or invalid.
        });
        return () => { current = false; };
      }
    }
  }, [choice]);
}
