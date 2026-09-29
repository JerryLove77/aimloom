/** The new indexes are the ones SQLite actually picks for the queries they were made for. */
import { describe, expect, it } from 'vitest'
import { db } from './seed'

const plan = async (sql: string, ...args: unknown[]) =>
  (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results.map(r => r.detail).join(' | ')

describe('query plans', () => {
  it('the live-name check searches item_live_name instead of scanning item', async () => {
    const p = await plan("SELECT COUNT(*) AS c FROM item WHERE kind = ? AND file_name = ? COLLATE NOCASE AND status IN ('published','pending','hidden')", 'theme', 'x.json')
    expect(p).toMatch(/SEARCH item USING (COVERING )?INDEX item_live_name/)
  })
  it('the oldest day and the rollup\'s delete use download_daily_day', async () => {
    expect(await plan('SELECT MIN(day) AS d FROM download_daily')).toMatch(/SEARCH download_daily USING COVERING INDEX download_daily_day/)
    expect(await plan('DELETE FROM download_daily WHERE day < ?', '2026-07-22')).toMatch(/SEARCH download_daily USING (COVERING )?INDEX download_daily_day \(day<\?\)/)
  })
  it('the log retention uses moderation_log_at', async () => {
    expect(await plan('DELETE FROM moderation_log WHERE at < ?', '2025-10-20')).toMatch(/SEARCH moderation_log USING (COVERING )?INDEX moderation_log_at \(at<\?\)/)
  })
})
