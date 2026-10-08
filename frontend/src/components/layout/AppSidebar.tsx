import { NAV_TABS } from "@/lib/tabs";
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

interface AppSidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onClose: () => void;
    onMinimize: () => void;
    onMaximize: () => void;
    platform?: string;
}

export const TABS = NAV_TABS.filter((tab) => tab.id !== "settings");


function AppSidebar({
    activeTab,
    onTabChange,
    onClose,
    onMinimize,
    onMaximize,
    platform,
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
