#!/usr/bin/env node
// Generates a deploy-time wrangler config with the real Cloudflare D1 database ids, read from
// an untracked local file, and writes it next to wrangler.jsonc as a gitignored file.
// wrangler.jsonc itself is tracked and carries placeholder ids only -- this repository is meant
// to become public, and a real D1 database id must never sit in a tracked file.
//
//   node scripts/wrangler-config.mjs
//
// Reads:
//   packages/site/wrangler.jsonc                         the tracked template (placeholder ids)
//   $AIMLOOM_SITE_CONFIG or ~/.config/aimloom/site.json   the real ids, shaped:
//     { "d1": { "production": "<uuid>", "preview": "<uuid>" } }
//
// Writes packages/site/.wrangler.generated.jsonc with the placeholders replaced by the real
// ids (everything else copied through unchanged, comments included). Stops with a clear
// message (exit 1) if the local file is missing, unreadable or incomplete -- this script never
// writes a generated config that still carries a placeholder id.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const SITE_DIR = resolve(__dirname, '..')
export const WRANGLER_SOURCE = join(SITE_DIR, 'wrangler.jsonc')
export const GENERATED_PATH = join(SITE_DIR, '.wrangler.generated.jsonc')

export const PLACEHOLDER_PRODUCTION = '00000000-0000-0000-0000-000000000000'
export const PLACEHOLDER_PREVIEW = '00000000-0000-0000-0000-000000000001'

export function resolveConfigPath(env = process.env) {
  const envPath = env.AIMLOOM_SITE_CONFIG
  if (envPath) return envPath
  return join(homedir(), '.config', 'aimloom', 'site.json')
}

/** Reads and validates the untracked local file holding the real D1 database ids. */
export function loadRealIds(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(
      `real Cloudflare D1 database ids not found at ${configPath}. Create it (see packages/site/` +
      `README.md, "Deploying the Worker") or set $AIMLOOM_SITE_CONFIG to point at it. Refusing to ` +
      `deploy with placeholder ids.`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`${configPath} is not valid JSON: ${err.message}`)
  }
  const production = parsed?.d1?.production
  const preview = parsed?.d1?.preview
  if (typeof production !== 'string' || production.length === 0) {
    throw new Error(`${configPath} is missing "d1.production"`)
  }
  if (typeof preview !== 'string' || preview.length === 0) {
    throw new Error(`${configPath} is missing "d1.preview"`)
  }
  return { production, preview }
}

/** Replaces the two placeholder database ids in wrangler.jsonc's text with the real ones. */
export function generateConfig(sourceText, ids) {
  if (!sourceText.includes(PLACEHOLDER_PRODUCTION)) {
    throw new Error(`wrangler.jsonc no longer contains the production placeholder id ${PLACEHOLDER_PRODUCTION}`)
  }
  if (!sourceText.includes(PLACEHOLDER_PREVIEW)) {
    throw new Error(`wrangler.jsonc no longer contains the preview placeholder id ${PLACEHOLDER_PREVIEW}`)
  }
  return sourceText.split(PLACEHOLDER_PRODUCTION).join(ids.production).split(PLACEHOLDER_PREVIEW).join(ids.preview)
}

function main() {
  const configPath = resolveConfigPath()
  const ids = loadRealIds(configPath)
  const sourceText = readFileSync(WRANGLER_SOURCE, 'utf8')
  const generated = generateConfig(sourceText, ids)
  writeFileSync(GENERATED_PATH, generated)
  console.log(`wrote ${GENERATED_PATH}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(String(err.message ?? err))
    process.exit(1)
  }
}
