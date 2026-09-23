/**
 * The item checks shared by the publish command and the Worker's upload route (spec 2026-09-22
 * §6, §11.3). Pure and platform-neutral: no Node, no bindings.
 */
import { parseScheme } from '../../../core/src/scheme/document'
import { renderSchemePreview } from '../../../core/src/scheme/preview'
import { canonicalPngIssue, encodePng, MAX_DIMENSION, MAX_PNG_BYTES } from '../../../crosshair/src/png'
import { parseCs2 } from '../../../crosshair/src/cs2'
import { parseValorant } from '../../../crosshair/src/valorant'
import { RESERVED_SLUGS } from './explore-types'

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

export class PublishError extends Error {}
const fail = (message: string): never => { throw new PublishError(message) }

export const MAX_MANIFEST_BYTES = 16 * 1024
export const MAX_THEME_BYTES = 1024 * 1024
export const MAX_SOUND_BYTES = 5 * 1024 * 1024
const EXT: Record<Kind, readonly string[]> = { theme: ['.json'], sound: ['.wav', '.ogg'], crosshair: ['.png'] }
export const CONTENT_TYPE: Record<string, string> = { '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.png': 'image/png' }
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** The App's slug rule (`validateProfileId`, packages/app/src/profiles/model.ts), plus the reserved shell path. */
export function checkSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)) fail('slug: lowercase letters, digits, - and _, starting with a letter or digit, at most 64 characters')
  if ((RESERVED_SLUGS as readonly string[]).includes(slug as string)) fail(`slug: "${slug}" is reserved`)
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
const pair = (v: unknown, field: string, max: number, optional = false): { zh: string; en: string } => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(`${field}: an object with "zh" and "en"`)
  const o = v as Record<string, unknown>
  const extra = Object.keys(o).filter(k => k !== 'zh' && k !== 'en')
  if (extra.length) fail(`${field}: unknown field ${extra.join(', ')}`)
  const one = (k: 'zh' | 'en') => (optional && (o[k] === undefined || o[k] === '') ? '' : text(o[k], `${field}.${k}`, max))
  return { zh: one('zh'), en: one('en') }
}

const FIELDS = ['slug', 'kind', 'title', 'summary', 'author', 'authorUrl', 'licence', 'code', 'featured'] as const

/** `item.json`: strict — unknown fields, a missing licence or author, or a bad link all refuse. */
export function parseManifest(bytes: Uint8Array): Manifest {
  if (bytes.length > MAX_MANIFEST_BYTES) fail(`item.json is larger than ${MAX_MANIFEST_BYTES} bytes`)
  let raw: unknown
  // No `fatal` option: the Workers types lack it, and a replacement character means the same thing.
  const decoded = new TextDecoder().decode(bytes)
  if (decoded.includes('\uFFFD')) return fail('item.json is not valid UTF-8 JSON')
  try { raw = JSON.parse(decoded) } catch { return fail('item.json is not valid UTF-8 JSON') }
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
    slug: checkSlug(o.slug), kind, title: pair(o.title, 'title', 80), summary: o.summary === undefined ? { zh: '', en: '' } : pair(o.summary, 'summary', 400, true),
    author: text(o.author, 'author', 80), authorUrl: authorUrl as string | null, licence: licence as string,
    code: code as string | null, featured: featured as number | null,
  }
}

const u32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
const u32le = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0
const u16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8)
const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n))

// ---- strict media checks (user, 2026-09-23: 「这肯定得加，到时候被黑了我都不会修」) ----------
// Nothing uploaded is scanned by Cloudflare, so every file must be exactly a medium of its kind:
// no chunk, page or byte that is not part of the picture or the sound, and nothing after the end.

const PNG_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export function pngCrc(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = PNG_CRC[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const OGG_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; t[n] = c >>> 0 } return t })()
export function oggCrc(bytes: Uint8Array): number { let c = 0; for (const b of bytes) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ b) & 0xff]!) >>> 0; return c >>> 0 }

/** Inflates a zlib stream, refusing any output longer than `max` (no decompression bomb). */
async function inflateCapped(data: Uint8Array, max: number): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate'))
  const out = new Uint8Array(max + 1); let n = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (n + value.length > max) { await reader.cancel(); return fail('crosshair: the PNG\'s image data is larger than its size says') }
    out.set(value, n); n += value.length
  }
  return out.subarray(0, n)
}

const paeth = (a: number, b: number, c: number): number => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }

/**
 * Walks every chunk (CRC checked; only IHDR, IDAT, IEND and small ancillary chunks; nothing after
 * IEND), decodes every pixel, and returns a freshly encoded canonical PNG of those pixels. What is
 * stored is the re-encoded picture, so nothing the uploader added besides pixels survives.
 */
async function cleanPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length > MAX_PNG_BYTES) fail(`crosshair PNG is larger than ${MAX_PNG_BYTES} bytes`)
  const issue = canonicalPngIssue(bytes)
  if (issue) fail(`crosshair: ${issue.en}`)
  const w = u32(bytes, 16), h = u32(bytes, 20)
  if (w < 1 || h < 1 || w > MAX_DIMENSION || h > MAX_DIMENSION) fail(`crosshair PNG is ${w}×${h}; Aimloom accepts at most ${MAX_DIMENSION}×${MAX_DIMENSION}`)
  const idat: Uint8Array[] = []; let pos = 8; let sawEnd = false; let first = true; let ancillary = 0
  while (pos < bytes.length) {
    if (sawEnd) fail('crosshair: the PNG has data after its end')
    if (pos + 12 > bytes.length) fail('crosshair: the PNG is cut off')
    const len = u32(bytes, pos); const type = ascii(bytes, pos + 4, 4)
    if (len > bytes.length || pos + 12 + len > bytes.length) fail('crosshair: the PNG is cut off')
    if (pngCrc(bytes.subarray(pos + 4, pos + 8 + len)) !== u32(bytes, pos + 8 + len)) fail(`crosshair: the PNG's ${type} chunk is damaged`)
    if (first && type !== 'IHDR') fail('crosshair: the PNG does not start with IHDR')
    first = false
    if (type === 'IDAT') idat.push(bytes.subarray(pos + 8, pos + 8 + len))
    else if (type === 'IEND') sawEnd = true
    else if (type !== 'IHDR') {
      // A critical chunk (upper-case first letter) Aimloom does not draw, or a large ancillary one, is refused.
      if (/^[A-Z]/.test(type) || !/^[a-z][a-zA-Z]{3}$/.test(type)) fail(`crosshair: the PNG has a ${type} chunk Aimloom does not accept`)
      ancillary += len; if (ancillary > 64 * 1024) fail('crosshair: the PNG carries too much extra data')
    }
    pos += 12 + len
  }
  if (!sawEnd || idat.length === 0) fail('crosshair: the PNG has no image data or no end')
  const stride = w * 4
  const raw = await inflateCapped(new Uint8Array(idat.reduce<number[]>((a, c) => (a.push(...c), a), [])), h * (stride + 1))
  if (raw.length !== h * (stride + 1)) fail('crosshair: the PNG\'s image data does not match its size')
  const px = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const row = y * stride
    if (f > 4) fail('crosshair: the PNG uses an unknown filter')
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[row + x - 4]! : 0, b = y > 0 ? px[row - stride + x]! : 0, c = x >= 4 && y > 0 ? px[row - stride + x - 4]! : 0
      const v = src[x]!
      px[row + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff
    }
  }
  return encodePng({ width: w, height: h, data: px, warnings: [] })
}

