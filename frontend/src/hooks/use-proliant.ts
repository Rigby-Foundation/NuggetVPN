import { useEffect } from "react";

/** P R O L I A N T, then up, down. */
const CODE = ["p", "r", "o", "l", "i", "a", "n", "t", "ArrowUp", "ArrowDown"];

/**
 * An easter egg: typing the code anywhere sets every icon in the app
 * spinning at 50 000 rpm (see [data-proliant] in App.css). Typing it again
 * stops them. Not kept between runs.
 */
export function useProliant() {
    useEffect(() => {
        let position = 0;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
            // A wrong key starts over, or counts as the first if it is one.
            position = key === CODE[position] ? position + 1 : key === CODE[0] ? 1 : 0;
            if (position < CODE.length) return;
            position = 0;
            document.documentElement.toggleAttribute("data-proliant");
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);
}
