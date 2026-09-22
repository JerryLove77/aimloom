import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../../crosshair/src/png'
import { buildRow, checkFile, checkFileName, checkSlug, parseManifest, PublishError, upsertSql, uploadsFor, type Manifest } from '../scripts/publish-lib'

// The tracked synthetic corpus, not real content.
const THEME = new Uint8Array(readFileSync(new URL('../../../KVK Settings 2025/Themes/Sample Alpha.json', import.meta.url)))
const png = (w: number, h: number) => encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(255), warnings: [] })
const wav = () => new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([36, 0, 0, 0], [...'WAVEfmt '].map(c => c.charCodeAt(0)), new Array(28).fill(0)))
const ogg = () => new Uint8Array([...'OggS'].map(c => c.charCodeAt(0)).concat(new Array(24).fill(0)))
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
const valid = { slug: 'sample-alpha', kind: 'theme', title: { zh: '示例', en: 'Sample' }, summary: { zh: '示例简介', en: 'A sample.' }, author: 'Sample author', licence: 'CC0-1.0' }
const refuses = (f: () => unknown, what: RegExp) => { expect(f).toThrow(PublishError); expect(f).toThrow(what) }

describe('item.json', () => {
  it('accepts a complete manifest and fills the optional fields with null', () => {
    expect(parseManifest(enc(valid))).toEqual({ ...valid, authorUrl: null, code: null, featured: null })
  })
  it('refuses an unknown field, a missing licence or author, and a non-https author link', () => {
    refuses(() => parseManifest(enc({ ...valid, tags: [] })), /unknown field tags/)
    refuses(() => parseManifest(enc({ ...valid, licence: undefined })), /licence/)
    refuses(() => parseManifest(enc({ ...valid, author: ' ' })), /author/)
    refuses(() => parseManifest(enc({ ...valid, authorUrl: 'javascript:alert(1)' })), /authorUrl/)
    refuses(() => parseManifest(enc({ ...valid, authorUrl: 'http://example.com' })), /authorUrl/)
    refuses(() => parseManifest(enc({ ...valid, title: { zh: '示例', en: 'Sample', fr: 'x' } })), /title: unknown field fr/)
  })
  it('accepts "permission" as the licence for files used with the author\'s permission', () => {
    expect(parseManifest(enc({ ...valid, licence: 'permission' })).licence).toBe('permission')
  })
  it('takes a crosshair code only on a crosshair, and only one the tool can read', () => {
    refuses(() => parseManifest(enc({ ...valid, code: 'CSGO-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA' })), /only a crosshair/)
    refuses(() => parseManifest(enc({ ...valid, kind: 'crosshair', code: 'not a code' })), /not a crosshair code/)
  })
  it('keeps slugs to the App\'s rule and reserves the detail shell\'s path', () => {
    expect(checkSlug('night-blue_2')).toBe('night-blue_2')
    for (const bad of ['Night', '-x', 'a'.repeat(65), 'con', 'item-shell', '夜']) refuses(() => checkSlug(bad), /slug/)
  })
})

describe('the file', () => {
  it('follows the App\'s add rules for names', () => {
    expect(checkFileName('sound', 'crisp hit.ogg')).toBe('crisp hit.ogg')
    for (const [kind, bad] of [['theme', 'a.png'], ['sound', 'a;b.wav'], ['crosshair', 'CON.png'], ['theme', '.x.json'], ['theme', 'a..b.json'], ['crosshair', 'a?.png'], ['theme', `${'a'.repeat(124)}.json`]] as const) refuses(() => checkFileName(kind, bad), /file name/)
  })
  it('reads a theme with Aimloom\'s theme reader and renders its preview in both languages', () => {
    const { previews } = checkFile('theme', 'Sample Alpha.json', THEME)
    expect(previews!.zh).toMatch(/^<svg/); expect(previews!.en).toMatch(/^<svg/); expect(previews!.zh).not.toBe(previews!.en)
    refuses(() => checkFile('theme', 'broken.json', new TextEncoder().encode('{"nope": 1}')), /theme reader refuses/)
  })
  it('takes a canonical RGBA crosshair PNG up to 512×512 only', () => {
    expect(checkFile('crosshair', 'dot.png', png(64, 64)).previews).toBeNull()
    // The encoder itself refuses 513 px, so widen a valid PNG's IHDR: only the declared size is checked here.
    const big = png(4, 4); new DataView(big.buffer, big.byteOffset).setUint32(16, 513)
    refuses(() => checkFile('crosshair', 'big.png', big), /at most 512×512/)
    refuses(() => checkFile('crosshair', 'fake.png', new Uint8Array(100)), /crosshair:/)
  })
  it('takes a sound whose content matches its extension', () => {
    expect(checkFile('sound', 'a.wav', wav()).previews).toBeNull(); expect(checkFile('sound', 'a.ogg', ogg()).previews).toBeNull()
    refuses(() => checkFile('sound', 'a.wav', ogg()), /RIFF\/WAVE/); refuses(() => checkFile('sound', 'a.ogg', wav()), /Ogg/)
  })
})

describe('what gets written', () => {
  const m: Manifest = { ...parseManifest(enc(valid)), title: { zh: "O'Neil 的", en: "O'Neil's" } }
  const row = buildRow(m, 'Sample Alpha.json', THEME, '2026-10-01T00:00:00.000Z')
  it('keys the file by its SHA-256 so a new version never overwrites an old one', () => {
    expect(row.file_key).toBe(`files/${row.sha256}/Sample Alpha.json`); expect(row.bytes).toBe(THEME.length); expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('uploads the file as an attachment under its own name, and a theme\'s two previews', () => {
    const ups = uploadsFor(row, '/tmp/x', { zh: '<svg/>', en: '<svg/>' })
    expect(ups.map(u => u.key)).toEqual([row.file_key, `previews/${row.sha256}/zh.svg`, `previews/${row.sha256}/en.svg`])
    expect(ups[0]).toMatchObject({ contentType: 'application/json', disposition: "attachment; filename*=UTF-8''Sample%20Alpha.json" })
  })
  it('quotes every value, and a republish keeps the first publication date and the counts', () => {
    const sql = upsertSql(row)
    expect(sql).toContain("'O''Neil''s'"); expect(sql).toContain('ON CONFLICT(slug) DO UPDATE SET')
    expect(sql).not.toContain('published_at = excluded.published_at'); expect(sql).toContain('author_url')
    expect(sql).toMatch(/, NULL, /)
  })
})
