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

const PATHS_KEY = "nugget.programPaths";
let programPaths: Record<string, string> | null = null;

function loadPaths(): Record<string, string> {
    if (programPaths) return programPaths;
    try {
        programPaths = JSON.parse(localStorage.getItem(PATHS_KEY) ?? "{}") ?? {};
    } catch {
        programPaths = {};
    }
    return programPaths!;
}

/**
 * Remembers where each program seen on Connections lives, so Statistics —
 * which keeps programs by name only — can show their icons too. Kept on this
 * device; only names Connections has seen are known.
 */
export function rememberProgramPaths(rows: readonly { app?: string; app_path?: string }[]) {
    const paths = loadPaths();
    let changed = false;
    for (const row of rows) {
        if (row.app && row.app_path && paths[row.app] !== row.app_path) {
            paths[row.app] = row.app_path;
            changed = true;
        }
    }
    if (!changed) return;
    try {
        localStorage.setItem(PATHS_KEY, JSON.stringify(paths));
    } catch {
        // Not remembered; icons still show on Connections.
    }
}

/** Where a program by this name was last seen, if anywhere. */
export function programPath(name: string): string | undefined {
    return loadPaths()[name];
}
