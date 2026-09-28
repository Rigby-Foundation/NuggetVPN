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
        // Bind IPv4 explicitly. Vite defaults to the hostname "localhost",
        // which on Windows resolves to ::1 first, so the dev server ends up
        // listening on IPv6 only — and the Wails dev proxy, which dials
        // 127.0.0.1, gets a refused connection and serves HTTP 502 instead of
        // the app.
        host: "127.0.0.1",
        port: 1420,
        strictPort: true,
    },
});
