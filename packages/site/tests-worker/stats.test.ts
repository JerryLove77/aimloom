import { describe, expect, it } from 'vitest'
import { createSession } from '../src/worker/auth'
import { popularAvailable, rollupDownloads, utcDay } from '../src/worker/catalogue'
import { handleExplore } from '../src/worker/explore'
import type { AppEnv } from '../src/worker/env'
import { adminStats, creatorStats } from '../src/worker/stats'
import { ADMIN, count, CREATOR, db, NOW, OTHER, seedDays, seedItems, seedMonths, test } from './seed'

// NOW is 2026-10-20, so the 30 days shown run from 2026-09-21; 09-15 … 09-20 only feed the 7-day average.
async function seedCreator(): Promise<void> {
  await seedItems(
    { slug: 'a', title_en: 'Alpha' }, { slug: 'b', status: 'hidden', file_name: 'b.json' }, { slug: 'd', file_name: 'd.json' },
    { slug: 'c', status: 'pending', file_name: 'c.json' }, { slug: 'x', uploader: OTHER, file_name: 'x.json' },
  )
  await seedDays('a', [['2026-09-15', 7], ['2026-09-21', 3], ['2026-09-23', 4], ['2026-10-20', 1]])
  await seedMonths('a', [['2026-05', 10]])
  await seedMonths('d', [['2026-06', 25]])
  await seedDays('x', [['2026-10-20', 99]])
}

describe('a creator\'s statistics', () => {
  it('fill every day of the last 30 with a count, a running total and a 7-day average', async () => {
    await seedCreator()
    const s = await creatorStats(db, CREATOR, NOW)
    expect(s).toMatchObject({ from: '2026-09-21', to: '2026-10-20' })
    const a = s.items.find(i => i.slug === 'a')!
    expect(a.days).toHaveLength(30)
    expect(a.days.slice(0, 3)).toEqual([
      // 09-15's 7 is outside the shown days but inside the first day's 7-day window: (7 + 3) / 7.
      { day: '2026-09-21', n: 3, running: 3, avg7: 1.43 },
      { day: '2026-09-22', n: 0, running: 3, avg7: 0.43 },
      { day: '2026-09-23', n: 4, running: 7, avg7: 1 },
    ])
    expect(a.days.at(-1)).toEqual({ day: '2026-10-20', n: 1, running: 8, avg7: 0.14 })
    expect(s.items.find(i => i.slug === 'b')!.days.every(d => d.n === 0 && d.running === 0)).toBe(true)
  })
  it('total each item across months and days, and rank them with ties sharing a place', async () => {
    await seedCreator()
    const s = await creatorStats(db, CREATOR, NOW)
    // a: 10 (May) + 7 + 3 + 4 + 1 = 25, the same as d's 25 in June; b has none.
    expect(s.items.map(i => [i.slug, i.total, i.last30, i.rank, i.status])).toEqual([
      ['a', 25, 8, 1, 'published'], ['d', 25, 0, 1, 'published'], ['b', 0, 0, 3, 'hidden'],
    ])
    expect(s.items[0]!.title).toEqual({ zh: '标题 a', en: 'Alpha' })
  })
  it('show only the creator\'s own live or hidden items', async () => {
    await seedCreator()
    expect((await creatorStats(db, CREATOR, NOW)).items.map(i => i.slug).sort()).toEqual(['a', 'b', 'd'])
    expect((await creatorStats(db, OTHER, NOW)).items.map(i => i.slug)).toEqual(['x'])
    expect((await creatorStats(db, ADMIN, NOW)).items).toEqual([])
  })
})

describe('the monthly rollup', () => {
  it('moves days older than 90 into months, once, without changing any total', async () => {
    await seedItems({ slug: 'a' })
    const days = Array.from({ length: 120 }, (_, i) => [utcDay(NOW, -i - 1), 1] as [string, number])
    await seedDays('a', days)
    await seedMonths('a', [['2026-01', 5]])
    const totalBefore = (await creatorStats(db, CREATOR, NOW)).items[0]!.total
    await rollupDownloads(db, NOW)
    await rollupDownloads(db, NOW) // a second run finds nothing left to move
    const cutoff = utcDay(NOW, -90)
    expect(await count('SELECT COUNT(*) AS c FROM download_daily WHERE day < ?', cutoff)).toBe(0)
    expect(await count('SELECT COUNT(*) AS c FROM download_daily')).toBe(90)
    expect(await count('SELECT SUM(count) AS c FROM download_monthly')).toBe(5 + 30)
    expect((await creatorStats(db, CREATOR, NOW)).items[0]!.total).toBe(totalBefore)
    expect(totalBefore).toBe(125)
  })
  it('keeps "most downloaded" available once the oldest days are months', async () => {
    await seedItems({ slug: 'a' })
    await seedMonths('a', [['2026-06', 3]])
    expect(await popularAvailable(db, NOW)).toBe(true)
  })
})

