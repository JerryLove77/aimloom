import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "theme",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
  },
})
