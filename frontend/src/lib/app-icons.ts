import { useEffect, useState } from "react";

import { invoke } from "@/lib/backend";

/**
 * Programs' icons, read from their files by path (see app.GetFileIcons), as
 * data URLs; "" where there is none. Kept for the session: a program's icon
 * does not change while the app is open, and Connections asks every second.
 */
const cache = new Map<string, string>();
const asked = new Set<string>();

export function useFileIcons(paths: readonly (string | undefined)[]): ReadonlyMap<string, string> {
    const [, setVersion] = useState(0);
    const missing = [...new Set(paths.filter((path): path is string => !!path && !asked.has(path)))];
    const key = missing.join("\u0000");

    useEffect(() => {
        if (missing.length === 0) return;
        missing.forEach((path) => asked.add(path));
        let live = true;
        invoke<Record<string, string>>("get_file_icons", { paths: missing })
            .then((icons) => {
                missing.forEach((path) => cache.set(path, icons?.[path] ?? ""));
                if (live) setVersion((version) => version + 1);
            })
            .catch(() => missing.forEach((path) => cache.set(path, "")));
        return () => {
            live = false;
        };
        // key stands for missing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return cache;
}
