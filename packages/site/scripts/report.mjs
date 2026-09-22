#!/usr/bin/env node
// Owner tools. `report.mjs AL-260921-7K3F [--preview]` prints one stored report; `--list` prints the latest rows.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The number goes into SQL and onto a command line, so nothing but this exact shape is accepted.
const NUMBER = /^AL-\d{6}-[0-9A-HJKMNP-TV-Z]{4}$/
const LIST = 'SELECT number, created_at, app_label, lang, has_log, has_contact, steam_id, bytes, mail FROM reports ORDER BY created_at DESC LIMIT 20'

// wrangler resolves a database name against a config's own d1_databases list, so this must run
// against the generated config (real ids), never the tracked wrangler.jsonc (placeholder ids) --
// `npm run report` / `report -w @kvk/site` run scripts/wrangler-config.mjs first to produce it.
const CONFIG = ['--config', '.wrangler.generated.jsonc']

export function commandFor(argv) {
  const preview = argv.includes('--preview'); const rest = argv.filter(a => a !== '--preview')
  const target = preview ? ['aimloom-preview', '--env', 'preview'] : ['aimloom']
  if (rest[0] === '--list') return { file: 'npx', one: false, args: ['wrangler', ...CONFIG, 'd1', 'execute', ...target, '--remote', '--command', LIST] }
  if (rest.length !== 1 || !NUMBER.test(rest[0])) throw new Error('Give one report number such as AL-260921-7K3F, or --list.')
  return { file: 'npx', one: true, args: ['wrangler', ...CONFIG, 'd1', 'execute', ...target, '--remote', '--json', '--command', `SELECT body FROM reports WHERE number = '${rest[0]}'`] }
}

/** wrangler's `--json` answer -> the stored report, indented; `null` when no such report exists. */
export function bodyFrom(stdout) {
  // `--json` is meant to print only the JSON array, but a banner line ahead of it (or a corrupted
  // body) must not surface as a raw SyntaxError with no clue what happened.
  const start = stdout.indexOf('[')
  if (start === -1) throw new Error('wrangler printed no JSON array; run without --json to see what it said.')
  let parsed
  try { parsed = JSON.parse(stdout.slice(start)) } catch { throw new Error('wrangler\'s output did not parse as JSON; run without --json to see what it said.') }
  const body = parsed?.[0]?.results?.[0]?.body
  return typeof body === 'string' ? JSON.stringify(JSON.parse(body), null, 2) : null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const c = commandFor(process.argv.slice(2))
    if (!c.one) execFileSync(c.file, c.args, { stdio: 'inherit' })
    else { const body = bodyFrom(execFileSync(c.file, c.args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })); if (body === null) { console.error('No such report.'); process.exit(1) } console.log(body) }
  } catch (e) { console.error(String(e.message ?? e)); process.exit(1) }
}
