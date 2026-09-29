import { System } from "@wailsio/runtime";

/**
 * The browser's own right-click menu — Back, Refresh, Save as, Print — makes
 * sense in a web page and none in an app; Refresh in particular reloads the
 * whole UI.
 *
 * In a release build the Wails runtime already hides it (its
 * `--default-contextmenu: auto` rule), keeping it only in text fields and over
 * selected text, where Cut, Copy and Paste are useful. It deliberately leaves
 * the full menu on in debug builds, for Inspect — which is where it showed up
 * in everyday use. This applies the same rule to debug builds, and leaves
 * Inspect one modifier away: Shift + right-click.
 *
 * Wails' DefaultContextMenuDisabled window option is not used instead: it
 * removes the menu from text fields as well, which is how people paste a
 * subscription link.
 */
export function blockBrowserMenu() {
    document.addEventListener("contextmenu", (event) => {
        // Release builds: the runtime's own handler has this covered.
        if (!System.IsDebug() || event.shiftKey) {
            return;
        }
        const target = event.target as HTMLElement | null;
        const editable =
            target?.isContentEditable ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement;
        const selected = (window.getSelection()?.toString() ?? "").length > 0;
        if (editable || selected) {
            return;
        }
        event.preventDefault();
    });
}
