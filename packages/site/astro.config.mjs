import { defineConfig } from 'astro/config'

// Phase 1 is fully static (spec §4). No adapter, no server routes.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
})
