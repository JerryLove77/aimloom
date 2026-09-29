import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The suites build their schema from the real migrations folder, the way `wrangler d1 migrations apply` reads it.
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './tests-worker/wrangler.test.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')) } },
  }))],
  test: { include: ['tests-worker/**/*.test.ts'], setupFiles: ['tests-worker/setup.ts'], testTimeout: 20_000 },
})
