import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    // Keep Go build errors visible alongside the frontend output.
    clearScreen: false,
    build: {
        // `wails dev` and `wails build` both read the app from frontend/dist.
        outDir: "dist",
        emptyOutDir: true,
    },
    server: {
        port: 1420,
        strictPort: true,
    },
});
