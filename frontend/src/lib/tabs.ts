import { Activity, Power, Server, Settings, Signal, Waypoints } from "lucide-react";

import type { MessageKey } from "@/lib/i18n";

export interface NavTabItem {
    id: string;
    label: MessageKey;
    icon: typeof Power;
}

/**
 * The app's screens, in order. Every navigation — top bar, sidebar, dock,
 * the phone's bar — and the arrow keys walk this one list.
 *
 * Connections, Statistics and Logs are one screen, Activity, with a switcher
 * of its own: they are three views of the same thing, what went through the
 * tunnel, and took three places in a bar that had room for five.
 */
export const NAV_TABS: readonly NavTabItem[] = [
    { id: "connection", label: "nav.connection", icon: Power },
    { id: "proxies", label: "nav.proxies", icon: Signal },
    { id: "configuration", label: "nav.configuration", icon: Server },
    { id: "routing", label: "nav.routing", icon: Waypoints },
    { id: "activity", label: "nav.activity", icon: Activity },
    { id: "settings", label: "nav.settings", icon: Settings },
];

/** Activity's pages. */
export const ACTIVITY_PAGES = ["statistics", "connections", "logs"] as const;
export type ActivityPage = (typeof ACTIVITY_PAGES)[number];
