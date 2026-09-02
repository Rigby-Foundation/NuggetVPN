import { FileText, Power, Server, Settings, Signal } from "lucide-react";

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
    { id: "connection", label: "Connection", icon: Power },
    { id: "configuration", label: "Configuration", icon: Server },
    { id: "proxies", label: "Proxies", icon: Signal },
    { id: "logs", label: "Logs", icon: FileText },
] as const;

const STATUS_DOT: Record<ConnectionStatus, string> = {
    idle: "bg-status-idle",
    connecting: "bg-status-connecting animate-pulse",
    connected: "bg-status-connected",
    error: "bg-status-error",
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
    idle: "Not connected",
    connecting: "Connecting",
    connected: "Connected",
    error: "Connection failed",
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
    const isMac = platform === "macos";

    return (
        <Sidebar variant="inset" className="select-none">
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
                                        <span>{tab.label}</span>
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
                    <span className="truncate">{STATUS_LABEL[status]}</span>
                </div>

                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            isActive={activeTab === "settings"}
                            onClick={() => onTabChange("settings")}
                        >
                            <Settings size={18} aria-hidden="true" />
                            <span>Settings</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
}

export default AppSidebar;
