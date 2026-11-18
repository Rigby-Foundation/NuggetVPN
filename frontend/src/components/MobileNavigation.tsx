import { useEffect, useState } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { matchPath, NavLink, useLocation } from "react-router";
import { pages } from "@/app/pages";
import { useT } from "@/lib/i18n";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const mobilePages = pages.filter(({ icon, sidebar }) => icon && sidebar && sidebar.mobile !== false && (sidebar.placement !== "footer" || sidebar.mobileLabel));
const primaryPages = mobilePages.filter(({ sidebar }) => sidebar?.mobile !== "more");
const morePages = mobilePages.filter(({ sidebar }) => sidebar?.mobile === "more");
const tabClassName = "group flex h-(--app-tab-height) w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-muted-foreground transition-colors aria-[current=page]:text-foreground data-active:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

export function MobileNavigation() {
  const t = useT();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = morePages.some(({ path, sidebar }) => matchPath({ path: sidebar?.to ?? path, end: sidebar?.end ?? true }, pathname));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <nav className="mobile-navigation shrink-0 border-t border-border/60 bg-sidebar" aria-label={t("nav.menu")}>
      <ul className="mx-auto flex max-w-md px-1">
        {primaryPages.map(({ path, title, icon: Icon, sidebar }) => {
          if (!Icon || !sidebar) return null;
          const label = sidebar.label ?? title;
          return (
            <li key={path} className="min-w-11 flex-1">
              <NavLink
                to={sidebar.to ?? path}
                end={sidebar.end ?? true}
                aria-label={t(label)}
                className={tabClassName}
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
        {morePages.length > 0 && (
          <li className="min-w-11 flex-1">
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger className={tabClassName} data-active={moreActive || moreOpen || undefined}>
                <span className="grid h-6 w-10 place-items-center rounded-full group-data-active:bg-primary/15 group-data-active:text-primary">
                  <Ellipsis className="size-4.5" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate text-[10px] leading-tight font-medium">{t("nav.more")}</span>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-3xl border-border bg-sidebar p-4 text-sidebar-foreground">
                <SheetHeader className="px-2 pt-1 pb-2">
                  <SheetTitle>{t("nav.more")}</SheetTitle>
                </SheetHeader>
                <nav aria-label={t("nav.more")}>
                  <ul className="flex flex-col gap-1">
                    {morePages.map(({ path, title, icon: Icon, sidebar }) => (
                      <li key={path}>
                        <NavLink
                          to={sidebar?.to ?? path}
                          end={sidebar?.end ?? true}
                          onClick={() => setMoreOpen(false)}
                          className="flex min-h-16 items-center gap-3 rounded-xl p-3 transition-colors hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sidebar-accent text-primary">
                            {Icon && <Icon className="size-5" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 flex-1 font-medium">{t(sidebar?.label ?? title)}</span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </nav>
              </SheetContent>
            </Sheet>
          </li>
        )}
      </ul>
    </nav>
  );
}
