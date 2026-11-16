import type { ComponentType } from "react";
import { ChartNoAxesColumn, EthernetPort, Info, Route, Server, Settings, UserGroup } from "lucide-react";
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
    mobileLabel?: MessageKey;
    /** Set false for pages reached through another screen on phones. */
    mobile?: boolean;
    /** Use a concrete URL for routes with parameters or wildcards. */
    to?: string;
    /** Set false to keep this item active on child pages. */
    end?: boolean;
  };
}

export const defaultPage = "/connection";
export const settingsPage = "/settings";
export const aboutPage = `${settingsPage}/about`;
export const analyticsPage = "/analytics";

// Add pages here. Routes and sidebar links are generated from this list.
export const pages: readonly AppPage[] = [
  {
    path: "/connection",
    title: "ui.connectionPage",
    icon: EthernetPort,
    load: () => import("@/pages/ConnectionPage"),
    sidebar: { mobileLabel: "nav.connection" },
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
    sidebar: { mobileLabel: "nav.mobileConfigs" },
  },
  {
    path: "/routing",
    title: "nav.routing",
    icon: Route,
    load: () => import("@/pages/RoutingPage"),
    sidebar: { mobileLabel: "nav.mobileRouting" },
  },
  {
    path: analyticsPage,
    title: "stats.analytics",
    icon: ChartNoAxesColumn,
    load: () => import("@/pages/AnalyticsPage"),
    sidebar: { mobile: false },
  },
  {
    path: settingsPage,
    title: "nav.settings",
    icon: Settings,
    load: () => import("@/pages/SettingsPage"),
    sidebar: {},
  },
  {
    path: aboutPage,
    title: "settings.about",
    icon: Info,
    load: () => import("@/pages/AboutPage"),
    sidebar: { placement: "footer", mobileLabel: "about.mobileLabel" },
  },
];
