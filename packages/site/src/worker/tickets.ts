/**
 * Tickets from the website's feedback panel: `GET /api/tickets/key` and `POST /api/tickets`.
 *
 * Anyone may send one, so every request needs the site's own Origin and a Cloudflare Turnstile
 * pass, and the day has a ceiling. Without both Turnstile keys (preview, or before they are set)
 * the panel stays closed and points at the feedback address. A ticket keeps only what the player
 * typed, the page's language and path; never an IP address (the rate limit's key is written
 * nowhere). The owner is mailed each one, and it is deleted after 180 days, as reports are.
 */
import { readCapped } from './body'
import { requireSameOrigin } from './auth'
import type { AppEnv, MailMessage } from './env'
import { fail, json, requireContentLengthWithin, requireJsonContentType } from './http'
import { reportNumber } from './report-number'
import { RETENTION_DAYS } from './reports'
import { humanCheck, turnstileSiteKey } from './turnstile'

export const TICKET_KINDS = ['problem', 'idea', 'other'] as const
export type TicketKind = typeof TICKET_KINDS[number]
export interface Ticket { kind: TicketKind; description: string; contact: string | null; lang: 'zh' | 'en'; page: string }
export const MAX_TICKET_DESCRIPTION = 2000, MAX_TICKET_CONTACT = 200, MAX_TICKET_BODY = 16 * 1024, TICKETS_PER_DAY = 100, NUMBER_ATTEMPTS = 5
const PAGE = /^\/(zh|en)(\/[a-z0-9/-]*)?$/
const INSERT = 'INSERT OR IGNORE INTO tickets (number, created_at, day, kind, lang, has_contact, bytes, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'

