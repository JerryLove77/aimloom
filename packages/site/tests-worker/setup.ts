import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'
import reports from '../migrations/0001_reports.sql?raw'
import catalogue from '../migrations/0002_catalogue.sql?raw'
import uploads from '../migrations/0003_uploads.sql?raw'

// Comments go first (whole-line and trailing): a ';' inside one must not split a statement.
const statements = (sql: string): string[] => sql.replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB
  await db.batch([
    ...['download_daily', 'download_daily_new', 'item', 'item_new', 'session', 'creator', 'reports'].map(t => db.prepare(`DROP TABLE IF EXISTS ${t}`)),
    ...[...statements(reports), ...statements(catalogue), ...statements(uploads)].map(s => db.prepare(s)),
  ])
})
