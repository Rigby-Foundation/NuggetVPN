import { NavLink } from "react-router";
import { pages } from "@/app/pages";
import { useT } from "@/lib/i18n";

export function MobileNavigation() {
  const t = useT();

  return (
    <nav className="mobile-navigation shrink-0 border-t border-border/60 bg-sidebar" aria-label={t("nav.menu")}>
      <ul className="mx-auto flex max-w-md gap-1 px-1">
        {pages.map(({ path, title, icon: Icon, sidebar }) => {
          if (!Icon || !sidebar || sidebar.placement === "footer") return null;
          const label = sidebar.label ?? title;
          return (
            <li key={path} className="min-w-0 flex-1">
              <NavLink
                to={sidebar.to ?? path}
                end={sidebar.end ?? true}
                aria-label={t(label)}
                className="group flex h-(--app-tab-height) min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-muted-foreground transition-colors aria-[current=page]:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="grid h-6 w-10 place-items-center rounded-full group-aria-[current=page]:bg-primary/15 group-aria-[current=page]:text-primary">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate text-[10px] leading-tight font-medium">
                  {t(sidebar.mobileLabel ?? label)}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
