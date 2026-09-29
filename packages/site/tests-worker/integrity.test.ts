/** The write rules the database now enforces itself, checked one statement at a time. */
import { describe, expect, it } from 'vitest'
import { fileKeyInUse, freeSlug, insertItem, setTrusted, transition } from '../src/worker/catalogue'
import { ADMIN, count, CREATOR, db, itemRow, logRows, NOW, OTHER, seedItems } from './seed'

const DAY_START = '2026-10-20T00:00:00.000Z'
const at = NOW.toISOString()

describe('freeSlug', () => {
  it('finds the first free candidate in one statement, gaps included', async () => {
    await seedItems({ slug: 'night-blue' }, { slug: 'night-blue-2', file_name: 'x.json' }, { slug: 'dot' }, { slug: 'dot-3', file_name: 'y.json' })
    expect(await freeSlug(db, 'Night Blue.json')).toBe('night-blue-3')
    expect(await freeSlug(db, 'dot.json')).toBe('dot-2')
    expect(await freeSlug(db, 'fresh.json')).toBe('fresh')
  })
  it('never hands out an explorer path or a Windows device name', async () => {
    expect(await freeSlug(db, 'upload.json')).toMatch(/^u-[0-9a-f]{8}$/)
    expect(await freeSlug(db, 'CON.json')).toMatch(/^u-[0-9a-f]{8}$/)
    expect(await freeSlug(db, '夜.json')).toMatch(/^u-[0-9a-f]{8}$/)
  })
})

describe('insertItem', () => {
  it('refuses a live name in any case, and frees it once the item is rejected', async () => {
    expect(await insertItem(db, itemRow({ slug: 'a', file_name: 'Small dot.png', kind: 'crosshair' }), 10, DAY_START)).toBe('ok')
    expect(await insertItem(db, itemRow({ slug: 'b', file_name: 'SMALL DOT.png', kind: 'crosshair' }), 10, DAY_START)).toBe('duplicate')
    // Another kind may use the name.
    expect(await insertItem(db, itemRow({ slug: 'c', file_name: 'small dot.png', kind: 'theme' }), 10, DAY_START)).toBe('ok')
    await db.prepare("UPDATE item SET status = 'rejected' WHERE slug = 'a'").run()
    expect(await insertItem(db, itemRow({ slug: 'b', file_name: 'SMALL DOT.png', kind: 'crosshair' }), 10, DAY_START)).toBe('ok')
  })
  it('stops at the daily limit inside the insert itself; earlier days do not count', async () => {
    const today = (i: number) => itemRow({ slug: `t${i}`, uploaded_at: `2026-10-20T0${i % 10}:00:00.000Z` })
    await seedItems({ slug: 'yesterday', uploaded_at: '2026-10-19T23:59:59.000Z' })
    for (let i = 0; i < 3; i++) expect(await insertItem(db, today(i), 3, DAY_START)).toBe('ok')
    expect(await insertItem(db, today(3), 3, DAY_START)).toBe('limit')
    expect(await count('SELECT COUNT(*) AS c FROM item WHERE uploader = ?', CREATOR)).toBe(4)
    // The limit is per uploader.
    expect(await insertItem(db, { ...today(4), uploader: OTHER }, 3, DAY_START)).toBe('ok')
  })
  it('holds the limit when the inserts race each other', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => insertItem(db, itemRow({ slug: `r${i}`, uploaded_at: at }), 5, DAY_START)))
    expect(results.filter(r => r === 'ok')).toHaveLength(5)
    expect(results.filter(r => r === 'limit')).toHaveLength(3)
    expect(await count('SELECT COUNT(*) AS c FROM item')).toBe(5)
  })
  it('says `slug` when the slug was taken meanwhile, and lets any other failure through', async () => {
    await seedItems({ slug: 'taken' })
    expect(await insertItem(db, itemRow({ slug: 'taken', file_name: 'other.json' }), 10, DAY_START)).toBe('slug')
    await expect(insertItem(db, { ...itemRow({ slug: 'bad' }), bytes: 0 }, 10, DAY_START)).rejects.toThrow(/CHECK constraint failed/)
  })
})

describe('transition', () => {
  const approve = { slug: 's', from: 'pending', to: 'published', action: 'approve', actor: ADMIN, at } as const
  it('changes the item and logs it once; the same move again finds nothing to change', async () => {
    await seedItems({ slug: 's', status: 'pending' })
    expect(await transition(db, { ...approve, publishedAt: at, fileKey: 'files/new/s.json' })).toBe(true)
    expect(await db.prepare("SELECT status, published_at, file_key FROM item WHERE slug = 's'").first()).toEqual({ status: 'published', published_at: at, file_key: 'files/new/s.json' })
    expect(await transition(db, approve)).toBe(false)
    expect(await logRows()).toEqual([{ actor: ADMIN, action: 'approve', slug: 's', creator: null, from_status: 'pending', to_status: 'published', reason: null }])
  })
  it('lets exactly one of two racing decisions through, and logs only that one', async () => {
    await seedItems({ slug: 's', status: 'pending' })
    const [a, b] = await Promise.all([transition(db, approve), transition(db, { ...approve, to: 'rejected', action: 'reject', reason: 'Too dark' })])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    const status = await db.prepare("SELECT status FROM item WHERE slug = 's'").first<string>('status')
    expect(await logRows()).toEqual([expect.objectContaining({ to_status: status })])
  })
  it('lets only the owner withdraw', async () => {
    await seedItems({ slug: 's', status: 'pending' })
    const withdraw = { slug: 's', from: 'pending', to: 'withdrawn', action: 'withdraw', at } as const
    expect(await transition(db, { ...withdraw, actor: OTHER, owner: OTHER })).toBe(false)
    expect(await transition(db, { ...withdraw, actor: CREATOR, owner: CREATOR })).toBe(true)
    expect(await logRows()).toEqual([expect.objectContaining({ actor: CREATOR, action: 'withdraw', from_status: 'pending', to_status: 'withdrawn' })])
  })
})

describe('setTrusted', () => {
  it('logs a change only, counting an unknown creator as untrusted', async () => {
    expect(await setTrusted(db, CREATOR, false, ADMIN, NOW)).toBe(false)
    expect(await setTrusted(db, CREATOR, true, ADMIN, NOW)).toBe(true)
    expect(await setTrusted(db, CREATOR, true, ADMIN, NOW)).toBe(false)
    expect(await setTrusted(db, CREATOR, false, ADMIN, NOW)).toBe(true)
    expect((await logRows()).map(r => r.action)).toEqual(['trust', 'untrust'])
    expect(await count('SELECT trusted AS c FROM creator WHERE steam_id = ?', CREATOR)).toBe(0)
  })
})

describe('fileKeyInUse', () => {
  it('sees a key held by an item in any status', async () => {
    await seedItems({ slug: 'gone', status: 'withdrawn' })
    expect(await fileKeyInUse(db, itemRow({ slug: 'gone' }).file_key)).toBe(true)
    expect(await fileKeyInUse(db, 'files/nobody/x.json')).toBe(false)
  })
})
