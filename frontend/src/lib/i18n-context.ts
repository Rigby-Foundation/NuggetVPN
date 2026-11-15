import { createContext } from "react";
import type { Language, LanguageChoice, Translate } from "@/lib/i18n";

export const I18nContext = createContext<{
  language: Language;
  dir: "ltr" | "rtl";
  choice: LanguageChoice;
  setChoice: (choice: LanguageChoice) => void;
  t: Translate;
} | null>(null);
