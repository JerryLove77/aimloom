import { describe, expect, it } from 'vitest'
import { listItems, parseListQuery } from '../src/worker/catalogue'
import { db, NOW, seedDays, seedItems } from './seed'

describe('catalogue search', () => {
  it.each(['a'.repeat(64), '中'.repeat(64), '😀'.repeat(32), '%'.repeat(25), '_'.repeat(25), '\\'.repeat(25)])('finds a literal long query: %s', async q => {
    await seedItems({ slug: 'match', title_en: `prefix ${q} suffix` }, { slug: 'other', title_en: 'unrelated title' })
    const result = await listItems(db, parseListQuery(new URLSearchParams({ q })), NOW)
    expect(result.total).toBe(1); expect(result.items.map(i => i.slug)).toEqual(['match'])
  })
  it('keeps ASCII case folding and treats SQL syntax and wildcards literally', async () => {
    await seedItems({ slug: 'match', title_en: "Warm 100%_\\ ' OR 1=1 --" }, { slug: 'other' })
    for (const q of ['warm', '%_', '\\', "' OR 1=1 --"]) {
      const result = await listItems(db, parseListQuery(new URLSearchParams({ q })), NOW)
      expect(result.items.map(i => i.slug)).toEqual(['match'])
    }
  })
})

describe('catalogue listing', () => {
  it('does not aggregate downloads for latest, but still ranks by them for popular', async () => {
    await seedItems({ slug: 'a' }, { slug: 'b' })
    await seedDays('b', [['2026-09-01', 1], ['2026-10-20', 9]])
    const plans: string[] = []
    // Observe the real query and bound parameters; all execution still goes to D1.
    const observed = { prepare(sql: string) {
      const statement = db.prepare(sql)
      if (!sql.startsWith('SELECT i.*')) return statement
      return { bind(...args: unknown[]) { return { async all() {
        const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()
        plans.push(plan.results.map(r => r.detail).join(' | '))
        return statement.bind(...args).all()
      } } } }
    } } as unknown as D1Database
    const latest = await listItems(observed, { kind: 'theme', q: '', sort: 'new', page: 1 }, NOW)
    expect(latest.items.map(i => i.slug)).toEqual(['a', 'b'])
    expect(plans[0]).not.toMatch(/download_daily|MATERIALIZE/)
    const popular = await listItems(observed, { kind: 'theme', q: '', sort: 'popular', page: 1 }, NOW)
    expect(popular.items.map(i => i.slug)).toEqual(['b', 'a'])
    expect(plans[1]).toMatch(/download_daily/)
  })
  it.each(['new', 'popular'] as const)('paginates equal timestamps deterministically for %s with search', async sort => {
    const slugs = Array.from({ length: 49 }, (_, i) => `item-${String(i).padStart(2, '0')}`)
    await seedItems(...slugs.map(slug => ({ slug, title_en: 'Match' })), { slug: 'unrelated', title_en: 'Other' })
    await seedDays(slugs[0]!, [['2026-09-01', 1]])
    const results = await Promise.all([1, 2, 3].map(page => listItems(db, { kind: 'theme', q: 'match', sort, page }, NOW)))
    expect(results.map(r => r.items.length)).toEqual([24, 24, 1])
    expect(results.flatMap(r => r.items.map(i => i.slug))).toEqual(slugs)
    for (const r of results) expect([r.total, r.pages]).toEqual([49, 3])
  })
})
