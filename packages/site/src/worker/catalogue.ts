/**
 * The explorer's reads and its one write, the download counter (spec 2026-09-22 §4–§5). Every
 * read returns published items only; nothing here learns anything about who is asking.
 */
import { KINDS, SORTS, MAX_QUERY, PAGE_SIZE, TRENDING_DAYS, type Item, type ItemStatus, type Kind, type ListQuery, type ListResult, type Sort } from '../lib/explore-types'
export { KINDS, SORTS, MAX_QUERY, PAGE_SIZE, TRENDING_DAYS, type Item, type Kind, type ListQuery, type ListResult, type Sort }

const isKind = (v: string | null): v is Kind => (KINDS as readonly string[]).includes(v ?? '')
const isSort = (v: string | null): v is Sort => (SORTS as readonly string[]).includes(v ?? '')

/** Unknown or malformed parameters fall back to the defaults rather than failing the page. */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const kind = params.get('kind'); const sort = params.get('sort'); const page = Number(params.get('page') ?? '1')
  return {
    kind: isKind(kind) ? kind : 'theme',
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY),
    sort: isSort(sort) ? sort : 'new',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  }
}

/** UTC day `offset` days from `now`, as YYYY-MM-DD. */
export function utcDay(now: Date, offset = 0): string {
  return new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
}

/** True once the earliest counted day is at least TRENDING_DAYS days old (inclusive of today). Days rolled into months count from the month's first day. */
export async function popularAvailable(db: D1Database, now: Date): Promise<boolean> {
  const first = await db.prepare("SELECT MIN(d) AS d FROM (SELECT MIN(day) AS d FROM download_daily UNION ALL SELECT MIN(month) || '-01' FROM download_monthly)").first<string | null>('d')
  return typeof first === 'string' && first <= utcDay(now, -(TRENDING_DAYS - 1))
}

// LIKE, not FTS5: the default tokenizer does not split Chinese, and the catalogue is small.
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, c => '\\' + c)
const SEARCHED = ['title_zh', 'title_en', 'summary_zh', 'summary_en', 'file_name'] as const
/** ?1 is the LIKE pattern, ?2 the kind. `t` names the item table in the statement. */
function where(t: string, searching: boolean): string {
  const search = SEARCHED.map(c => `${t}.${c} LIKE ?1 ESCAPE '\\'`).join(' OR ')
  return `${t}.status = 'published' AND ${t}.kind = ?2${searching ? ` AND (${search})` : ''}`
}

