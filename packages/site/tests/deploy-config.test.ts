import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// wrangler.jsonc is JSONC (comments allowed); this file has only full-line `//` comments, so
// stripping any line whose trimmed content starts with `//` is enough to parse it as plain JSON.
const stripJsoncComments = (text: string) => text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
const config = JSON.parse(stripJsoncComments(readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')))

describe('Worker deployment config', () => {
  it('serves production on aimloom.dev as a Cloudflare custom domain', () => {
    // Bought through Cloudflare Registrar on 2026-09-19; the workers.dev address keeps working.
    expect(config.routes).toEqual([{ pattern: 'aimloom.dev', custom_domain: true }])
  })
  it('keeps the workers.dev address alive: links handed out before the domain existed still work', () => {
    // With a route present, wrangler turns workers.dev off unless it is set explicitly.
    expect(config.workers_dev).toBe(true)
  })
  it('never lets an environment claim the production domain, and gives each its own storage', () => {
    // wrangler INHERITS `routes` but NOT bindings. A preview without `"routes": []` took aimloom.dev on
    // 2026-09-20; a preview without its own bindings would have none, or worse, production's by copy-paste.
    const envs = Object.entries(config.env as Record<string, Record<string, unknown>>)
    expect(envs.map(([name]) => name)).toContain('preview')
    for (const [name, env] of envs) {
      expect(env.routes, `env.${name}.routes`).toEqual([])
      const d1 = (env.d1_databases as { database_name: string }[])[0]
      expect(d1?.database_name, name).toBe(`aimloom-${name}`)
      expect(env.r2_buckets, name).toBeUndefined() // R2 is not enabled on the account: bodies live in D1
      expect(env.send_email, name).toEqual([{ name: 'MAIL' }])
      expect((env.ratelimits as { name: string }[]).map(r => r.name).sort(), name).toEqual(['REPORT_LIMIT', 'STEAM_LIMIT'])
    }
  })
  it('runs the script first for /api/*, the explorer and /d/* only: every other page and release file stays a static asset', () => {
    expect(config.main).toBe('src/worker/index.ts')
    expect(config.assets.binding).toBe('ASSETS')
    expect(config.assets.run_worker_first).toEqual(['/api/*', '/zh/explore*', '/en/explore*', '/d/*'])
  })
  it('points both environments at the explorer\'s file origin; vars are not inherited, so preview repeats it', () => {
    expect(config.vars).toEqual({ FILES_ORIGIN: 'https://dl.aimloom.dev' })
    expect(config.env.preview.vars).toEqual({ FILES_ORIGIN: 'https://dl.aimloom.dev' })
  })
  it('binds production to its own database, to no bucket, and limits as the spec says', () => {
    expect(config.d1_databases[0]).toMatchObject({ binding: 'DB', database_name: 'aimloom', migrations_dir: 'migrations' })
    expect(config.r2_buckets).toBeUndefined()
    expect(config.ratelimits).toEqual([
      { name: 'REPORT_LIMIT', namespace_id: '2001', simple: { limit: 3, period: 60 } },
      { name: 'STEAM_LIMIT', namespace_id: '2002', simple: { limit: 10, period: 60 } },
    ])
  })
  it('deletes expired reports once a day, everywhere, so the Privacy page\'s promise holds with no traffic', () => {
    // `triggers` (like `observability`) is INHERITED by every environment, unlike bindings — confirmed
    // against wrangler 4.134.0's own field table (`wrangler-dist/cli.js`: `triggers: inheritable(...)`)
    // — so it is set only at the top level, and every `env.*` gets it without repeating it.
    expect(config.triggers).toEqual({ crons: ['17 4 * * *'] })
    for (const [name, env] of Object.entries(config.env as Record<string, Record<string, unknown>>)) expect(env.triggers, name).toBeUndefined()
  })
  it('turns off Workers Logs: the Privacy page says no IP address is stored', () => {
    expect(config.observability).toEqual({ enabled: false })
    for (const [name, env] of Object.entries(config.env as Record<string, Record<string, unknown>>)) expect(env.observability, name).toEqual({ enabled: false })
  })
  it('keeps the owner\'s mailbox out of git: it is a secret, never a var or a binding field', () => {
    const text = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')
    expect(text).not.toMatch(/@(?!kvk)[\w.-]+\.(com|net|org|cn)/)
    expect(text).not.toContain('REPORT_TO')
  })
})
