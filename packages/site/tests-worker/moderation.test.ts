/** What the moderation log's own constraints refuse, and how long it keeps rows. */
import { describe, expect, it } from 'vitest'
import { deleteOldModerationLog } from '../src/worker/catalogue'
import { ADMIN, count, CREATOR, db, NOW, seedItems } from './seed'

const insert = (fields: { at?: string; action: string; slug?: string | null; creator?: string | null }) => db.prepare(
  'INSERT INTO moderation_log (at, actor, action, slug, creator) VALUES (?, ?, ?, ?, ?)',
).bind(fields.at ?? NOW.toISOString(), ADMIN, fields.action, fields.slug ?? null, fields.creator ?? null).run()

describe('the moderation log', () => {
  it('holds an item action to an item and a trust action to a creator, and only known items', async () => {
    await seedItems({ slug: 'a' })
    await insert({ action: 'approve', slug: 'a' }); await insert({ action: 'trust', creator: CREATOR })
    await expect(insert({ action: 'approve', creator: CREATOR })).rejects.toThrow(/CHECK constraint failed/)
    await expect(insert({ action: 'trust', slug: 'a' })).rejects.toThrow(/CHECK constraint failed/)
    await expect(insert({ action: 'approve', slug: 'a', creator: CREATOR })).rejects.toThrow(/CHECK constraint failed/)
    await expect(insert({ action: 'delete', slug: 'a' })).rejects.toThrow(/CHECK constraint failed/)
    await expect(insert({ action: 'approve', slug: 'nothing' })).rejects.toThrow(/FOREIGN KEY constraint failed/)
  })
  it('keeps a row for 365 days', async () => {
    await seedItems({ slug: 'a' })
    const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
    await insert({ action: 'hide', slug: 'a', at: daysAgo(366) }); await insert({ action: 'hide', slug: 'a', at: daysAgo(364) })
    await deleteOldModerationLog(db, NOW)
    expect(await count('SELECT COUNT(*) AS c FROM moderation_log')).toBe(1)
    expect(await count('SELECT COUNT(*) AS c FROM moderation_log WHERE at = ?', daysAgo(364))).toBe(1)
  })
})
