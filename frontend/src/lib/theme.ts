import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@/lib/backend";
import { hasNativeRuntime, isAndroid, isIOS } from "@/lib/platform";
export type ThemeChoice = "Light" | "Dark" | "System";
function storedTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem("theme")?.toLowerCase();
    return saved === "light" ? "Light" : saved === "system" ? "System" : "Dark";
  } catch {
    return "Dark";
  }
}
let choice = storedTheme();
const listeners = new Set<() => void>();
const snapshot = () => choice;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function setChoice(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem("theme", next.toLowerCase());
  } catch {
    /* The choice still applies in this window. */
  }
  listeners.forEach((listener) => listener());
}
export function useThemeChoice() {
  return [
    useSyncExternalStore(subscribe, snapshot, snapshot),
    setChoice,
  ] as const;
}

export type PageMotion = "rise" | "slide" | "fade" | "none";
function storedPageMotion(): PageMotion {
  try {
    const value = localStorage.getItem("kage.pageMotion");
    if (value === "none" || value === "fade" || value === "slide") return value;
  } catch {
    // Use the default if storage is unavailable.
  }
  return "rise";
}
let pageMotion = storedPageMotion();
const motionSnapshot = () => pageMotion;
function setPageMotion(value: PageMotion) {
  pageMotion = value;
  try {
    localStorage.setItem("kage.pageMotion", value);
  } catch {
    // The choice still applies in this window.
  }
  listeners.forEach((listener) => listener());
}
export function usePageMotion() {
  return [
    useSyncExternalStore(subscribe, motionSnapshot, motionSnapshot),
    setPageMotion,
  ] as const;
}
export function useApplyTheme() {
  const [theme] = useThemeChoice();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "Dark" || (theme === "System" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      if ((isAndroid || isIOS) && hasNativeRuntime()) {
        void invoke("set_system_bars", {
          color: dark ? "#18181B" : "#FAFAFA",
          light: !dark,
        }).catch(() => undefined);
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