export async function listItems(db: D1Database, query: ListQuery, now: Date): Promise<ListResult> {
  const popular = await popularAvailable(db, now)
  const sort: Sort = query.sort === 'popular' && popular ? 'popular' : 'new'
  const like = `%${escapeLike(query.q)}%`
  const searching = query.q !== ''
  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM item i WHERE ${where('i', searching)}`).bind(like, query.kind).first<number>('c')) ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(query.page, pages)
  const order = sort === 'popular' ? 'COALESCE(d.c, 0) DESC, i.published_at DESC, i.slug' : 'i.published_at DESC, i.slug'
  const { results } = await db.prepare(
    `SELECT i.* FROM item i LEFT JOIN (SELECT slug, SUM(count) AS c FROM download_daily WHERE day >= ?3 GROUP BY slug) d ON d.slug = i.slug
     WHERE ${where('i', searching)} ORDER BY ${order} LIMIT ?4 OFFSET ?5`,
  ).bind(like, query.kind, utcDay(now, -(TRENDING_DAYS - 1)), PAGE_SIZE, (page - 1) * PAGE_SIZE).all<Item>()
  return { items: results, total, page, pages, popularAvailable: popular }
}

/** The hand-ordered Featured row for one tab. */
export async function featuredItems(db: D1Database, kind: Kind): Promise<Item[]> {
  const { results } = await db.prepare(`SELECT * FROM item WHERE status = 'published' AND kind = ? AND featured IS NOT NULL ORDER BY featured, slug LIMIT 6`).bind(kind).all<Item>()
  return results
}

export async function getItem(db: D1Database, slug: string): Promise<Item | null> {
  return db.prepare(`SELECT * FROM item WHERE slug = ? AND status = 'published'`).bind(slug).first<Item>()
}

export async function downloadsLast30(db: D1Database, slug: string, now: Date): Promise<number> {
  return (await db.prepare('SELECT COALESCE(SUM(count), 0) AS c FROM download_daily WHERE slug = ? AND day >= ?').bind(slug, utcDay(now, -(TRENDING_DAYS - 1))).first<number>('c')) ?? 0
}

/** One more download request for today. The requester is not read, hashed or stored. */
export async function countDownload(db: D1Database, slug: string, now: Date): Promise<void> {
  await db.prepare('INSERT INTO download_daily (slug, day, count) VALUES (?, ?, 1) ON CONFLICT(slug, day) DO UPDATE SET count = count + 1').bind(slug, utcDay(now)).run()
}

/** Day counts are kept this long; older days are added to their month's total (migration 0007). */
export const DAILY_KEPT_DAYS = 90

/**
 * Moves every day before the cutoff into download_monthly. The add and the delete are one batch, so
 * one transaction: a retry after a failure can neither count a day twice nor lose it.
 */
export async function rollupDownloads(db: D1Database, now: Date): Promise<void> {
  const cutoff = utcDay(now, -DAILY_KEPT_DAYS)
  await db.batch([
    db.prepare(`INSERT INTO download_monthly (slug, month, count)
      SELECT slug, substr(day, 1, 7), SUM(count) FROM download_daily WHERE day < ?1 GROUP BY slug, substr(day, 1, 7)
      ON CONFLICT (slug, month) DO UPDATE SET count = count + excluded.count`).bind(cutoff),
    db.prepare('DELETE FROM download_daily WHERE day < ?1').bind(cutoff),
  ])
}

// ---- uploads (spec 2026-09-22 §11) ------------------------------------------------------------

export interface Creator { steam_id: string; trusted: number; display_name: string | null; author_url: string | null }

export async function creatorOf(db: D1Database, steamId: string): Promise<Creator | null> {
  return db.prepare('SELECT steam_id, trusted, display_name, author_url FROM creator WHERE steam_id = ?').bind(steamId).first<Creator>()
}

/** Remembers the display name and link for the next form; never changes `trusted`. */
export async function rememberCreator(db: D1Database, steamId: string, name: string, url: string | null, now: Date): Promise<void> {
  await db.prepare('INSERT INTO creator (steam_id, trusted, display_name, author_url, first_seen) VALUES (?, 0, ?, ?, ?) ON CONFLICT(steam_id) DO UPDATE SET display_name = excluded.display_name, author_url = excluded.author_url')
    .bind(steamId, name, url, now.toISOString()).run()
}

/**
 * Trusts or untrusts a creator, and logs it only when it changes something: an unknown creator
 * counts as untrusted. Log and upsert are one batch. True when the log gained a row.
 */
export async function setTrusted(db: D1Database, steamId: string, trusted: boolean, actor: string, now: Date): Promise<boolean> {
  const value = trusted ? 1 : 0
  const [logged] = await db.batch([
    db.prepare(`INSERT INTO moderation_log (at, actor, action, creator) SELECT ?1, ?2, ?3, ?4
      WHERE COALESCE((SELECT trusted FROM creator WHERE steam_id = ?4), 0) <> ?5`).bind(now.toISOString(), actor, trusted ? 'trust' : 'untrust', steamId, value),
    db.prepare('INSERT INTO creator (steam_id, trusted, first_seen) VALUES (?, ?, ?) ON CONFLICT(steam_id) DO UPDATE SET trusted = excluded.trusted').bind(steamId, value, now.toISOString()),
  ])
  return logged!.meta.changes === 1
}

export async function trustedCreators(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT steam_id FROM creator WHERE trusted = 1 ORDER BY first_seen').all<{ steam_id: string }>()
  return results.map(r => r.steam_id)
}

export async function uploadsToday(db: D1Database, steamId: string, now: Date): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS c FROM item WHERE uploader = ? AND uploaded_at >= ?").bind(steamId, `${utcDay(now)}T00:00:00.000Z`).first<number>('c')) ?? 0
}

/** A file name is taken while an item of that kind with that name is live or waiting. */
export async function fileNameTaken(db: D1Database, kind: Kind, fileName: string): Promise<boolean> {
  return ((await db.prepare("SELECT COUNT(*) AS c FROM item WHERE kind = ? AND file_name = ? COLLATE NOCASE AND status IN ('published','pending','hidden')").bind(kind, fileName).first<number>('c')) ?? 0) > 0
}

const randomHex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('')

// The candidates base, base-2 … base-999 in order, and the first no item holds: one statement
// instead of one round trip per candidate.
const FREE_SLUG = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 999)
  SELECT CASE i WHEN 1 THEN ?1 ELSE ?1 || '-' || i END AS slug FROM n
  WHERE NOT EXISTS (SELECT 1 FROM item WHERE item.slug = CASE i WHEN 1 THEN ?1 ELSE ?1 || '-' || i END)
  ORDER BY i LIMIT 1`

/** A slug from the file's stem, unique among all items: `night-blue`, `night-blue-2`, … or `u-<hex>` when nothing ASCII is left. */
export async function freeSlug(db: D1Database, fileName: string): Promise<string> {
  const stem = fileName.slice(0, fileName.lastIndexOf('.')).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  const base = /^[a-z0-9]/.test(stem) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem) && !(RESERVED as readonly string[]).includes(stem) ? stem : `u-${randomHex(4)}`
  const slug = await db.prepare(FREE_SLUG).bind(base).first<string>('slug')
  if (!slug) throw new Error('no free slug')
  return slug
}
const RESERVED = ['item-shell', 'upload', 'mine', 'review', 'welcome'] as const

/** Where a file waiting for review is kept. The random part means two uploads never share a key. */
export const pendingKey = (slug: string, fileName: string): string => `pending/${slug}/${randomHex(8)}/${fileName}`

/**
 * `limit`: the uploader already has `perDay` items since `dayStart`. `duplicate`: a live or waiting
 * item of this kind has this name (index item_live_name), or the same file is already stored
 * (file_key). `slug`: another upload took the slug in the meantime.
 */
