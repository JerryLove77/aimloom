import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'
import reports from '../migrations/0001_reports.sql?raw'
import catalogue from '../migrations/0002_catalogue.sql?raw'

const statements = (sql: string): string[] => sql.split(';').map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB
  await db.batch([
    ...['download_daily', 'item', 'reports'].map(t => db.prepare(`DROP TABLE IF EXISTS ${t}`)),
    ...[...statements(reports), ...statements(catalogue)].map(s => db.prepare(s)),
  ])
})
