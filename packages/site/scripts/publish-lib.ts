/**
 * The publish command's Node-side helpers (spec 2026-09-22 §6). The checks themselves live in
 * `src/lib/item-checks.ts`, shared with the Worker's upload route.
 */
import { createHash } from 'node:crypto'
import { CONTENT_TYPE, extensionOf, rowFor, type Manifest, type Row } from '../src/lib/item-checks'
export { checkFile, checkFileName, checkSlug, parseManifest, PublishError, MAX_MANIFEST_BYTES, MAX_SOUND_BYTES, MAX_THEME_BYTES } from '../src/lib/item-checks'
export type { Kind, Manifest, Row } from '../src/lib/item-checks'
export interface Upload { key: string; path?: string; body?: Uint8Array; contentType: string; disposition: string }

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export function buildRow(m: Manifest, fileName: string, bytes: Uint8Array, publishedAt: string): Row {
  return rowFor(m, fileName, bytes, sha256(bytes), publishedAt)
}

/** The objects to put in R2: the file itself, and a theme's two previews. Keys are content-addressed and never reused. */
export function uploadsFor(row: Row, filePath: string, previews: { zh: string; en: string } | null): Upload[] {
  const out: Upload[] = [{ key: row.file_key, path: filePath, contentType: CONTENT_TYPE[extensionOf(row.file_name)]!, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}` }]
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
