/**
 * npm run site:publish -w @kvk/site -- <folder> [--env production] [--dry-run]
 *
 * The explorer's only writer (spec 2026-09-22 §6). <folder> holds `item.json` and exactly one
 * other file. Every check runs before anything is uploaded; the target is preview unless
 * `--env production` is given; a production publish exports the database to backups/ first.
 * Uploads and writes go through the maintainer's `wrangler login` — no token is read here.
 * The permission evidence for the file stays in the maintainer's private records.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildRow, checkFile, parseManifest, PublishError, upsertSql, uploadsFor, type Upload } from './publish-lib'

const SITE_DIR = resolve(import.meta.dirname, '..')
const BUCKET = 'aimloom-files'
const DATABASE = { production: 'aimloom', preview: 'aimloom-preview' } as const

function args(argv: string[]): { folder: string; env: 'production' | 'preview'; dryRun: boolean } {
  const rest = [...argv]
  let env: 'production' | 'preview' = 'preview'; let dryRun = false; let folder: string | null = null
  while (rest.length) {
    const a = rest.shift()!
    if (a === '--dry-run') dryRun = true
    else if (a === '--env') { const v = rest.shift(); if (v !== 'production' && v !== 'preview') throw new PublishError('--env takes production or preview'); env = v }
    else if (a.startsWith('--')) throw new PublishError(`unknown option ${a}`)
    else if (folder === null) folder = a
    else throw new PublishError('give one folder')
  }
  if (folder === null) throw new PublishError('usage: site:publish -- <folder> [--env production] [--dry-run]')
  return { folder: resolve(folder), env, dryRun }
}

function wrangler(argv: string[], env: 'production' | 'preview', dryRun: boolean): void {
  const full = [...argv, '--config', '.wrangler.generated.jsonc', env === 'production' ? '--env=' : '--env=preview']
  console.log(`${dryRun ? '[dry run] ' : ''}wrangler ${full.join(' ')}`)
  if (dryRun) return
  const r = spawnSync('npx', ['wrangler', ...full], { cwd: SITE_DIR, stdio: 'inherit' })
  if (r.status !== 0) throw new PublishError(`wrangler exited with ${r.status}; nothing after this step ran`)
}

async function main(): Promise<void> {
  const { folder, env, dryRun } = args(process.argv.slice(2))
  const names = readdirSync(folder).filter(n => !n.startsWith('.'))
  if (!names.includes('item.json')) throw new PublishError('the folder has no item.json')
  const files = names.filter(n => n !== 'item.json')
  if (files.length !== 1) throw new PublishError(`the folder must hold item.json and exactly one file; it holds ${files.length} other entries`)
  const fileName = files[0]!
  const filePath = join(folder, fileName)
  if (!statSync(filePath).isFile()) throw new PublishError(`${fileName} is not a file`)

  // 1–3. Every check, before anything leaves this machine.
  const manifest = parseManifest(readFileSync(join(folder, 'item.json')))
  // Strict: every byte accounted for; a crosshair is published re-encoded (only its pixels survive).
  const { bytes, previews } = await checkFile(manifest.kind, fileName, new Uint8Array(readFileSync(filePath)))
  const row = buildRow(manifest, fileName, bytes, new Date().toISOString())
  const uploads: Upload[] = uploadsFor(row, null, previews, bytes)
  console.log(`checked: ${row.kind} "${row.title_en}" → ${row.file_key} (${row.bytes} bytes, sha256 ${row.sha256}); target ${env}`)

  execute(env, dryRun, row.slug, uploads, upsertSql(row))
  console.log(`${dryRun ? '[dry run] would publish' : 'published'} /zh/explore/${row.slug}/ and /en/explore/${row.slug}/ (${env})`)
}

function execute(env: 'production' | 'preview', dryRun: boolean, slug: string, uploads: Upload[], sql: string): void {
  if (!dryRun) {
    const r = spawnSync('node', ['scripts/wrangler-config.mjs'], { cwd: SITE_DIR, stdio: 'inherit' })
    if (r.status !== 0) throw new PublishError('could not generate the wrangler config (see above)')
  }
  const work = mkdtempSync(join(tmpdir(), 'aimloom-publish-'))
  try {
    if (env === 'production') {
      mkdirSync(join(SITE_DIR, 'backups'), { recursive: true })
      wrangler(['d1', 'export', DATABASE.production, '--remote', '--output', `backups/${new Date().toISOString().replace(/[:.]/g, '-')}-before-${slug}.sql`], env, dryRun)
    }
    // 4. Files first, then the row: a row never points at a file that is not there yet.
    for (const u of uploads) {
      let path = u.path
      if (!path) { path = join(work, u.key.replace(/\//g, '_')); writeFileSync(path, u.body!) }
      wrangler(['r2', 'object', 'put', `${BUCKET}/${u.key}`, '--file', path, '--content-type', u.contentType,
        '--cache-control', 'public, max-age=31536000, immutable', '--content-disposition', u.disposition, '--remote'], env, dryRun)
    }
    const sqlPath = join(work, 'item.sql'); writeFileSync(sqlPath, sql)
    if (dryRun) console.log(sql.trim())
    wrangler(['d1', 'execute', DATABASE[env], '--remote', '--file', sqlPath], env, dryRun)
  } finally { rmSync(work, { recursive: true, force: true }) }
}

main().catch((e: unknown) => {
  // 5. A refusal names its reason and changes nothing.
  console.error(e instanceof PublishError ? `refused: ${e.message}` : e)
  process.exit(1)
})
