import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'
import schema from '../migrations/0001_reports.sql?raw'

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB
  await db.batch([db.prepare('DROP TABLE IF EXISTS reports'), ...schema.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s))])
})
