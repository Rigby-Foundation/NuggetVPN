import type { MouseEvent } from "react";

/** What a double-click should leave alone: anything you can operate. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="menuitem"], [role="combobox"], .no-drag';

/**
 * Double-clicking an empty part of a header maximises the window, or
 * restores it, on every desktop system: what a native title bar does, which
 * the app's own headers stand in for. The headers only start a drag once the
 * mouse moves, so no system acts on the double-click itself and this cannot
 * fight it.
 */
export function maximiseOnDoubleClick(onMaximize: () => void, platform?: string) {
    return (event: MouseEvent<HTMLElement>) => {
        if (platform === "android" || platform === "ios") return;
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
        event.preventDefault();
        onMaximize();
    };
}
