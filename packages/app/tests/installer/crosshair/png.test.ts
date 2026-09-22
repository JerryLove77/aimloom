import { describe, expect, it, vi } from 'vitest'
import { encodePng, canonicalPngIssue } from '../../../../crosshair/src/png'
import { toCanonicalPng, type RgbaDecoder } from '../../../src/crosshair/png'
import { errorMsg } from '../../../src/workspace/issue-text'
import { renderMsg, type Msg } from '../../../src/i18n'

const renderEn = (msg: Msg) => renderMsg('en', msg)

/** A 3x2 image sized to stay well inside the bounds. */
function pixels(width = 3, height = 2) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = index * 11
    data[index * 4 + 1] = 255 - index
    data[index * 4 + 2] = 3
    data[index * 4 + 3] = index % 2 ? 255 : 64
  }
  return data
}
const decoderReturning = (width: number, height: number, data: Uint8Array) => vi.fn(async () => ({ width, height, data }))

describe('canonicalising a chosen crosshair image', () => {
  it('passes an already-canonical PNG through byte for byte without decoding it', async () => {
    const canonical = encodePng({ width: 3, height: 2, data: pixels(), warnings: [] })
    const decode = vi.fn()
    const result = await toCanonicalPng(canonical, decode)
    expect(Array.from(result)).toEqual(Array.from(canonical))
    // Re-encoding identical pixels would be wasted work, and the user's bytes are kept.
    expect(decode).not.toHaveBeenCalled()
  })

  it('decodes and re-encodes an image that is not canonical RGBA', async () => {
    const rgb = Uint8Array.from(encodePng({ width: 3, height: 2, data: pixels(), warnings: [] }))
    rgb[25] = 2 // colour type 2: readable by the browser, refused by the game adapter
    const decode: RgbaDecoder = decoderReturning(3, 2, pixels())
    const result = await toCanonicalPng(rgb, decode)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(canonicalPngIssue(result)).toBeNull()
    expect(result[25]).toBe(6)
    expect(Array.from(result)).toEqual(Array.from(encodePng({ width: 3, height: 2, data: pixels(), warnings: [] })))
  })

  it('refuses an image that cannot be decoded', async () => {
    const decode: RgbaDecoder = vi.fn(async () => { throw new Error('bad image') })
    await expect(toCanonicalPng(new Uint8Array([1, 2, 3, 4]), decode)).rejects.toThrow(/无法读取|解码/)
  })

  it('refuses an image outside the accepted bounds', async () => {
    const oversized = encodePng({ width: 3, height: 2, data: pixels(), warnings: [] })
    const deep = Uint8Array.from(oversized)
    deep[25] = 2
    await expect(toCanonicalPng(deep, decoderReturning(513, 2, pixels(513 * 2, 1)))).rejects.toThrow(/512/)
    // A canonical but oversized file must be refused without decoding it either.
    const wide = encodePng({ width: 512, height: 512, data: new Uint8Array(512 * 512 * 4), warnings: [] })
    await expect(toCanonicalPng(wide, vi.fn())).resolves.toBeDefined()
    await expect(toCanonicalPng(new Uint8Array(2 * 1024 * 1024 + 4), decoderReturning(2, 2, pixels(4, 1)))).rejects.toThrow(/2 MiB|大小/)
  })

  it('refuses in both languages, so an English player reads the real reason', async () => {
    // A Chinese-only Error would collapse to the caller's generic "Can't use this image." line.
    const reason = await toCanonicalPng(new Uint8Array(2 * 1024 * 1024 + 4), decoderReturning(2, 2, pixels(4, 1))).catch(error => error as unknown)
    const msg = errorMsg(reason, { key: 'crosshair.error.useImage' })
    expect(msg).toEqual({ zh: expect.stringContaining('2 MiB'), en: expect.stringContaining('2 MiB') })
    expect(renderEn(msg)).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/)
    expect(renderEn(msg)).not.toBe(renderEn({ key: 'crosshair.error.useImage' }))
  })
})
