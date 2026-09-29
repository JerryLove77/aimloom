import { defineConfig } from "vitest/config"

// packages/site is not a project here: its Worker suite needs @cloudflare/vitest-plugin, which
// needs vitest 4, while these three stay on the pinned 3.2.7 chain. Run it with `npm run test:site`.
export default defineConfig({
  test: {
    projects: ["packages/theme", "packages/app", "packages/crosshair"],
  },
})
