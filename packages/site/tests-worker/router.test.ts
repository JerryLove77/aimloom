import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from '../src/worker/index'
import type { AppEnv } from '../src/worker/env'

const base = testEnv as unknown as Pick<AppEnv, 'DB'>
const env = { ...base, ASSETS: { fetch: async () => new Response('the 404 page', { status: 404 }) } } as unknown as AppEnv
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

describe('the router', () => {
  it('answers an unknown /api path with a code, as JSON, uncached', async () => {
    const r = await worker.fetch(new Request('https://aimloom.dev/api/nope'), env, ctx)
    expect(r.status).toBe(404); expect(await r.json()).toEqual({ code: 'NOT_FOUND' }); expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('hands everything outside /api/ to the static assets', async () => {
    const r = await worker.fetch(new Request('https://aimloom.dev/zh/nope/'), env, ctx)
    expect(await r.text()).toBe('the 404 page')
  })
})

describe('the scheduled handler (the daily Cron Trigger)', () => {
  it('deletes expired rows through the same deleteExpired the request path uses', async () => {
    await base.DB.prepare("INSERT INTO reports (number, created_at, day, app_label, lang, windows, has_log, has_contact, bytes, body) VALUES ('AL-260301-EXP0', '2026-03-01T00:00:00.000Z', '2026-03-01', '0.1.3', 'zh', 'w', 0, 0, 1, '{}')").run()
    const pending: Promise<unknown>[] = []
    const cronCtx = { waitUntil: (p: Promise<unknown>) => { pending.push(p) }, passThroughOnException() {} } as unknown as ExecutionContext
    const controller = { cron: '17 4 * * *', scheduledTime: new Date('2026-09-21T04:17:00Z').getTime(), noRetry() {} } as unknown as ScheduledController
    // @ts-expect-error — scheduled is optional on ExportedHandler's type but always present on this worker
    await worker.scheduled(controller, env, cronCtx)
    await Promise.all(pending)
    expect(await base.DB.prepare("SELECT COUNT(*) AS c FROM reports WHERE number = 'AL-260301-EXP0'").first('c')).toBe(0)
  })
})
