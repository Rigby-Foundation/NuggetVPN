import { createHashRouter, RouterProvider } from "react-router";
import { appRoutes } from "@/app/routes";

import { I18nProvider } from "@/lib/i18n";
import { VpnProvider } from "@/app/VpnProvider";
import { ImportLinkDialog } from "@/components/ImportLinkDialog";
import { PluginRuntime } from "@/components/plugins/plugins-provider";
import { Toaster } from "react-hot-toast";

const router = createHashRouter(appRoutes);

export default function App() {
  return (
    <I18nProvider>
      <VpnProvider>
        <PluginRuntime>
          <RouterProvider router={router} />
          <ImportLinkDialog />
          <Toaster
            position="bottom-center"
            toastOptions={{
              style: {
                background: "var(--card)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                fontSize: "13px",
              },
            }}
          />
        </PluginRuntime>
      </VpnProvider>
    </I18nProvider>
  );
}