describe('the admin statistics', () => {
  it('rank the top items per kind, count the queue and time the decisions', async () => {
    const hoursAfter = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3_600_000).toISOString()
    const up = '2026-10-10T00:00:00.000Z'
    await seedItems(
      { slug: 't1' }, { slug: 't2', file_name: 't2.json' }, { slug: 's1', kind: 'sound', file_name: 's1.ogg' },
      { slug: 'p1', status: 'pending', file_name: 'p1.json', uploaded_at: '2026-10-19T12:00:00.000Z' },
      ...['r1', 'r2', 'r3', 'r4'].map(slug => ({ slug, status: 'rejected' as const, file_name: `${slug}.json`, uploaded_at: up })),
    )
    await seedDays('t1', [['2026-10-18', 5]]); await seedDays('t2', [['2026-10-18', 5]]); await seedDays('s1', [['2026-10-01', 2]])
    // Waits of 1, 2, 4 and 10 hours: the median is (2 + 4) / 2.
    await db.batch([['r1', 'approve', 1], ['r2', 'approve', 2], ['r3', 'reject', 4], ['r4', 'approve', 10]].map(([slug, action, h]) =>
      db.prepare('INSERT INTO moderation_log (at, actor, action, slug, from_status, to_status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(hoursAfter(up, h as number), ADMIN, action, slug, 'pending', action === 'approve' ? 'published' : 'rejected')))
    const s = await adminStats(db, NOW)
    expect(s.top).toEqual([
      { kind: 'sound', slug: 's1', title: 'Title s1', downloads: 2, rank: 1 },
      { kind: 'theme', slug: 't1', title: 'Title t1', downloads: 5, rank: 1 },
      { kind: 'theme', slug: 't2', title: 'Title t2', downloads: 5, rank: 1 },
    ])
    expect(s.queue).toEqual({ pending: 1, oldestHours: 24 })
    expect(s.decisions).toEqual({ approved: 3, rejected: 1, approvalRate: 0.75, medianHours: 3 })
    expect(s.recent.map(r => r.slug)).toEqual(['r4', 'r3', 'r2', 'r1'])
    expect(s.weeks.reduce((n, w) => n + w.uploads, 0)).toBe(8)
  })
  it('answer an empty site with zeros and nulls, not errors', async () => {
    const s = await adminStats(db, NOW)
    expect(s).toEqual({ top: [], weeks: [], queue: { pending: 0, oldestHours: null }, decisions: { approved: 0, rejected: 0, approvalRate: null, medianHours: null }, recent: [] })
  })
})

describe('the statistics endpoints', () => {
  const env = { DB: test.DB, FILES: test.FILES, UPLOADS: test.UPLOADS, ADMIN_STEAM_IDS: ADMIN, FILES_ORIGIN: 'https://dl.test.invalid' } as unknown as AppEnv
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
  const get = async (path: string, steamId?: string) => {
    const headers = steamId ? { cookie: `aimloom_session=${await createSession(env, steamId, NOW)}` } : undefined
    return (await handleExplore(new Request(`https://aimloom.dev${path}`, headers ? { headers } : {}), env, ctx, NOW))!
  }
  it('give a creator their own numbers, privately, and nobody else\'s', async () => {
    await seedCreator()
    expect((await get('/api/explore/mine/stats')).status).toBe(401)
    const r = await get('/api/explore/mine/stats', CREATOR)
    expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store')
    const body = await r.json() as { items: { slug: string }[] }
    expect(body.items.map(i => i.slug).sort()).toEqual(['a', 'b', 'd'])
    expect(JSON.stringify(body)).not.toContain(CREATOR)
  })
  it('show the admin view to admins only, as the review page does', async () => {
    expect((await get('/api/explore/admin/stats')).status).toBe(404)
    expect((await get('/api/explore/admin/stats', CREATOR)).status).toBe(404)
    const r = await get('/api/explore/admin/stats', ADMIN)
    expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(Object.keys(await r.json() as object)).toEqual(['top', 'weeks', 'queue', 'decisions', 'recent'])
  })
})
