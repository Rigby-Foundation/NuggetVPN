import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_CLASSES, THEME_IDS } from "@/lib/themes";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/*
      `value` maps each preset onto the classes it needs: a preset is its base
      mode plus an override class, so the override only has to restate the
      tokens it actually changes.
    */}
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={THEME_IDS}
      value={THEME_CLASSES}
    >
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
