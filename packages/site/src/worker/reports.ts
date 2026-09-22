import { readCapped } from './body'
import type { AppEnv } from './env'
import { fail, json, requireClient, requireContentLengthWithin, requireJsonContentType } from './http'
import { reportNumber } from './report-number'
import { parseReport, type Report } from './report-schema'

export const MAX_BODY_BYTES = 1024 * 1024, DAILY_CEILING = 300, DAILY_BYTES_CEILING = 64 * 1024 * 1024,
  ARCHIVE_CEILING_BYTES = 400 * 1024 * 1024, RETENTION_DAYS = 180, NUMBER_ATTEMPTS = 5
export interface ReportDeps {
  now?: () => Date
  random?: (n: number) => Uint8Array
  /** Runs after the report is stored; the mail plugs in here (notify.ts). Its failure never fails the report. */
  afterStore?: (number: string, report: Report, env: AppEnv) => Promise<void>
}
const INSERT = 'INSERT OR IGNORE INTO reports (number, created_at, day, app_label, lang, windows, has_log, has_contact, steam_id, bytes, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'

/** Deletes reports older than the retention window. Shared by the request path (on arrival) and the
 * daily Cron Trigger (`index.ts`'s `scheduled`), so the promise on the Privacy page holds even when
 * no report ever arrives again. Returns the number of rows removed. */
export async function deleteExpired(env: AppEnv, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
  const done = await env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(cutoff).run()
  return done.meta.changes
}

export async function handleReport(request: Request, env: AppEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: ReportDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
  const badType = requireJsonContentType(request); if (badType) return badType
  const badClient = requireClient(request); if (badClient) return badClient
  const tooLarge = requireContentLengthWithin(request, MAX_BODY_BYTES); if (tooLarge) return tooLarge
  let capped: { bytes: Uint8Array; truncated: boolean }
  try { capped = await readCapped(request, MAX_BODY_BYTES) } catch { return fail('INVALID_JSON', 400) }
  if (capped.truncated) return fail('TOO_LARGE', 413)
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(capped.bytes)) } catch { return fail('INVALID_JSON', 400) }
  const parsed = parseReport(value)
  if (!parsed.ok) return fail('INVALID_REPORT', 400, { field: parsed.field.slice(0, 64) })

  const now = (deps.now ?? (() => new Date()))(); const random = deps.random ?? (n => crypto.getRandomValues(new Uint8Array(n)))
  const createdAt = now.toISOString(); const day = createdAt.slice(0, 10); const report = parsed.report
  let number = ''
  try {
    // Retention first: an archive that is full of expired reports must free itself, not refuse forever.
    await deleteExpired(env, now)
    // The indexed daily total FIRST: a flood that is about to be refused must not pay for a full-table scan.
    const daily = await env.DB.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS bytes FROM reports WHERE day = ?').bind(day).first<{ c: number; bytes: number }>()
    if ((daily?.c ?? 0) >= DAILY_CEILING) return fail('DAILY_LIMIT', 429)
    if ((daily?.bytes ?? 0) >= DAILY_BYTES_CEILING) return fail('DAILY_LIMIT', 429)
    // Only once the daily checks pass does the archive total run.
    const archive = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM reports').first<{ bytes: number }>()
    if ((archive?.bytes ?? 0) >= ARCHIVE_CEILING_BYTES) return fail('STORAGE_FULL', 507)
    for (let attempt = 0; attempt < NUMBER_ATTEMPTS && number === ''; attempt++) {
      const candidate = reportNumber(now, random)
      const body = JSON.stringify({ ...report, number: candidate, receivedAt: createdAt })
      // The number is the primary key: a taken number changes nothing, and the next attempt draws another.
      const done = await env.DB.prepare(INSERT).bind(candidate, createdAt, day, report.app.label, report.system.lang, report.system.windows,
        report.log === null ? 0 : 1, report.contact === null ? 0 : 1, report.account?.steamId ?? null, new TextEncoder().encode(body).length, body).run()
      if (done.meta.changes === 1) number = candidate
    }
  } catch { return fail('STORAGE_FAILED', 500) }
  if (number === '') return fail('STORAGE_FAILED', 500)
  if (deps.afterStore) ctx.waitUntil(deps.afterStore(number, report, env).catch(() => undefined))
  return json({ number })
}
