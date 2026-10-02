import type { AppEnv } from './env'
import { fail, json, readJsonBody, requireClient, requireJsonContentType } from './http'
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
// ?1 is the UTC day, ?2 the final stored body's UTF-8 bytes. CASE checks the indexed daily
// quota first, so an already-full day does not scan the archive. NULL means there is room.
function quotaSql(hasCounter: boolean): string {
  // Missing counter rows fail closed. The SUM fallback lets this Worker deploy before 0010.
  const archive = hasCounter
    ? `COALESCE((SELECT bytes FROM report_storage WHERE id = 1), ${ARCHIVE_CEILING_BYTES})`
    : '(SELECT COALESCE(SUM(bytes), 0) FROM reports)'
  return `SELECT CASE
    WHEN COUNT(*) >= ${DAILY_CEILING} OR COALESCE(SUM(bytes), 0) + ?2 > ${DAILY_BYTES_CEILING} THEN 'DAILY_LIMIT'
    WHEN ${archive} + ?2 > ${ARCHIVE_CEILING_BYTES} THEN 'STORAGE_FULL'
    ELSE NULL END FROM reports WHERE day = ?1`
}

/** Deletes reports older than the retention window. Shared by the request path (on arrival) and the
 * daily Cron Trigger (`index.ts`'s `scheduled`), so the promise on the Privacy page holds even when
 * no report ever arrives again. Returns the number of rows removed. */
export async function deleteExpired(env: AppEnv, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
  const [, result] = await env.DB.batch<{ removed: number }>([
    env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('SELECT changes() AS removed'),
  ])
  return result!.results[0]!.removed
}

export async function handleReport(request: Request, env: AppEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: ReportDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
  const badType = requireJsonContentType(request); if (badType) return badType
  const badClient = requireClient(request); if (badClient) return badClient
  const read = await readJsonBody(request, MAX_BODY_BYTES, 'INVALID_JSON'); if (!read.ok) return read.response
  const parsed = parseReport(read.value)
  if (!parsed.ok) return fail('INVALID_REPORT', 400, { field: parsed.field.slice(0, 64) })

  const now = (deps.now ?? (() => new Date()))(); const random = deps.random ?? (n => crypto.getRandomValues(new Uint8Array(n)))
  const createdAt = now.toISOString(); const day = createdAt.slice(0, 10); const report = parsed.report
  let number = ''
  try {
    // Retention first: an archive that is full of expired reports must free itself, not refuse forever.
    await deleteExpired(env, now)
    const hasCounter = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_storage'").first()
    const quota = quotaSql(hasCounter !== null)
    const insert = `INSERT INTO reports (number, created_at, day, app_label, lang, windows, has_log, has_contact, steam_id, bytes, body)
      SELECT ?3, ?4, ?1, ?5, ?6, ?7, ?8, ?9, ?10, ?2, ?11 WHERE (${quota}) IS NULL ON CONFLICT(number) DO NOTHING`
    for (let attempt = 0; attempt < NUMBER_ATTEMPTS && number === ''; attempt++) {
      const candidate = reportNumber(now, random)
      const body = JSON.stringify({ ...report, number: candidate, receivedAt: createdAt })
      const bytes = new TextEncoder().encode(body).length
      // The quota and insert are one statement. Diagnose a refused insert in the same batch
      // transaction; a concurrent insert or retention cleanup cannot change its failure code.
      // SQL changes() excludes accounting-trigger updates, unlike D1 meta.changes.
      const [, result] = await env.DB.batch<{ inserted: number; code: 'DAILY_LIMIT' | 'STORAGE_FULL' | null }>([
        env.DB.prepare(insert).bind(day, bytes, candidate, createdAt, report.app.label, report.system.lang, report.system.windows,
          report.log === null ? 0 : 1, report.contact === null ? 0 : 1, report.account?.steamId ?? null, body),
        env.DB.prepare(`SELECT changes() AS inserted, CASE WHEN changes() = 0 THEN (${quota}) ELSE NULL END AS code`).bind(day, bytes),
      ])
      const outcome = result!.results[0]!
      if (outcome.inserted === 1) number = candidate
      else {
        const code = outcome.code
        if (code) return fail(code, code === 'DAILY_LIMIT' ? 429 : 507)
        // Only a taken number leaves the quotas open without inserting; draw another.
      }
    }
  } catch { return fail('STORAGE_FAILED', 500) }
  if (number === '') return fail('STORAGE_FAILED', 500)
  if (deps.afterStore) ctx.waitUntil(deps.afterStore(number, report, env).catch(() => undefined))
  return json({ number })
}