/** RIFF/WAVE, every chunk accounted for, only audio chunks, sane format, nothing after the last chunk. */
function checkWav(b: Uint8Array): void {
  const bad = (why: string): never => fail(`sound: ${why}`)
  if (b.length < 44 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') bad('the content is not a RIFF/WAVE file')
  if (u32le(b, 4) + 8 !== b.length) bad('the WAV\'s declared size does not match the file (extra or missing data)')
  let pos = 12; let fmt = false; let data = false
  while (pos < b.length) {
    if (pos + 8 > b.length) bad('the WAV is cut off')
    const id = ascii(b, pos, 4); const size = u32le(b, pos + 4); const next = pos + 8 + size + (size & 1)
    if (next > b.length) bad('the WAV is cut off')
    if (id === 'fmt ') {
      if (fmt || ![16, 18, 40].includes(size)) bad('the WAV\'s format chunk is not valid')
      const tag = u16le(b, pos + 8), ch = u16le(b, pos + 10), rate = u32le(b, pos + 12), bits = u16le(b, pos + 22)
      if (![1, 3, 0xfffe].includes(tag) || ch < 1 || ch > 8 || rate < 4000 || rate > 384000 || ![8, 16, 24, 32].includes(bits)) bad('the WAV\'s audio format is not one Aimloom accepts')
      fmt = true
    } else if (id === 'data') {
      if (!fmt || data || size === 0) bad('the WAV\'s audio data is missing or out of place')
      data = true
    } else if (id === 'fact' || id === 'LIST') {
      if (size > 64 * 1024) bad(`the WAV's ${id.trim()} chunk is too large`)
    } else bad(`the WAV has a "${id.replace(/[^\x20-\x7e]/g, '?')}" chunk Aimloom does not accept`)
    pos = next
  }
  if (!fmt || !data) bad('the WAV has no audio')
}

/** One Ogg Vorbis or Opus stream: every page CRC-checked, begin and end pages, nothing between or after. */
function checkOgg(b: Uint8Array): void {
  const bad = (why: string): never => fail(`sound: ${why}`)
  let pos = 0; let serial: number | null = null; let pages = 0; let last = 0
  while (pos < b.length) {
    if (pos + 27 > b.length || ascii(b, pos, 4) !== 'OggS' || b[pos + 4] !== 0) bad(pages ? 'the Ogg file has data between or after its pages' : 'the content is not an Ogg file')
    const flags = b[pos + 5]!; const segs = b[pos + 26]!
    if (pos + 27 + segs > b.length) bad('the Ogg file is cut off')
    let body = 0; for (let i = 0; i < segs; i++) body += b[pos + 27 + i]!
    const end = pos + 27 + segs + body
    if (end > b.length) bad('the Ogg file is cut off')
    const page = b.slice(pos, end); page.fill(0, 22, 26)
    if (oggCrc(page) !== u32le(b, pos + 22)) bad('an Ogg page is damaged')
    const s = u32le(b, pos + 14)
    if (serial === null) {
      if (!(flags & 2)) bad('the Ogg file does not begin a stream')
      const head = pos + 27 + segs
      if (!(ascii(b, head, 7) === '\x01vorbis' || ascii(b, head, 8) === 'OpusHead')) bad('the Ogg file is not Vorbis or Opus audio')
      serial = s
    } else if (s !== serial || flags & 2) bad('the Ogg file holds more than one stream')
    last = flags; pages++; pos = end
  }
  if (pages < 2 || !(last & 4)) bad('the Ogg file does not end its stream')
}

/**
 * The per-kind content check, strict (see above). Returns the bytes to store — a crosshair is
 * re-encoded; a theme and a sound are kept as they are once every byte is accounted for — and a
 * theme's preview, rendered once per language.
 */
export async function checkFile(kind: Kind, name: string, bytes: Uint8Array): Promise<{ bytes: Uint8Array; previews: { zh: string; en: string } | null }> {
  checkFileName(kind, name)
  if (kind === 'theme') {
    if (bytes.length > MAX_THEME_BYTES) fail(`theme is larger than ${MAX_THEME_BYTES} bytes`)
    let doc
    try { doc = parseScheme(bytes) } catch (e) { return fail(`theme: Aimloom's theme reader refuses it (${e instanceof Error ? e.message : String(e)})`) }
    return { bytes, previews: { zh: renderSchemePreview(doc, 'zh'), en: renderSchemePreview(doc, 'en') } }
  }
  if (kind === 'crosshair') return { bytes: await cleanPng(bytes), previews: null }
  if (bytes.length === 0 || bytes.length > MAX_SOUND_BYTES) fail(`sound must be between 1 byte and ${MAX_SOUND_BYTES} bytes`)
  if (extensionOf(name) === '.wav') checkWav(bytes); else checkOgg(bytes)
  return { bytes, previews: null }
}

/** A licence the upload form offers; the publish command also takes any SPDX id. */
export const UPLOAD_LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'permission'] as const

/** The SHA-256 as hex, on any platform. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function rowFor(m: Manifest, fileName: string, bytes: Uint8Array, hash: string, publishedAt: string): Row {
  return {
    slug: m.slug, kind: m.kind, status: 'published', title_zh: m.title.zh, title_en: m.title.en, summary_zh: m.summary.zh, summary_en: m.summary.en,
    author: m.author, author_url: m.authorUrl, licence: m.licence, file_name: fileName, file_key: `files/${hash}/${fileName}`,
    bytes: bytes.length, sha256: hash, code: m.code, featured: m.featured, published_at: publishedAt,
  }
}

export const extensionOf = (name: string): string => name.slice(name.lastIndexOf('.')).toLowerCase()
