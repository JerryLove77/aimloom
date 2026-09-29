import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: ["packages/theme", "packages/app", "packages/crosshair"],
  },
})
