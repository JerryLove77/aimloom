/**
 * The explorer's reads and its one write, the download counter (spec 2026-09-22 §4–§5). Every
 * read returns published items only; nothing here learns anything about who is asking.
 */
import { KINDS, SORTS, MAX_QUERY, PAGE_SIZE, TRENDING_DAYS, type Item, type Kind, type ListQuery, type ListResult, type Sort } from '../lib/explore-types'
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

/** True once the earliest counted day is at least TRENDING_DAYS days old (inclusive of today). */
export async function popularAvailable(db: D1Database, now: Date): Promise<boolean> {
  const first = await db.prepare('SELECT MIN(day) AS d FROM download_daily').first<string | null>('d')
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
