import { Activity, BarChart3, FileText, Power, Server, Settings, Signal, Waypoints } from "lucide-react";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConnectionStatus } from "@/types";

interface AppSidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onClose: () => void;
    onMinimize: () => void;
    onMaximize: () => void;
    platform?: string;
    status: ConnectionStatus;
}

const TABS = [
    { id: "connection", label: "nav.connection", icon: Power },
    { id: "configuration", label: "nav.configuration", icon: Server },
    { id: "proxies", label: "nav.proxies", icon: Signal },
    { id: "routing", label: "nav.routing", icon: Waypoints },
    { id: "connections", label: "nav.connections", icon: Activity },
    { id: "statistics", label: "nav.statistics", icon: BarChart3 },
    { id: "logs", label: "nav.logs", icon: FileText },
] as const satisfies readonly { id: string; label: MessageKey; icon: unknown }[];

const STATUS_DOT: Record<ConnectionStatus, string> = {
    idle: "bg-status-idle",
    connecting: "bg-status-connecting animate-pulse",
    connected: "bg-status-connected",
    error: "bg-status-error",
};

const STATUS_LABEL: Record<ConnectionStatus, MessageKey> = {
    idle: "status.idle",
    connecting: "status.connecting",
    connected: "status.connected",
    error: "status.error",
};

function AppSidebar({
    activeTab,
    onTabChange,
    onClose,
    onMinimize,
    onMaximize,
    platform,
    status,
}: AppSidebarProps) {
    const { t, dir } = useI18n();
    const isMac = platform === "macos";

    // On the reading side: the right in a right-to-left language.
    const side = dir === "rtl" ? "right" : "left";
    return (
        <Sidebar variant="inset" side={side} className="select-none">
            <SidebarHeader
                className={cn(
                    "drag-region flex-row items-center justify-between px-4",
                    isMac ? "h-12" : "h-8"
                )}
            >
                {isMac ? (
                    <MacWindowControls
                        onClose={onClose}
                        onMinimize={onMinimize}
                        onMaximize={onMaximize}
                    />
                ) : (
                    <span className="text-xl unbounded tracking-tight">Nugget</span>
                )}
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {TABS.map((tab) => (
                                <SidebarMenuItem key={tab.id}>
                                    <SidebarMenuButton
                                        isActive={activeTab === tab.id}
                                        onClick={() => onTabChange(tab.id)}
                                    >
                                        <tab.icon size={18} aria-hidden="true" />
                                        <span>{t(tab.label)}</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="gap-2">
                {/* The tunnel state is visible from every screen, not only the
                    one screen that happens to be about connecting. */}
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <span
                        className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[status])}
                        aria-hidden="true"
                    />
                    <span className="truncate">{t(STATUS_LABEL[status])}</span>
                </div>

                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            isActive={activeTab === "settings"}
                            onClick={() => onTabChange("settings")}
                        >
                            <Settings size={18} aria-hidden="true" />
                            <span>{t("nav.settings")}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
}

export default AppSidebar;
