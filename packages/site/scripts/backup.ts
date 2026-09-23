/**
 * npm run site:backup -w @kvk/site -- [--out <folder>]
 *
 * A local copy of the explorer, for the maintainer's weekly look (user, 2026-09-23: Cloudflare's
 * 7-day Time Travel is enough when this runs about once a week). It writes, under
 * `<out>/<date>/`: the production database as SQL (every table — keep the folder private and out
 * of git), and every uploaded file the database points at, from both buckets. Files are
 * content-addressed, so a file already in any earlier backup is copied from there, not downloaded.
 * Default <out>: the maintainer's private records, `private/backups/` at the repository root.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { backupPlan, type ItemRow } from './backup-lib'

const SITE_DIR = resolve(import.meta.dirname, '..')

function wrangler(args: string[], capture = false): string {
  const r = spawnSync('npx', ['wrangler', ...args, '--config', '.wrangler.generated.jsonc', '--env='], { cwd: SITE_DIR, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} exited with ${r.status}`)
  return r.stdout ?? ''
}

/** Finds `key` in an earlier backup of `root`, if any. */
function earlier(root: string, key: string, except: string): string | null {
  for (const day of readdirSync(root).sort().reverse()) {
    if (day === except) continue
    const p = join(root, day, 'files', key)
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

function main(): void {
  const i = process.argv.indexOf('--out')
  const root = resolve(i > 0 ? process.argv[i + 1]! : join(SITE_DIR, '..', '..', 'private', 'backups'))
  if (i < 0 && !existsSync(join(root, '..'))) throw new Error(`no private records folder at ${dirname(root)}; pass --out <folder>`)
  const day = new Date().toISOString().slice(0, 10)
  const dir = join(root, day)
  mkdirSync(join(dir, 'files'), { recursive: true })
  if (spawnSync('node', ['scripts/wrangler-config.mjs'], { cwd: SITE_DIR, stdio: 'inherit' }).status !== 0) throw new Error('could not generate the wrangler config')

  console.log(`database → ${join(dir, 'aimloom.sql')}`)
  wrangler(['d1', 'export', 'aimloom', '--remote', '--output', join(dir, 'aimloom.sql')])

  const out = wrangler(['d1', 'execute', 'aimloom', '--remote', '--json', '--command', 'SELECT kind, status, file_key, sha256 FROM item'], true)
  const rows = (JSON.parse(out) as { results: ItemRow[] }[])[0]?.results ?? []
  const plan = backupPlan(rows)
  let copied = 0, fetched = 0
  for (const { bucket, key } of plan) {
    const target = join(dir, 'files', key)
    mkdirSync(dirname(target), { recursive: true })
    const old = earlier(root, key, day)
    if (old) { copyFileSync(old, target); copied++; continue }
    wrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', target])
    fetched++
  }
  console.log(`${rows.length} items, ${plan.length} files (${fetched} downloaded, ${copied} from earlier backups) → ${dir}`)
}

try { main() } catch (e) { console.error(`backup failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1) }
