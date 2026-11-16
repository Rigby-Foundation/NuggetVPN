import { useEffect, useRef } from "react";
import { Outlet, useLocation, useMatches, useNavigation } from "react-router";
import { useVpn } from "@/app/vpn-context";
import { AppHeader } from "@/components/Header";
import { MobileNavigation } from "@/components/MobileNavigation";
import { LockedProfiles } from "@/components/settings/profile-encryption";
import { FirstRunSetup } from "@/components/FirstRunSetup";
import { AppSidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileViewport } from "@/hooks/use-mobile-viewport";
import { useApplyTheme, usePageMotion } from "@/lib/theme";
import { useApplyFont } from "@/lib/fonts";
import { useT, type MessageKey } from "@/lib/i18n";

export function AppLayout() {
  const { plugins, profileEncryption, settings, loaded } = useVpn();
  useApplyTheme(plugins);
  useApplyFont();
  const compact = useIsMobile();
  useMobileViewport(compact);
  const [pageMotion] = usePageMotion();
  const t = useT();
  const { pathname } = useLocation();
  const matches = useMatches();
  const navigation = useNavigation();
  const main = useRef<HTMLElement>(null);
  const handle = matches.at(-1)?.handle as { title?: MessageKey } | undefined;
  const title = handle?.title && t(handle.title);
  const locked = profileEncryption?.locked;
  const setup = loaded && settings.setup_completed === false && !locked;

  useEffect(() => {
    const pageTitle = locked ? t("profileEncryption.locked") : setup ? t("setup.title") : title;
    document.title = pageTitle ? `${pageTitle} — Kage` : "Kage";
  }, [locked, setup, t, title]);

  useEffect(() => {
    main.current?.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <SidebarProvider className="app-shell min-h-0 flex-col overflow-hidden">
      <a
        href="#page-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
        className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:absolute focus:left-4 focus:top-16"
      >
        {t("ui.skipContent")}
      </a>
      <AppHeader />
      <div className="flex min-h-0 flex-1 bg-sidebar">
        {!compact && !locked && !setup && <AppSidebar />}
        <main
          id="page-content"
          ref={main}
          tabIndex={-1}
          aria-busy={navigation.state !== "idle"}
          className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none rounded-ss-3xl border-t border-s bg-background outline-none compact:rounded-none compact:border-s-0"
        >
          <div
            key={pathname}
            data-page-motion={pageMotion}
            className="h-full"
          >
            {locked ? <LockedProfiles unavailable={profileEncryption.unavailable} /> : setup ? <FirstRunSetup /> : <Outlet />}
          </div>
        </main>
      </div>
      {compact && !locked && !setup && <MobileNavigation />}
    </SidebarProvider>
  );
}
