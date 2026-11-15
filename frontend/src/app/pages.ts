import type { ComponentType } from "react";
import { EthernetPort, Route, Server, Settings, UserGroup } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n";

export interface AppPage {
  path: string;
  title: MessageKey;
  icon?: LucideIcon;
  load: () => Promise<{ default: ComponentType }>;
  /** Omit this to make a page accessible by URL only. */
  sidebar?: {
    placement?: "main" | "footer";
    group?: string;
    label?: MessageKey;
    /** Use a concrete URL for routes with parameters or wildcards. */
    to?: string;
    /** Set false to keep this item active on child pages. */
    end?: boolean;
  };
}

export const defaultPage = "/connection";
export const settingsPage = "/settings";
export const aboutPage = `${settingsPage}/about`;

// Add pages here. Routes and sidebar links are generated from this list.
export const pages: readonly AppPage[] = [
  {
    path: "/connection",
    title: "ui.connectionPage",
    icon: EthernetPort,
    load: () => import("@/pages/ConnectionPage"),
    sidebar: {},
  },
  {
    path: "/profiles",
    title: "ui.profilesPage",
    icon: UserGroup,
    load: () => import("@/pages/ProfilesPage"),
    sidebar: {},
  },
  {
    path: "/configs",
    title: "ui.configsPage",
    icon: Server,
    load: () => import("@/pages/ConfigsPage"),
    sidebar: {},
  },
  {
    path: "/routing",
    title: "nav.routing",
    icon: Route,
    load: () => import("@/pages/RoutingPage"),
    sidebar: {},
  },
  {
    path: settingsPage,
    title: "nav.settings",
    icon: Settings,
    load: () => import("@/pages/SettingsPage"),
    sidebar: { end: false },
  },
  {
    path: aboutPage,
    title: "settings.about",
    load: () => import("@/pages/AboutPage"),
  },
];
