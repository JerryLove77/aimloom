import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../../crosshair/src/png'
import { buildRow, checkFile, checkFileName, checkSlug, parseManifest, PublishError, upsertSql, uploadsFor, type Manifest } from '../scripts/publish-lib'
import { oggCrc, pngCrc } from '../src/lib/item-checks'

// The tracked synthetic corpus, not real content.
const THEME = new Uint8Array(readFileSync(new URL('../../../KVK Settings 2025/Themes/Sample Alpha.json', import.meta.url)))
const png = (w: number, h: number) => encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(255), warnings: [] })
const A = (t: string) => [...t].map(c => c.charCodeAt(0))
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
/** A real 8 kHz mono 16-bit PCM WAV with `samples` samples; `extra` chunks go before data. */
function wav(samples = 800, extra: number[] = []): Uint8Array {
  const fmt = [...A('fmt '), ...le32(16), 1, 0, 1, 0, ...le32(8000), ...le32(16000), 2, 0, 16, 0]
  const data = [...A('data'), ...le32(samples * 2), ...new Array(samples * 2).fill(0)]
  const body = [...A('WAVE'), ...fmt, ...extra, ...data]
  return new Uint8Array([...A('RIFF'), ...le32(body.length), ...body])
}
/** One Ogg page with a correct CRC. */
function oggPage(flags: number, seq: number, payload: number[], serial = 7): number[] {
  const page = [...A('OggS'), 0, flags, ...new Array(8).fill(0), ...le32(serial), ...le32(seq), 0, 0, 0, 0, 1, payload.length, ...payload]
  const crc = oggCrc(new Uint8Array(page)); page.splice(22, 4, ...le32(crc)); return page
}
const ogg = (pages = [oggPage(2, 0, [1, ...A('vorbis'), 0, 0, 0]), oggPage(4, 1, [9, 9, 9])]) => new Uint8Array(pages.flat())
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
function pngChunk(type: string, data: number[]): number[] { const body = [...A(type), ...data]; return [...be32(data.length), ...body, ...be32(pngCrc(new Uint8Array(body)))] }
/** Inserts a PNG chunk (with a correct CRC) just before IEND. */
function withChunk(bytes: Uint8Array, type: string, data: number[]): Uint8Array {
  const body = [...A(type), ...data]; const crc = pngCrc(new Uint8Array(body))
  const chunk = [data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...body, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]
  return new Uint8Array([...bytes.subarray(0, bytes.length - 12), ...chunk, ...bytes.subarray(bytes.length - 12)])
}
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
const valid = { slug: 'sample-alpha', kind: 'theme', title: { zh: '示例', en: 'Sample' }, summary: { zh: '示例简介', en: 'A sample.' }, author: 'Sample author', licence: 'CC0-1.0' }
const refuses = (f: () => unknown, what: RegExp) => { expect(f).toThrow(PublishError); expect(f).toThrow(what) }
const rejects = async (p: Promise<unknown>, what: RegExp) => { await expect(p).rejects.toBeInstanceOf(PublishError); await expect(p).rejects.toThrow(what) }

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
  it('reads a theme with Aimloom\'s theme reader and renders its preview in both languages', async () => {
    const { previews, bytes } = await checkFile('theme', 'Sample Alpha.json', THEME)
    expect(bytes).toBe(THEME)
    expect(previews!.zh).toMatch(/^<svg/); expect(previews!.en).toMatch(/^<svg/); expect(previews!.zh).not.toBe(previews!.en)
    await rejects(checkFile('theme', 'broken.json', new TextEncoder().encode('{"nope": 1}')), /theme reader refuses/)
  })
  it('takes a canonical RGBA crosshair PNG up to 512×512 only, and stores it re-encoded', async () => {
    const clean = png(64, 64)
    const out = await checkFile('crosshair', 'dot.png', clean)
    expect(out.previews).toBeNull(); expect(out.bytes).toEqual(clean)
    // The encoder itself refuses 513 px, so widen a valid PNG's IHDR: only the declared size is checked here.
    const big = png(4, 4); new DataView(big.buffer, big.byteOffset).setUint32(16, 513)
    await rejects(checkFile('crosshair', 'big.png', big), /at most 512×512/)
    await rejects(checkFile('crosshair', 'fake.png', new Uint8Array(100)), /crosshair:/)
  })
  it('decodes a real-world PNG — compressed, every row filter — to exactly its pixels', async () => {
    const w = 23, h = 17, stride = w * 4
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 97 + (i >> 5) * 13) & 255)
    const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
    const raw: number[] = []
    for (let y = 0; y < h; y++) {
      const f = y % 5; raw.push(f)
      for (let x = 0; x < stride; x++) {
        const v = px[y * stride + x]!, a = x >= 4 ? px[y * stride + x - 4]! : 0, b = y > 0 ? px[(y - 1) * stride + x]! : 0, c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4]! : 0
        raw.push((v - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!) & 255)
      }
    }
    const { deflateSync } = await import('node:zlib')
    const ihdr = [...be32(w), ...be32(h), 8, 6, 0, 0, 0]
    const real = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...pngChunk('IHDR', ihdr), ...pngChunk('IDAT', [...deflateSync(new Uint8Array(raw), { level: 9 })]), ...pngChunk('IEND', [])])
    const out = await checkFile('crosshair', 'real.png', real)
    expect(out.bytes).toEqual(encodePng({ width: w, height: h, data: px, warnings: [] }))
  })
  it('refuses anything smuggled in a PNG, and strips harmless metadata', async () => {
    const clean = png(8, 8)
    await rejects(checkFile('crosshair', 'x.png', new Uint8Array([...clean, ...A('MZ payload')])), /data after its end/)
    const damaged = clean.slice(); damaged[40] = damaged[40]! ^ 0xff
    await rejects(checkFile('crosshair', 'x.png', damaged), /damaged/)
    await rejects(checkFile('crosshair', 'x.png', withChunk(clean, 'ZZZZ', [1, 2, 3])), /ZZZZ chunk Aimloom does not accept/)
    await rejects(checkFile('crosshair', 'x.png', withChunk(clean, 'tEXt', new Array(70 * 1024).fill(65))), /too much extra data/)
    const tagged = withChunk(clean, 'tEXt', [...A('Comment'), 0, ...A('hello')])
    const out = await checkFile('crosshair', 'x.png', tagged)
    expect(out.bytes).toEqual(clean); expect(new TextDecoder().decode(out.bytes)).not.toContain('hello')
  })
  it('takes a WAV only when every chunk is audio and the sizes add up exactly', async () => {
    expect((await checkFile('sound', 'a.wav', wav())).bytes).toEqual(wav())
    expect((await checkFile('sound', 'a.wav', wav(800, [...A('LIST'), ...le32(4), ...A('INFO')]))).previews).toBeNull()
    await rejects(checkFile('sound', 'a.wav', new Uint8Array([...wav(), ...A('EXTRA')])), /declared size does not match/)
    const hidden = wav(800, [...A('junk'), ...le32(4), 1, 2, 3, 4])
    await rejects(checkFile('sound', 'a.wav', hidden), /"junk" chunk Aimloom does not accept/)
    await rejects(checkFile('sound', 'a.wav', ogg()), /not a RIFF\/WAVE file/)
  })
  it('takes an Ogg file only as one CRC-checked Vorbis or Opus stream with nothing between or after', async () => {
    expect((await checkFile('sound', 'a.ogg', ogg())).previews).toBeNull()
    await rejects(checkFile('sound', 'a.ogg', new Uint8Array([...ogg(), ...A('tail')])), /data between or after its pages/)
    const broken = ogg(); broken[30] = broken[30]! ^ 1
    await rejects(checkFile('sound', 'a.ogg', broken), /damaged/)
    await rejects(checkFile('sound', 'a.ogg', ogg([oggPage(2, 0, [1, ...A('vorbis')]), oggPage(0, 1, [1])])), /does not end its stream/)
    await rejects(checkFile('sound', 'a.ogg', ogg([oggPage(2, 0, [...A('notaudio')]), oggPage(4, 1, [1])])), /not Vorbis or Opus/)
    await rejects(checkFile('sound', 'a.ogg', ogg([oggPage(2, 0, [1, ...A('vorbis')]), oggPage(4, 1, [1], 8)])), /more than one stream/)
    await rejects(checkFile('sound', 'a.ogg', wav()), /not an Ogg file/)
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
