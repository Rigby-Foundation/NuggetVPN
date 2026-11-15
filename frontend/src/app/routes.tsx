import { Navigate } from "react-router";
import type { RouteObject } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { PageError } from "@/components/PageError";
import { Page } from "@/components/Page";
import { defaultPage, pages } from "@/app/pages";
import NotFoundPage from "@/pages/NotFoundPage";
import { useT } from "@/lib/i18n";

function LoadingPage() {
  const t = useT();
  return <Page title={t("ui.loading")} />;
}

export const appRoutes: RouteObject[] = [
  {
    Component: AppLayout,
    HydrateFallback: LoadingPage,
    children: [
      { index: true, element: <Navigate to={defaultPage} replace /> },
      ...pages.map(
        ({ path, title, load }): RouteObject => ({
          path,
          handle: { title },
          lazy: async () => ({ Component: (await load()).default }),
          ErrorBoundary: PageError,
        }),
      ),
      { path: "*", Component: NotFoundPage, handle: { title: "ui.notFound" } },
    ],
  },
];
