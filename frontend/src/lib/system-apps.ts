import { useEffect, useState } from "react";

/**
 * Whether a program is part of the operating system rather than an app the
 * user runs — the background services that open connections of their own,
 * and that crowd the lists on Connections and Statistics.
 *
 * Decided from what the core already reports, the program's name and where
 * its file is: Windows services show up by their DLL name (iphlpsvc.dll),
 * system programs live under the system folders. No guess is perfect; a
 * program it gets wrong is one click away under "Show system".
 */
export function isSystemProgram(name: string | undefined, path?: string): boolean {
    if (!name) return true;
    const lower = name.toLowerCase();
    if (lower.endsWith(".dll") || SYSTEM_NAMES.has(lower.replace(/\.exe$/, ""))) return true;
    const folder = (path ?? "").toLowerCase().replace(/\//g, "\\");
    if (folder) {
        if (/^[a-z]:\\windows\\/.test(folder)) return true;
        const unix = (path ?? "").toLowerCase();
        if (/^\/(system|usr|sbin|bin|library\/apple)\//.test(unix)) return true;
    }
    return false;
}

const SYSTEM_NAMES = new Set([
    "system",
    "svchost",
    "lsass",
    "services",
    "wininit",
    "winlogon",
    "csrss",
    "spoolsv",
    "searchhost",
    "searchindexer",
    "smartscreen",
    "msmpeng",
    "mpdefendercoreservice",
    "wuauclt",
    "musnotification",
    "backgroundtaskhost",
    "runtimebroker",
    "taskhostw",
    "mdnsresponder",
    "nsurlsessiond",
    "trustd",
    "apsd",
    "systemd-resolved",
    "networkmanager",
]);

const KEY = "nugget.showSystem";
const listeners = new Set<(value: boolean) => void>();

/**
 * Whether system programs are listed one by one (true) or folded into one
 * "System" row. Shared by Connections and Statistics, and kept on this device.
 */
export function useShowSystem(): [boolean, (value: boolean) => void] {
    const [value, setValue] = useState(() => {
        try {
            return localStorage.getItem(KEY) === "1";
        } catch {
            return false;
        }
    });
    useEffect(() => {
        listeners.add(setValue);
        return () => {
            listeners.delete(setValue);
        };
    }, []);
    const set = (next: boolean) => {
        try {
            localStorage.setItem(KEY, next ? "1" : "0");
        } catch {
            // Not remembered; it still applies now.
        }
        listeners.forEach((listener) => listener(next));
    };
    return [value, set];
}
