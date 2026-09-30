import { useEffect, useRef } from "react";

import { isAndroid } from "@/lib/platform";

/**
 * Android's Back gesture.
 *
 * The WebView goes back through its history before the activity gives up and
 * moves to the background, so each thing Back should close (a settings page,
 * a dialog, any tab other than Connection) pushes a history entry while it is
 * open, and Back popping that entry closes it. Everywhere else this does
 * nothing: a desktop window has no Back.
 */

interface Entry {
    run: () => void;
}

// Open things, oldest first. Back closes the newest.
const stack: Entry[] = [];
// Entries this module removed itself, whose popstate is not a Back.
let ownPops = 0;

if (isAndroid) {
    window.addEventListener("popstate", () => {
        if (ownPops > 0) {
            ownPops--;
            return;
        }
        stack.pop()?.run();
    });
}

/** While active, Back calls onBack instead of leaving the app. */
export function useBack(active: boolean, onBack: () => void) {
    const handler = useRef(onBack);
    handler.current = onBack;

    useEffect(() => {
        if (!isAndroid || !active) return;
        const entry: Entry = { run: () => handler.current() };
        stack.push(entry);
        window.history.pushState({ nuggetBack: true }, "");
        return () => {
            const index = stack.indexOf(entry);
            // Gone already: Back closed it and took its entry with it.
            if (index === -1) return;
            // Closed some other way; take back the entry it pushed.
            stack.splice(index, 1);
            ownPops++;
            window.history.back();
        };
    }, [active]);
}

/** Back closes the topmost dialog or sheet the way Escape would. */
export function useBackEscapes() {
    useBack(true, () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}
