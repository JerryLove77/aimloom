import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from '../src/worker/index'
import { buildTicketMail, deleteExpiredTickets, handleTickets, notifyTicket, parseTicket, type Ticket } from '../src/worker/tickets'
import type { AppEnv, MailMessage } from '../src/worker/env'

const base = testEnv as unknown as Pick<AppEnv, 'DB'>
const allow = { limit: async () => ({ success: true }) }
const env = (over: Partial<AppEnv> = {}): AppEnv => ({ ...base, ASSETS: { fetch: async () => new Response('') }, MAIL: { send: async () => ({ messageId: 'm' }) },
  REPORT_LIMIT: allow, STEAM_LIMIT: allow, TICKET_LIMIT: allow, REPORT_TO: 'owner@test.invalid', TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET: 'secret', ...over } as unknown as AppEnv)
const ctx = { waitUntil() {} }
const valid = { kind: 'problem', description: '应用背景后游戏里没变', contact: 'player@example.com', lang: 'zh', page: '/zh/guide', token: 'tok' }
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://aimloom.dev/api/tickets', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: 'https://aimloom.dev', 'cf-connecting-ip': '203.0.113.9', ...headers } })
/** Stands in for Turnstile's siteverify: passes the token 'tok' only, and records what was sent. */
const turnstile = () => {
  const sent: string[] = []
  const fetcher = (async (_url: string, init: { body: URLSearchParams }) => { sent.push(init.body.toString()); return Response.json({ success: init.body.get('response') === 'tok' }) }) as unknown as typeof fetch
  return { fetcher, sent }
}
const deps = (over = {}) => ({ now: () => new Date('2026-09-24T10:00:00Z'), random: () => new Uint8Array([1, 2, 3, 4]), fetcher: turnstile().fetcher, ...over })
const code = async (r: Promise<Response | null>) => { const x = (await r)!; return [x.status, ((await x.json()) as { code: string }).code] }

describe('GET /api/tickets/key', () => {
  it('gives the Turnstile site key, or null while either key is missing (the panel then stays closed)', async () => {
    const get = new Request('https://aimloom.dev/api/tickets/key')
    expect(await (await handleTickets(get, env(), ctx))!.json()).toEqual({ siteKey: 'site-key' })
    expect(await (await handleTickets(get, env({ TURNSTILE_SECRET: undefined }), ctx))!.json()).toEqual({ siteKey: null })
    expect(await (await handleTickets(get, env({ TURNSTILE_SITE_KEY: undefined }), ctx))!.json()).toEqual({ siteKey: null })
  })
})

describe('POST /api/tickets', () => {
  it('stores what the player typed, without the token or the address, and answers with a number', async () => {
    const t = turnstile()
    const r = (await handleTickets(post(valid), env(), ctx, deps({ fetcher: t.fetcher })))!
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ number: 'AL-260924-1234' })
    const row = (await base.DB.prepare('SELECT * FROM tickets').first<Record<string, unknown>>())!
    expect(row).toMatchObject({ number: 'AL-260924-1234', day: '2026-09-24', kind: 'problem', lang: 'zh', has_contact: 1, mail: 'pending' })
    const { token: _token, ...kept } = valid
    expect(JSON.parse(row.body as string)).toEqual({ ...kept, number: 'AL-260924-1234', receivedAt: '2026-09-24T10:00:00.000Z' })
    expect(JSON.stringify(row)).not.toContain('203.0.113.9'); expect(JSON.stringify(row)).not.toContain('"tok"')
    // Only the widget's token goes to Cloudflare, never the address.
    expect(t.sent).toEqual([new URLSearchParams({ secret: 'secret', response: 'tok' }).toString()])
  })
  it('refuses a request from another origin, and every request while the panel is closed', async () => {
    expect(await code(handleTickets(post(valid, { origin: 'https://evil.example' }), env(), ctx, deps()))).toEqual([403, 'FORBIDDEN'])
    expect(await code(handleTickets(post(valid, { origin: '' }), env(), ctx, deps()))).toEqual([403, 'FORBIDDEN'])
    expect(await code(handleTickets(post(valid), env({ TURNSTILE_SECRET: undefined }), ctx, deps()))).toEqual([503, 'TICKETS_CLOSED'])
  })
  it('refuses a failed human check and stores nothing', async () => {
    expect(await code(handleTickets(post({ ...valid, token: 'forged' }), env(), ctx, deps()))).toEqual([403, 'HUMAN_CHECK_FAILED'])
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM tickets').first('c')).toBe(0)
  })
  it('refuses the wrong method, type, size and JSON, each with its own code', async () => {
    expect(await code(handleTickets(new Request('https://aimloom.dev/api/tickets'), env(), ctx))).toEqual([405, 'METHOD_NOT_ALLOWED'])
    expect(await code(handleTickets(post(valid, { 'content-type': 'text/plain' }), env(), ctx, deps()))).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE'])
    expect(await code(handleTickets(post('x'.repeat(16 * 1024 + 1)), env(), ctx, deps()))).toEqual([413, 'TOO_LARGE'])
    expect(await code(handleTickets(post('{nope'), env(), ctx, deps()))).toEqual([400, 'INVALID_JSON'])
  })
  it('stops at 100 tickets a UTC day', async () => {
    await base.DB.batch(Array.from({ length: 100 }, (_, i) => base.DB.prepare("INSERT INTO tickets (number, created_at, day, kind, lang, has_contact, bytes, body) VALUES (?, '2026-09-24T01:00:00.000Z', '2026-09-24', 'idea', 'en', 0, 1, '{}')").bind(`AL-260924-T${String(i).padStart(3, '0')}`)))
    expect(await code(handleTickets(post(valid), env(), ctx, deps()))).toEqual([429, 'DAILY_LIMIT'])
    expect((await handleTickets(post(valid), env(), ctx, deps({ now: () => new Date('2026-09-25T00:00:01Z') })))!.status).toBe(200)
  })
  it('is rate limited per address through the router, before anything is read', async () => {
    const deny = { limit: async () => ({ success: false }) }
    const r = await worker.fetch(post(valid), env({ TICKET_LIMIT: deny }), { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext)
    expect(r.status).toBe(429); expect(await r.json()).toEqual({ code: 'RATE_LIMITED' })
  })
})

