import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppearanceProvider, bootAppearance } from "@/components/appearance-provider";
import "./App.css";

bootAppearance();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <App />
    </AppearanceProvider>
  </React.StrictMode>
);
