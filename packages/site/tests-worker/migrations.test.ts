import { applyD1Migrations } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { count, db, emptyDatabase, test } from './seed'

describe('the migrations', () => {
  it('are numbered without gaps, the order wrangler applies them in', () => {
    const names = test.TEST_MIGRATIONS.map(m => m.name)
    expect(names.length).toBeGreaterThanOrEqual(7)
    names.forEach((name, i) => expect(name).toMatch(new RegExp(`^${String(i + 1).padStart(4, '0')}_[a-z_]+\\.sql$`)))
  })

  it('bring a database made by 0001–0004 forward with its rows intact, and record each one once', async () => {
    await emptyDatabase(db)
    await applyD1Migrations(db, test.TEST_MIGRATIONS.slice(0, 4))
    // Rows as production held them before 0005: two rejected uploads whose names differ only in
    // case (allowed, since rejection frees a name), one live item and a day count.
    const insert = (slug: string, status: string, name: string) => db.prepare(
      `INSERT INTO item (slug, kind, status, title_zh, title_en, summary_zh, summary_en, author, licence, file_name, file_key, bytes, sha256, published_at, source, uploader, uploaded_at)
       VALUES (?, 'theme', ?, 't', 't', '', '', 'Sample author', 'CC0', ?, ?, 1, ?, '2026-10-01T00:00:00.000Z', 'upload', '76561198000000043', '2026-10-01T00:00:00.000Z')`,
    ).bind(slug, status, name, `files/${slug}/${name}`, 'b'.repeat(64))
    await db.batch([insert('night', 'rejected', 'night.json'), insert('night-2', 'rejected', 'NIGHT.json'), insert('day', 'published', 'day.json'),
      db.prepare("INSERT INTO download_daily (slug, day, count) VALUES ('day', '2026-10-02', 7)")])

    await applyD1Migrations(db, test.TEST_MIGRATIONS)
    const { results } = await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>()
    expect(results.map(r => r.name)).toEqual(test.TEST_MIGRATIONS.map(m => m.name))
    expect(await count('SELECT COUNT(*) AS c FROM item')).toBe(3)
    expect(await count("SELECT count AS c FROM download_daily WHERE slug = 'day'")).toBe(7)
    // Applying again changes nothing: each migration runs once.
    await applyD1Migrations(db, test.TEST_MIGRATIONS)
    expect(await count('SELECT COUNT(*) AS c FROM d1_migrations')).toBe(test.TEST_MIGRATIONS.length)
    // From 0005 on, a second live item cannot take a name that is live, in any case.
    await expect(insert('day-2', 'pending', 'DAY.json').run()).rejects.toThrow(/UNIQUE constraint failed/)
    await insert('night-3', 'pending', 'Night.json').run()
  })
})
