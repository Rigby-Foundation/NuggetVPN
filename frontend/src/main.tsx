import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppearanceProvider, bootAppearance } from "@/components/appearance-provider";
import { invoke } from "@/lib/backend";
import { blockBrowserMenu } from "@/lib/context-menu";
import { bootLanguage, I18nProvider, Language } from "@/lib/i18n";
import "./App.css";

bootLanguage();
bootAppearance();
blockBrowserMenu();

// The tray menu is Go's; it follows the UI's language through this call.
const tellTray = (language: Language) => {
  void invoke("set_ui_language", { language }).catch(() => undefined);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider onLanguage={tellTray}>
      <AppearanceProvider>
        <App />
      </AppearanceProvider>
    </I18nProvider>
  </React.StrictMode>
);
