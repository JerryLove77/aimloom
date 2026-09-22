import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import fixture from './fixtures/report.valid.json'
import { deleteExpired, handleReport } from '../src/worker/reports'
import type { AppEnv } from '../src/worker/env'

const base = testEnv as unknown as Pick<AppEnv, 'DB'>
const allow = { limit: async () => ({ success: true }) }
const env = (over: Partial<AppEnv> = {}): AppEnv => ({ ...base, ASSETS: { fetch: async () => new Response('') }, MAIL: { send: async () => ({ messageId: 'm' }) }, REPORT_LIMIT: allow, STEAM_LIMIT: allow, REPORT_TO: 'owner@test.invalid', ...over })
const ctx = { waitUntil() {} }
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://aimloom.dev/api/reports', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', 'user-agent': 'Aimloom/0.1.3', 'cf-connecting-ip': '203.0.113.9', ...headers } })
const at = (iso: string) => ({ now: () => new Date(iso), random: () => new Uint8Array([1, 2, 3, 4]) })
const seed = (number: string, createdAt: string, bytes = 1) => base.DB.prepare("INSERT INTO reports (number, created_at, day, app_label, lang, windows, has_log, has_contact, bytes, body) VALUES (?, ?, ?, '0.1.3', 'zh', 'w', 0, 0, ?, '{}')").bind(number, createdAt, createdAt.slice(0, 10), bytes)