export type InsertResult = 'ok' | 'limit' | 'duplicate' | 'slug'

/**
 * Inserts an upload only while its uploader is under the daily limit, as one statement: the count
 * and the insert cannot interleave with another request's, because D1 runs one write at a time.
 */
export async function insertItem(db: D1Database, row: Omit<Item, 'featured'>, perDay: number, dayStart: string): Promise<InsertResult> {
  try {
    const { meta } = await db.prepare(`INSERT INTO item (slug, kind, status, title_zh, title_en, summary_zh, summary_en, author, author_url, licence, file_name, file_key, bytes, sha256, code, featured, published_at, source, uploader, uploaded_at, reject_reason)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM item WHERE uploader = ? AND uploaded_at >= ?) < ?`)
      .bind(row.slug, row.kind, row.status, row.title_zh, row.title_en, row.summary_zh, row.summary_en, row.author, row.author_url, row.licence, row.file_name, row.file_key, row.bytes, row.sha256, row.code, row.published_at, row.source, row.uploader, row.uploaded_at, row.reject_reason,
        row.uploader, dayStart, perDay).run()
    return meta.changes === 1 ? 'ok' : 'limit'
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e)
    if (!message.includes('UNIQUE constraint failed')) throw e
    return message.includes('item.slug') ? 'slug' : 'duplicate'
  }
}

/** Any status, any item — for the owner's page and the review page, never for the public routes. */
export async function itemAnyStatus(db: D1Database, slug: string): Promise<Item | null> {
  return db.prepare('SELECT * FROM item WHERE slug = ?').bind(slug).first<Item>()
}

export async function mine(db: D1Database, steamId: string): Promise<Item[]> {
  const { results } = await db.prepare('SELECT * FROM item WHERE uploader = ? ORDER BY uploaded_at DESC').bind(steamId).all<Item>()
  return results
}

export async function pendingItems(db: D1Database): Promise<(Item & { uploader_total: number; uploader_live: number })[]> {
  const { results } = await db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM item x WHERE x.uploader = i.uploader) AS uploader_total, (SELECT COUNT(*) FROM item x WHERE x.uploader = i.uploader AND x.status = 'published') AS uploader_live
    FROM item i WHERE i.status = 'pending' ORDER BY i.uploaded_at`).all<Item & { uploader_total: number; uploader_live: number }>()
  return results
}

export async function liveItems(db: D1Database, limit = 100): Promise<Item[]> {
  const { results } = await db.prepare("SELECT * FROM item WHERE status = 'published' ORDER BY published_at DESC LIMIT ?").bind(limit).all<Item>()
  return results
}

export type ItemAction = 'approve' | 'reject' | 'hide' | 'withdraw'

export interface Transition {
  slug: string; from: ItemStatus; to: ItemStatus; action: ItemAction
  /** Who acts: the admin, or the owner withdrawing. */
  actor: string; at: string
  /** Set for a withdrawal: the item must also belong to this SteamID. */
  owner?: string
  reason?: string; publishedAt?: string; fileKey?: string
}

/**
 * Moves one item from `from` to `to` and logs it, in one batch (one transaction). The log insert
 * and the update carry the same condition — the item is still in `from` (and still the owner's) —
 * so both happen or neither does. False when someone else changed the item first.
 */
export async function transition(db: D1Database, t: Transition): Promise<boolean> {
  const guard = t.owner === undefined ? 'slug = ? AND status = ?' : 'slug = ? AND status = ? AND uploader = ?'
  const args = t.owner === undefined ? [t.slug, t.from] : [t.slug, t.from, t.owner]
  const [, updated] = await db.batch([
    db.prepare(`INSERT INTO moderation_log (at, actor, action, slug, from_status, to_status, reason) SELECT ?, ?, ?, slug, status, ?, ? FROM item WHERE ${guard}`)
      .bind(t.at, t.actor, t.action, t.to, t.reason ?? null, ...args),
    db.prepare(`UPDATE item SET status = ?, reject_reason = COALESCE(?, reject_reason), published_at = COALESCE(?, published_at), file_key = COALESCE(?, file_key) WHERE ${guard}`)
      .bind(t.to, t.reason ?? null, t.publishedAt ?? null, t.fileKey ?? null, ...args),
  ])
  return updated!.meta.changes === 1
}

/** True while some item, in any status, points at this stored file. */
export async function fileKeyInUse(db: D1Database, key: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS used FROM item WHERE file_key = ?').bind(key).first('used')) !== null
}

/** The moderation log is kept for a year (the Privacy page says so). */
export const LOG_KEPT_DAYS = 365

export async function deleteOldModerationLog(db: D1Database, now: Date): Promise<void> {
  await db.prepare('DELETE FROM moderation_log WHERE at < ?').bind(new Date(now.getTime() - LOG_KEPT_DAYS * 86_400_000).toISOString()).run()
}

export async function deleteExpiredSessions(db: D1Database, now: Date): Promise<void> {
  await db.prepare('DELETE FROM session WHERE expires_at < ?').bind(now.toISOString()).run()
}
