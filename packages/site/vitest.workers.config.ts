import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './tests-worker/wrangler.test.jsonc' } })],
  test: { include: ['tests-worker/**/*.test.ts'], setupFiles: ['tests-worker/setup.ts'], testTimeout: 20_000 },
})
