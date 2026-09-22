/**
 * The explorer's publish checks (spec 2026-09-22 §6), pure so they can be tested without
 * Cloudflare. `publish.ts` runs them, then uploads and writes the row. Nothing here reads the
 * network or the permission evidence, which stays in the maintainer's private records.
 */
import { createHash } from 'node:crypto'
import { parseScheme } from '../../core/src/scheme/document'
import { renderSchemePreview } from '../../core/src/scheme/preview'
import { canonicalPngIssue, MAX_DIMENSION, MAX_PNG_BYTES } from '../../crosshair/src/png'
import { parseCs2 } from '../../crosshair/src/cs2'
import { parseValorant } from '../../crosshair/src/valorant'
import { RESERVED_SLUG } from '../src/lib/explore-types'

export type Kind = 'theme' | 'sound' | 'crosshair'
export interface Manifest {
  slug: string; kind: Kind; title: { zh: string; en: string }; summary: { zh: string; en: string }
  author: string; authorUrl: string | null; licence: string; code: string | null; featured: number | null
}
export interface Row {
  slug: string; kind: Kind; status: 'published'; title_zh: string; title_en: string; summary_zh: string; summary_en: string
  author: string; author_url: string | null; licence: string; file_name: string; file_key: string; bytes: number
  sha256: string; code: string | null; featured: number | null; published_at: string
}
export interface Upload { key: string; path?: string; body?: Uint8Array; contentType: string; disposition: string }

export class PublishError extends Error {}
const fail = (message: string): never => { throw new PublishError(message) }

export const MAX_MANIFEST_BYTES = 16 * 1024
export const MAX_THEME_BYTES = 1024 * 1024
export const MAX_SOUND_BYTES = 5 * 1024 * 1024
const EXT: Record<Kind, readonly string[]> = { theme: ['.json'], sound: ['.wav', '.ogg'], crosshair: ['.png'] }
const CONTENT_TYPE: Record<string, string> = { '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.png': 'image/png' }
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** The App's slug rule (`validateProfileId`, packages/app/src/profiles/model.ts), plus the reserved shell path. */
export function checkSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)) fail('slug: lowercase letters, digits, - and _, starting with a letter or digit, at most 64 characters')
  if (slug === RESERVED_SLUG) fail(`slug: "${RESERVED_SLUG}" is reserved`)
  return slug as string
}

/**
 * The App's add rules for a file name (`Assert-KvkImportFileName` in kvk-import.ps1 and
 * `Assert-KvkCrosshairTargetName` in kvk-crosshair.ps1), so a downloaded file can always be dropped in.
 */
export function checkFileName(kind: Kind, name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  const stem = name.slice(0, name.length - ext.length)
  const bad = name.length === 0 || name.length > 128 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /^[. ]|[. ]$/.test(name) || name.includes('..')
    || !EXT[kind].includes(ext) || DEVICE.test(name.split('.')[0] ?? '') || stem.trim() === '' || /[. ]$/.test(stem) || (kind === 'sound' && stem.includes(';'))
  if (bad) fail(`file name "${name}": must end with ${EXT[kind].join(' or ')}, be at most 128 characters, and contain no \\ / : * ? " < > |, control characters or "..", no leading or trailing dot or space${kind === 'sound' ? ', and no ; in the name' : ''}`)
  return name
}

const text = (v: unknown, field: string, max: number): string => {
  if (typeof v !== 'string' || v.trim() === '' || v !== v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) fail(`${field}: a non-empty single line without surrounding spaces, at most ${max} characters`)
  return v as string
}
const pair = (v: unknown, field: string, max: number): { zh: string; en: string } => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(`${field}: an object with "zh" and "en"`)
  const o = v as Record<string, unknown>
  const extra = Object.keys(o).filter(k => k !== 'zh' && k !== 'en')
  if (extra.length) fail(`${field}: unknown field ${extra.join(', ')}`)
  return { zh: text(o.zh, `${field}.zh`, max), en: text(o.en, `${field}.en`, max) }
}

const FIELDS = ['slug', 'kind', 'title', 'summary', 'author', 'authorUrl', 'licence', 'code', 'featured'] as const

