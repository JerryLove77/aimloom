/**
 * Download and review statistics, as JSON (no page yet: a page is drawn in Figma first). A creator
 * sees only their own items; the admin view is the review page's audience. Every figure comes from
 * the day and month counters (which hold no visitor data) and from the moderation log.
 */
import { TRENDING_DAYS, utcDay } from './catalogue'

export interface DayPoint { day: string; n: number; running: number; avg7: number }
export interface CreatorItemStats {
  slug: string; kind: string; title: { zh: string; en: string }; status: string
  total: number; last30: number; rank: number; days: DayPoint[]
}
export interface CreatorStats { from: string; to: string; items: CreatorItemStats[] }

// The last 30 days for each of the creator's live or hidden items, one row per item and day, zero
// on a day without downloads. The grid starts 6 days earlier so the 7-day average of the first
// shown day already covers 7 days; the running total counts only the shown days.
const CREATOR_DAYS = `WITH RECURSIVE days(day) AS (
    SELECT date(?2, '-6 days') UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < ?3
  ),
  mine AS (SELECT slug FROM item WHERE uploader = ?1 AND status IN ('published','hidden')),
  grid AS (
    SELECT m.slug, d.day, COALESCE(dd.count, 0) AS n
    FROM mine m CROSS JOIN days d
    LEFT JOIN download_daily dd ON dd.slug = m.slug AND dd.day = d.day
  ),
  calc AS (
    SELECT slug, day, n,
      SUM(CASE WHEN day >= ?2 THEN n ELSE 0 END) OVER w AS running,
      AVG(n) OVER (w ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS avg7
    FROM grid
    WINDOW w AS (PARTITION BY slug ORDER BY day)
  )
  SELECT slug, day, n, running, ROUND(avg7, 2) AS avg7 FROM calc WHERE day >= ?2 ORDER BY slug, day`

// All-time total per item (the month totals plus the days not yet rolled up), the last 30 days,
// and the item's place among the creator's items; equal totals share a place.
const CREATOR_TOTALS = `WITH mine AS (
    SELECT slug, kind, title_zh, title_en, status FROM item WHERE uploader = ?1 AND status IN ('published','hidden')
  ),
  counts AS (
    SELECT slug, count AS c FROM download_monthly WHERE slug IN (SELECT slug FROM mine)
    UNION ALL
    SELECT slug, count FROM download_daily WHERE slug IN (SELECT slug FROM mine)
  ),
  totals AS (SELECT slug, SUM(c) AS total FROM counts GROUP BY slug),
  recent AS (SELECT slug, SUM(count) AS c FROM download_daily WHERE day >= ?2 AND slug IN (SELECT slug FROM mine) GROUP BY slug)
  SELECT m.slug, m.kind, m.title_zh, m.title_en, m.status,
    COALESCE(t.total, 0) AS total, COALESCE(r.c, 0) AS last30,
    RANK() OVER (ORDER BY COALESCE(t.total, 0) DESC) AS rank
  FROM mine m LEFT JOIN totals t ON t.slug = m.slug LEFT JOIN recent r ON r.slug = m.slug
  ORDER BY rank, m.slug`

interface TotalRow { slug: string; kind: string; title_zh: string; title_en: string; status: string; total: number; last30: number; rank: number }
interface DayRow extends DayPoint { slug: string }

export async function creatorStats(db: D1Database, steamId: string, now: Date): Promise<CreatorStats> {
  const from = utcDay(now, -(TRENDING_DAYS - 1)); const to = utcDay(now)
  // One batch is one transaction: both answers describe the same moment.
  const [days, totals] = await db.batch<DayRow | TotalRow>([
    db.prepare(CREATOR_DAYS).bind(steamId, from, to),
    db.prepare(CREATOR_TOTALS).bind(steamId, from),
  ])
  const bySlug = new Map<string, DayPoint[]>()
  for (const r of days!.results as DayRow[]) {
    const list = bySlug.get(r.slug) ?? []
    list.push({ day: r.day, n: r.n, running: r.running, avg7: r.avg7 })
    bySlug.set(r.slug, list)
  }
  const items = (totals!.results as TotalRow[]).map(r => ({
    slug: r.slug, kind: r.kind, title: { zh: r.title_zh, en: r.title_en }, status: r.status,
    total: r.total, last30: r.last30, rank: r.rank, days: bySlug.get(r.slug) ?? [],
  }))
  return { from, to, items }
}

