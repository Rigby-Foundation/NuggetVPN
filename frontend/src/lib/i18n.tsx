/**
 * Translation.
 *
 * English (locales/en.ts) is the source of truth; every other language is
 * typed as a complete record of its keys, so a missing or misspelt key in any
 * translation is a build error rather than a string that silently stays in
 * English.
 *
 * A message is a string with {name} placeholders, or — for anything counted
 * — a set of plural forms chosen by Intl.PluralRules. Russian and Ukrainian
 * need one/few/many ("1 сервер, 2 сервера, 5 серверов"); Chinese and Japanese
 * have a single form.
 *
 * The choice lives in this renderer's storage, like the theme, so the first
 * frame is already in the right language.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import en from "@/locales/en";
import ja from "@/locales/ja";
import ru from "@/locales/ru";
import uk from "@/locales/uk";
import zh from "@/locales/zh";

export type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
export type Message = string | Plural;
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, Message>;

/**
 * The writing systems the UI can be shown in. A font lists the ones it fully
 * covers; see FONTS in lib/appearance.ts. Chinese and Japanese are separate
 * even though they share characters: the same character is drawn differently
 * in each, so a Chinese font does not cover Japanese.
 */
export type Script = "latin" | "cyrillic" | "hans" | "jpan" | "arab";

/**
 * Every language the UI offers. `tag` goes on <html lang>, which is also how
 * the browser picks regional glyphs when it falls back to a system font —
 * zh-CN, not bare zh, so Chinese gets Simplified Chinese shapes.
 *
 * Adding a language means an entry here, its locale file, and — if its
 * script is new — fonts that cover it in lib/appearance.ts.
 */
export const LANGUAGES = [
    { id: "en", label: "English", tag: "en", script: "latin" },
    { id: "ru", label: "Русский", tag: "ru", script: "cyrillic" },
    { id: "uk", label: "Українська", tag: "uk", script: "cyrillic" },
    { id: "zh", label: "中文", tag: "zh-CN", script: "hans" },
    { id: "ja", label: "日本語", tag: "ja", script: "jpan" },
] as const satisfies readonly { id: string; label: string; tag: string; script: Script }[];

export type Language = (typeof LANGUAGES)[number]["id"];

/** The script a language is written in. */
export function scriptOf(language: Language): Script {
    return LANGUAGES.find((item) => item.id === language)?.script ?? "latin";
}
/** What the user picked: a language, or whatever the system uses. */
export type LanguageChoice = Language | "system";

const CATALOG: Record<Language, Messages> = { en, ru, uk, zh, ja };
const STORAGE_KEY = "nugget.language";

/** The first of the system's preferred languages this app has. */
export function systemLanguage(): Language {
    const preferred = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
    for (const tag of preferred) {
        const base = tag.toLowerCase().split("-")[0];
        if (LANGUAGES.some((language) => language.id === base)) {
            return base as Language;
        }
    }
    return "en";
}

/** The language the UI will show, read before React renders. */
export function currentLanguage(): Language {
    const choice = loadChoice();
    return choice === "system" ? systemLanguage() : choice;
}

function loadChoice(): LanguageChoice {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "system" || LANGUAGES.some((language) => language.id === stored)) {
            return stored as LanguageChoice;
        }
    } catch {
        // Storage unavailable: follow the system.
    }
    return "system";
}

export type Params = Record<string, string | number>;

/** Formats one message; exported for the few callers outside React. */
export function translate(language: Language, key: MessageKey, params?: Params): string {
    let message: Message = CATALOG[language][key] ?? en[key];
    if (typeof message !== "string") {
        const count = Number(params?.count ?? 0);
        const form = new Intl.PluralRules(language).select(count) as keyof Plural;
        message = message[form] ?? message.other;
    }
    if (!params) {
        return message;
    }
    return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const value = params[name];
        if (value === undefined) return whole;
        return typeof value === "number" ? value.toLocaleString(language) : value;
    });
}

export type Translate = (key: MessageKey, params?: Params) => string;

interface I18nContext {
    language: Language;
    choice: LanguageChoice;
    setChoice: (choice: LanguageChoice) => void;
    t: Translate;
}

const Context = createContext<I18nContext | null>(null);

export function useI18n(): I18nContext {
    const value = useContext(Context);
    if (!value) {
        throw new Error("useI18n must be used inside I18nProvider");
    }
    return value;
}

/** Just the translate function, which is what most components need. */
export function useT(): Translate {
    return useI18n().t;
}

export function I18nProvider({
    children,
    onLanguage,
}: {
    children: ReactNode;
    /** Told the resolved language whenever it changes — for the tray menu. */
    onLanguage?: (language: Language) => void;
}) {
    const [choice, setChoiceState] = useState<LanguageChoice>(loadChoice);
    const language = choice === "system" ? systemLanguage() : choice;

    const setChoice = useCallback((next: LanguageChoice) => {
        setChoiceState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // It still applies for this run.
        }
    }, []);

    useEffect(() => {
        document.documentElement.lang = LANGUAGES.find((item) => item.id === language)?.tag ?? language;
        onLanguage?.(language);
    }, [language, onLanguage]);

    const t = useCallback<Translate>((key, params) => translate(language, key, params), [language]);
    const value = useMemo(() => ({ language, choice, setChoice, t }), [language, choice, setChoice, t]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
}
