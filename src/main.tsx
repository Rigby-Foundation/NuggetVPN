import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "@/components/theme-provider";
import "./App.css";
//@ts-expect-error
import { ViewTransition } from "react";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ViewTransition>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <App />
      </ThemeProvider>
    </ViewTransition>
  </React.StrictMode>
);