describe('POST /api/reports', () => {
  it('stores the whole report in the row and answers with the number', async () => {
    const r = await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ number: 'AL-260921-1234' })
    const row = await base.DB.prepare('SELECT * FROM reports').first<Record<string, unknown>>()
    expect(JSON.parse(row!.body as string)).toEqual({ ...fixture, number: 'AL-260921-1234', receivedAt: '2026-09-21T10:00:00.000Z' })
    expect(row).toMatchObject({ number: 'AL-260921-1234', day: '2026-09-21', app_label: '0.1.3', lang: 'zh', windows: '10.0.22631', has_log: 1, has_contact: 1, steam_id: '76561198000000042', mail: 'pending' })
    expect(row!.bytes).toBe(new TextEncoder().encode(row!.body as string).length)
  })
  it('keeps free text out of every column but the body, and the client address out of everything', async () => {
    await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))
    const row = (await base.DB.prepare('SELECT * FROM reports').first<Record<string, unknown>>())!
    const { body: _body, ...index } = row
    for (const text of ['someone@example.com', '应用背景时报错', 'worker session']) expect(JSON.stringify(index)).not.toContain(text)
    expect(JSON.stringify(row)).not.toContain('203.0.113.9')
  })
  it('retries with a new number when the number is taken', async () => {
    const seq = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])]
    const deps = { now: () => new Date('2026-09-21T10:00:00Z'), random: () => seq.shift()! }
    expect(await (await handleReport(post(fixture), env(), ctx, deps)).json()).toEqual({ number: 'AL-260921-1234' })
    expect(await (await handleReport(post(fixture), env(), ctx, deps)).json()).toEqual({ number: 'AL-260921-5678' })
    expect(JSON.parse((await base.DB.prepare("SELECT body FROM reports WHERE number = 'AL-260921-5678'").first<string>('body'))!).number).toBe('AL-260921-5678')
  })
  it('refuses the wrong method, type, client, size and JSON, each with its own code', async () => {
    const code = async (r: Promise<Response>) => { const x = await r; return [x.status, ((await x.json()) as { code: string }).code] }
    expect(await code(handleReport(new Request('https://aimloom.dev/api/reports'), env(), ctx))).toEqual([405, 'METHOD_NOT_ALLOWED'])
    expect(await code(handleReport(post(fixture, { 'content-type': 'text/plain' }), env(), ctx))).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE'])
    expect(await code(handleReport(post(fixture, { 'user-agent': 'curl/8' }), env(), ctx))).toEqual([400, 'UNKNOWN_CLIENT'])
    expect(await code(handleReport(post('x'.repeat(1024 * 1024 + 1)), env(), ctx))).toEqual([413, 'TOO_LARGE'])
    expect(await code(handleReport(post('{not json'), env(), ctx))).toEqual([400, 'INVALID_JSON'])
  })
  it('names the offending field of an invalid report, capped to 64 characters: an attacker controls the key name', async () => {
    const r = await handleReport(post({ ...fixture, extra: 1 }), env(), ctx)
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ code: 'INVALID_REPORT', field: 'extra' })
    const long = 'x'.repeat(200)
    const r2 = await handleReport(post({ ...fixture, [long]: 1 }), env(), ctx)
    expect(((await r2.json()) as { field: string }).field).toHaveLength(64)
  })
  it('stops at 300 reports a UTC day', async () => {
    await base.DB.batch(Array.from({ length: 300 }, (_, i) => seed(`AL-260921-T${String(i).padStart(3, '0')}`, '2026-09-21T01:00:00.000Z')))
    const r = await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))
    expect(r.status).toBe(429); expect(await r.json()).toEqual({ code: 'DAILY_LIMIT' })
    expect((await handleReport(post(fixture), env(), ctx, at('2026-09-22T00:00:01Z'))).status).toBe(200)
  })
  it('stops at 64 MiB in one UTC day, well under the 300-report count ceiling: the two ceilings are in different units', async () => {
    // 30 rows of ~2.2 MiB each: 30 reports, nowhere near DAILY_CEILING, but their bytes sum past 64 MiB.
    const rowBytes = Math.ceil((64 * 1024 * 1024) / 29)
    await base.DB.batch(Array.from({ length: 30 }, (_, i) => seed(`AL-260921-B${String(i).padStart(3, '0')}`, '2026-09-21T01:00:00.000Z', rowBytes)))
    const r = await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))
    expect(r.status).toBe(429); expect(await r.json()).toEqual({ code: 'DAILY_LIMIT' })
    // A new UTC day resets the daily byte total, same as the daily count.
    expect((await handleReport(post(fixture), env(), ctx, at('2026-09-22T00:00:01Z'))).status).toBe(200)
  })
  it('does not let the daily byte ceiling see yesterday\'s bytes: only "day = ?" counts', async () => {
    await seed('AL-260920-BIG1', '2026-09-20T01:00:00.000Z', 100 * 1024 * 1024).run()
    expect((await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))).status).toBe(200)
  })
  it('stops when the archive holds 400 MiB: the free database is 500 MB and nobody may fill it', async () => {
    await seed('AL-260920-BIG0', '2026-09-20T01:00:00.000Z', 400 * 1024 * 1024).run()
    const r = await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))
    expect(r.status).toBe(507); expect(await r.json()).toEqual({ code: 'STORAGE_FULL' })
  })
  it('deletes reports older than 180 days BEFORE it counts, so an old full archive frees itself', async () => {
    await seed('AL-260301-OLD0', '2026-03-01T00:00:00.000Z', 400 * 1024 * 1024).run()
    expect((await handleReport(post(fixture), env(), ctx, at('2026-09-21T10:00:00Z'))).status).toBe(200)
    expect(await base.DB.prepare("SELECT COUNT(*) AS c FROM reports WHERE number = 'AL-260301-OLD0'").first('c')).toBe(0)
  })
  it('rejects a body whose declared content-length already exceeds the cap, before any ceiling or database work', async () => {
    // A lying content-length is refused by content-length alone (the cap on the read itself, tested
    // above via the 1 MiB+1 body, is what protects against a lying or absent header).
    const request = post(fixture, { 'content-length': String(2 * 1024 * 1024) })
    const r = await handleReport(request, env(), ctx)
    expect(r.status).toBe(413); expect(await r.json()).toEqual({ code: 'TOO_LARGE' })
  })
  it('answers INVALID_JSON, not a bare rejection, when the body read itself fails', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(8)); throw new Error('connection reset') } })
    const request = new Request('https://aimloom.dev/api/reports', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'user-agent': 'Aimloom/0.1.3' },
      // @ts-expect-error — see above
      duplex: 'half',
    })
    const r = await handleReport(request, env(), ctx)
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ code: 'INVALID_JSON' })
  })
  it('says STORAGE_FAILED when the database cannot write', async () => {
    const broken = { ...base.DB, prepare: (sql: string) => sql.startsWith('INSERT') ? { bind: () => ({ run: async () => { throw new Error('d1 down') } }) } : base.DB.prepare(sql) } as unknown as AppEnv['DB']
    const r = await handleReport(post(fixture), env({ DB: broken }), ctx, at('2026-09-21T10:00:00Z'))
    expect(r.status).toBe(500); expect(await r.json()).toEqual({ code: 'STORAGE_FAILED' })
  })
  it('hands the stored report to afterStore, and survives its failure', async () => {
    const pending: Promise<unknown>[] = []; const seen: string[] = []
    const r = await handleReport(post(fixture), env(), { waitUntil: p => { pending.push(p) } }, { ...at('2026-09-21T10:00:00Z'), afterStore: async n => { seen.push(n); throw new Error('mail down') } })
    await Promise.all(pending)
    expect(r.status).toBe(200); expect(seen).toEqual(['AL-260921-1234'])
  })
})

describe('deleteExpired', () => {
  it('removes only rows older than 180 days and returns how many', async () => {
    await base.DB.batch([
      seed('AL-260301-OLD0', '2026-03-01T00:00:00.000Z'), // 204 days before the `now` below: expired
      seed('AL-260601-OLD1', '2026-06-01T00:00:00.000Z'), // 112 days before: not expired
      seed('AL-260921-CUR0', '2026-09-21T00:00:00.000Z'), // today: not expired
    ])
    const removed = await deleteExpired(base as unknown as AppEnv, new Date('2026-09-21T10:00:00Z'))
    expect(removed).toBe(1)
    const left = await base.DB.prepare('SELECT number FROM reports ORDER BY number').all<{ number: string }>()
    expect(left.results.map(r => r.number)).toEqual(['AL-260601-OLD1', 'AL-260921-CUR0'])
  })
  it('returns 0 when nothing is old enough to expire', async () => {
    await seed('AL-260921-CUR1', '2026-09-21T00:00:00.000Z').run()
    expect(await deleteExpired(base as unknown as AppEnv, new Date('2026-09-21T10:00:00Z'))).toBe(0)
  })
})