describe('parseTicket', () => {
  it('names the first wrong field, and accepts no contact', () => {
    expect(parseTicket({ ...valid, contact: null }).ok).toBe(true)
    for (const [change, field] of [
      [{ kind: 'bug' }, 'kind'], [{ description: '   ' }, 'description'], [{ description: 'x'.repeat(2001) }, 'description'],
      [{ contact: '' }, 'contact'], [{ contact: 'x'.repeat(201) }, 'contact'], [{ lang: 'fr' }, 'lang'],
      [{ page: 'https://evil.example/' }, 'page'], [{ page: '/zh/<script>' }, 'page'], [{ token: '' }, 'token'], [{ extra: 1 }, 'extra'],
    ] as const) expect(parseTicket({ ...valid, ...change }), JSON.stringify(change)).toEqual({ ok: false, field })
    expect(parseTicket({ kind: 'idea' })).toEqual({ ok: false, field: 'description' })
  })
  it('counts characters, not UTF-16 units: 2000 Chinese characters or emoji fit', () => {
    expect(parseTicket({ ...valid, description: '😀'.repeat(2000) }).ok).toBe(true)
  })
})

describe('the mail and retention', () => {
  const ticket: Ticket = { kind: 'idea', description: 'line one\r\nBcc: x@example.com', contact: 'player@example.com', lang: 'en', page: '/en/' }
  it('keeps the description out of the headers, and replies to an email contact only', () => {
    const m: MailMessage = buildTicketMail('AL-260924-1234', ticket, 'owner@test.invalid')
    expect(m.subject).not.toMatch(/[\r\n]/); expect(m.subject).toContain('AL-260924-1234 · idea · en')
    expect(m.replyTo).toBe('player@example.com')
    expect(buildTicketMail('AL-260924-1234', { ...ticket, contact: 'QQ 12345' }, 'o@test.invalid').replyTo).toBeUndefined()
  })
  it('records whether the mail went out', async () => {
    await handleTickets(post(valid), env(), ctx, deps())
    await notifyTicket('AL-260924-1234', ticket, env({ MAIL: { send: async () => { throw new Error('E_SENDER_NOT_VERIFIED') } } as unknown as AppEnv['MAIL'] }))
    expect(await base.DB.prepare('SELECT mail FROM tickets').first('mail')).toBe('failed:E_SENDER_NOT_VERIFIED')
  })
  it('deletes tickets after 180 days, and the daily cron does it too', async () => {
    await base.DB.prepare("INSERT INTO tickets (number, created_at, day, kind, lang, has_contact, bytes, body) VALUES ('AL-260301-OLD0', '2026-03-01T00:00:00.000Z', '2026-03-01', 'other', 'zh', 0, 1, '{}')").run()
    expect(await deleteExpiredTickets(env(), new Date('2026-09-24T00:00:00Z'))).toBe(1)
    await base.DB.prepare("INSERT INTO tickets (number, created_at, day, kind, lang, has_contact, bytes, body) VALUES ('AL-260301-OLD1', '2026-03-01T00:00:00.000Z', '2026-03-01', 'other', 'zh', 0, 1, '{}')").run()
    const pending: Promise<unknown>[] = []
    // @ts-expect-error — scheduled is always present on this worker
    await worker.scheduled({ cron: '17 4 * * *', scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController, env(), { waitUntil: (p: Promise<unknown>) => { pending.push(p) } } as unknown as ExecutionContext)
    await Promise.all(pending)
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM tickets').first('c')).toBe(0)
  })
})
