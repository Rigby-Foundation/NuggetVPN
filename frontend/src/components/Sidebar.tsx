import { matchPath, NavLink, useLocation } from "react-router";
import { pages } from "@/app/pages";
import type { AppPage } from "@/app/pages";
import { useT } from "@/lib/i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

function SidebarPages({ placement }: { placement: "main" | "footer" }) {
  const t = useT();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const groups = new Map<string, AppPage[]>();

  for (const page of pages) {
    if (!page.sidebar || (page.sidebar.placement ?? "main") !== placement)
      continue;
    const group = page.sidebar.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(page);
  }

  return Array.from(groups, ([group, items]) => (
    <SidebarGroup key={group}>
      {group && <SidebarGroupLabel>{group}</SidebarGroupLabel>}
      <SidebarMenu className="flex flex-col gap-1">
        {items.map(({ path, title, icon: Icon, sidebar }) => {
          const to = sidebar?.to ?? path;
          const end = sidebar?.end ?? true;
          const label = t(sidebar?.label ?? title);
          return (
            <SidebarMenuItem key={path}>
              <SidebarMenuButton
                render={<NavLink to={to} end={end} />}
                isActive={Boolean(matchPath({ path: to, end }, pathname))}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    setOpenMobile(false);
                  }
                }}
              >
                {Icon && <Icon />}
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  ));
}

export function AppSidebar() {
  const t = useT();
  return (
    <Sidebar className="top-14 h-[calc(100svh-3.5rem)] border-r-0!">
      <SidebarContent>
        <nav aria-label={t("nav.menu")}>
          <SidebarPages placement="main" />
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <nav aria-label={t("ui.footerNav")}>
          <SidebarPages placement="footer" />
        </nav>
      </SidebarFooter>
    </Sidebar>
  );
}