/** `item.json`: strict — unknown fields, a missing licence or author, or a bad link all refuse. */
export function parseManifest(bytes: Uint8Array): Manifest {
  if (bytes.length > MAX_MANIFEST_BYTES) fail(`item.json is larger than ${MAX_MANIFEST_BYTES} bytes`)
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return fail('item.json is not valid UTF-8 JSON') }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('item.json must be an object')
  const o = raw as Record<string, unknown>
  const extra = Object.keys(o).filter(k => !(FIELDS as readonly string[]).includes(k))
  if (extra.length) fail(`item.json: unknown field ${extra.join(', ')}`)
  const kind = o.kind
  if (kind !== 'theme' && kind !== 'sound' && kind !== 'crosshair') return fail('kind: "theme", "sound" or "crosshair"')
  const authorUrl = o.authorUrl ?? null
  if (authorUrl !== null && (typeof authorUrl !== 'string' || authorUrl.length > 300 || !/^https:\/\/[^\s"'<>]+$/.test(authorUrl))) fail('authorUrl: an https:// link, or leave it out')
  const licence = o.licence
  if (typeof licence !== 'string' || !(licence === 'permission' || /^[A-Za-z0-9][A-Za-z0-9.+-]{1,39}$/.test(licence))) fail('licence: an SPDX id such as CC-BY-4.0 or CC0-1.0, or "permission" for "used with the author\'s permission"')
  const code = o.code ?? null
  if (code !== null) {
    if (kind !== 'crosshair') fail('code: only a crosshair carries a code')
    if (typeof code !== 'string' || code.length > 512) fail('code: a CS2 or VALORANT crosshair code, at most 512 characters')
    try { if (/^CSGO-/i.test((code as string).trim())) parseCs2(code as string); else parseValorant(code as string) } catch (e) { fail(`code: not a crosshair code the tool can read (${e instanceof Error ? e.message : String(e)})`) }
  }
  const featured = o.featured ?? null
  if (featured !== null && !(Number.isInteger(featured) && (featured as number) >= 1 && (featured as number) <= 99)) fail('featured: a position from 1 to 99, or leave it out')
  return {
    slug: checkSlug(o.slug), kind, title: pair(o.title, 'title', 80), summary: pair(o.summary, 'summary', 400),
    author: text(o.author, 'author', 80), authorUrl: authorUrl as string | null, licence: licence as string,
    code: code as string | null, featured: featured as number | null,
  }
}

const u32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n))

/** The per-kind content check. A theme also yields its preview, rendered once per language. */
export function checkFile(kind: Kind, name: string, bytes: Uint8Array): { previews: { zh: string; en: string } | null } {
  checkFileName(kind, name)
  if (kind === 'theme') {
    if (bytes.length > MAX_THEME_BYTES) fail(`theme is larger than ${MAX_THEME_BYTES} bytes`)
    let doc
    try { doc = parseScheme(bytes) } catch (e) { return fail(`theme: Aimloom's theme reader refuses it (${e instanceof Error ? e.message : String(e)})`) }
    return { previews: { zh: renderSchemePreview(doc, 'zh'), en: renderSchemePreview(doc, 'en') } }
  }
  if (kind === 'crosshair') {
    if (bytes.length > MAX_PNG_BYTES) fail(`crosshair PNG is larger than ${MAX_PNG_BYTES} bytes`)
    const issue = canonicalPngIssue(bytes)
    if (issue) fail(`crosshair: ${issue.en}`)
    const w = u32(bytes, 16), h = u32(bytes, 20)
    if (w < 1 || h < 1 || w > MAX_DIMENSION || h > MAX_DIMENSION) fail(`crosshair PNG is ${w}×${h}; Aimloom accepts at most ${MAX_DIMENSION}×${MAX_DIMENSION}`)
    return { previews: null }
  }
  if (bytes.length === 0 || bytes.length > MAX_SOUND_BYTES) fail(`sound must be between 1 byte and ${MAX_SOUND_BYTES} bytes`)
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const ok = ext === '.wav' ? ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE' : ascii(bytes, 0, 4) === 'OggS'
  if (!ok) fail(`sound: the content is not ${ext === '.wav' ? 'a RIFF/WAVE file' : 'an Ogg file'}`)
  return { previews: null }
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export function buildRow(m: Manifest, fileName: string, bytes: Uint8Array, publishedAt: string): Row {
  const hash = sha256(bytes)
  return {
    slug: m.slug, kind: m.kind, status: 'published', title_zh: m.title.zh, title_en: m.title.en, summary_zh: m.summary.zh, summary_en: m.summary.en,
    author: m.author, author_url: m.authorUrl, licence: m.licence, file_name: fileName, file_key: `files/${hash}/${fileName}`,
    bytes: bytes.length, sha256: hash, code: m.code, featured: m.featured, published_at: publishedAt,
  }
}

/** The objects to put in R2: the file itself, and a theme's two previews. Keys are content-addressed and never reused. */
export function uploadsFor(row: Row, filePath: string, previews: { zh: string; en: string } | null): Upload[] {
  const ext = row.file_name.slice(row.file_name.lastIndexOf('.')).toLowerCase()
  const out: Upload[] = [{ key: row.file_key, path: filePath, contentType: CONTENT_TYPE[ext]!, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}` }]
  if (previews) for (const lang of ['zh', 'en'] as const) out.push({ key: `previews/${row.sha256}/${lang}.svg`, body: new TextEncoder().encode(previews[lang]), contentType: 'image/svg+xml', disposition: 'inline' })
  return out
}

const lit = (v: string | number | null): string => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)
const COLUMNS = ['slug', 'kind', 'status', 'title_zh', 'title_en', 'summary_zh', 'summary_en', 'author', 'author_url', 'licence', 'file_name', 'file_key', 'bytes', 'sha256', 'code', 'featured', 'published_at'] as const

/**
 * One upsert. A republished slug keeps its first `published_at` and its download counts; the
 * previous file stays in R2 under its own key (spec §5.2).
 */
export function upsertSql(row: Row): string {
  const values = COLUMNS.map(c => lit(row[c])).join(', ')
  const updates = COLUMNS.filter(c => c !== 'slug' && c !== 'published_at').map(c => `${c} = excluded.${c}`).join(', ')
  return `INSERT INTO item (${COLUMNS.join(', ')}) VALUES (${values}) ON CONFLICT(slug) DO UPDATE SET ${updates};\n`
}
