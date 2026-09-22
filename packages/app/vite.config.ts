import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

const appVersion = JSON.parse(readFileSync(fileURLToPath(new URL("./src-tauri/tauri.installer.conf.json", import.meta.url)), "utf8")).version as string

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  publicDir: false,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    outDir: "dist-installer",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./installer.html", import.meta.url)),
    },
  },
  test: {
    name: "installer",
    environment: "jsdom",
    include: ["tests/installer/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
})