export interface AdminStats {
  top: { kind: string; slug: string; title: string; downloads: number; rank: number }[]
  weeks: { week: string; uploads: number; published: number; pending: number; rejected: number; withdrawn: number; hidden: number }[]
  queue: { pending: number; oldestHours: number | null }
  decisions: { approved: number; rejected: number; approvalRate: number | null; medianHours: number | null }
  recent: { at: string; actor: string; action: string; slug: string | null; creator: string | null; from: string | null; to: string | null; reason: string | null; title: string | null }[]
}

/** The weeks and the decisions it looks back over. */
export const ADMIN_WEEKS = 8
export const DECISION_DAYS = 90

// The five most requested live items of each kind over the last 30 days (ties share a place, so a
// kind can show more than five).
const TOP = `WITH recent AS (SELECT slug, SUM(count) AS c FROM download_daily WHERE day >= ?1 GROUP BY slug),
  ranked AS (
    SELECT i.kind, i.slug, i.title_en, r.c, RANK() OVER (PARTITION BY i.kind ORDER BY r.c DESC) AS rank
    FROM recent r JOIN item i ON i.slug = r.slug WHERE i.status = 'published'
  )
  SELECT kind, slug, title_en AS title, c AS downloads, rank FROM ranked WHERE rank <= 5 ORDER BY kind, rank, slug`

// Uploads per week (by upload time), split by where each one stands now.
const WEEKS = `SELECT strftime('%Y-W%W', uploaded_at) AS week, COUNT(*) AS uploads,
    SUM(status = 'published') AS published, SUM(status = 'pending') AS pending, SUM(status = 'rejected') AS rejected,
    SUM(status = 'withdrawn') AS withdrawn, SUM(status = 'hidden') AS hidden
  FROM item WHERE source = 'upload' AND uploaded_at >= ?1
  GROUP BY week ORDER BY week`

const QUEUE = `SELECT COUNT(*) AS pending, ROUND((julianday(?1) - julianday(MIN(uploaded_at))) * 24, 1) AS oldestHours
  FROM item WHERE status = 'pending'`

// Approvals and rejections since ?1, and the median hours from upload to that decision: the middle
// row, or the mean of the two middle rows, of the waits in order.
const DECISIONS = `WITH decided AS (
    SELECT l.action, (julianday(l.at) - julianday(i.uploaded_at)) * 24 AS hours
    FROM moderation_log l JOIN item i ON i.slug = l.slug
    WHERE l.action IN ('approve','reject') AND l.at >= ?1
  ),
  ordered AS (SELECT hours, ROW_NUMBER() OVER (ORDER BY hours) AS rn, COUNT(*) OVER () AS n FROM decided)
  SELECT
    (SELECT COUNT(*) FROM decided WHERE action = 'approve') AS approved,
    (SELECT COUNT(*) FROM decided WHERE action = 'reject') AS rejected,
    (SELECT ROUND(1.0 * SUM(action = 'approve') / NULLIF(COUNT(*), 0), 3) FROM decided) AS approvalRate,
    (SELECT ROUND(AVG(hours), 2) FROM ordered WHERE rn IN ((n + 1) / 2, (n + 2) / 2)) AS medianHours`

const RECENT = `SELECT l.at, l.actor, l.action, l.slug, l.creator, l.from_status AS "from", l.to_status AS "to", l.reason, i.title_en AS title
  FROM moderation_log l LEFT JOIN item i ON i.slug = l.slug
  ORDER BY l.at DESC, l.id DESC LIMIT 20`

export async function adminStats(db: D1Database, now: Date): Promise<AdminStats> {
  const weeksFrom = new Date(now.getTime() - ADMIN_WEEKS * 7 * 86_400_000).toISOString()
  const decisionsFrom = new Date(now.getTime() - DECISION_DAYS * 86_400_000).toISOString()
  const [top, weeks, queue, decisions, recent] = await db.batch([
    db.prepare(TOP).bind(utcDay(now, -(TRENDING_DAYS - 1))),
    db.prepare(WEEKS).bind(weeksFrom),
    db.prepare(QUEUE).bind(now.toISOString()),
    db.prepare(DECISIONS).bind(decisionsFrom),
    db.prepare(RECENT),
  ])
  return {
    top: top!.results as AdminStats['top'],
    weeks: weeks!.results as AdminStats['weeks'],
    queue: queue!.results[0] as AdminStats['queue'],
    decisions: decisions!.results[0] as AdminStats['decisions'],
    recent: recent!.results as AdminStats['recent'],
  }
}
