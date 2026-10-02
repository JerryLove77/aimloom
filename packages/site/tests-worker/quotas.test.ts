/** Quotas must hold across concurrent requests, including the incoming UTF-8 body. */
import { describe, expect, it } from 'vitest'
import { db } from './seed'
import fixture from './fixtures/report.valid.json'
import { handleReport } from '../src/worker/reports'
import { handleTickets } from '../src/worker/tickets'
import type { AppEnv } from '../src/worker/env'

const now = () => new Date('2026-10-01T12:00:00.000Z')
const app = { DB: db, TURNSTILE_SITE_KEY: 'test-key', TURNSTILE_SECRET: 'test-secret' } as AppEnv
const ticket = { kind: 'idea', description: 'Synthetic feedback', contact: null, lang: 'en', page: '/en/', token: 'test-token' }
const post = (route: string, body: unknown) => new Request(`https://aimloom.dev/api/${route}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Aimloom/0.1.3', origin: 'https://aimloom.dev' }, body: JSON.stringify(body),
})
const fetcher = (async () => Response.json({ success: true })) as typeof fetch
const random = (i: number) => () => new Uint8Array([i, 2, 3, 4])
const seedReport = (id: string, day: string, bytes = 1) => db.prepare("INSERT INTO reports (number, created_at, day, app_label, lang, windows, has_log, has_contact, bytes, body) VALUES (?, ?, ?, '0.1.3', 'en', 'w', 0, 0, ?, '{}')").bind(id, `${day}T01:00:00.000Z`, day, bytes)
const total = (table: 'reports' | 'tickets') => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM ${table}`).first<{ n: number; bytes: number }>()
const ctx = { waitUntil() {} }
const sendReport = (i = 1) => handleReport(post('reports', fixture), app, ctx, { now, random: random(i) })

describe('atomic quotas', () => {
  it.each(['reports', 'tickets'] as const)('only stores and notifies one concurrent %s request for the last slot', async route => {
    const ceiling = route === 'reports' ? 300 : 100
    await db.batch(Array.from({ length: ceiling - 1 }, (_, i) => route === 'reports'
      ? seedReport(`AL-261001-T${i}`, '2026-10-01')
      : db.prepare("INSERT INTO tickets (number, created_at, day, kind, lang, has_contact, bytes, body) VALUES (?, '2026-10-01T01:00:00.000Z', '2026-10-01', 'idea', 'en', 0, 1, '{}')").bind(`AL-261001-T${i}`)))
    const notified: string[] = []; const pending: Promise<unknown>[] = []
    const context = { waitUntil: (p: Promise<unknown>) => { pending.push(p) } }
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => {
      const deps = { now, random: random(i), fetcher, afterStore: async (number: string) => { notified.push(number) } }
      return route === 'reports' ? handleReport(post(route, fixture), app, context, deps) : handleTickets(post(route, ticket), app, context, deps)
    }))
    await Promise.all(pending)
    expect(responses.filter(r => r!.status === 200)).toHaveLength(1)
    expect(responses.filter(r => r!.status === 429)).toHaveLength(7)
    for (const r of responses.filter(r => r!.status !== 200)) expect(await r!.json()).toEqual({ code: 'DAILY_LIMIT' })
    expect((await total(route))!.n).toBe(ceiling)
    expect(notified).toHaveLength(1)
  })

  it.each([
    ['daily', '2026-10-01', 64 * 1024 * 1024, 429, 'DAILY_LIMIT'],
    ['archive', '2026-09-30', 400 * 1024 * 1024, 507, 'STORAGE_FULL'],
  ] as const)('enforces the exact %s byte boundary, including the incoming body', async (_name, day, ceiling, status, code) => {
    expect((await sendReport()).status).toBe(200)
    const bodyBytes = (await total('reports'))!.bytes
    await db.prepare('DELETE FROM reports').run()
    await seedReport('AL-261001-TST1', day, ceiling - bodyBytes + 1).run()
    const refused = await sendReport()
    expect(refused.status).toBe(status); expect(await refused.json()).toEqual({ code })
    expect((await total('reports'))!.n).toBe(1)
    await db.prepare('UPDATE reports SET bytes = bytes - 1').run()
    expect((await sendReport()).status).toBe(200)
    expect((await total('reports'))!.bytes).toBe(ceiling)
  })

  it.each([
    ['daily', '2026-10-01', 64 * 1024 * 1024, 429],
    ['archive', '2026-09-30', 400 * 1024 * 1024, 507],
  ] as const)('protects the last %s bytes when requests race', async (_name, day, ceiling, status) => {
    expect((await sendReport()).status).toBe(200)
    const bodyBytes = (await total('reports'))!.bytes
    await db.prepare('DELETE FROM reports').run()
    await seedReport('AL-261001-TST1', day, ceiling - bodyBytes).run()
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => sendReport(i)))
    expect(responses.filter(r => r.status === 200)).toHaveLength(1)
    expect(responses.filter(r => r.status === status)).toHaveLength(7)
    expect((await total('reports'))!.bytes).toBe(ceiling)
  })

  it.each(['reports', 'tickets'] as const)('retries only number collisions and stops after five for %s', async route => {
    let draws = 0
    const send = () => {
      const deps = { now, fetcher, random: () => { draws++; return new Uint8Array([1, 2, 3, 4]) } }
      return route === 'reports' ? handleReport(post(route, fixture), app, ctx, deps) : handleTickets(post(route, ticket), app, ctx, deps)
    }
    expect((await send())!.status).toBe(200)
    draws = 0
    const refused = (await send())!
    expect(refused.status).toBe(500); expect(await refused.json()).toEqual({ code: 'STORAGE_FAILED' })
    expect(draws).toBe(5); expect((await total(route))!.n).toBe(1)
    let retries = 0
    const deps = { now, fetcher, random: () => new Uint8Array([++retries, 2, 3, 4]) }
    const success = route === 'reports' ? await handleReport(post(route, fixture), app, ctx, deps) : await handleTickets(post(route, ticket), app, ctx, deps)
    expect(success!.status).toBe(200); expect((await total(route))!.n).toBe(2); expect(retries).toBe(2)
  })
  it.each(['reports', 'tickets'] as const)('does not retry or notify a %s database failure', async route => {
    await db.prepare(`CREATE TRIGGER refuse_insert BEFORE INSERT ON ${route} BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END`).run()
    let draws = 0; let notifications = 0
    const deps = { now, fetcher, random: () => { draws++; return new Uint8Array([1, 2, 3, 4]) }, afterStore: async () => { notifications++ } }
    const r = (route === 'reports' ? await handleReport(post(route, fixture), app, ctx, deps) : await handleTickets(post(route, ticket), app, ctx, deps))!
    expect(r.status).toBe(500); expect(await r.json()).toEqual({ code: 'STORAGE_FAILED' })
    expect(draws).toBe(1); expect(notifications).toBe(0); expect((await total(route))!.n).toBe(0)
  })
})
