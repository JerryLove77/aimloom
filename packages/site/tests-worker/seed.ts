/** Fixtures shared by the SQL suites. Every SteamID is one of the fixed fake identities (CLAUDE.md). */
import { env as testEnv } from 'cloudflare:workers'
import type { D1Migration } from 'cloudflare:test'
import type { Item, ItemStatus, Kind } from '../src/lib/explore-types'

export const test = testEnv as unknown as { DB: D1Database; FILES: R2Bucket; UPLOADS: R2Bucket; TEST_MIGRATIONS: D1Migration[] }
export const db = test.DB
export const NOW = new Date('2026-10-20T12:00:00.000Z')
export const ADMIN = '76561198000000042', CREATOR = '76561198000000043', OTHER = '76561198000000044'

/** Drops every table the migrations made, and the record of which ran; D1's own `_cf_` tables stay. */
export async function emptyDatabase(d: D1Database): Promise<void> {
  const { results } = await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()
  // Deferred, so a table can go before the tables that reference it.
  await d.batch([d.prepare('PRAGMA defer_foreign_keys = ON'), ...results.map(r => d.prepare(`DROP TABLE "${r.name}"`))])
}

/** Deletes every object; the buckets outlive a test unless something empties them. */
export async function emptyBucket(bucket: R2Bucket): Promise<void> {
  for (let listed = await bucket.list(); listed.objects.length; listed = await bucket.list()) await bucket.delete(listed.objects.map(o => o.key))
}

export interface ItemSeed { slug: string; kind?: Kind; status?: ItemStatus; file_name?: string; uploader?: string | null; uploaded_at?: string | null; title_en?: string }

/** A full row as the upload path writes it; `uploader: null` makes it the maintainer's. */
export function itemRow(r: ItemSeed): Omit<Item, 'featured'> {
  const fileName = r.file_name ?? `${r.slug}.json`
  const uploader = r.uploader === undefined ? CREATOR : r.uploader
  return {
    slug: r.slug, kind: r.kind ?? 'theme', status: r.status ?? 'published', title_zh: `标题 ${r.slug}`, title_en: r.title_en ?? `Title ${r.slug}`,
    summary_zh: '', summary_en: '', author: 'Sample author', author_url: null, licence: 'CC-BY-4.0', file_name: fileName,
    file_key: `files/${r.slug.padEnd(64, '0').slice(0, 64)}/${fileName}`, bytes: 100, sha256: 'a'.repeat(64), code: null,
    published_at: '2026-10-01T00:00:00.000Z', source: uploader ? 'upload' : 'maintainer', uploader,
    uploaded_at: r.uploaded_at === undefined ? (uploader ? '2026-10-01T00:00:00.000Z' : null) : r.uploaded_at, reject_reason: null,
  }
}

export async function seedItems(...rows: ItemSeed[]): Promise<void> {
  await db.batch(rows.map(itemRow).map(r => db.prepare(
    `INSERT INTO item (slug, kind, status, title_zh, title_en, summary_zh, summary_en, author, author_url, licence, file_name, file_key, bytes, sha256, code, featured, published_at, source, uploader, uploaded_at, reject_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).bind(r.slug, r.kind, r.status, r.title_zh, r.title_en, r.summary_zh, r.summary_en, r.author, r.author_url, r.licence, r.file_name, r.file_key, r.bytes, r.sha256, r.code, r.published_at, r.source, r.uploader, r.uploaded_at, r.reject_reason)))
}

/** Day counts for one item: `[day, count]` pairs. */
export async function seedDays(slug: string, days: [string, number][]): Promise<void> {
  if (days.length) await db.batch(days.map(([day, count]) => db.prepare('INSERT INTO download_daily (slug, day, count) VALUES (?, ?, ?)').bind(slug, day, count)))
}

export async function seedMonths(slug: string, months: [string, number][]): Promise<void> {
  if (months.length) await db.batch(months.map(([month, count]) => db.prepare('INSERT INTO download_monthly (slug, month, count) VALUES (?, ?, ?)').bind(slug, month, count)))
}

export const logRows = () => db.prepare('SELECT actor, action, slug, creator, from_status, to_status, reason FROM moderation_log ORDER BY id').all().then(r => r.results)
export const count = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<number>('c')
