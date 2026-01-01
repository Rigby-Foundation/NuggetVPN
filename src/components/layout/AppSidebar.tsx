import { Clock, Power, Server, Settings } from "lucide-react";

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

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  status: string;
  isConnected: boolean;
  onClose: () => void;
  onMinimize: () => void;
}

function AppSidebar({
  activeTab,
  onTabChange,
  status,
  isConnected,
  onClose,
  onMinimize,
}: AppSidebarProps) {
  return (
    <Sidebar variant="inset" className="select-none">
      <SidebarHeader
        className="h-16 flex-row items-center justify-between px-4"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <div className="unbounded text-xl pointer-events-none">
            Nugget
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="w-3 h-3 rounded-full bg-[#FF5F57] hover:bg-[#FF5F57]/80 transition-colors"
            aria-label="Close"
          />
          <button
            onClick={onMinimize}
            className="w-3 h-3 rounded-full bg-[#FEBC2E] hover:bg-[#FEBC2E]/80 transition-colors"
            aria-label="Minimize"
          />
          <button
            className="w-3 h-3 rounded-full bg-[#28C840] hover:bg-[#28C840]/80 transition-colors"
            aria-label="Maximize"
          />
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
        <div className="p-2 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500 animate-pulse" : "bg-muted-foreground"
              }`}
            />
            <div className="text-xs font-medium text-muted-foreground">
              {status}
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export default AppSidebar;
