import { Clock, Globe, Power, Server, Settings } from "lucide-react";

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

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  platform?: string;
}

function AppSidebar({
  activeTab,
  onTabChange,
  onClose,
  onMinimize,
  onMaximize,
  platform,
}: AppSidebarProps) {
  return (
    <Sidebar variant="inset" className="select-none">
      <SidebarHeader
        className={cn(
          "flex-row items-center justify-between px-4",
          platform === "macos" ? "h-12" : "h-8"
        )}
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          {platform === "macos" ? (
            <MacWindowControls
              onClose={onClose}
              onMinimize={onMinimize}
              onMaximize={onMaximize}
            />
          ) : (
            <div className="flex items-center h-full">
              <span className="text-xl unbounded tracking-tight">Nugget</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "connection"}
                  onClick={() => onTabChange("connection")}
                >
                  <Power size={18} />
                  <span>Connection</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "configuration"}
                  onClick={() => onTabChange("configuration")}
                >
                  <Server size={18} />
                  <span>Configuration</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "proxies"}
                  onClick={() => onTabChange("proxies")}
                >
                  <Globe size={18} />
                  <span>Proxies</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "logs"}
                  onClick={() => onTabChange("logs")}
                >
                  <Clock size={18} />
                  <span>Logs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeTab === "settings"}
              onClick={() => onTabChange("settings")}
            >
              <Settings size={18} />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export default AppSidebar;