export interface TicketDeps {
  now?: () => Date
  random?: (n: number) => Uint8Array
  fetcher?: typeof fetch
  /** Runs after the ticket is stored; its failure never fails the ticket. */
  afterStore?: (number: string, ticket: Ticket, env: AppEnv) => Promise<void>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max

/** The ticket and its Turnstile token, or the first field that is wrong. Every key must be present and no other. */
export function parseTicket(value: unknown): { ok: true; ticket: Ticket; token: string } | { ok: false; field: string } {
  if (!isRecord(value)) return { ok: false, field: '' }
  const keys = ['kind', 'description', 'contact', 'lang', 'page', 'token']
  for (const key of Object.keys(value)) if (!keys.includes(key)) return { ok: false, field: key.slice(0, 64) }
  if (!(TICKET_KINDS as readonly unknown[]).includes(value.kind)) return { ok: false, field: 'kind' }
  if (!text(value.description, MAX_TICKET_DESCRIPTION)) return { ok: false, field: 'description' }
  if (value.contact !== null && !text(value.contact, MAX_TICKET_CONTACT)) return { ok: false, field: 'contact' }
  if (value.lang !== 'zh' && value.lang !== 'en') return { ok: false, field: 'lang' }
  if (typeof value.page !== 'string' || value.page.length > 100 || !PAGE.test(value.page)) return { ok: false, field: 'page' }
  if (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 4096) return { ok: false, field: 'token' }
  const ticket: Ticket = { kind: value.kind as TicketKind, description: value.description, contact: value.contact === null ? null : (value.contact as string).trim(), lang: value.lang, page: value.page }
  return { ok: true, ticket, token: value.token }
}

export async function deleteExpiredTickets(env: AppEnv, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
  return (await env.DB.prepare('DELETE FROM tickets WHERE created_at < ?').bind(cutoff).run()).meta.changes
}

/** `/api/tickets` and `/api/tickets/key`; `null` for any other path. */
export async function handleTickets(request: Request, env: AppEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: TicketDeps = {}): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/tickets/key') {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405)
    return json({ siteKey: turnstileSiteKey(env) })
  }
  if (pathname !== '/api/tickets') return null
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
  const refused = requireSameOrigin(request); if (refused) return refused
  if (turnstileSiteKey(env) === null) return fail('TICKETS_CLOSED', 503)
  const badType = requireJsonContentType(request); if (badType) return badType
  const tooLarge = requireContentLengthWithin(request, MAX_TICKET_BODY); if (tooLarge) return tooLarge
  let capped: { bytes: Uint8Array; truncated: boolean }
  try { capped = await readCapped(request, MAX_TICKET_BODY) } catch { return fail('INVALID_JSON', 400) }
  if (capped.truncated) return fail('TOO_LARGE', 413)
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(capped.bytes)) } catch { return fail('INVALID_JSON', 400) }
  const parsed = parseTicket(value)
  if (!parsed.ok) return fail('INVALID_TICKET', 400, { field: parsed.field })
  if (!(await humanCheck(env, parsed.token, deps.fetcher ?? fetch))) return fail('HUMAN_CHECK_FAILED', 403)

  const now = (deps.now ?? (() => new Date()))(); const random = deps.random ?? (n => crypto.getRandomValues(new Uint8Array(n)))
  const createdAt = now.toISOString(); const day = createdAt.slice(0, 10); const ticket = parsed.ticket
  let number = ''
  try {
    await deleteExpiredTickets(env, now)
    const today = await env.DB.prepare('SELECT COUNT(*) AS c FROM tickets WHERE day = ?').bind(day).first<number>('c')
    if ((today ?? 0) >= TICKETS_PER_DAY) return fail('DAILY_LIMIT', 429)
    for (let attempt = 0; attempt < NUMBER_ATTEMPTS && number === ''; attempt++) {
      const candidate = reportNumber(now, random)
      const body = JSON.stringify({ ...ticket, number: candidate, receivedAt: createdAt })
      const done = await env.DB.prepare(INSERT).bind(candidate, createdAt, day, ticket.kind, ticket.lang, ticket.contact === null ? 0 : 1, new TextEncoder().encode(body).length, body).run()
      if (done.meta.changes === 1) number = candidate
    }
  } catch { return fail('STORAGE_FAILED', 500) }
  if (number === '') return fail('STORAGE_FAILED', 500)
  if (deps.afterStore) ctx.waitUntil(deps.afterStore(number, ticket, env).catch(() => undefined))
  return json({ number })
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
// Collapsing every run of whitespace keeps a CR or LF out of the subject: no header injection.
const head = (s: string, max: number) => { const chars = [...s.replace(/\s+/g, ' ').trim()]; return chars.length <= max ? chars.join('') : chars.slice(0, max).join('') + '…' }

export function buildTicketMail(number: string, ticket: Ticket, to: string): MailMessage {
  const message: MailMessage = {
    to, from: { email: 'reports@aimloom.dev', name: 'Aimloom tickets' },
    subject: `[Aimloom] ticket ${number} · ${ticket.kind} · ${ticket.lang} · ${head(ticket.description, 60)}`,
    text: [`Ticket ${number} (website)`, `Kind: ${ticket.kind} · language ${ticket.lang} · sent from ${ticket.page}`, `Contact: ${ticket.contact ?? 'none'}`, '', ticket.description].join('\n'),
  }
  if (ticket.contact !== null && EMAIL.test(ticket.contact)) message.replyTo = ticket.contact
  return message
}

/** Best effort: the outcome is written to the row and nothing is thrown. */
export async function notifyTicket(number: string, ticket: Ticket, env: AppEnv): Promise<void> {
  let state = 'sent'
  try {
    if (!env.REPORT_TO) state = 'failed:NO_MAILBOX'
    else await env.MAIL.send(buildTicketMail(number, ticket, env.REPORT_TO))
  } catch (error) {
    state = `failed:${/E_[A-Z_]+/.exec(String(error))?.[0] ?? 'UNKNOWN'}`
  }
  try { await env.DB.prepare('UPDATE tickets SET mail = ? WHERE number = ?').bind(state, number).run() } catch { /* the ticket itself is safe */ }
}
