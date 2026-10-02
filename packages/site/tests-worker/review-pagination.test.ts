import { describe, expect, it } from 'vitest'
import { liveItems, pendingItems } from '../src/worker/catalogue'
import { CREATOR, OTHER, db, seedItems } from './seed'

describe('review pagination', () => {
  it('seeks a deep page even when thousands of upload times are equal', async () => {
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<4999)
      INSERT INTO item (slug,kind,status,title_zh,title_en,summary_zh,summary_en,author,licence,file_name,file_key,bytes,sha256,published_at,uploaded_at)
      SELECT printf('item-%04d',i),'theme','pending','sample','Sample','','','Sample author','CC0',printf('item-%04d.json',i),printf('files/%04d',i),1,?,
        '2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z' FROM n`).bind('a'.repeat(64)).run()
    let read = 0
    const observed = { prepare(sql: string) { return { bind(...args: unknown[]) { return { async all() {
      const result = await db.prepare(sql).bind(...args).all(); read = result.meta.rows_read; return result
    } } } } } } as unknown as D1Database
    const page = await pendingItems(observed,{at:'2026-10-01T00:00:00.000Z',slug:'item-4900'})
    expect(page.items).toHaveLength(24); expect(page.items[0]!.slug).toBe('item-4901')
    // No uploader history in this fixture: only the page and its small temporary results are read.
    expect(read).toBeLessThan(1000)
  })
  it('uses page indexes and aggregates uploaders once instead of correlated subqueries', async () => {
    await seedItems({slug:'pending',status:'pending'},{slug:'live'})
    const plans: string[] = []
    const observed = { prepare(sql: string) { return { bind(...args: unknown[]) { return { async all() {
      const p = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{detail:string}>()
      plans.push(p.results.map(r=>r.detail).join(' | '))
      return db.prepare(sql).bind(...args).all()
    } } } } } } as unknown as D1Database
    await pendingItems(observed,{at:'2026-10-01T00:00:00.000Z',slug:'a'})
    await liveItems(observed,{at:'2026-10-01T00:00:00.000Z',slug:'z'})
    expect(plans[0]).toMatch(/item_pending_page/); expect(plans[0]).toMatch(/item_uploader/)
    expect(plans[0]).not.toMatch(/CORRELATED SCALAR SUBQUERY/)
    expect(plans[1]).toMatch(/item_live_page/); expect(plans[1]).not.toMatch(/TEMP B-TREE/)
  })
  it('pages equal upload times without skips when earlier rows are moderated', async () => {
    const slugs = Array.from({ length: 53 }, (_, i) => `pending-${String(i).padStart(2, '0')}`)
    await seedItems(...slugs.map(slug => ({ slug, status: 'pending' as const })))
    const first = await pendingItems(db)
    expect(first).toMatchObject({ items: expect.any(Array), next: expect.any(Object) })
    expect(first.items.map(i => i.slug)).toEqual(slugs.slice(0, 24))
    await db.prepare("UPDATE item SET status='rejected' WHERE slug <= 'pending-23'").run()
    const second = await pendingItems(db, first.next)
    const third = await pendingItems(db, second.next)
    expect([...second.items, ...third.items].map(i => i.slug)).toEqual(slugs.slice(24))
    expect(third.next).toBeNull()
  })
  it('pages live files past the former 100-row cap, with stable ties', async () => {
    const slugs = Array.from({ length: 105 }, (_, i) => `live-${String(i).padStart(3, '0')}`).reverse()
    await seedItems(...slugs.map(slug => ({ slug })))
    let page = await liveItems(db)
    expect(page).toMatchObject({ items: expect.any(Array), next: expect.any(Object) })
    const seen = page.items.map(i => i.slug)
    for (let n = 0; page.next && n < 10; n++) {
      page = await liveItems(db, page.next); expect(page.items.length).toBeLessThanOrEqual(24)
      seen.push(...page.items.map(i => i.slug))
    }
    expect(seen).toEqual(slugs); expect(page.next).toBeNull()
  })
  it('keeps uploader totals across all statuses and handles unknown upload times', async () => {
    await seedItems({ slug: 'old', status: 'pending', uploaded_at: null }, { slug: 'pending', status: 'pending' },
      { slug: 'published' }, { slug: 'rejected', status: 'rejected' }, { slug: 'other', uploader: OTHER },
      { slug: 'anonymous', status: 'pending', uploader: null, uploaded_at: null })
    const page = await pendingItems(db)
    expect(page).toMatchObject({ items: expect.any(Array), next: null })
    expect(page.items.map(i => i.slug)).toEqual(['anonymous', 'old', 'pending'])
    for (const row of page.items.filter(i => i.uploader === CREATOR)) expect([row.uploader_total, row.uploader_live]).toEqual([4, 1])
    expect(page.items[0]).toMatchObject({ uploader_total: 0, uploader_live: 0 })
  })
})
