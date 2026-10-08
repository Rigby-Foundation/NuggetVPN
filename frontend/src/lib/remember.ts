import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";

/**
 * Where you were on each screen, for as long as the app is open.
 *
 * Screens are unmounted when you leave them — keeping them all mounted would
 * keep their timers and polling running too — so what should survive a trip
 * to another tab is kept here instead: which settings section was open, how
 * far down a list you had scrolled. A restart starts fresh.
 */
const memory = new Map<string, unknown>();

/** useState whose value outlives the component, under key. */
export function useRemembered<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
    const set = useCallback<Dispatch<SetStateAction<T>>>(
        (next) =>
            setValue((current) => {
                const resolved = typeof next === "function" ? (next as (previous: T) => T)(current) : next;
                memory.set(key, resolved);
                return resolved;
            }),
        [key]
    );
    return [value, set];
}

/**
 * Keeps an element's scroll position under key, and puts it back when the
 * element mounts again. Returns a callback ref for the scrolling element.
 *
 * Content often arrives a moment after the page (a list loading), so the
 * position is re-applied as the content grows, until it fits or the user
 * scrolls themselves.
 */
export function useScrollMemory(key: string | undefined) {
    const cleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => cleanup.current?.(), []);

    return useCallback(
        (element: HTMLElement | null) => {
            cleanup.current?.();
            cleanup.current = null;
            if (!element || !key) return;

            const target = (memory.get(`scroll:${key}`) as number | undefined) ?? 0;
            let restoring = target > 0;
            const apply = () => {
                if (!restoring) return;
                element.scrollTop = target;
                if (Math.abs(element.scrollTop - target) < 2) restoring = false;
            };
            apply();
            const grown = new ResizeObserver(apply);
            if (element.firstElementChild) grown.observe(element.firstElementChild);
            // Give up on a position the content never grows back to.
            const giveUp = window.setTimeout(() => {
                restoring = false;
                grown.disconnect();
            }, 2000);
            // A deliberate scroll ends the restoring; any scroll is remembered.
            const stop = () => {
                restoring = false;
            };
            const save = () => memory.set(`scroll:${key}`, element.scrollTop);
            element.addEventListener("wheel", stop, { passive: true });
            element.addEventListener("touchstart", stop, { passive: true });
            element.addEventListener("keydown", stop);
            element.addEventListener("scroll", save, { passive: true });

            cleanup.current = () => {
                window.clearTimeout(giveUp);
                grown.disconnect();
                element.removeEventListener("wheel", stop);
                element.removeEventListener("touchstart", stop);
                element.removeEventListener("keydown", stop);
                element.removeEventListener("scroll", save);
            };
        },
        [key]
    );
}
