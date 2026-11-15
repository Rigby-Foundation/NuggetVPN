import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite'

const frontendDir = fileURLToPath(new URL(".", import.meta.url));

function sourceRevision(): string {
  const ciRevision = process.env.GITHUB_SHA;
  if (ciRevision && /^[a-f\d]{40}$/i.test(ciRevision)) return ciRevision.slice(0, 8);
  try {
    return execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
      cwd: frontendDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Source archives may not have Git metadata.
    return "";
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __KAGE_REVISION__: JSON.stringify(sourceRevision()) },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
